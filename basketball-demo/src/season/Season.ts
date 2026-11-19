import type Phaser from 'phaser';
import { DB_TEAMS, PLAYER_BY_ID, TEAM_BY_ID, matchTeams } from './db';
import { Match, STEP } from '../sim/Match';
import { headlessScene } from '../sim/headless';
import { minuteSeed } from '../sim/rng';
import { emptyPlayerStats, type PlayerStats } from '../sim/Player';
import { worseInjury, type InjuryKind } from '../sim/injury';

/**
 * 赛季：随机 10 支球队，常规赛四循环（每两队打 4 场，主客场各 2 场；每队 36 场，共 180 场），前 4 名进季后赛：
 * 半决赛 1 vs 4、2 vs 3，总决赛，全部三局两胜（主场：高-低-高），主场给排名高的一方。
 * 每场比赛有自己的种子，所以“后台模拟”和“打开观看”得到的是同一场比赛，模拟完的比赛也能原样回看。
 * 伤病会带到之后的比赛，所以一场比赛只有在两队之前的比赛都打完后才能开打（readyGames）。
 * 状态是纯数据（可以 JSON 序列化，存在 localStorage）。
 */

export const SEASON_TEAMS = 10;
export const PLAYOFF_TEAMS = 4;

export type Stage = 'regular' | 'semi' | 'final';

/** 一名球员一场比赛的数据 */
export interface BoxLine {
  pid: string;
  team: string;
  starter: boolean;
  stats: PlayerStats;
}

export interface GameResult {
  homePts: number;
  awayPts: number;
  /** 加时次数 */
  ot?: number;
  box: BoxLine[];
  /** 本场新受的伤 */
  injuries?: { pid: string; team: string; kind: InjuryKind; games: number }[];
}

/** 开赛时两队的伤病情况（第一次开打时定下，回看时沿用） */
export interface GameSetup {
  /** 带轻伤上场（能力减半） */
  injured: string[];
  /** 重伤 / 报销，不在名单里 */
  out: string[];
}

/** 伤病记录：left = 还要影响几场（本队的比赛场次） */
export interface Injury {
  pid: string;
  team: string;
  kind: InjuryKind;
  games: number;
  left: number;
  /** 在哪场比赛受的伤 */
  gameId: number;
}

export type NewsKind = 'injury' | 'streak' | 'mvp' | 'award' | 'playoff';

export interface News {
  /** 排序键：触发它的比赛 id（同一场里再按小数排） */
  order: number;
  /** 时间标签，例如“第 12 轮”“季后赛” */
  when: string;
  kind: NewsKind;
  text: string;
}

export interface Game {
  id: number;
  stage: Stage;
  /** 常规赛轮次（1~36）；季后赛为系列赛里的第几场 */
  round: number;
  home: string;
  away: string;
  seed: number;
  /** 季后赛所属系列赛 */
  series?: string;
  setup?: GameSetup;
  result?: GameResult;
}

export interface Series {
  id: string;
  stage: 'semi' | 'final';
  /** 排名高的一方（主场优势） */
  high: string;
  low: string;
  bestOf: 3;
  winsHigh: number;
  winsLow: number;
  winner?: string;
}

export interface SeasonState {
  version: 2;
  seed: number;
  teams: string[];
  games: Game[];
  series: Series[];
  champion?: string;
  injuries: Injury[];
  news: News[];
  /** 各队常规赛当前连胜（负数 = 连败） */
  streaks: Record<string, number>;
  /** MVP 周榜：已结算到第几周、当前榜首和他连续领先的周数 */
  mvpWeek: number;
  mvpLeader: string | null;
  mvpWeeks: number;
}

/** 常规赛循环次数（每两队打 4 场，主客场各 2 场） */
export const CYCLES = 4;
/** 一周 = 3 轮（每队 3 场），MVP 榜按周结算 */
export const ROUNDS_PER_WEEK = 3;

// ---------- 创建 ----------
function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeason(seed: number): SeasonState {
  const rand = makeRand(seed);
  const pool = DB_TEAMS.map((t) => t.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const teams = pool.slice(0, SEASON_TEAMS);
  const st: SeasonState = {
    version: 2,
    seed,
    teams,
    games: [],
    series: [],
    injuries: [],
    news: [],
    streaks: Object.fromEntries(teams.map((t) => [t, 0])),
    mvpWeek: 0,
    mvpLeader: null,
    mvpWeeks: 0,
  };
  // 圆桌法排 9 轮单循环，每轮 5 场；第 2、4 循环主客互换
  const n = teams.length;
  const order = [...teams];
  const first: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      // 交替主客，避免某队总在主场
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    first.push(round);
    order.splice(1, 0, order.pop()!);
  }
  const mirror = first.map((r) => r.map(([h, a]) => [a, h] as [string, string]));
  const rounds: [string, string][][] = [];
  for (let c = 0; c < CYCLES; c++) rounds.push(...(c % 2 === 0 ? first : mirror));
  rounds.forEach((r, ri) => r.forEach(([home, away]) => addGame(st, 'regular', ri + 1, home, away)));
  return st;
}

function addGame(st: SeasonState, stage: Stage, round: number, home: string, away: string, series?: string): Game {
  const id = st.games.length;
  const g: Game = { id, stage, round, home, away, seed: minuteSeed(st.seed, 1000 + id), series };
  st.games.push(g);
  return g;
}

// ---------- 比赛 ----------
/** 下一场还没打的比赛（按顺序） */
export function nextGame(st: SeasonState): Game | undefined {
  return st.games.find((g) => !g.result);
}

export function regularDone(st: SeasonState): boolean {
  return st.games.filter((g) => g.stage === 'regular').every((g) => g.result);
}

export function seasonDone(st: SeasonState): boolean {
  return st.champion !== undefined;
}

/**
 * 现在可以开打的比赛：两队在它之前的比赛都已经有结果（伤病要按顺序结算）。
 * 常规赛同一轮的 5 场互不相关，可以并行；下一轮某队的比赛要等他这一轮打完。
 */
export function readyGames(st: SeasonState): Game[] {
  const blocked = new Set<string>();
  const ready: Game[] = [];
  for (const g of st.games) {
    if (g.result) continue;
    if (!blocked.has(g.home) && !blocked.has(g.away)) ready.push(g);
    blocked.add(g.home);
    blocked.add(g.away);
  }
  return ready;
}

export function isReady(st: SeasonState, g: Game): boolean {
  return !g.result && readyGames(st).some((x) => x.id === g.id);
}

/** 某队目前的伤病：轻伤（能力减半）/ 不能上场 */
export function teamInjuries(st: SeasonState, team: string): Map<string, InjuryKind> {
  const m = new Map<string, InjuryKind>();
  for (const inj of st.injuries) {
    if (inj.team !== team || inj.left <= 0) continue;
    m.set(inj.pid, worseInjury(m.get(inj.pid) ?? null, inj.kind)!);
  }
  return m;
}

/** 开打前定下两队伤病名单（只定一次，之后回看沿用） */
export function prepareGame(st: SeasonState, g: Game): void {
  if (g.setup) return;
  const injured: string[] = [];
  const out: string[] = [];
  for (const t of [g.home, g.away]) {
    for (const [pid, kind] of teamInjuries(st, t)) (kind === 'light' ? injured : out).push(pid);
  }
  g.setup = { injured, out };
}

/** 新建一场比赛对象（观看或后台模拟都用它） */
export function createMatch(g: Game, scene: Phaser.Scene = headlessScene): Match {
  return new Match(scene, g.seed, matchTeams(g.home, g.away, g.setup));
}

/** 从打完的比赛里取结果 */
export function resultFromMatch(g: Game, m: Match): GameResult {
  const home = TEAM_BY_ID.get(g.home)!;
  const away = TEAM_BY_ID.get(g.away)!;
  const box: BoxLine[] = m.roster.map((p) => ({
    pid: p.def.id!,
    team: p.teamId === 'blue' ? home.id : away.id,
    starter: p.starter,
    stats: { ...p.stats },
  }));
  const injuries = m.roster
    .filter((p) => p.newInjury)
    .map((p) => ({ pid: p.def.id!, team: p.teamId === 'blue' ? home.id : away.id, kind: p.newInjury!.kind, games: p.newInjury!.games }));
  return { homePts: m.score('blue'), awayPts: m.score('red'), ot: m.overtime || undefined, box, injuries };
}

/**
 * 后台模拟一场：按固定步长跑到终场。返回一个可以分段调用的迭代器，每次推进 budgetMs 毫秒，
 * 界面就不会卡住；完成时返回结果。
 */
export function* simulateGame(g: Game): Generator<number, GameResult, number> {
  const m = createMatch(g);
  const done = () => m.phase === 'finished';
  let budget = yield 0;
  for (;;) {
    const start = performance.now();
    while (!done() && performance.now() - start < budget) {
      for (let i = 0; i < 60 && !done(); i++) m.update(STEP);
    }
    if (done()) break;
    budget = yield m.gameTime();
  }
  return resultFromMatch(g, m);
}

/** 一次性跑完一场（Web Worker 和脚本里用） */
export function runGame(g: Game): GameResult {
  const it = simulateGame(g);
  it.next();
  let r = it.next(1e9);
  while (!r.done) r = it.next(1e9);
  return r.value;
}

/** 记录比赛结果，并推进赛程（常规赛打完 → 生成半决赛；系列赛分出胜负 → 生成下一轮 / 产生总冠军） */
export function recordResult(st: SeasonState, gameId: number, r: GameResult): void {
  const g = st.games[gameId];
  if (g.result) return;
  g.result = r;
  const when = g.stage === 'regular' ? `第 ${g.round} 轮` : g.stage === 'semi' ? '季后赛半决赛' : '总决赛';
  const news = (kind: NewsKind, text: string, sub = 0) => st.news.push({ order: g.id + sub, when, kind, text });
  // 伤病：两队旧伤各过一场，再记本场新伤
  for (const inj of st.injuries) {
    if ((inj.team === g.home || inj.team === g.away) && inj.left > 0 && inj.kind !== 'season') inj.left--;
  }
  for (const [i, x] of (r.injuries ?? []).entries()) {
    st.injuries.push({ ...x, left: x.games, gameId: g.id });
    const what = x.kind === 'season' ? '重伤，赛季报销' : x.kind === 'light' ? `轻伤 ${x.games} 场（能力减半）` : `重伤，缺阵 ${x.games} 场`;
    news('injury', `${teamShort(x.team)} ${playerName(x.pid)} ${what}`, 0.1 + i * 0.01);
  }
  if (g.stage === 'regular') {
    updateStreaks(st, g, news);
    settleMvpWeeks(st);
    if (regularDone(st) && st.series.length === 0) {
      startPlayoffs(st);
      const t = standings(st).slice(0, PLAYOFF_TEAMS).map((x) => teamShort(x.team));
      const lastReg = Math.max(...st.games.filter((x) => x.stage === 'regular').map((x) => x.id));
      st.news.push({ order: lastReg + 0.6, when: '常规赛结束', kind: 'playoff', text: `常规赛结束，${t.join('、')} 进入季后赛` });
    }
    return;
  }
  const s = st.series.find((x) => x.id === g.series)!;
  const homeWon = r.homePts > r.awayPts;
  const winner = homeWon ? g.home : g.away;
  if (winner === s.high) s.winsHigh++;
  else s.winsLow++;
  const need = Math.ceil(s.bestOf / 2);
  if (s.winsHigh >= need || s.winsLow >= need) {
    s.winner = s.winsHigh >= need ? s.high : s.low;
    const loser = s.winner === s.high ? s.low : s.high;
    const score = `${Math.max(s.winsHigh, s.winsLow)}:${Math.min(s.winsHigh, s.winsLow)}`;
    if (s.stage === 'final') {
      st.champion = s.winner;
      news('playoff', `${teamShort(s.winner)} ${score} 击败 ${teamShort(loser)}，夺得总冠军！`, 0.5);
      // 新闻按时间倒序显示：MVP 排在最上面
      computeAwards(st).forEach((a, i) => {
        if (a.top[0]) st.news.push({ order: g.id + 0.69 - i * 0.01, when: '赛季奖项', kind: 'award', text: `赛季奖项出炉：${teamShort(a.top[0].team)} ${playerName(a.top[0].pid)} 获得${a.name}` });
      });
    } else {
      news('playoff', `${teamShort(s.winner)} ${score} 淘汰 ${teamShort(loser)}，晋级总决赛`, 0.5);
      const semis = st.series.filter((x) => x.stage === 'semi');
      if (semis.every((x) => x.winner) && !st.series.some((x) => x.stage === 'final')) {
        // 决赛主场给常规赛排名高的一方
        const rank = standings(st).map((x) => x.team);
        const [a, b] = semis.map((x) => x.winner!).sort((x, y) => rank.indexOf(x) - rank.indexOf(y));
        const fin: Series = { id: 'final', stage: 'final', high: a, low: b, bestOf: 3, winsHigh: 0, winsLow: 0 };
        st.series.push(fin);
        addSeriesGame(st, fin);
      }
    }
  } else {
    addSeriesGame(st, s);
  }
}

/** 主场顺序：三局两胜 高-低-高（true = 排名高的一方主场） */
const HOME_PATTERN: Record<3, boolean[]> = {
  3: [true, false, true],
};

/** 连胜新闻：3、5、7、10 连胜，之后每 5 场；5 连胜以上被终结也发一条 */
function updateStreaks(st: SeasonState, g: Game, news: (kind: NewsKind, text: string, sub?: number) => void): void {
  const r = g.result!;
  const winner = r.homePts > r.awayPts ? g.home : g.away;
  const loser = winner === g.home ? g.away : g.home;
  const prevW = st.streaks[winner] ?? 0;
  const prevL = st.streaks[loser] ?? 0;
  st.streaks[winner] = prevW > 0 ? prevW + 1 : 1;
  st.streaks[loser] = prevL < 0 ? prevL - 1 : -1;
  const n = st.streaks[winner];
  if (n === 3 || n === 5 || n === 7 || n === 10 || (n > 10 && n % 5 === 0)) news('streak', `${teamShort(winner)} 获得 ${n} 连胜`, 0.3);
  if (prevL >= 5) news('streak', `${teamShort(loser)} 的 ${prevL} 连胜被 ${teamShort(winner)} 终结`, 0.31);
}

/** MVP 周榜：每 3 轮结算一次（只看这几轮及以前的比赛），榜首连续领先 2 周以上发新闻，换人登顶也发 */
function settleMvpWeeks(st: SeasonState): void {
  const reg = st.games.filter((g) => g.stage === 'regular');
  const totalWeeks = Math.ceil(Math.max(...reg.map((g) => g.round)) / ROUNDS_PER_WEEK);
  while (st.mvpWeek < totalWeeks) {
    const week = st.mvpWeek + 1;
    const maxRound = week * ROUNDS_PER_WEEK;
    const games = reg.filter((g) => g.round <= maxRound);
    if (!games.every((g) => g.result)) return;
    st.mvpWeek = week;
    const top = mvpRanking(st, maxRound)[0];
    if (!top) continue;
    const order = Math.max(...games.map((g) => g.id)) + 0.4;
    const when = `第 ${week} 周`;
    if (top.pid === st.mvpLeader) {
      st.mvpWeeks++;
      st.news.push({ order, when, kind: 'mvp', text: `${teamShort(top.team)} ${playerName(top.pid)} 在 MVP 榜单上已连续 ${st.mvpWeeks} 周领先` });
    } else {
      st.mvpLeader = top.pid;
      st.mvpWeeks = 1;
      st.news.push({ order, when, kind: 'mvp', text: `${teamShort(top.team)} ${playerName(top.pid)} 登上 MVP 榜首` });
    }
  }
}

function addSeriesGame(st: SeasonState, s: Series): void {
  const n = s.winsHigh + s.winsLow;
  const highHome = HOME_PATTERN[s.bestOf][n];
  addGame(st, s.stage, n + 1, highHome ? s.high : s.low, highHome ? s.low : s.high, s.id);
}

function startPlayoffs(st: SeasonState): void {
  const t = standings(st).map((x) => x.team);
  const semis: Series[] = [
    { id: 'semi1', stage: 'semi', high: t[0], low: t[3], bestOf: 3, winsHigh: 0, winsLow: 0 },
    { id: 'semi2', stage: 'semi', high: t[1], low: t[2], bestOf: 3, winsHigh: 0, winsLow: 0 },
  ];
  st.series.push(...semis);
  // 每组先排第一场；之后每打完一场才排该组的下一场，所以两组半决赛自然交替进行，一组结束后只打另一组
  for (const s of semis) addSeriesGame(st, s);
}

// ---------- 积分榜 ----------
export interface Standing {
  team: string;
  w: number;
  l: number;
  pf: number;
  pa: number;
}

export function standings(st: SeasonState, maxRound = Infinity): Standing[] {
  const map = new Map<string, Standing>(st.teams.map((t) => [t, { team: t, w: 0, l: 0, pf: 0, pa: 0 }]));
  const h2h = new Map<string, number>();
  for (const g of st.games) {
    if (g.stage !== 'regular' || !g.result || g.round > maxRound) continue;
    const h = map.get(g.home)!;
    const a = map.get(g.away)!;
    h.pf += g.result.homePts;
    h.pa += g.result.awayPts;
    a.pf += g.result.awayPts;
    a.pa += g.result.homePts;
    const homeWon = g.result.homePts > g.result.awayPts;
    (homeWon ? h : a).w++;
    (homeWon ? a : h).l++;
    const winner = homeWon ? g.home : g.away;
    const loser = homeWon ? g.away : g.home;
    h2h.set(`${winner}>${loser}`, (h2h.get(`${winner}>${loser}`) ?? 0) + 1);
  }
  // 胜场 → 相互战绩 → 净胜分 → 得分
  return [...map.values()].sort(
    (x, y) =>
      y.w - x.w ||
      (h2h.get(`${y.team}>${x.team}`) ?? 0) - (h2h.get(`${x.team}>${y.team}`) ?? 0) ||
      y.pf - y.pa - (x.pf - x.pa) ||
      y.pf - x.pf,
  );
}

// ---------- 球员数据 ----------
export interface PlayerTotals {
  pid: string;
  team: string;
  gp: number;
  gs: number;
  s: PlayerStats;
}

export function playerTotals(st: SeasonState, stages: Stage[], onlyTeam?: string, maxRound = Infinity): PlayerTotals[] {
  const map = new Map<string, PlayerTotals>();
  for (const g of st.games) {
    if (!g.result || !stages.includes(g.stage) || (g.stage === 'regular' && g.round > maxRound)) continue;
    for (const b of g.result.box) {
      if (onlyTeam && b.team !== onlyTeam) continue;
      let t = map.get(b.pid);
      if (!t) {
        t = { pid: b.pid, team: b.team, gp: 0, gs: 0, s: emptyPlayerStats() };
        map.set(b.pid, t);
      }
      if (b.stats.sec <= 0) continue; // 没上场不算出场
      t.gp++;
      if (b.starter) t.gs++;
      for (const k of Object.keys(t.s) as (keyof PlayerStats)[]) t.s[k] += b.stats[k];
    }
  }
  return [...map.values()];
}

/** 效率值（场均）：得分 + 篮板 + 助攻 + 抢断 + 盖帽 − 投丢 − 罚丢 − 失误 */
export function effPerGame(t: PlayerTotals): number {
  if (t.gp === 0) return 0;
  const s = t.s;
  return (s.pts + s.reb + s.ast + s.stl + s.blk - (s.fga - s.fgm) - (s.fta - s.ftm) - s.tov) / t.gp;
}

export const perGame = (t: PlayerTotals, k: keyof PlayerStats) => (t.gp ? t.s[k] / t.gp : 0);

// ---------- 奖项 ----------
export interface AwardEntry {
  pid: string;
  team: string;
  value: number;
  /** 显示用的说明，例如 "28.4 分" */
  text: string;
}

export interface Award {
  key: string;
  name: string;
  /** 评选方式说明 */
  rule: string;
  top: AwardEntry[];
}

/** 常规赛出场至少 60% 的比赛才有资格拿个人奖 */
function eligible(st: SeasonState, t: PlayerTotals, maxRound = Infinity): boolean {
  const teamGames = st.games.filter((g) => g.stage === 'regular' && g.result && g.round <= maxRound && (g.home === t.team || g.away === t.team)).length;
  return t.gp >= Math.max(1, Math.ceil(teamGames * 0.6));
}

const mvpScore = (t: PlayerTotals, winPct: Map<string, number>) => effPerGame(t) * (0.6 + 0.8 * (winPct.get(t.team) ?? 0));

/** MVP 榜（可以只算到第 maxRound 轮，周榜用） */
export function mvpRanking(st: SeasonState, maxRound = Infinity): PlayerTotals[] {
  const winPct = new Map(standings(st, maxRound).map((s) => [s.team, s.w + s.l ? s.w / (s.w + s.l) : 0]));
  return playerTotals(st, ['regular'], undefined, maxRound)
    .filter((t) => eligible(st, t, maxRound))
    .sort((a, b) => mvpScore(b, winPct) - mvpScore(a, winPct));
}

export function computeAwards(st: SeasonState): Award[] {
  const reg = playerTotals(st, ['regular']).filter((t) => eligible(st, t));
  const winPct = new Map(standings(st).map((s) => [s.team, s.w + s.l ? s.w / (s.w + s.l) : 0]));
  const f1 = (v: number) => v.toFixed(1);
  const top3 = (rows: PlayerTotals[], val: (t: PlayerTotals) => number, text: (t: PlayerTotals, v: number) => string): AwardEntry[] =>
    rows
      .map((t) => ({ t, v: val(t) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map(({ t, v }) => ({ pid: t.pid, team: t.team, value: v, text: text(t, v) }));
  const stat = (k: keyof PlayerStats, unit: string) => top3(reg, (t) => perGame(t, k), (_t, v) => `场均 ${f1(v)} ${unit}`);

  const awards: Award[] = [
    {
      key: 'mvp',
      name: '常规赛 MVP',
      rule: '常规赛场均效率值 ×（0.6 + 0.8 × 球队胜率）',
      top: top3(
        reg,
        (t) => mvpScore(t, winPct),
        (t) => `效率 ${f1(effPerGame(t))}，${f1(perGame(t, 'pts'))} 分 ${f1(perGame(t, 'reb'))} 板 ${f1(perGame(t, 'ast'))} 助，球队胜率 ${Math.round((winPct.get(t.team) ?? 0) * 100)}%`,
      ),
    },
  ];
  // 总决赛 MVP：冠军队球员，按总决赛场均效率值
  if (st.champion) {
    const fin = playerTotals(st, ['final'], st.champion);
    const finGames = st.games.filter((g) => g.stage === 'final' && g.result).length;
    const rows = fin.filter((t) => t.gp >= Math.ceil(finGames / 2));
    awards.push({
      key: 'fmvp',
      name: '总决赛 MVP',
      rule: '总冠军球队中，总决赛场均效率值最高',
      top: top3(rows, effPerGame, (t) => `效率 ${f1(effPerGame(t))}，${f1(perGame(t, 'pts'))} 分 ${f1(perGame(t, 'reb'))} 板 ${f1(perGame(t, 'ast'))} 助`),
    });
  }
  awards.push(
    { key: 'pts', name: '得分王', rule: '常规赛场均得分', top: stat('pts', '分') },
    { key: 'ast', name: '助攻王', rule: '常规赛场均助攻', top: stat('ast', '助攻') },
    { key: 'reb', name: '篮板王', rule: '常规赛场均篮板', top: stat('reb', '篮板') },
    { key: 'stl', name: '抢断王', rule: '常规赛场均抢断', top: stat('stl', '抢断') },
    { key: 'blk', name: '盖帽王', rule: '常规赛场均盖帽', top: stat('blk', '盖帽') },
    {
      key: 'sixth',
      name: '最佳第六人',
      rule: '替补出场多于首发出场的球员中，常规赛场均效率值最高',
      top: top3(
        reg.filter((t) => t.gs * 2 < t.gp),
        effPerGame,
        (t) => `效率 ${f1(effPerGame(t))}，${f1(perGame(t, 'pts'))} 分，场均 ${f1(perGame(t, 'sec') / 60)} 分钟`,
      ),
    },
  );
  return awards;
}

export function playerName(pid: string): string {
  return PLAYER_BY_ID.get(pid)?.name ?? pid;
}

export function teamShort(id: string): string {
  return TEAM_BY_ID.get(id)?.short ?? id;
}

// ---------- 存档 ----------
const SAVE_KEY = 'basketball-demo.season.v2';

export function saveSeason(st: SeasonState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(st));
  } catch {
    /* 存不了（隐私模式等）就算了，只是刷新后会丢 */
  }
}

export function loadSeason(): SeasonState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const st = JSON.parse(raw) as SeasonState;
    return st.version === 2 && Array.isArray(st.games) ? st : null;
  } catch {
    return null;
  }
}

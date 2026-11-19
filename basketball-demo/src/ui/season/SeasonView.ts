import './season.css';
import { ATTR_LABELS, type Attributes } from '../../data/players';
import { DB_TEAMS, PLAYERS, PLAYER_BY_ID, TEAM_BY_ID, TIER_LABEL, arrangeRoster, playerOvr, teamOvr, type DbPlayer, type DbTeam } from '../../season/db';
import { INJURY_LABEL } from '../../sim/injury';
import {
  computeAwards,
  createSeason,
  isReady,
  prepareGame,
  readyGames,
  teamInjuries,
  effPerGame,
  loadSeason,
  nextGame,
  perGame,
  playerTotals,
  recordResult,
  regularDone,
  saveSeason,
  seasonDone,
  standings,
  type Game,
  type GameResult,
  type PlayerTotals,
  type SeasonState,
  type Stage,
} from '../../season/Season';
import { SimPool } from '../../season/simPool';
import { planMinutes } from '../../sim/coach';
import type { PlayerStats } from '../../sim/Player';
import { randomSeed } from '../../sim/rng';

type Tab = 'pdb' | 'news' | 'standings' | 'schedule' | 'playoffs' | 'leaders' | 'awards' | 'teams' | 'db';

const TABS: [Tab, string][] = [
  ['news', '新闻'],
  ['standings', '积分榜'],
  ['schedule', '赛程'],
  ['playoffs', '季后赛'],
  ['leaders', '球员数据'],
  ['awards', '奖项'],
  ['teams', '本季球队'],
  ['db', '球队库（50 队）'],
  ['pdb', '球员库（500 人）'],
];

/** 球员库的排序列 */
type DbSortKey = 'ovr' | 'height' | 'age' | keyof Attributes;

/** 球员 → 所属球队 */
const TEAM_OF = new Map(DB_TEAMS.flatMap((t) => t.roster.map((pid) => [pid, t] as const)));

const ATTR_KEYS: (keyof Attributes)[] = ['inside', 'mid', 'three', 'rebound', 'assist', 'insideDef', 'outsideDef', 'stability'];

type SimScope = 'next' | 'round' | 'regular' | 'all';

type SortKey = 'gp' | 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'fg' | 'tp' | 'ft' | 'eff';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (v: number) => v.toFixed(1);
const pct = (m: number, a: number) => (a ? `${((m / a) * 100).toFixed(1)}%` : '-');
/** 当前排序列的箭头：▼ 从大到小，▲ 从小到大 */
const arrow = (on: boolean, dir: 1 | -1) => (on ? (dir === 1 ? ' ▼' : ' ▲') : '');
const rateClass = (v: number) => (v >= 90 ? 'r90' : v >= 80 ? 'r80' : v >= 70 ? 'r70' : v >= 60 ? 'r60' : 'r50');

/**
 * 赛季总览（HTML 覆盖在 Phaser 画布上）：积分榜、赛程、季后赛、球员数据、奖项、球队 / 球员库。
 * 点「观看」切到比赛画面（Phaser），打完或点「返回赛季」再回来。
 */
export class SeasonView {
  private readonly root: HTMLDivElement;
  private st: SeasonState;
  private tab: Tab = 'news';
  private pool: SimPool | null = null;
  private simulating = false;
  private simDone = 0;
  private simTotal = 0;
  private leaderStage: Stage | 'playoffs' = 'regular';
  private leaderSort: SortKey = 'pts';
  /** 排序方向：1 = 从大到小，-1 = 从小到大；点同一列来回切换，换列时回到从大到小 */
  private leaderDir: 1 | -1 = 1;
  private leaderQualified = true;
  /** 球员库的筛选与排序 */
  private pdb = { q: '', tier: 'all', role: 'all', legend: false, inSeason: false, sort: 'ovr' as DbSortKey, dir: 1 as 1 | -1 };
  private modal: string | null = null;
  /** 观看比赛 */
  onWatch: (g: Game) => void = () => {};

  constructor() {
    this.st = loadSeason() ?? createSeason(randomSeed());
    saveSeason(this.st);
    this.root = document.createElement('div');
    this.root.id = 'season';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.addEventListener('change', (e) => this.handleChange(e));
    this.root.addEventListener('input', (e) => this.handleInput(e));
    this.render();
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 比赛画面打完一场 */
  report(gameId: number, r: GameResult): void {
    recordResult(this.st, gameId, r);
    saveSeason(this.st);
  }

  // ---------- 模拟 ----------
  private getPool(): SimPool {
    if (!this.pool) this.pool = new SimPool();
    return this.pool;
  }

  /** scope：next = 下一场；round = 常规赛本轮剩余 / 季后赛当前这一轮（半决赛或总决赛）打完；regular = 常规赛剩余；all = 打到赛季结束 */
  private async simulate(scope: SimScope): Promise<void> {
    if (this.simulating) return;
    const first = nextGame(this.st);
    if (!first) return;
    const st = this.st;
    let launched = 0;
    const pending = () => st.games.filter((g) => !g.result);
    const inScope = (): Game[] => {
      const open = pending();
      if (open.length === 0) return [];
      if (scope === 'next') return launched > 0 ? [] : [open[0]];
      if (scope === 'round') return open.filter((g) => g.stage === first.stage && (g.stage !== 'regular' || g.round === first.round));
      if (scope === 'regular') return open.filter((g) => g.stage === 'regular');
      return open;
    };
    // 伤病要按顺序结算：只发出两队之前的比赛都已打完的场次，开打前定下伤病名单
    const pick = (): Game[] => {
      const ready = new Set(readyGames(st).map((g) => g.id));
      const b = inScope().filter((g) => ready.has(g.id));
      for (const g of b) prepareGame(st, g);
      return b;
    };
    this.simTotal = inScope().length;
    this.simDone = 0;
    this.simulating = true;
    this.render();
    await this.getPool().run(
      () => {
        const b = pick();
        if (b.length > 0) launched++;
        // 季后赛的下一场要等上一场的结果才排出来，总数边打边涨
        this.simTotal = Math.max(this.simTotal, this.simDone + inScope().length);
        return b;
      },
      (g, r) => {
        recordResult(st, g.id, r);
        this.simDone++;
        saveSeason(st);
        this.render();
      },
    );
    this.simulating = false;
    this.render();
  }

  private stopSim(): void {
    this.pool?.cancel();
  }

  private newSeason(): void {
    if (this.simulating) return;
    const played = this.st.games.some((g) => g.result);
    if (played && !seasonDone(this.st) && !confirm('当前赛季还没打完，确定放弃并开始新赛季？')) return;
    this.st = createSeason(randomSeed());
    saveSeason(this.st);
    this.tab = 'standings';
    this.render();
  }

  // ---------- 事件 ----------
  private handleClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!el) {
      if ((e.target as HTMLElement).classList.contains('modal-bg')) this.closeModal();
      return;
    }
    const a = el.dataset.a!;
    const v = el.dataset.v ?? '';
    switch (a) {
      case 'tab':
        this.tab = v as Tab;
        this.render();
        break;
      case 'sim':
        void this.simulate(v as SimScope);
        break;
      case 'stop':
        this.stopSim();
        break;
      case 'new':
        this.newSeason();
        break;
      case 'watch': {
        if (this.simulating) return;
        const g = this.st.games[Number(v)];
        if (!g || (!g.result && !isReady(this.st, g))) return;
        prepareGame(this.st, g);
        saveSeason(this.st);
        this.onWatch(g);
        break;
      }
      case 'box':
        this.openModal(this.boxScore(this.st.games[Number(v)]));
        break;
      case 'player':
        this.openModal(this.playerModal(v));
        break;
      case 'team':
        this.openModal(this.teamModal(v));
        break;
      case 'close':
        this.closeModal();
        break;
      case 'sort':
        this.leaderDir = this.leaderSort === v ? (-this.leaderDir as 1 | -1) : 1;
        this.leaderSort = v as SortKey;
        this.render();
        break;
      case 'lstage':
        this.leaderStage = v as Stage;
        this.render();
        break;
      case 'pdbsort':
        this.pdb.dir = this.pdb.sort === v ? (-this.pdb.dir as 1 | -1) : 1;
        this.pdb.sort = v as DbSortKey;
        this.render();
        break;
    }
  }

  private handleChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset.a === 'qual') {
      this.leaderQualified = el.checked;
      this.render();
    }
    if (el.dataset.a === 'pdbf') {
      const k = el.dataset.v as 'tier' | 'role' | 'legend' | 'inSeason';
      if (k === 'legend' || k === 'inSeason') this.pdb[k] = el.checked;
      else this.pdb[k] = el.value;
      this.render();
    }
  }

  /** 球员库搜索框：边打边筛，重绘后把焦点和光标放回去 */
  private handleInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset.a !== 'pdbq') return;
    this.pdb.q = el.value;
    const pos = el.selectionStart ?? el.value.length;
    this.render();
    const box = this.root.querySelector<HTMLInputElement>('input[data-a="pdbq"]');
    if (box) {
      box.focus();
      box.setSelectionRange(pos, pos);
    }
  }

  private openModal(html: string): void {
    this.modal = html;
    this.render();
  }

  private closeModal(): void {
    this.modal = null;
    this.render();
  }

  // ---------- 渲染 ----------
  private render(): void {
    if (this.root.classList.contains('hidden')) return;
    const content = this.root.querySelector('.content');
    const scroll = content ? content.scrollTop : 0;
    this.root.innerHTML = `${this.header()}${this.tabs()}<div class="content">${this.body()}</div>${
      this.modal ? `<div class="modal-bg"><div class="modal"><button class="close" data-a="close">关闭</button>${this.modal}</div></div>` : ''
    }`;
    const c = this.root.querySelector('.content');
    if (c) c.scrollTop = scroll;
  }

  private header(): string {
    const st = this.st;
    const reg = st.games.filter((g) => g.stage === 'regular');
    const regPlayed = reg.filter((g) => g.result).length;
    let status: string;
    if (st.champion) status = `赛季结束 · 总冠军 <b>${esc(TEAM_BY_ID.get(st.champion)!.name)}</b>`;
    else if (!regularDone(st)) status = `常规赛 <b>${regPlayed}/${reg.length}</b> 场`;
    else {
      const fin = st.series.find((s) => s.stage === 'final');
      status = fin ? `总决赛进行中（三局两胜）` : `季后赛半决赛进行中（三局两胜）`;
    }
    const next = nextGame(st);
    const dis = this.simulating || !next ? 'disabled' : '';
    const btns = st.champion
      ? ''
      : this.simulating
      ? `<span class="progress">后台模拟中… ${this.simDone}/${this.simTotal}（${this.getPool().threads} 线程）</span><button data-a="stop">停止</button>`
      : `${next ? `<button class="primary" data-a="watch" data-v="${next.id}">观看下一场</button>` : ''}
         <button data-a="sim" data-v="next" ${dis}>模拟下一场</button>
         <button data-a="sim" data-v="round" ${dis}>${next && next.stage !== 'regular' ? (next.stage === 'final' ? '模拟总决赛' : '模拟半决赛') : '模拟本轮'}</button>
         ${!regularDone(st) ? `<button data-a="sim" data-v="regular" ${dis}>模拟常规赛剩余</button>` : ''}
         <button data-a="sim" data-v="all" ${dis}>模拟到赛季结束</button>`;
    const latest = [...st.news].sort((a, b) => b.order - a.order)[0];
    if (latest) status += `　<span class="muted">📰 ${esc(latest.text)}</span>`;
    return `<div class="bar"><span class="title">篮球赛季</span><span class="status">${status}　<span class="muted">赛季种子 ${st.seed}</span></span>
      ${btns}<button data-a="new" ${this.simulating ? 'disabled' : ''}>新赛季</button></div>`;
  }

  private tabs(): string {
    return `<div class="tabs">${TABS.map(([k, label]) => `<button class="${this.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${label}</button>`).join('')}</div>`;
  }

  private body(): string {
    switch (this.tab) {
      case 'news':
        return this.newsView();
      case 'standings':
        return this.standingsView();
      case 'schedule':
        return this.scheduleView();
      case 'playoffs':
        return this.playoffsView();
      case 'leaders':
        return this.leadersView();
      case 'awards':
        return this.awardsView();
      case 'teams':
        return this.teamsView(this.st.teams.map((id) => TEAM_BY_ID.get(id)!), true);
      case 'db':
        return this.teamsView(DB_TEAMS, false);
      case 'pdb':
        return this.playerDbView();
    }
  }

  private playerDbView(): string {
    const f = this.pdb;
    const q = f.q.trim().toLowerCase();
    const val = (p: DbPlayer, k: DbSortKey) => (k === 'ovr' ? playerOvr(p) : k === 'height' ? p.height : k === 'age' ? p.age : p.attrs[k]);
    const rows = PLAYERS.filter((p) => {
      const t = TEAM_OF.get(p.id)!;
      if (f.tier !== 'all' && t.tier !== f.tier) return false;
      if (f.role !== 'all' && p.role !== f.role) return false;
      if (f.legend && !p.legend) return false;
      if (f.inSeason && !this.st.teams.includes(t.id)) return false;
      if (q && !`${p.name}${p.short}${t.name}${t.short}${p.badges.join('')}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (val(b, f.sort) - val(a, f.sort)) * f.dir || a.id.localeCompare(b.id));
    const sel = (k: string, opts: [string, string][], cur: string) =>
      `<select data-a="pdbf" data-v="${k}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const th = (k: DbSortKey, l: string) => `<th class="sort ${f.sort === k ? 'on' : ''}" data-a="pdbsort" data-v="${k}">${l}${arrow(f.sort === k, f.dir)}</th>`;
    const tr = rows
      .map((p, i) => {
        const t = TEAM_OF.get(p.id)!;
        return `<tr><td>${i + 1}</td><td class="l">${this.playerLink(p.id)}${p.legend ? ' ★' : ''}</td><td class="l">${this.teamLink(t.id)}<span class="tier ${t.tier}">${TIER_LABEL[t.tier]}</span></td>
          <td>${p.number}</td><td>${p.role}</td><td>${p.height}</td><td>${p.weight}</td><td>${p.age}</td>
          <td class="${rateClass(playerOvr(p))}"><b>${playerOvr(p)}</b></td>${ATTR_KEYS.map((k) => `<td class="${rateClass(p.attrs[k])}">${p.attrs[k]}</td>`).join('')}
          <td class="l muted">${p.badges.map(esc).join('、')}</td></tr>`;
      })
      .join('');
    return `<p class="hint">
      <input data-a="pdbq" placeholder="搜索球员 / 球队 / 荣誉" value="${esc(f.q)}" style="width:180px">
      ${sel('tier', [['all', '全部档次'], ['elite', '强队'], ['normal', '普通'], ['weak', '杂牌']], f.tier)}
      ${sel('role', [['all', '全部位置'], ['PG', 'PG'], ['SG', 'SG'], ['SF', 'SF'], ['PF', 'PF'], ['C', 'C']], f.role)}
      <label><input type="checkbox" data-a="pdbf" data-v="legend" ${f.legend ? 'checked' : ''}> 只看传奇 ★</label>
      <label><input type="checkbox" data-a="pdbf" data-v="inSeason" ${f.inSeason ? 'checked' : ''}> 只看本赛季参赛球队</label>
      　共 ${rows.length} 人 · 点列名排序，再点一次切换从大到小 ▼ / 从小到大 ▲ · 点名字看详情（含本赛季数据）<br>
      综合评分 = 八项能力值里最高的六项取平均（四舍五入）。去掉最低的两项，是为了不让内线因为三分低、射手因为篮板低被拉低分；教练排首发和分配上场时间也用它。</p>
      <table><thead><tr><th>#</th><th class="l">球员</th><th class="l">球队</th><th>号</th><th>位置</th>${th('height', '身高')}<th>体重</th>${th('age', '年龄')}${th('ovr', '综合评分')}
      ${ATTR_KEYS.map((k) => th(k, ATTR_LABELS[k].replace('投篮', ''))).join('')}<th class="l">荣誉</th></tr></thead><tbody>${tr}</tbody></table>`;
  }

  private teamLink(id: string, full = false): string {
    const t = TEAM_BY_ID.get(id)!;
    return `<span class="link" data-a="team" data-v="${t.id}"><span class="team-dot" style="background:${t.color}"></span>${esc(full ? t.name : t.short)}</span>`;
  }

  private playerLink(pid: string): string {
    const p = PLAYER_BY_ID.get(pid)!;
    const team = DB_TEAMS.find((t) => t.roster.includes(pid))!;
    const inj = this.st.teams.includes(team.id) ? teamInjuries(this.st, team.id).get(pid) : undefined;
    const tag = inj ? ` <span class="inj ${inj}" title="${INJURY_LABEL[inj]}">${inj === 'light' ? '轻伤' : inj === 'severe' ? '伤停' : '报销'}</span>` : '';
    return `<span class="link" data-a="player" data-v="${pid}">${esc(p.name)}</span>${tag}`;
  }

  private newsView(): string {
    const items = [...this.st.news].sort((a, b) => b.order - a.order);
    if (!items.length) return '<p class="muted">赛季开始后，伤病、连胜、MVP 榜、季后赛和奖项的新闻会出现在这里。</p>';
    const icon = { injury: '🩹', streak: '🔥', mvp: '👑', award: '🏆', playoff: '🏀' } as const;
    return `<p class="hint">最新的在最上面。MVP 榜每 3 轮（一周）结算一次。</p>${items
      .map((n) => `<div class="news ${n.kind}"><span class="when">${esc(n.when)}</span>${icon[n.kind]} ${esc(n.text)}</div>`)
      .join('')}`;
  }

  private standingsView(): string {
    const rows = standings(this.st);
    const lead = rows[0];
    const tr = rows
      .map((s, i) => {
        const t = TEAM_BY_ID.get(s.team)!;
        const gp = s.w + s.l;
        const gb = ((lead.w - s.w) + (s.l - lead.l)) / 2;
        const cls = [i < 4 ? 'playoff' : '', i === 3 ? 'cut' : ''].join(' ');
        return `<tr class="${cls}"><td>${i + 1}</td><td class="l">${this.teamLink(s.team, true)}<span class="tier ${t.tier}">${TIER_LABEL[t.tier]}</span></td>
          <td>${teamOvr(t)}</td><td>${s.w}</td><td>${s.l}</td><td>${gp ? (s.w / gp).toFixed(3) : '-'}</td><td>${gb ? f1(gb) : '-'}</td>
          <td>${gp ? f1(s.pf / gp) : '-'}</td><td>${gp ? f1(s.pa / gp) : '-'}</td><td>${gp ? (s.pf - s.pa > 0 ? '+' : '') + f1((s.pf - s.pa) / gp) : '-'}</td></tr>`;
      })
      .join('');
    return `<p class="hint">10 支球队四循环（每两队打 4 场，主客场各 2 场，每队 36 场）。前 4 名（虚线以上）进入季后赛：半决赛 1 vs 4、2 vs 3，总决赛，全部三局两胜。排名依次看胜场、相互战绩、净胜分。</p>
      <table><thead><tr><th>#</th><th class="l">球队</th><th>实力</th><th>胜</th><th>负</th><th>胜率</th><th>胜场差</th><th>场均得分</th><th>场均失分</th><th>净胜分</th></tr></thead><tbody>${tr}</tbody></table>`;
  }

  private gameRow(g: Game): string {
    const r = g.result;
    const homeWon = r ? r.homePts > r.awayPts : false;
    const name = (id: string, won: boolean) => `<span class="${r ? (won ? 'win' : 'lose') : ''}">${this.teamLink(id)}</span>`;
    const score = r ? `${r.homePts} : ${r.awayPts}${r.ot ? ` <span class="muted">${r.ot > 1 ? r.ot : ''}OT</span>` : ''}` : '<span class="muted">未赛</span>';
    const label = g.stage === 'regular' ? '' : `<span class="muted">G${g.round}</span> `;
    const btns = r
      ? `<button class="small" data-a="box" data-v="${g.id}">技术统计</button><button class="small" data-a="watch" data-v="${g.id}" ${this.simulating ? 'disabled' : ''}>回看</button>`
      : isReady(this.st, g)
        ? `<button class="small" data-a="watch" data-v="${g.id}" ${this.simulating ? 'disabled' : ''}>观看</button>`
        : '<span class="muted" title="伤病按顺序结算：两队之前的比赛打完后才能看">待前序比赛</span>';
    return `<div class="game"><span class="teams">${label}${name(g.home, homeWon)} <span class="muted">（主）vs</span> ${name(g.away, !homeWon)}</span><span class="score">${score}</span>${btns}</div>`;
  }

  private scheduleView(): string {
    const byRound = new Map<number, Game[]>();
    for (const g of this.st.games) if (g.stage === 'regular') byRound.set(g.round, [...(byRound.get(g.round) ?? []), g]);
    let html = '<p class="hint">每场比赛都有固定的种子：后台模拟和打开观看得到的是同一场比赛，打完的比赛点「回看」可以原样重放。</p>';
    for (const [round, games] of byRound) {
      html += `<div class="round">第 ${round} 轮${round === 10 ? '（下半程，主客互换）' : ''}</div>${games.map((g) => this.gameRow(g)).join('')}`;
    }
    return html;
  }

  private playoffsView(): string {
    const st = this.st;
    if (st.series.length === 0) {
      const top = standings(st).slice(0, 4);
      return `<p class="hint">常规赛结束后，前 4 名进入季后赛。当前排名前 4：${top.map((s, i) => `${i + 1}. ${this.teamLink(s.team)}`).join('　')}</p>`;
    }
    const seriesCard = (id: string, title: string) => {
      const s = st.series.find((x) => x.id === id);
      if (!s) return `<div class="card series"><h3>${title}</h3><span class="muted">等待半决赛结果</span></div>`;
      const games = st.games.filter((g) => g.series === id);
      return `<div class="card series"><h3>${title}（三局两胜）</h3>
        <div>${this.teamLink(s.high, true)} <span class="wins">${s.winsHigh}</span> : <span class="wins">${s.winsLow}</span> ${this.teamLink(s.low, true)}
        ${s.winner ? `　<b class="r90">${esc(TEAM_BY_ID.get(s.winner)!.short)} 晋级${s.stage === 'final' ? '，夺得总冠军！' : ''}</b>` : ''}</div>
        ${games.map((g) => this.gameRow(g)).join('')}</div>`;
    };
    return `${st.champion ? `<div class="champion">🏆 总冠军：${this.teamLink(st.champion, true)}</div>` : ''}
      <div class="grid">${seriesCard('semi1', '半决赛 1 vs 4')}${seriesCard('semi2', '半决赛 2 vs 3')}</div>
      <div style="margin-top:12px">${seriesCard('final', '总决赛')}</div>`;
  }

  private leadersView(): string {
    const st = this.st;
    const stages: Stage[] = this.leaderStage === 'regular' ? ['regular'] : ['semi', 'final'];
    let rows = playerTotals(st, stages).filter((t) => t.gp > 0);
    if (this.leaderQualified && this.leaderStage === 'regular') {
      rows = rows.filter((t) => {
        const tg = st.games.filter((g) => g.stage === 'regular' && g.result && (g.home === t.team || g.away === t.team)).length;
        return t.gp >= Math.ceil(tg * 0.6);
      });
    }
    const val = (t: PlayerTotals, k: SortKey): number => {
      const s = t.s;
      switch (k) {
        case 'gp':
          return t.gp;
        case 'min':
          return perGame(t, 'sec') / 60;
        case 'fg':
          return s.fga ? s.fgm / s.fga : 0;
        case 'tp':
          return s.tpa ? s.tpm / s.tpa : 0;
        case 'ft':
          return s.fta ? s.ftm / s.fta : 0;
        case 'eff':
          return effPerGame(t);
        default:
          return perGame(t, k as keyof PlayerStats);
      }
    };
    rows.sort((a, b) => (val(b, this.leaderSort) - val(a, this.leaderSort)) * this.leaderDir);
    const cols: [SortKey, string][] = [
      ['gp', '出场'],
      ['min', '分钟'],
      ['pts', '得分'],
      ['reb', '篮板'],
      ['ast', '助攻'],
      ['stl', '抢断'],
      ['blk', '盖帽'],
      ['tov', '失误'],
      ['fg', '命中率'],
      ['tp', '三分%'],
      ['ft', '罚球%'],
      ['eff', '效率'],
    ];
    const th = cols.map(([k, l]) => `<th class="sort ${this.leaderSort === k ? 'on' : ''}" data-a="sort" data-v="${k}">${l}${arrow(this.leaderSort === k, this.leaderDir)}</th>`).join('');
    const tr = rows
      .map((t, i) => {
        const s = t.s;
        return `<tr><td>${i + 1}</td><td class="l">${this.playerLink(t.pid)}</td><td class="l">${this.teamLink(t.team)}</td><td>${t.gp}（${t.gs}）</td>
        <td>${f1(val(t, 'min'))}</td><td>${f1(perGame(t, 'pts'))}</td><td>${f1(perGame(t, 'reb'))}</td><td>${f1(perGame(t, 'ast'))}</td>
        <td>${f1(perGame(t, 'stl'))}</td><td>${f1(perGame(t, 'blk'))}</td><td>${f1(perGame(t, 'tov'))}</td>
        <td>${pct(s.fgm, s.fga)}</td><td>${pct(s.tpm, s.tpa)}</td><td>${pct(s.ftm, s.fta)}</td><td>${f1(effPerGame(t))}</td></tr>`;
      })
      .join('');
    const stageBtn = (v: string, l: string) => `<button class="small ${this.leaderStage === v ? 'primary' : ''}" data-a="lstage" data-v="${v}">${l}</button>`;
    return `<p class="hint">${stageBtn('regular', '常规赛')} ${stageBtn('playoffs', '季后赛')}
      <label><input type="checkbox" data-a="qual" ${this.leaderQualified ? 'checked' : ''}> 只看出场达标的球员（≥ 球队已赛场次的 60%，评奖资格）</label>　点列名排序，再点一次切换从大到小 ▼ / 从小到大 ▲；出场括号里是首发场次；均为场均数据。</p>
      ${rows.length ? `<table><thead><tr><th>#</th><th class="l">球员</th><th class="l">球队</th>${th}</tr></thead><tbody>${tr}</tbody></table>` : '<p class="muted">还没有比赛数据</p>'}`;
  }

  private awardsView(): string {
    const st = this.st;
    if (!st.games.some((g) => g.stage === 'regular' && g.result)) return '<p class="muted">还没有比赛数据</p>';
    const done = seasonDone(st);
    const awards = computeAwards(st);
    const cards = awards
      .map(
        (a) => `<div class="card award"><h3>${a.name}</h3><div class="rule">${a.rule}</div>
        ${a.top.length ? `<ol>${a.top.map((e) => `<li>${this.playerLink(e.pid)}（${this.teamLink(e.team)}）<div class="muted">${e.text}</div></li>`).join('')}</ol>` : '<p class="muted">暂无</p>'}</div>`,
      )
      .join('');
    return `${done ? `<div class="champion">🏆 总冠军：${this.teamLink(st.champion!, true)}　·　每个奖项第一名获奖</div>` : `<p class="hint">赛季还没结束，下面是目前的排名（总决赛 MVP 在总冠军产生后评选）。个人奖要求常规赛出场 ≥ 球队场次的 60%。</p>`}
      <div class="grid">${cards}</div>`;
  }

  private teamsView(teams: DbTeam[], inSeason: boolean): string {
    const rec = new Map(standings(this.st).map((s) => [s.team, s]));
    const byTier = (tier: string) => teams.filter((t) => t.tier === tier);
    const card = (t: DbTeam) => {
      const roster = t.roster.map((id) => PLAYER_BY_ID.get(id)!);
      const legends = roster.filter((p) => p.legend).map((p) => p.short);
      const s = rec.get(t.id);
      return `<div class="card"><h3>${this.teamLink(t.id, true)}<span class="tier ${t.tier}">${TIER_LABEL[t.tier]}</span></h3>
        <div class="muted">实力 ${teamOvr(t)}${inSeason && s ? ` · 战绩 ${s.w}-${s.l}` : ''}${this.st.teams.includes(t.id) && !inSeason ? ' · 本赛季参赛' : ''}</div>
        <div>${legends.length ? `核心：${legends.map(esc).join('、')}` : '<span class="muted">全员为虚构球员</span>'}</div></div>`;
    };
    if (inSeason) return `<p class="hint">本赛季从 50 支球队里随机抽出的 10 支。点球队看名单、能力值和教练安排的出场时间。</p><div class="grid">${teams.map(card).join('')}</div>`;
    return ['elite', 'normal', 'weak']
      .map((tier) => `<h3 style="margin:14px 0 8px">${TIER_LABEL[tier as 'elite']}（${byTier(tier).length} 队）</h3><div class="grid">${byTier(tier).map(card).join('')}</div>`)
      .join('');
  }

  // ---------- 弹窗 ----------
  private teamModal(id: string): string {
    const t = TEAM_BY_ID.get(id)!;
    // 本赛季参赛的球队按当前伤病排名单（替补顶替首发、伤停的人排在最后）
    const inj = this.st.teams.includes(id) ? teamInjuries(this.st, id) : new Map();
    const lightSet = new Set([...inj].filter(([, k]) => k === 'light').map(([pid]) => pid));
    const outSet = new Set([...inj].filter(([, k]) => k !== 'light').map(([pid]) => pid));
    const order = arrangeRoster(t.roster, lightSet, outSet).ids;
    const roster = [...order, ...t.roster.filter((pid) => !order.includes(pid))].map((pid) => PLAYER_BY_ID.get(pid)!);
    const targets = planMinutes(order.map((pid) => ({ attrs: PLAYER_BY_ID.get(pid)!.attrs, injured: lightSet.has(pid) })));
    const totals = new Map(playerTotals(this.st, ['regular', 'semi', 'final'], id).map((x) => [x.pid, x]));
    const tr = roster
      .map((p, i) => {
        const s = totals.get(p.id);
        const role = outSet.has(p.id) ? '<span class="inj severe">伤停</span>' : i < 5 ? '首发' : '替补';
        return `<tr><td>${role}</td><td>${p.number}</td><td class="l">${this.playerLink(p.id)}${p.legend ? ' ★' : ''}</td><td>${p.role}</td><td>${p.height}</td><td>${p.age}</td>
          <td class="${rateClass(playerOvr(p))}">${playerOvr(p)}</td>${ATTR_KEYS.map((k) => `<td class="${rateClass(p.attrs[k])}">${p.attrs[k]}</td>`).join('')}
          <td>${targets[i] !== undefined ? f1(targets[i] / 60) : '-'}</td><td>${s ? `${s.gp} 场 ${f1(perGame(s, 'sec') / 60)} 分钟 ${f1(perGame(s, 'pts'))} 分` : '-'}</td></tr>`;
      })
      .join('');
    return `<h2>${esc(t.name)} <span class="tier ${t.tier}">${TIER_LABEL[t.tier]}</span></h2><div class="muted">实力 ${teamOvr(t)} · ★ = 有真实原型的传奇球员</div>
      <table style="margin-top:10px"><thead><tr><th></th><th>号</th><th class="l">球员</th><th>位置</th><th>身高</th><th>年龄</th><th>综合评分</th>
      ${ATTR_KEYS.map((k) => `<th>${ATTR_LABELS[k].replace('投篮', '')}</th>`).join('')}<th>目标分钟</th><th>本季（含季后赛）</th></tr></thead><tbody>${tr}</tbody></table>
      <p class="hint" style="margin-top:8px">目标分钟：教练按实力分配，首发约 30 分钟，其余时间按（综合评分 − 45）² 分给替补；比赛中还会看体力、比分（关键时刻主力回场，大比分时主力休息）。
      轻伤的人能力减半，实力不如替补就让替补首发、他的时间按减半后的实力分；伤停的人不在名单里。</p>`;
  }

  private playerModal(pid: string): string {
    const p: DbPlayer = PLAYER_BY_ID.get(pid)!;
    const team = DB_TEAMS.find((t) => t.roster.includes(pid))!;
    const attrs = ATTR_KEYS.map(
      (k) =>
        `<div class="attr"><span>${ATTR_LABELS[k]}</span><span class="v ${rateClass(p.attrs[k])}">${p.attrs[k]}</span><div class="track"><div class="fill ${rateClass(p.attrs[k])}" style="width:${Math.max(0, (p.attrs[k] - 45) / 55) * 100}%;background:currentColor"></div></div></div>`,
    ).join('');
    const line = (label: string, stages: Stage[]) => {
      const t = playerTotals(this.st, stages).find((x) => x.pid === pid);
      if (!t || !t.gp) return '';
      const s = t.s;
      return `<tr><td class="l">${label}</td><td>${t.gp}（${t.gs}）</td><td>${f1(perGame(t, 'sec') / 60)}</td><td>${f1(perGame(t, 'pts'))}</td><td>${f1(perGame(t, 'reb'))}</td><td>${f1(perGame(t, 'ast'))}</td>
        <td>${f1(perGame(t, 'stl'))}</td><td>${f1(perGame(t, 'blk'))}</td><td>${pct(s.fgm, s.fga)}</td><td>${pct(s.tpm, s.tpa)}</td><td>${pct(s.ftm, s.fta)}</td><td>${f1(effPerGame(t))}</td></tr>`;
    };
    const rows = line('常规赛', ['regular']) + line('季后赛', ['semi', 'final']);
    return `<h2>#${p.number} ${esc(p.name)}${p.legend ? ' ★' : ''}</h2>
      <div class="muted">${this.teamLink(team.id, true)} · ${p.role} · 身高 ${p.height}cm · 体重 ${p.weight}kg · 年龄 ${p.age} · 综合评分 <b class="${rateClass(playerOvr(p))}">${playerOvr(p)}</b></div>
      ${p.badges.length ? `<div style="margin-top:6px;color:#ffd166">${p.badges.map((b) => `🏅 ${esc(b)}`).join('　')}</div>` : ''}
      <div class="attrs">${attrs}</div>
      ${rows ? `<table><thead><tr><th class="l">本赛季</th><th>出场（首发）</th><th>分钟</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>命中率</th><th>三分%</th><th>罚球%</th><th>效率</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">${this.st.teams.includes(team.id) ? '本赛季还没有出场数据' : '所在球队没有参加本赛季'}</p>`}`;
  }

  private boxScore(g: Game): string {
    const r = g.result!;
    const side = (teamId: string, pts: number) => {
      const lines = r.box.filter((b) => b.team === teamId);
      const tr = lines
        .map((b) => {
          const s = b.stats;
          return `<tr><td class="l">${b.starter ? '' : '<span class="muted">替</span> '}${this.playerLink(b.pid)}</td><td>${Math.round(s.sec / 60)}</td><td><b>${s.pts}</b></td><td>${s.reb}</td><td>${s.ast}</td><td>${s.stl}</td><td>${s.blk}</td>
            <td>${s.fgm}/${s.fga}</td><td>${s.tpm}/${s.tpa}</td><td>${s.ftm}/${s.fta}</td><td>${s.tov}</td><td>${s.pf}</td></tr>`;
        })
        .join('');
      return `<h3 style="margin:12px 0 4px">${this.teamLink(teamId, true)}　${pts}</h3><table><thead><tr><th class="l">球员</th><th>分钟</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>投篮</th><th>三分</th><th>罚球</th><th>失误</th><th>犯规</th></tr></thead><tbody>${tr}</tbody></table>`;
    };
    const title = g.stage === 'regular' ? `常规赛第 ${g.round} 轮` : `${g.stage === 'final' ? '总决赛' : '半决赛'} 第 ${g.round} 场`;
    return `<h2>${title}：${esc(TEAM_BY_ID.get(g.home)!.short)} ${r.homePts} : ${r.awayPts} ${esc(TEAM_BY_ID.get(g.away)!.short)}</h2>${side(g.home, r.homePts)}${side(g.away, r.awayPts)}`;
  }
}

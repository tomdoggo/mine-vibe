/**
 * 能力值敏感性实验：量化每一项能力对比赛结果的真实影响。
 *
 * 用法：
 *   npm run sim:sens -- roster 100          真实名单跑 N 场，输出每人总能力值 vs 贡献（EFF）
 *   npm run sim:sens -- attr 40 [key ...]   两队全员能力统一为 70，再把蓝队某一项抬到 95，
 *                                           跑 N 场看净胜分与数据变化；不给 key 则跑全部 8 项
 *   npm run sim:sens -- role 40             两队全员 70，蓝队每个位置轮流单独全项 +25，看该位置贡献变化
 */
import { ATTR_LABELS, TEAMS, type Attributes, type TeamId } from '../src/data/players';
import { Match } from '../src/sim/Match';
import { emptyPlayerStats, type PlayerStats } from '../src/sim/Player';

const noop: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === Symbol.toPrimitive) return () => 0;
    if (key === 'then') return undefined;
    return noop;
  },
  apply: () => noop,
});

const KEYS = Object.keys(ATTR_LABELS) as (keyof Attributes)[];
const mode = process.argv[2] ?? 'roster';
const games = Number(process.argv[3] ?? 40);
const f1 = (v: number) => v.toFixed(1);
const sgn = (v: number) => (v >= 0 ? `+${f1(v)}` : f1(v));

interface Agg {
  per: Map<string, PlayerStats>;
  margin: number; // 蓝队场均净胜分
  bluePts: number;
  redPts: number;
}

function run(n: number): Agg {
  const per = new Map<string, PlayerStats>();
  let margin = 0;
  let bluePts = 0;
  let redPts = 0;
  for (let g = 0; g < n; g++) {
    const m = new Match(noop);
    let guard = 0;
    while (m.phase !== 'finished' && guard++ < 30 * 60 * 60) m.update(1 / 30);
    for (const p of m.players) {
      const key = `${p.teamId}:${p.def.number}`;
      const acc = per.get(key) ?? emptyPlayerStats();
      for (const k of Object.keys(acc) as (keyof PlayerStats)[]) acc[k] += p.stats[k] / n;
      per.set(key, acc);
    }
    margin += (m.score('blue') - m.score('red')) / n;
    bluePts += m.score('blue') / n;
    redPts += m.score('red') / n;
  }
  return { per, margin, bluePts, redPts };
}

/** NBA 效率值 EFF = PTS + REB + AST + STL + BLK − 投失 − 罚失 − TOV */
const eff = (s: PlayerStats) => s.pts + s.reb + s.ast + s.stl + s.blk - (s.fga - s.fgm) - (s.fta - s.ftm) - s.tov;

function setAll(teamId: TeamId, v: number): void {
  for (const p of TEAMS[teamId].players) for (const k of KEYS) p.attrs[k] = v;
}

const originals = new Map<string, Attributes>();
for (const t of ['blue', 'red'] as const) for (const p of TEAMS[t].players) originals.set(`${t}:${p.number}`, { ...p.attrs });
function restore(): void {
  for (const t of ['blue', 'red'] as const) for (const p of TEAMS[t].players) Object.assign(p.attrs, originals.get(`${t}:${p.number}`)!);
}

const t0 = Date.now();

if (mode === 'roster') {
  const r = run(games);
  console.log(`真实名单 ${games} 场：蓝 ${f1(r.bluePts)} : ${f1(r.redPts)} 红\n`);
  const header = ['球员', '位置', '总能力', '不含稳定', 'EFF', 'EFF占比', '能力占比', '比值', 'PTS', 'REB', 'AST', 'FGA', 'FG%'];
  for (const t of ['blue', 'red'] as const) {
    const team = TEAMS[t];
    const rows = team.players.map((d) => {
      const s = r.per.get(`${t}:${d.number}`)!;
      const total = KEYS.reduce((a, k) => a + d.attrs[k], 0);
      const noStab = total - d.attrs.stability;
      return { d, s, total, noStab, eff: eff(s) };
    });
    const sumEff = rows.reduce((a, x) => a + x.eff, 0);
    const sumTot = rows.reduce((a, x) => a + x.total, 0);
    console.log(`${team.name}`);
    console.log(header.map((h) => h.padEnd(9)).join(''));
    for (const x of rows) {
      const effShare = x.eff / sumEff;
      const totShare = x.total / sumTot;
      console.log(
        [
          `${x.d.number} ${x.d.name}`,
          x.d.role,
          `${x.total}`,
          `${x.noStab}`,
          f1(x.eff),
          `${(effShare * 100).toFixed(1)}%`,
          `${(totShare * 100).toFixed(1)}%`,
          (effShare / totShare).toFixed(2),
          f1(x.s.pts),
          f1(x.s.reb),
          f1(x.s.ast),
          f1(x.s.fga),
          x.s.fga ? `${((x.s.fgm / x.s.fga) * 100).toFixed(0)}%` : '-',
        ]
          .map((c) => c.padEnd(9))
          .join(''),
      );
    }
    console.log('');
  }
} else if (mode === 'attr') {
  // attr N 跑全部八项；attr N inside three 只跑指定项；attr N - 只跑基线
  const wanted = process.argv.slice(4).length ? KEYS.filter((k) => process.argv.slice(4).includes(k)) : KEYS;
  setAll('blue', 70);
  setAll('red', 70);
  const base = run(games);
  const teamSum = (a: Agg, t: TeamId) => {
    const s = emptyPlayerStats();
    for (const d of TEAMS[t].players) {
      const x = a.per.get(`${t}:${d.number}`)!;
      for (const k of Object.keys(s) as (keyof PlayerStats)[]) s[k] += x[k];
    }
    return s;
  };
  const b0 = teamSum(base, 'blue');
  const r0 = teamSum(base, 'red');
  console.log(`基线（全员 70）${games} 场：蓝 ${f1(base.bluePts)} : ${f1(base.redPts)} 红，净胜 ${sgn(base.margin)}`);
  console.log(`蓝队基线：FG ${((b0.fgm / b0.fga) * 100).toFixed(1)}%  REB ${f1(b0.reb)}  AST ${f1(b0.ast)}  STL ${f1(b0.stl)}  BLK ${f1(b0.blk)}  TOV ${f1(b0.tov)}`);
  console.log(`红队基线：FG ${((r0.fgm / r0.fga) * 100).toFixed(1)}%  REB ${f1(r0.reb)}  AST ${f1(r0.ast)}  STL ${f1(r0.stl)}  BLK ${f1(r0.blk)}  TOV ${f1(r0.tov)}\n`);
  console.log('蓝队某一项 70 → 95（+25），其余不变：');
  console.log(['能力', '净胜分', '绝对净胜', '蓝得分', '红得分', '蓝FG%', '红FG%', '蓝REB', '红REB', '蓝AST', '蓝STL', '蓝BLK', '蓝TOV'].map((h) => h.padEnd(9)).join(''));
  for (const k of wanted) {
    setAll('blue', 70);
    for (const p of TEAMS.blue.players) p.attrs[k] = 95;
    const r = run(games);
    const b = teamSum(r, 'blue');
    const rd = teamSum(r, 'red');
    console.log(
      [
        ATTR_LABELS[k],
        sgn(r.margin - base.margin),
        sgn(r.margin),
        sgn(r.bluePts - base.bluePts),
        sgn(r.redPts - base.redPts),
        sgn(((b.fgm / b.fga) - b0.fgm / b0.fga) * 100),
        sgn(((rd.fgm / rd.fga) - r0.fgm / r0.fga) * 100),
        sgn(b.reb - b0.reb),
        sgn(rd.reb - r0.reb),
        sgn(b.ast - b0.ast),
        sgn(b.stl - b0.stl),
        sgn(b.blk - b0.blk),
        sgn(b.tov - b0.tov),
      ]
        .map((c) => c.padEnd(9))
        .join(''),
    );
  }
} else if (mode === 'role') {
  setAll('blue', 70);
  setAll('red', 70);
  const base = run(games);
  console.log(`基线（全员 70）${games} 场：净胜 ${sgn(base.margin)}\n`);
  console.log('蓝队某个位置全项 70 → 95，其余人不变：');
  console.log(['位置', '净胜分', '本人EFF变化', '本人PTS', '本人REB', '本人AST', '本人FGA'].map((h) => h.padEnd(12)).join(''));
  for (const d of TEAMS.blue.players) {
    setAll('blue', 70);
    for (const k of KEYS) d.attrs[k] = 95;
    const r = run(games);
    const s = r.per.get(`blue:${d.number}`)!;
    const s0 = base.per.get(`blue:${d.number}`)!;
    console.log(
      [d.role, sgn(r.margin - base.margin), sgn(eff(s) - eff(s0)), sgn(s.pts - s0.pts), sgn(s.reb - s0.reb), sgn(s.ast - s0.ast), sgn(s.fga - s0.fga)]
        .map((c) => c.padEnd(12))
        .join(''),
    );
  }
}
restore();
console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);

/**
 * 离线批量模拟：不渲染，只跑比赛逻辑，统计每名球员的场均数据。
 * 用法：npm run sim -- 100
 */
import { TEAMS, type TeamId } from '../src/data/players';
import { Match } from '../src/sim/Match';
import { emptyPlayerStats, type PlayerStats } from '../src/sim/Player';

// 万能空对象：任何属性都是它自己，调用也返回它自己，用来顶替 Phaser 的场景与显示对象
const noop: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === Symbol.toPrimitive) return () => 0;
    if (key === 'then') return undefined;
    return noop;
  },
  apply: () => noop,
});

// SWAP=1：两队名单互换（蓝队用红队球员），用来区分“名单强弱”和“场地方向偏差”
if (process.env.SWAP) {
  const b = TEAMS.blue.players;
  TEAMS.blue.players = TEAMS.red.players;
  TEAMS.red.players = b;
  console.log('（名单已互换：蓝队 = 原红队球员，红队 = 原蓝队球员）\n');
}

const games = Number(process.argv[2] ?? 100);
const totals = new Map<string, PlayerStats>();
const scores: Record<TeamId, number[]> = { blue: [], red: [] };
const shotKinds: Record<string, number> = {};
let openShots = 0;
let intercepts = 0;
let onBallSteals = 0;
let t0 = Date.now();

for (let g = 0; g < games; g++) {
  const m = new Match(noop);
  m.onEvent = (e) => {
    const raw = e.text.replace(/^(蓝队|红队) #\d+ \S+ /, '');
    if (/^空位/.test(raw)) openShots++;
    if (/截断传球/.test(raw)) intercepts++;
    if (/抢断成功/.test(raw)) onBallSteals++;
    const k = raw.replace(/^空位/, '');
    if (/^(上篮|篮下出手|中投|三分出手)$/.test(k)) shotKinds[k] = (shotKinds[k] ?? 0) + 1;
  };
  let guard = 0;
  while (m.phase !== 'finished' && guard++ < 30 * 60 * 60) m.update(1 / 30);
  for (const p of m.players) {
    const key = `${p.teamId}:${p.def.number}`;
    const acc = totals.get(key) ?? emptyPlayerStats();
    for (const k of Object.keys(acc) as (keyof PlayerStats)[]) acc[k] += p.stats[k];
    totals.set(key, acc);
  }
  scores.blue.push(m.score('blue'));
  scores.red.push(m.score('red'));
}
const ms = Date.now() - t0;

const f1 = (v: number) => v.toFixed(1);
const pct = (m: number, a: number) => (a === 0 ? '-' : `${((m / a) * 100).toFixed(1)}%`);
const stat = (arr: number[]) => {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  return `均值 ${f1(mean)}  标准差 ${f1(sd)}  最低 ${Math.min(...arr)}  最高 ${Math.max(...arr)}`;
};

console.log(`模拟 ${games} 场，用时 ${(ms / 1000).toFixed(1)} 秒\n`);
console.log(`蓝队得分：${stat(scores.blue)}`);
console.log(`红队得分：${stat(scores.red)}`);
const all = [...scores.blue, ...scores.red];
console.log(`单队得分：${stat(all)}   <50 的场次 ${all.filter((s) => s < 50).length}，>150 的场次 ${all.filter((s) => s > 150).length}`);
const totalShots = Object.values(shotKinds).reduce((a, b) => a + b, 0);
console.log(
  `出手类型：` +
    Object.entries(shotKinds)
      .map(([k, v]) => `${k} ${((v / totalShots) * 100).toFixed(0)}%`)
      .join('  '),
);
const jumpers = (shotKinds['中投'] ?? 0) + (shotKinds['三分出手'] ?? 0);
if (jumpers) console.log(`空位出手：占中投 + 三分的 ${((openShots / jumpers) * 100).toFixed(0)}%`);
console.log(`抢断构成（每队场均）：截断传球 ${f1(intercepts / games / 2)}  持球抢断 ${f1(onBallSteals / games / 2)}`);

const header = ['球员', '位置', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'FGM/FGA', 'FG%', '3PM/3PA', '3P%', 'FTM/FTA', 'FT%'];
for (const teamId of ['blue', 'red'] as const) {
  const team = TEAMS[teamId];
  console.log(`\n${team.name}（场均）`);
  console.log(header.map((h, i) => h.padEnd(i < 2 ? 8 : 9)).join(''));
  const sum = emptyPlayerStats();
  for (const def of team.players) {
    const s = totals.get(`${teamId}:${def.number}`)!;
    for (const k of Object.keys(sum) as (keyof PlayerStats)[]) sum[k] += s[k];
    const row = [
      `${def.number} ${def.name}`,
      def.role,
      f1(s.sec / 60 / games),
      f1(s.pts / games),
      f1(s.reb / games),
      f1(s.ast / games),
      f1(s.stl / games),
      f1(s.blk / games),
      f1(s.tov / games),
      f1(s.pf / games),
      `${f1(s.fgm / games)}/${f1(s.fga / games)}`,
      pct(s.fgm, s.fga),
      `${f1(s.tpm / games)}/${f1(s.tpa / games)}`,
      pct(s.tpm, s.tpa),
      `${f1(s.ftm / games)}/${f1(s.fta / games)}`,
      pct(s.ftm, s.fta),
    ];
    console.log(row.map((c, i) => c.padEnd(i < 2 ? 8 : 9)).join(''));
  }
  const row = [
    '全队',
    '',
    '',
    f1(sum.pts / games),
    f1(sum.reb / games),
    f1(sum.ast / games),
    f1(sum.stl / games),
    f1(sum.blk / games),
    f1(sum.tov / games),
    f1(sum.pf / games),
    `${f1(sum.fgm / games)}/${f1(sum.fga / games)}`,
    pct(sum.fgm, sum.fga),
    `${f1(sum.tpm / games)}/${f1(sum.tpa / games)}`,
    pct(sum.tpm, sum.tpa),
    `${f1(sum.ftm / games)}/${f1(sum.fta / games)}`,
    pct(sum.ftm, sum.fta),
  ];
  console.log(row.map((c, i) => c.padEnd(i < 2 ? 8 : 9)).join(''));
}

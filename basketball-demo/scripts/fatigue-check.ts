/**
 * 体力 / 出场时间校验（不渲染）：
 *  1. 只用首发五人打满 40 分钟（不换人），看每人终场体力：明星应在 30 左右；
 *  2. 十人名单正常比赛，看教练排的出场时间（首发约 30 分钟）、最低体力、场均得分。
 * 用法：npm run sim:fatigue -- [场数] [主队id] [客队id]
 */
import { matchTeams } from '../src/season/db';
import { Match, STEP } from '../src/sim/Match';
import { headlessScene } from '../src/sim/headless';
import type { TeamDef } from '../src/data/players';

const games = Number(process.argv[2] ?? 4);
const homeId = process.argv[3] ?? 'chi1996';
const awayId = process.argv[4] ?? 'gsw2017';

function play(teams: Record<'blue' | 'red', TeamDef>, seed: number, onStep?: (m: Match) => void): Match {
  const m = new Match(headlessScene, seed, teams);
  let guard = 0;
  while (m.phase !== 'finished' && guard++ < 60 * 60 * 120) {
    m.update(STEP);
    onStep?.(m);
  }
  return m;
}

const f1 = (v: number) => v.toFixed(1);

// 1) 五人打满
{
  const t = matchTeams(homeId, awayId);
  const five = { blue: { ...t.blue, players: t.blue.players.slice(0, 5) }, red: { ...t.red, players: t.red.players.slice(0, 5) } };
  const acc = new Map<string, { st: number; fga: number; n: number; at30: number }>();
  for (let g = 0; g < games; g++) {
    const hit30 = new Map<string, number>();
    const m = play(five, 1000 + g, (mm) => {
      for (const p of mm.players) if (p.stamina <= 30 && !hit30.has(p.def.name)) hit30.set(p.def.name, mm.gameTime() / 60);
    });
    for (const p of m.roster) {
      const a = acc.get(p.def.name) ?? { st: 0, fga: 0, n: 0, at30: 0 };
      a.at30 += hit30.get(p.def.name) ?? 40;
      a.st += p.stamina;
      a.fga += p.stats.fga;
      a.n++;
      acc.set(p.def.name, a);
    }
  }
  console.log(`== 首发五人打满 40 分钟（${games} 场平均）：终场体力 ==`);
  for (const [name, a] of acc) console.log(`${name.padEnd(12)} 体力 ${f1(a.st / a.n)}  降到 30 的时刻 ${f1(a.at30 / a.n)} 分  出手 ${f1(a.fga / a.n)}`);
}

// 2) 十人轮换
if (!process.env.ONLY5) {
  const t = matchTeams(homeId, awayId);
  const acc = new Map<string, { sec: number; target: number; minSt: number; pts: number; starter: boolean; n: number }>();
  const scores: number[] = [];
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const minSt = new Map<string, number>();
    const m = play(t, 2000 + g, (mm) => {
      for (const p of mm.players) minSt.set(p.def.name, Math.min(minSt.get(p.def.name) ?? 100, p.stamina));
    });
    scores.push(m.score('blue'), m.score('red'));
    for (const p of m.roster) {
      const k = `${p.team.name} ${p.def.name}`;
      const a = acc.get(k) ?? { sec: 0, target: p.targetSec, minSt: 0, pts: 0, starter: p.starter, n: 0 };
      a.sec += p.stats.sec;
      a.minSt += minSt.get(p.def.name) ?? 100;
      a.pts += p.stats.pts;
      a.n++;
      acc.set(k, a);
    }
  }
  const ms = (Date.now() - t0) / games;
  console.log(`\n== 十人轮换（${games} 场平均，每场 ${(ms / 1000).toFixed(2)} 秒）：单队均分 ${f1(scores.reduce((s, x) => s + x, 0) / scores.length)} ==`);
  for (const [k, a] of acc) {
    console.log(`${(a.starter ? '★ ' : '  ') + k.padEnd(14)} 出场 ${f1(a.sec / 60 / a.n).padStart(5)} 分（目标 ${f1(a.target / 60)}）  最低体力 ${f1(a.minSt / a.n).padStart(5)}  得分 ${f1(a.pts / a.n)}`);
  }
}

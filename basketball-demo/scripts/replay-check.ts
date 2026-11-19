/**
 * 回放可复现性校验（不渲染）：
 *  1. 同一种子跑两场，逐步比对状态哈希，证明模拟完全可复现；
 *  2. 第一场在每分钟开始时存快照；随机挑几分钟，恢复快照后重算到下一分钟，逐步比对，证明快照完整。
 * 用法：npm run sim:replay -- [seed]
 */
import { MINUTES, Match, STEP, type MatchSnapshot } from '../src/sim/Match';
import { matchTeams } from '../src/season/db';

// MATCHUP=chi1996,gsw2017：用球队库里的两队（十人名单，会换人），校验换人 / 体力也进了快照
const matchup = process.env.MATCHUP ? process.env.MATCHUP.split(',') : null;

// 万能空对象：顶替 Phaser 的场景与显示对象
const noop: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === Symbol.toPrimitive) return () => 0;
    if (key === 'then') return undefined;
    return noop;
  },
  apply: () => noop,
});

const seed = Number(process.argv[2] ?? 12345);
const MAX_STEPS = 60 * 60 * 90; // 90 分钟真实比赛时间的保险

function hash(m: Match): number {
  let h = 2166136261;
  const mix = (v: number) => {
    // 把 double 的两半都搅进去，位置上任何微小差别都能发现
    const f = new Float64Array([v]);
    const u = new Uint32Array(f.buffer);
    h = Math.imul(h ^ u[0], 16777619);
    h = Math.imul(h ^ u[1], 16777619);
  };
  mix(m.clock);
  mix(m.shotClock);
  mix(m.elapsed);
  mix(m.phase.length + m.half * 10 + (m.possession === 'blue' ? 0 : 100));
  mix(m.ball.pos.x);
  mix(m.ball.pos.y);
  mix(m.ball.height);
  for (const p of m.roster) {
    mix(p.stamina);
    mix(p.onCourt ? p.slot + 1 : 0);
    mix(p.pos.x);
    mix(p.pos.y);
    mix(p.vel.x);
    mix(p.stats.pts + p.stats.reb * 1000 + p.stats.ast * 1e6);
    mix(p.decideTimer);
    mix(p.cutTimer);
  }
  return h >>> 0;
}

interface Run {
  hashes: Uint32Array;
  steps: number;
  snapshots: (MatchSnapshot | null)[];
  /** 每分钟开始对应的步号（快照是在这一步 update 之前的状态） */
  minuteStep: number[];
  match: Match;
}

function run(seedV: number, keepSnapshots: boolean): Run {
  const m = new Match(noop, seedV, matchup ? matchTeams(matchup[0], matchup[1]) : undefined);
  const hashes = new Uint32Array(MAX_STEPS);
  const snapshots: (MatchSnapshot | null)[] = new Array(MINUTES).fill(null);
  const minuteStep: number[] = new Array(MINUTES).fill(-1);
  let step = 0;
  m.onMinuteStart = (k) => {
    minuteStep[k] = step;
    if (keepSnapshots) snapshots[k] = m.snapshot();
  };
  // 第 0 分钟：构造完成即是起点
  minuteStep[0] = 0;
  if (keepSnapshots) snapshots[0] = m.snapshot();
  while (m.phase !== 'finished' && step < MAX_STEPS) {
    m.update(STEP);
    hashes[step++] = hash(m);
  }
  return { hashes, steps: step, snapshots, minuteStep, match: m };
}

function firstDiff(a: Uint32Array, b: Uint32Array, from: number, to: number): number {
  for (let i = from; i < to; i++) if (a[i] !== b[i]) return i;
  return -1;
}

let t0 = Date.now();
const A = run(seed, true);
const simMs = Date.now() - t0;
console.log(`种子 ${seed}：全场 ${A.steps} 步（${(A.steps * STEP / 60).toFixed(1)} 分钟模拟时间），耗时 ${simMs} ms，` +
  `终场 ${A.match.score('blue')} : ${A.match.score('red')}`);
console.log(`每分钟起点步号：${A.minuteStep.join(' ')}`);
if (A.minuteStep.some((s) => s < 0)) {
  console.log('✗ 有分钟没有触发 onMinuteStart');
  process.exit(1);
}

// 1. 同种子重跑
const B = run(seed, false);
const d1 = firstDiff(A.hashes, B.hashes, 0, Math.max(A.steps, B.steps));
if (d1 < 0 && A.steps === B.steps) console.log('✓ 同种子两次运行逐步一致');
else {
  console.log(`✗ 同种子两次运行在第 ${d1} 步出现差异（步数 ${A.steps} vs ${B.steps}）`);
  process.exit(1);
}

// 2. 换种子应当不同（防止 rng 根本没生效）
const C = run(seed + 1, false);
if (firstDiff(A.hashes, C.hashes, 0, Math.min(A.steps, C.steps)) >= 0) console.log('✓ 不同种子结果不同');
else {
  console.log('✗ 不同种子结果竟然相同');
  process.exit(1);
}

// 3. 快照恢复后重算：对每一分钟都做一遍（在同一个 Match 对象上来回恢复，模拟拖进度条）
let bad = 0;
t0 = Date.now();
for (let k = 0; k < MINUTES; k++) {
  const snap = A.snapshots[k];
  if (!snap) continue;
  const m = A.match;
  m.restore(snap);
  const from = A.minuteStep[k];
  const to = k + 1 < MINUTES ? A.minuteStep[k + 1] : A.steps;
  const re = new Uint32Array(to - from);
  for (let i = from; i < to; i++) {
    m.update(STEP);
    re[i - from] = hash(m);
  }
  const d = firstDiff(A.hashes.subarray(from, to), re, 0, to - from);
  if (d >= 0) {
    bad++;
    console.log(`✗ 第 ${k} 分钟：恢复快照后在第 ${from + d} 步（分钟内第 ${d} 步）出现差异`);
  }
}
const seekMs = Date.now() - t0;
if (bad === 0) console.log(`✓ ${MINUTES} 个分钟快照全部恢复重算一致（共 ${seekMs} ms，平均每分钟 ${(seekMs / MINUTES).toFixed(1)} ms）`);
process.exit(bad === 0 ? 0 : 1);

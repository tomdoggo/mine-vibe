/**
 * 带种子的随机数（mulberry32）：模拟里所有随机都走这里，同一种子两次运行结果完全一致。
 * 比赛按分钟分段，每进入新的一分钟就用种子链里对应的种子重置一次，
 * 因此“这一分钟开始时的快照 + 这一分钟的种子”就能原样重算这一分钟。
 */
let state = 1;

export function seedRng(seed: number): void {
  state = seed >>> 0;
}

export function rng(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 种子链：由总种子派生第 k 分钟的种子（k = -1 用于开场布置） */
export function minuteSeed(master: number, minute: number): number {
  let h = (master ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (minute + 1), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** 新开一场时用：真随机的总种子（不走模拟随机数） */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

/**
 * 体力系统（0~100）。
 *  - 场上：每秒有基础消耗，跑动按距离消耗，做动作（投篮、传球、突破、空切、抢断、争篮板、封盖、罚球）另有一次性消耗；
 *    动作多的明星连续打满 40 分钟大约剩 30。
 *  - 场下：每秒恢复；中场休息全员恢复一截。
 *  - 体力 80 以上能力值不打折，80 以下线性衰减，体力 0 时只剩一半（staminaFactor）。
 * 数值都按比赛逻辑的秒（不是现实时间）计，停表时（罚球、死球）也在消耗 / 恢复。
 */

/** 能力值开始衰减的体力线 */
export const FATIGUE_LINE = 80;

/** 体力系数：≥80 为 1，0 时 0.5，中间线性 */
export function staminaFactor(stamina: number): number {
  if (stamina >= FATIGUE_LINE) return 1;
  return 0.5 + (0.5 * Math.max(0, stamina)) / FATIGUE_LINE;
}

/** 场上基础消耗（每秒） */
export const DRAIN_BASE = 0.0042;
/** 跑动消耗（每米） */
export const DRAIN_PER_M = 0.0038;
/** 场下恢复（每秒） */
export const RECOVER_BENCH = 0.075;
/** 中场休息恢复 */
export const RECOVER_HALFTIME = 12;

/** 各动作的一次性消耗 */
export const ACTION_COST = {
  shoot: 0.18,
  pass: 0.034,
  drive: 0.22,
  cut: 0.12,
  steal: 0.04,
  rebound: 0.09,
  block: 0.07,
  freeThrow: 0.07,
} as const;

export type Action = keyof typeof ACTION_COST;

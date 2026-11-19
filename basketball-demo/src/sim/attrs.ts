import { rng } from './rng';
import type { Attributes } from '../data/players';

/** 随机区间的默认下限 / 上限（相对能力值） */
export const FLOOR_DEFAULT = -50;
export const CEIL = 50;
/** 下限最多抬高 30（到 -20） */
export const FLOOR_LIFT_MAX = 30;

/** 参与结算的对象：实际能力值（已乘体力系数）+ 本半场的随机下限 */
export interface Rollable {
  eff: Attributes;
  floor: number;
}

/**
 * 每半场开始时掷一次：决定本半场随机区间的下限。
 * 抬高量在 [保底, 保底 + 10] 之间均匀随机（不超过 30），保底 = (稳定性 - 50) × 0.6：
 * 稳定性 100 → 必定抬满 30（下限 -20）；稳定性 50 → 保底 0，抬 0~10（下限 -50 ~ -40）。
 * 随机带只有 10，所以稳定性对本半场平均发挥的影响是确定的：每 10 点稳定性 ≈ 所有能力平均 +3。
 */
export const FLOOR_RAND_BAND = 10;
export function rollHalfFloor(stability: number): number {
  const minLift = Math.max(0, Math.min(FLOOR_LIFT_MAX, (stability - 50) * 0.28));
  const band = Math.min(FLOOR_RAND_BAND, FLOOR_LIFT_MAX - minLift);
  const lift = minLift + rng() * band;
  return FLOOR_DEFAULT + lift;
}

/** 本半场状态分级：按下限抬高量三等分（<10 不佳、10~20 普通、≥20 极佳） */
export type FloorGrade = 'poor' | 'normal' | 'great';
export function floorGrade(floor: number): FloorGrade {
  const lift = floor - FLOOR_DEFAULT;
  return lift < 10 ? 'poor' : lift < 20 ? 'normal' : 'great';
}
/** 状态符号：不佳 △、普通 ○、极佳 ◎ */
export const FLOOR_GRADE_SYMBOL: Record<FloorGrade, string> = { poor: '△', normal: '○', great: '◎' };

/** 单次动作的实际值：能力值 + [本半场下限, +50] 内的随机量 */
export function roll(p: Rollable, key: Exclude<keyof Attributes, 'stability'>): number {
  return p.eff[key] + p.floor + rng() * (CEIL - p.floor);
}

/** 不带随机的期望值（AI 评估用） */
export function expected(p: Rollable, key: Exclude<keyof Attributes, 'stability'>): number {
  return p.eff[key] + (p.floor + CEIL) / 2;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

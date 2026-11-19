/**
 * 伤病：球员在场上每做一个动作（投篮、传球、突破、空切、抢断、争篮板、封盖、罚球）都有一次受伤判定，
 * 概率 = INJURY_BASE × e^(−稳定性 / 35)，稳定性用当前实际值（累了更容易受伤）。
 * 校准：稳定性 0 的首发一个赛季（36 场）受伤的概率约 85%；稳定性 50 约 35%，70 约 23%，90 约 13%。
 *
 * 受伤类型：75% 轻伤（全能力值减半，之后 1~3 场仍然减半但能上场）、
 * 20% 重伤（全能力值减半且无法出场，之后 3~5 场）、5% 赛季报销。
 * 本场受伤后：轻伤继续打（能力减半，教练减少他剩余的上场时间）；重伤 / 报销在下一个死球被换下，本场不再上场。
 */

export type InjuryKind = 'light' | 'severe' | 'season';

export const INJURY_LABEL: Record<InjuryKind, string> = { light: '轻伤', severe: '重伤', season: '赛季报销' };

/** 每个动作的基础受伤概率（稳定性 0 时）。首发每场约 400 个动作（含争篮板、传球），36 场约 1.45 万个 */
export const INJURY_BASE = 0.00013;
export const INJURY_STAB_SCALE = 35;

export function injuryChance(stability: number): number {
  return INJURY_BASE * Math.exp(-Math.max(0, stability) / INJURY_STAB_SCALE);
}

/** 掷受伤类型与缺阵场数（r1、r2 是两个 0~1 随机数） */
export function rollInjury(r1: number, r2: number): { kind: InjuryKind; games: number } {
  if (r1 < 0.75) return { kind: 'light', games: 1 + Math.floor(r2 * 3) };
  if (r1 < 0.95) return { kind: 'severe', games: 3 + Math.floor(r2 * 3) };
  return { kind: 'season', games: 999 };
}

const RANK: Record<InjuryKind, number> = { light: 1, severe: 2, season: 3 };
export function worseInjury(a: InjuryKind | null, b: InjuryKind | null): InjuryKind | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** 受伤后能力值倍率 */
export const INJURED_MUL = 0.5;

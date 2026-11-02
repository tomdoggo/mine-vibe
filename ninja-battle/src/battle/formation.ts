import { GAME_WIDTH } from '../config';
import { UNIT_KINDS, type Composition, type TeamId, type UnitKind } from '../data/units';
import { FLAT_CENTER_Y, perspectiveX, perspectiveY, scaleAt } from './perspective';

/* ---------- 方阵排列规则（与渲染无关的纯数据） ---------- */

/** 一个方阵的人数范围（下限 1：骑兵默认只有 5 人） */
export const MIN_SQUAD = 1;
export const MAX_SQUAD = 50;
/** 每列最多站几个人 */
export const MAX_PER_COL = 10;
/** 列数范围 */
export const MIN_COLS = 2;
export const MAX_COLS = 5;

/**
 * 人数 → 列数。
 * 规则：每满一个“每列上限”就多开一列，并始终多留一列余量，
 * 再夹在 [MIN_COLS, MAX_COLS] 之间：
 *   10..19 → 2 列，20..29 → 3 列，30..39 → 4 列，40..50 → 5 列。
 */
export function columnsFor(n: number): number {
  const cols = Math.floor(n / MAX_PER_COL) + 1;
  return Math.min(MAX_COLS, Math.max(MIN_COLS, cols));
}

/**
 * 人数 → 每列人数（下标 0 是最前列）。
 * 尽量平均，余数从最前列开始逐列 +1。
 */
export function columnSizes(n: number): number[] {
  const count = Math.min(MAX_SQUAD, Math.max(MIN_SQUAD, Math.round(n)));
  const cols = columnsFor(count);
  const base = Math.floor(count / cols);
  const extra = count % cols;
  return Array.from({ length: cols }, (_, c) => base + (c < extra ? 1 : 0));
}

/* ---------- 几何布局 ---------- */

/** 平面上的行距（像素，透视前），所有兵种相同 */
export const ROW_SPACING = 18;
/** 前后列距（像素，透视前）。骑兵连马比人宽，列距单独放宽一些 */
export const COL_SPACING: Record<UnitKind, number> = {
  melee: 16,
  ranged: 16,
  cavalry: 25,
};
/** 第一个方阵最前列距中线的距离，以及相邻方阵之间的空隙（透视前） */
export const FIRST_FRONT_X = 60;
export const SQUAD_GAP = 28;
/** 整个队伍相对战场视觉中心往下挪多少（平面像素），正数向下 */
export const FORMATION_Y_OFFSET = 0;

export interface Slot {
  kind: UnitKind;
  x: number;
  y: number;
  /** 近大远小的缩放 */
  scale: number;
  /** 0 = 最前列 */
  col: number;
  /** 0 = 该列最上面一个 */
  row: number;
}

/**
 * 各方阵最前列距中线的平面距离：
 * 从前到后依次是 UNIT_KINDS 的顺序（足轻、弓兵、骑兵），
 * 后一个方阵紧跟在前一个方阵的最后一列之后，中间留 SQUAD_GAP。
 */
export function squadFrontX(comp: Composition): Record<UnitKind, number> {
  const result = {} as Record<UnitKind, number>;
  let front = FIRST_FRONT_X;
  for (const kind of UNIT_KINDS) {
    result[kind] = front;
    const depth = (columnsFor(comp[kind]) - 1) * COL_SPACING[kind];
    front += depth + SQUAD_GAP;
  }
  return result;
}

/**
 * 计算一方全部站位（屏幕坐标，已做透视）。
 * 每一列各自以战场中线垂直居中。
 */
export function formationSlots(team: TeamId, comp: Composition): Slot[] {
  const dir = team === 'player' ? 1 : -1;
  const center = GAME_WIDTH / 2;
  const fieldMid = FLAT_CENTER_Y + FORMATION_Y_OFFSET;
  const fronts = squadFrontX(comp);
  const slots: Slot[] = [];

  for (const kind of UNIT_KINDS) {
    const sizes = columnSizes(comp[kind]);
    sizes.forEach((size, col) => {
      const flatX = center - dir * (fronts[kind] + col * COL_SPACING[kind]);
      for (let row = 0; row < size; row++) {
        const flatY = fieldMid + (row - (size - 1) / 2) * ROW_SPACING;
        const y = perspectiveY(flatY);
        slots.push({ kind, col, row, x: perspectiveX(flatX, y), y, scale: scaleAt(y) });
      }
    });
  }
  return slots;
}

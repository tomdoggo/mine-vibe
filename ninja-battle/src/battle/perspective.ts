import Phaser from 'phaser';
import { FIELD_BOTTOM, FIELD_TOP, GAME_WIDTH } from '../config';

/**
 * 伪 3D 透视：屏幕越靠下离镜头越近。
 * “平面坐标”指没有透视时的地面坐标（x 距中线的偏移、y 在战场中的位置），
 * 这里负责把平面坐标换算成屏幕坐标和缩放。
 * depth = 0 是最远（战场顶端），1 是最近（战场底端）。
 */

/** 最远 / 最近处的单位缩放 */
export const SCALE_FAR = 0.7;
export const SCALE_NEAR = 1.3;
/** 最远 / 最近处横向偏移的收缩系数（远处向中线收窄） */
export const SPREAD_FAR = 0.72;
export const SPREAD_NEAR = 1.08;
/** 纵向压缩指数：>1 让靠近地平线的行挤得更密 */
export const DEPTH_EXPONENT = 1.35;

const FIELD_SPAN = FIELD_BOTTOM - FIELD_TOP;

/**
 * 平面上的“视觉中心”：经过 perspectiveY 之后正好落在屏幕上战场的正中间。
 * 方阵以此为中心上下对称排列，看起来才是居中的。
 */
export const FLAT_CENTER_Y = FIELD_TOP + FIELD_SPAN * Math.pow(0.5, 1 / 1.35);

export function depthAt(screenY: number): number {
  return Phaser.Math.Clamp((screenY - FIELD_TOP) / FIELD_SPAN, 0, 1);
}

export function scaleAt(screenY: number): number {
  return Phaser.Math.Linear(SCALE_FAR, SCALE_NEAR, depthAt(screenY));
}

/** 平面 y（FIELD_TOP..FIELD_BOTTOM）→ 屏幕 y：远处压缩，近处拉开 */
export function perspectiveY(flatY: number): number {
  const t = Phaser.Math.Clamp((flatY - FIELD_TOP) / FIELD_SPAN, 0, 1);
  return FIELD_TOP + FIELD_SPAN * Math.pow(t, DEPTH_EXPONENT);
}

/** 平面 x → 屏幕 x：按所在屏幕 y 的深度，远处向中线收窄、近处放宽 */
export function perspectiveX(flatX: number, screenY: number): number {
  const center = GAME_WIDTH / 2;
  const spread = Phaser.Math.Linear(SPREAD_FAR, SPREAD_NEAR, depthAt(screenY));
  return center + (flatX - center) * spread;
}

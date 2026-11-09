/**
 * 角色素材：Ninja Adventure（Pixel-boy，CC0），见 public/assets/README.md
 * 精灵表 64×112，每帧 16×16：4 列 = 朝向（下、上、左、右），7 行 = 行走 4 帧、攻击、跳跃、特殊。
 */
export const ASSET_ROOT = 'assets';
export const CHAR_FRAME = 16;

export type Facing = 'down' | 'up' | 'left' | 'right';
export const FACING_COL: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 };

/** 行走动画用的 4 行 */
export const WALK_ROWS = [0, 1, 2, 3];
/** 投篮姿势（攻击行） */
export const SHOOT_ROW = 4;
/** 跳起（跳跃行） */
export const JUMP_ROW = 5;

export function frameIndex(row: number, facing: Facing): number {
  return row * 4 + FACING_COL[facing];
}

export const TEX = {
  char: (id: number) => `char-${id}`,
  ball: 'ball',
} as const;

export const ANIM = {
  walk: (id: number, facing: Facing) => `walk-${id}-${facing}`,
} as const;

/** 篮球贴图 32×32，缩到 8px 显示 */
export const BALL_SCALE = 0.25;

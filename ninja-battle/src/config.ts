/** 逻辑分辨率：所有坐标、尺寸都按这个算，实际显示由 Phaser Scale FIT 整体缩放 */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;

/**
 * 渲染倍率：画布实际是 GAME_WIDTH × RENDER_SCALE 像素，每个场景的相机放大 RENDER_SCALE 倍，
 * 这样逻辑坐标不变，像素画按整数倍放大仍然是方块，而文字按 RENDER_SCALE 倍分辨率绘制，不会糊。
 */
export const RENDER_SCALE = 3;

/** 地平线：以上是天空，以下是草地 */
export const HORIZON_Y = 150;

/** 战场可行走区域（单位只能在这段 y 范围内活动），位于地平线以下 */
export const FIELD_TOP = 172;
export const FIELD_BOTTOM = 338;

/** 中文优先用系统无衬线字体，小字号下比等宽字体清楚得多 */
export const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

export const SCENE = {
  BOOT: 'Boot',
  BATTLE: 'Battle',
} as const;

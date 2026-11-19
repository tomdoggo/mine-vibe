/** 逻辑分辨率：所有坐标、尺寸都按这个算，实际显示由 Phaser Scale FIT 整体缩放 */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

/**
 * 渲染倍率：画布实际是 GAME_WIDTH × RENDER_SCALE 像素，相机放大 RENDER_SCALE 倍，
 * 像素画按整数倍放大仍是方块，文字按高分辨率绘制不糊。
 */
export const RENDER_SCALE = 2;

/** 中文优先用系统无衬线字体 */
export const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

export const SCENE = {
  BOOT: 'Boot',
  MATCH: 'Match',
} as const;

/** 布局：顶部记分牌、左侧球场 + 事件日志、右侧数据面板 */
export const LAYOUT = {
  hudHeight: 56,
  /** 右侧面板 */
  panelX: 594,
  panelWidth: 358,
  panelTop: 66,
  panelBottom: 528,
  /** 球场下方事件日志区域 */
  logTop: 410,
  logBottom: 528,
} as const;

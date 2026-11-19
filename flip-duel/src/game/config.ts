import type { Quality } from './cards.ts';

/** 所有可调数值集中在这里，调平衡只改这个文件 */
export const CONFIG = {
  startGold: 5,
  dailyIncome: 5, // 第一天没有
  maxHp: 20,
  starsToWin: 10,

  price: { white: 2, blue: 3, purple: 4, orange: 5 } as Record<Quality, number>,
  sellPrice: 1,
  shopSize: 3,
  refreshBase: 1, // 每进一次商店，刷新价从 1 开始，每刷一次 +1
  refreshStep: 1,

  /** 商店每个格子按天数决定品质概率（白/蓝/紫/橙，百分比） */
  shopOdds: (day: number): [number, number, number, number] => {
    const table: [number, number, number, number][] = [
      [100, 0, 0, 0],
      [75, 25, 0, 0],
      [55, 35, 10, 0],
      [45, 35, 17, 3],
      [35, 35, 24, 6],
      [28, 35, 28, 9],
      [22, 33, 32, 13],
    ];
    return table[Math.min(day, table.length) - 1];
  },

  /** 构筑：选 20 种职业卡，每种带 1~4 张；中立卡 35 种 × 4 张自动加入 */
  buildDistinct: 20,
  maxCopies: 4,
  neutralCopies: 4,

  rows: 5, // 竖屏：5 行 × 4 列 = 20 格
  cols: 4,
  rounds: 3,
  roundMult: [1, 1, 1], // 每轮分数倍率（现在三轮一样）

  /** 一天 4 个事件 */
  events: ['shop', 'wild', 'shop', 'pvp'] as const,

  /** 输一场扣的血：第 1~2 天 2 点，之后每两天 +1，最多 6 点 */
  lossDamage: (day: number) => Math.min(2 + Math.floor((day - 1) / 2), 6),

  /** 打赢野怪：金币奖励 + 野怪的随机 1 张卡（可跳过，跳过再 +2 金） */
  wildGold: (day: number) => 1 + Math.floor((day + 1) / 2),
  skipCardGold: 2,
  /** 野怪牌力 = 参考玩家牌力 × 这个比例（模拟校准：正常玩家胜率约 80%~90%） */
  wildRatio: (day: number) => (day <= 2 ? 0.85 : day <= 6 ? 1.05 : 0.95),
  /** 野怪的卡最高等级：第 3 天起可能出银卡，第 7 天起可能出金卡 */
  wildMaxTier: (day: number) => (day >= 7 ? 2 : day >= 3 ? 1 : 0),
};

export type EventKind = (typeof CONFIG.events)[number];
export const BOARD_SIZE = CONFIG.rows * CONFIG.cols;

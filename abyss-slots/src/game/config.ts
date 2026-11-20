/** 所有可调数值集中在这里，改完跑 `npm run sim` 看返还率 */
export const CONFIG = {
  startCoins: 10,
  maxSpins: 100,
  minBet: 1,
  maxBet: 10,
} as const;

export type SymbolId = 'candle' | 'dagger' | 'eye' | 'skull' | 'coin' | 'seven';

export interface SymbolDef {
  id: SymbolId;
  name: string;
  /** 每格独立抽取时的权重 */
  weight: number;
  /** 三连时的赔率（× 本次下注） */
  mult: number;
}

/** 从便宜到贵。权重合计 100，方便心算概率 */
export const SYMBOLS: readonly SymbolDef[] = [
  { id: 'candle', name: '残烛', weight: 40, mult: 1 },
  { id: 'dagger', name: '匕首', weight: 24, mult: 4 },
  { id: 'eye', name: '魔眼', weight: 15, mult: 8 },
  { id: 'skull', name: '骷髅', weight: 10, mult: 15 },
  { id: 'coin', name: '冥币', weight: 7, mult: 30 },
  { id: 'seven', name: '血七', weight: 4, mult: 100 },
];

/** 赔率达到这个倍数算“大奖”，触发金币雨和震屏 */
export const BIG_WIN_MULT = 15;

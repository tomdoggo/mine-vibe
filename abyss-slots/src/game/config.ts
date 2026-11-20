/** 所有可调数值集中在这里，改完跑 `npm run sim` 看返还率 */
export const CONFIG = {
  startCoins: 10,
  maxSpins: 100,
  minBet: 1,
  /** 深渊 1 层时的下注上限 */
  baseMaxBet: 10,
  /** 每转这么多次，深渊等级 +1，下注上限翻倍 */
  abyssEvery: 10,
  /** 左右两边各能摆几个玩偶 */
  dollSlotsPerSide: 5,
  /** 开局先选一次玩偶，之后每转这么多次再选一次 */
  offerEvery: 5,
  /** 每次从几个玩偶里挑 */
  offerChoices: 2,
  /** 玩偶的价格：跳过选择拿这么多金币，出售拿一半（向下取整） */
  dollPrice: 5,
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

/**
 * 从便宜到贵。权重合计 100，方便心算概率。
 * 基础返还率故意压在 100% 以下（约 89%）：不靠玩偶，转得越多亏得越多。
 */
export const SYMBOLS: readonly SymbolDef[] = [
  { id: 'candle', name: '残烛', weight: 36, mult: 1 },
  { id: 'dagger', name: '匕首', weight: 24, mult: 2 },
  { id: 'eye', name: '魔眼', weight: 16, mult: 3 },
  { id: 'skull', name: '骷髅', weight: 12, mult: 6 },
  { id: 'coin', name: '冥币', weight: 8, mult: 15 },
  { id: 'seven', name: '血七', weight: 4, mult: 100 },
];

/** 奖金达到下注的这么多倍算“大奖”，触发金币雨和震屏 */
export const BIG_WIN_MULT = 15;

/* ---------------- 玩偶（礼物） ---------------- */

export type DollId =
  | 'imp' | 'raven' | 'ghost' | 'bat' | 'skeleton'
  | 'rat' | 'hound' | 'cat' | 'owl' | 'mimic';

export interface DollDef {
  id: DollId;
  name: string;
  /** 给玩家看的效果说明（具体数值在下面的 DOLL_TUNING 里） */
  desc: string;
}

/** 玩偶效果用到的数值（每个玩偶大约值 +10% ~ +25% 返还率，凑齐两三个才开始赚钱） */
export const DOLL_TUNING = {
  impCandleMult: 1.5,
  ghostRefundChance: 0.25,
  batEyeMult: 3,
  skeletonSkullWeight: 10,
  skeletonCoinWeight: 6,
  ratPercent: 1,
  ratMin: 1,
  houndMult: 2,
  catStreak: 3,
  catMult: 2,
  owlThreshold: 10,
  owlMult: 2,
  mimicBetShare: 0.5,
  mimicMult: 1.3,
} as const;

const T = DOLL_TUNING;

export const DOLLS: readonly DollDef[] = [
  { id: 'imp', name: '烛灵', desc: `残烛三连的赔率 ×${T.impCandleMult}` },
  { id: 'ghost', name: '幽灵', desc: `没中奖时 ${T.ghostRefundChance * 100}% 概率退还下注` },
  { id: 'rat', name: '吞金鼠', desc: `每转结束，获得持有金币的 ${T.ratPercent}%（至少 ${T.ratMin}）` },
  { id: 'raven', name: '渡鸦', desc: '中了匕首三连，立即免费再转一次' },
  { id: 'bat', name: '魔眼蝠', desc: `魔眼三连的赔率 ×${T.batEyeMult}` },
  { id: 'cat', name: '黑猫', desc: `连续 ${T.catStreak} 转没中后，下一次中奖奖金 ×${T.catMult}` },
  { id: 'skeleton', name: '骷髅兵', desc: '骷髅和冥币出现得更频繁' },
  { id: 'hound', name: '双头犬', desc: `同时中 2 条线以上，奖金 ×${T.houndMult}` },
  { id: 'owl', name: '猫头鹰', desc: `奖金达到下注 ${T.owlThreshold} 倍时，再 ×${T.owlMult}` },
  { id: 'mimic', name: '宝箱怪', desc: `下注不低于上限的一半时，奖金 ×${T.mimicMult}` },
];

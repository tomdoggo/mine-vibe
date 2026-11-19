/* ======================= 卡牌基础类型 ======================= */

/** 品质：决定商店出现概率和价格 */
export type Quality = 'white' | 'blue' | 'purple' | 'orange';
export const QUALITIES: Quality[] = ['white', 'blue', 'purple', 'orange'];
export const QUALITY_NAMES: Record<Quality, string> = { white: '白', blue: '蓝', purple: '紫', orange: '橙' };

/** 职业：neutral 为中立卡，每局自动加入卡池 */
export type ClassId = 'neutral' | 'miner' | 'hacker';
export const CLASS_NAMES: Record<ClassId, string> = { neutral: '中立', miner: '矿工', hacker: '黑客' };
export const CLASS_ICON: Record<ClassId, string> = { neutral: '◇', miner: '⛏', hacker: '⌨' };
export const PLAY_CLASSES: Exclude<ClassId, 'neutral'>[] = ['miner', 'hacker'];

/** 等级：两张同名同级合成一张高一级，数值翻倍 */
export type Tier = 0 | 1 | 2;
export const TIER_NAMES = ['1星', '2星', '3星'] as const;
export const TIER_MULT = [1, 2, 4] as const;
export const MAX_TIER: Tier = 2;

/**
 * 效果。n 为 1 星数值，2 星 ×2、3 星 ×4。
 * 「本轮」= 只影响这一轮；「永久」= 写回卡牌，以后每场都在。
 */
export type Op =
  // 计分时加分
  | 'adjAlly' | 'adjEnemy' | 'rowAlly' | 'colAlly' | 'prevAlly' | 'alone'
  | 'edge' | 'corner' | 'center' | 'early' | 'late' | 'round3' | 'scaleRound'
  | 'perTag' | 'perGold' | 'copyPrev'
  // 永久成长
  | 'grow' | 'growAdj' | 'growTag' | 'growRandom'
  // 影响后面翻开的牌
  | 'buffAdj' | 'buffNext' | 'doubleNext'
  | 'debuffAdj' | 'debuffNext' | 'silenceNext' | 'destroyAdjEnemy' | 'destroyRandomEnemy'
  // 其他
  | 'steal' | 'virus' | 'gold' | 'shield';

export type Fx = [Op, number?, string?];

export interface CardDef {
  id: string;
  name: string;
  cls: ClassId;
  q: Quality;
  base: number;
  fx: Fx[];
  tags: string[];
}

/** 一张实际拥有的卡 */
export interface Card {
  uid: string;
  id: string;
  tier: Tier;
  /** 永久成长累计的分数 */
  bonus: number;
}

/* ======================= 文字描述（按等级生成） ======================= */

export function fxText([op, n = 0, tag = '']: Fx, tier: Tier): string {
  const v = n * TIER_MULT[tier];
  switch (op) {
    case 'adjAlly': return `每个相邻友方 +${v}`;
    case 'adjEnemy': return `每个相邻敌方 +${v}`;
    case 'rowAlly': return `同一行每个其他友方 +${v}`;
    case 'colAlly': return `同一列每个其他友方 +${v}`;
    case 'prevAlly': return `本轮在它之前每翻开一张友方 +${v}`;
    case 'alone': return `没有相邻友方时 +${v}`;
    case 'edge': return `在边上 +${v}`;
    case 'corner': return `在四个角上 +${v}`;
    case 'center': return `不在边上 +${v}`;
    case 'early': return `在前两行 +${v}`;
    case 'late': return `在后两行 +${v}`;
    case 'round3': return `第 3 轮 +${v}`;
    case 'scaleRound': return `+ 轮数 × ${v}`;
    case 'perTag': return `卡组里每张其他【${tag}】+${v}`;
    case 'perGold': return `每持有 5 金 +${v}`;
    case 'copyPrev': return '再加上前一张翻开的牌的分数';
    case 'grow': return `翻开：永久 +${v}`;
    case 'growAdj': return `翻开：相邻友方永久 +${v}`;
    case 'growTag': return `翻开：卡组里所有【${tag}】永久 +${v}`;
    case 'growRandom': return `翻开：卡组里随机一张其他卡永久 +${v}`;
    case 'buffAdj': return `相邻未翻开的友方本轮 +${v}`;
    case 'buffNext': return `下一张友方 +${v}`;
    case 'doubleNext': return `下一张友方得分 ×${1 + TIER_MULT[tier]}`;
    case 'debuffAdj': return `相邻未翻开的敌方本轮 -${v}`;
    case 'debuffNext': return `下一张敌方 -${v}`;
    case 'silenceNext': return '下一张敌方得 0 分';
    case 'destroyAdjEnemy': return '摧毁相邻未翻开的敌方（本轮 0 分）';
    case 'destroyRandomEnemy': return `随机摧毁 ${TIER_MULT[tier] * Math.max(1, n)} 张未翻开的敌方`;
    case 'steal': return `从对手偷 ${v} 分（吃轮次倍率）`;
    case 'virus': return `本轮之后翻开的敌方每张 -${v}`;
    case 'gold': return `获得 ${v} 金`;
    case 'shield': return '免疫负面效果';
  }
}

/* ======================= 卡牌数据库 ======================= */

export const CARD_DB = new Map<string, CardDef>();

export function registerCards(cls: ClassId, rows: [string, string, Quality, number, Fx[], string?][]) {
  for (const [id, name, q, base, fx, tags] of rows) {
    CARD_DB.set(id, { id, name, cls, q, base, fx, tags: tags ? tags.split(',') : [] });
  }
}

export const defOf = (c: Card | string): CardDef => {
  const d = CARD_DB.get(typeof c === 'string' ? c : c.id);
  if (!d) throw new Error(`未知卡牌 ${typeof c === 'string' ? c : c.id}`);
  return d;
};

export const cardsOfClass = (cls: ClassId) => [...CARD_DB.values()].filter((d) => d.cls === cls);

export const baseScore = (c: Card) => defOf(c).base * TIER_MULT[c.tier];
/** 不算场上效果时的分数（底分 + 永久成长） */
export const cardScore = (c: Card) => baseScore(c) + c.bonus;

export const cardTexts = (c: Card) => defOf(c).fx.map((f) => fxText(f, c.tier));

export const makeCard = (id: string, uid: string, tier: Tier = 0): Card => ({ uid, id, tier, bonus: 0 });
export const cloneCard = (c: Card): Card => ({ ...c });

export const canMerge = (a: Card, b: Card) => a.uid !== b.uid && a.id === b.id && a.tier === b.tier && a.tier < MAX_TIER;

/** 两张同名同级 → 一张高一级；永久成长相加保留 */
export const mergeCards = (a: Card, b: Card, uid: string): Card => ({
  uid, id: a.id, tier: (a.tier + 1) as Tier, bonus: a.bonus + b.bonus,
});

export function findPartner(deck: Card[], c: Card): Card | undefined {
  return deck.filter((o) => canMerge(c, o)).sort((x, y) => y.bonus - x.bonus)[0];
}

const Q_ORDER: Record<Quality, number> = { orange: 0, purple: 1, blue: 2, white: 3 };
export const qualityOrder = (q: Quality) => Q_ORDER[q];

export function sortDeck(deck: Card[]): Card[] {
  return [...deck].sort((a, b) => b.tier - a.tier || Q_ORDER[defOf(a).q] - Q_ORDER[defOf(b).q] || a.id.localeCompare(b.id) || b.bonus - a.bonus);
}

/* ======================= 牌力估算（野怪、AI 用） ======================= */

/** 每单位效果值大约等于多少「每轮分数」，粗估即可，模拟脚本会校验 */
const EST: Record<Op, number> = {
  adjAlly: 1.4, adjEnemy: 1.4, rowAlly: 1.5, colAlly: 2, prevAlly: 4.5, alone: 0.35,
  edge: 0.7, corner: 0.2, center: 0.3, early: 0.4, late: 0.4, round3: 0.5, scaleRound: 2.25,
  perTag: 3, perGold: 1, copyPrev: 0,
  grow: 2.25, growAdj: 2, growTag: 4, growRandom: 1.5,
  buffAdj: 0.8, buffNext: 0.9, doubleNext: 0,
  debuffAdj: 0.8, debuffNext: 0.9, silenceNext: 0, destroyAdjEnemy: 0, destroyRandomEnemy: 10,
  steal: 2.6, virus: 5, gold: 2.5, shield: 0,
};
const EST_FLAT: Partial<Record<Op, number>> = { copyPrev: 10, doubleNext: 10, silenceNext: 11, destroyAdjEnemy: 9, shield: 1 };

export function estPower(c: Card): number {
  const d = defOf(c);
  const m = TIER_MULT[c.tier];
  let v = d.base;
  for (const [op, n = 0] of d.fx) v += EST[op] * n + (EST_FLAT[op] ?? 0);
  return v * m + c.bonus;
}

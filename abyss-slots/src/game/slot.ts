import { CONFIG, DOLLS, DOLL_TUNING as T, SYMBOLS, type DollDef, type DollId, type SymbolDef, type SymbolId } from './config.ts';
import type { Rng } from './rng.ts';

/** 盘面按行存：格子下标 = 行 * 3 + 列（行 0 在最上面） */
export type Grid = SymbolId[];

/** 8 条中奖线：3 横、3 竖、2 斜 */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const SYMBOL_BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s])) as Record<SymbolId, SymbolDef>;
export const DOLL_BY_ID = Object.fromEntries(DOLLS.map((d) => [d.id, d])) as Record<DollId, DollDef>;
export const MAX_DOLLS = CONFIG.dollSlotsPerSide * 2;

export interface Session {
  coins: number;
  spinsLeft: number;
  /** 本局见过的最高金币数 */
  peak: number;
  /** 已摆上台的玩偶，按购买顺序 */
  dolls: DollId[];
  /** 连续没中奖的次数（黑猫用） */
  loseStreak: number;
  /** 已经花掉的转数（免费旋转不算），决定深渊等级和下一次选玩偶的时机 */
  spinsDone: number;
  /** 正等着玩家挑的玩偶；null = 现在没有选择 */
  offer: DollId[] | null;
}

export const newSession = (): Session => ({
  coins: CONFIG.startCoins,
  spinsLeft: CONFIG.maxSpins,
  peak: CONFIG.startCoins,
  dolls: [],
  loseStreak: 0,
  spinsDone: 0,
  offer: null,
});

const has = (s: Session, id: DollId) => s.dolls.includes(id);

/** 当前各符号的权重（骷髅兵会改） */
export function weightsFor(s: Session): number[] {
  return SYMBOLS.map((sym) => {
    if (has(s, 'skeleton')) {
      if (sym.id === 'skull') return sym.weight + T.skeletonSkullWeight;
      if (sym.id === 'coin') return sym.weight + T.skeletonCoinWeight;
    }
    return sym.weight;
  });
}

export function rollGrid(rng: Rng, weights: readonly number[] = SYMBOLS.map((s) => s.weight)): Grid {
  const total = weights.reduce((a, b) => a + b, 0);
  return Array.from({ length: 9 }, () => {
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return SYMBOLS[i].id;
    }
    return SYMBOLS[SYMBOLS.length - 1].id;
  });
}

export interface LineWin {
  line: number;
  symbol: SymbolId;
  mult: number;
}

/** 不考虑玩偶的基础判奖 */
export function evaluate(grid: Grid): { wins: LineWin[]; mult: number } {
  const wins: LineWin[] = [];
  LINES.forEach(([a, b, c], line) => {
    if (grid[a] === grid[b] && grid[b] === grid[c]) {
      wins.push({ line, symbol: grid[a], mult: SYMBOL_BY_ID[grid[a]].mult });
    }
  });
  return { wins, mult: wins.reduce((a, w) => a + w.mult, 0) };
}

export const isOver = (s: Session) => s.spinsLeft <= 0 || s.coins < CONFIG.minBet;

/** 深渊等级：从 1 层开始，每转 abyssEvery 次 +1 */
export const abyssLevel = (s: Session) => 1 + Math.floor(s.spinsDone / CONFIG.abyssEvery);

/** 下注上限：每深一层翻一倍 */
export const maxBetOf = (s: Session) => CONFIG.baseMaxBet * 2 ** (abyssLevel(s) - 1);

/** 把想下的注收到合法范围内（不能超过手里的金币） */
export const clampBet = (s: Session, bet: number) =>
  Math.max(CONFIG.minBet, Math.min(maxBetOf(s), Math.floor(bet), s.coins));

/** 某个符号现在的实际赔率（算上玩偶），点盘面查看和结算用的是同一份 */
export interface SymbolOdds {
  /** 基础赔率 */
  base: number;
  /** 实际赔率（× 下注） */
  mult: number;
  /** 每条线额外加的固定金币 */
  bonus: number;
  /** 每格抽到它的概率 */
  chance: number;
  /** 哪些玩偶改了它 */
  notes: { doll: DollId; text: string }[];
}

export function symbolOdds(s: Session, id: SymbolId): SymbolOdds {
  const base = SYMBOL_BY_ID[id].mult;
  const out: SymbolOdds = { base, mult: base, bonus: 0, chance: 0, notes: [] };
  if (id === 'eye' && has(s, 'bat')) {
    out.mult *= T.batEyeMult;
    out.notes.push({ doll: 'bat', text: `赔率 ×${T.batEyeMult}` });
  }
  if (id === 'candle' && has(s, 'imp')) {
    out.bonus = T.impBonus;
    out.notes.push({ doll: 'imp', text: `每条线 +${T.impBonus} 金币` });
  }
  if (id === 'dagger' && has(s, 'raven')) out.notes.push({ doll: 'raven', text: '中了免费再转一次' });
  const weights = weightsFor(s);
  const i = SYMBOLS.findIndex((x) => x.id === id);
  out.chance = weights[i] / weights.reduce((a, b) => a + b, 0);
  if (weights[i] !== SYMBOLS[i].weight) out.notes.push({ doll: 'skeleton', text: '出现概率提高' });
  return out;
}

/* ---------------- 玩偶 ---------------- */

/** 出售价：半价，向下取整 */
export const SELL_PRICE = Math.floor(CONFIG.dollPrice / 2);

/** 现在该不该弹出玩偶选择：开局一次，之后每 offerEvery 转一次 */
export const offerDue = (s: Session) => s.spinsDone % CONFIG.offerEvery === 0;

/** 从还没摆上台的玩偶里随机抽几个给玩家挑；没得挑（全拥有 / 位置满了）就返回 null */
export function rollOffer(s: Session, rng: Rng): DollId[] | null {
  s.offer = null;
  if (s.dolls.length >= MAX_DOLLS) return null;
  const pool = DOLLS.map((d) => d.id).filter((id) => !has(s, id));
  const picks: DollId[] = [];
  while (pool.length && picks.length < CONFIG.offerChoices) {
    picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  if (picks.length) s.offer = picks;
  return s.offer;
}

/** 从当前选择里带走一个玩偶 */
export function takeDoll(s: Session, id: DollId): boolean {
  if (!s.offer?.includes(id) || has(s, id) || s.dolls.length >= MAX_DOLLS) return false;
  s.dolls.push(id);
  s.offer = null;
  return true;
}

/** 跳过这次选择，改拿金币 */
export function skipOffer(s: Session): number {
  if (!s.offer) return 0;
  s.offer = null;
  s.coins += CONFIG.dollPrice;
  s.peak = Math.max(s.peak, s.coins);
  return CONFIG.dollPrice;
}

/** 卖掉一个已摆放的玩偶，后面的玩偶往前补位 */
export function sellDoll(s: Session, id: DollId): number {
  const i = s.dolls.indexOf(id);
  if (i < 0) return 0;
  s.dolls.splice(i, 1);
  s.coins += SELL_PRICE;
  s.peak = Math.max(s.peak, s.coins);
  return SELL_PRICE;
}

/** 某个玩偶在这一转里触发了什么 */
export interface DollEvent {
  doll: DollId;
  text: string;
}

export interface SpinResult {
  bet: number;
  /** 这是一次免费旋转（不扣下注、不扣转数） */
  free: boolean;
  grid: Grid;
  wins: LineWin[];
  /** 中奖奖金（已算上玩偶加成） */
  payout: number;
  /** 幽灵退还的下注 */
  refund: number;
  /** 吞金鼠给的利息 */
  interest: number;
  /** 渡鸦触发：紧接着再免费转一次 */
  freeSpin: boolean;
  events: DollEvent[];
}

/**
 * 结算一次旋转（纯逻辑，立刻出结果；动画由表现层慢慢播）。
 * 奖金计算顺序：各线实际赔率（见 symbolOdds）→ 双头犬 → 黑猫 → 宝箱怪，所有结果向下取整。
 */
export function spin(s: Session, bet: number, rng: Rng, free = false): SpinResult {
  if (!free) {
    if (isOver(s)) throw new Error('对局已结束');
    bet = clampBet(s, bet);
    s.coins -= bet;
    s.spinsLeft--;
    s.spinsDone++;
  }
  const events: DollEvent[] = [];
  const grid = rollGrid(rng, weightsFor(s));
  const { wins } = evaluate(grid);

  let payout = 0;
  for (const w of wins) {
    const odds = symbolOdds(s, w.symbol);
    payout += bet * odds.mult + odds.bonus;
  }
  const count = (sym: SymbolId) => wins.filter((w) => w.symbol === sym).length;
  if (has(s, 'bat') && count('eye')) events.push({ doll: 'bat', text: `魔眼 ×${T.batEyeMult}` });
  if (has(s, 'imp') && count('candle')) events.push({ doll: 'imp', text: `+${T.impBonus * count('candle')}` });
  if (wins.length >= 2 && has(s, 'hound')) {
    payout *= T.houndMult;
    events.push({ doll: 'hound', text: `多线 ×${T.houndMult}` });
  }
  if (payout > 0 && s.loseStreak >= T.catStreak && has(s, 'cat')) {
    payout *= T.catMult;
    events.push({ doll: 'cat', text: `转运 ×${T.catMult}` });
  }
  if (payout > 0 && bet >= T.mimicMinBet && has(s, 'mimic')) {
    payout = Math.floor(payout * T.mimicMult);
    events.push({ doll: 'mimic', text: `重注 ×${T.mimicMult}` });
  }

  let refund = 0;
  if (payout === 0 && !free && has(s, 'ghost') && rng() < T.ghostRefundChance) {
    refund = bet;
    events.push({ doll: 'ghost', text: `退还 ${bet}` });
  }
  s.loseStreak = payout > 0 ? 0 : s.loseStreak + 1;
  s.coins += payout + refund;

  let interest = 0;
  if (has(s, 'rat')) {
    interest = Math.min(T.ratMax, Math.floor(s.coins / T.ratPer));
    if (interest) {
      s.coins += interest;
      events.push({ doll: 'rat', text: `利息 +${interest}` });
    }
  }
  if (payout >= bet * T.owlThreshold && has(s, 'owl')) {
    s.spinsLeft += T.owlSpins;
    events.push({ doll: 'owl', text: `转数 +${T.owlSpins}` });
  }
  const freeSpin = has(s, 'raven') && count('dagger') > 0;
  if (freeSpin) events.push({ doll: 'raven', text: '再转一次' });

  s.peak = Math.max(s.peak, s.coins);
  return { bet, free, grid, wins, payout, refund, interest, freeSpin, events };
}

/** 一次“玩家按下旋转”的完整结算：包含渡鸦连锁出来的免费旋转 */
export function spinChain(s: Session, bet: number, rng: Rng): SpinResult[] {
  const out = [spin(s, bet, rng)];
  // 连锁上限只是保险，正常概率下到不了
  while (out[out.length - 1].freeSpin && out.length < 50) out.push(spin(s, out[0].bet, rng, true));
  return out;
}

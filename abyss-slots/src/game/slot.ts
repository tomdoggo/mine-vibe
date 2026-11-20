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
}

export const newSession = (): Session => ({
  coins: CONFIG.startCoins,
  spinsLeft: CONFIG.maxSpins,
  peak: CONFIG.startCoins,
  dolls: [],
  loseStreak: 0,
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

/** 把想下的注收到合法范围内（不能超过手里的金币） */
export const clampBet = (s: Session, bet: number) =>
  Math.max(CONFIG.minBet, Math.min(CONFIG.maxBet, Math.floor(bet), s.coins));

/* ---------------- 玩偶 ---------------- */

/** 买完至少要剩 1 枚金币，不然直接没法转了 */
export const canBuy = (s: Session, id: DollId) =>
  !has(s, id) && s.dolls.length < MAX_DOLLS && s.coins - DOLL_BY_ID[id].price >= CONFIG.minBet;

export function buyDoll(s: Session, id: DollId): boolean {
  if (!canBuy(s, id)) return false;
  s.coins -= DOLL_BY_ID[id].price;
  s.dolls.push(id);
  return true;
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
 * 奖金计算顺序：各线赔率（魔眼蝠）→ 烛灵加固定值 → 双头犬 → 黑猫 → 宝箱怪。
 */
export function spin(s: Session, bet: number, rng: Rng, free = false): SpinResult {
  if (!free) {
    if (isOver(s)) throw new Error('对局已结束');
    bet = clampBet(s, bet);
    s.coins -= bet;
    s.spinsLeft--;
  }
  const events: DollEvent[] = [];
  const grid = rollGrid(rng, weightsFor(s));
  const { wins } = evaluate(grid);

  let payout = 0;
  for (const w of wins) {
    let mult = w.mult;
    if (w.symbol === 'eye' && has(s, 'bat')) mult *= T.batEyeMult;
    payout += bet * mult;
    if (w.symbol === 'candle' && has(s, 'imp')) payout += T.impBonus;
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

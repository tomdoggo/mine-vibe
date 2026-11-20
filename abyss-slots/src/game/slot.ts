import { CONFIG, SYMBOLS, type SymbolDef, type SymbolId } from './config.ts';
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
const TOTAL_WEIGHT = SYMBOLS.reduce((a, s) => a + s.weight, 0);

export function rollSymbol(rng: Rng): SymbolId {
  let r = rng() * TOTAL_WEIGHT;
  for (const s of SYMBOLS) {
    r -= s.weight;
    if (r < 0) return s.id;
  }
  return SYMBOLS[SYMBOLS.length - 1].id;
}

export const rollGrid = (rng: Rng): Grid => Array.from({ length: 9 }, () => rollSymbol(rng));

export interface LineWin {
  line: number;
  symbol: SymbolId;
  mult: number;
}

export function evaluate(grid: Grid): { wins: LineWin[]; mult: number } {
  const wins: LineWin[] = [];
  LINES.forEach(([a, b, c], line) => {
    if (grid[a] === grid[b] && grid[b] === grid[c]) {
      wins.push({ line, symbol: grid[a], mult: SYMBOL_BY_ID[grid[a]].mult });
    }
  });
  return { wins, mult: wins.reduce((a, w) => a + w.mult, 0) };
}

export interface Session {
  coins: number;
  spinsLeft: number;
  /** 本局见过的最高金币数 */
  peak: number;
}

export const newSession = (): Session => ({
  coins: CONFIG.startCoins,
  spinsLeft: CONFIG.maxSpins,
  peak: CONFIG.startCoins,
});

export const isOver = (s: Session) => s.spinsLeft <= 0 || s.coins < CONFIG.minBet;

/** 把想下的注收到合法范围内（不能超过手里的金币） */
export const clampBet = (s: Session, bet: number) =>
  Math.max(CONFIG.minBet, Math.min(CONFIG.maxBet, Math.floor(bet), s.coins));

export interface SpinResult {
  bet: number;
  grid: Grid;
  wins: LineWin[];
  /** 总赔率 */
  mult: number;
  /** 本次赢得的金币 */
  payout: number;
}

/** 结算一次旋转（纯逻辑，立刻出结果；动画由表现层慢慢播） */
export function spin(s: Session, bet: number, rng: Rng): SpinResult {
  if (isOver(s)) throw new Error('对局已结束');
  bet = clampBet(s, bet);
  const grid = rollGrid(rng);
  const { wins, mult } = evaluate(grid);
  const payout = bet * mult;
  s.coins += payout - bet;
  s.spinsLeft--;
  s.peak = Math.max(s.peak, s.coins);
  return { bet, grid, wins, mult, payout };
}

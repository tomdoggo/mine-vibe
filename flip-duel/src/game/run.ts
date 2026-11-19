import './carddb.ts';
import { CONFIG, type EventKind } from './config.ts';
import {
  canMerge, defOf, findPartner, makeCard, mergeCards, QUALITIES, TIER_MULT,
  type Card, type Quality, type Tier,
} from './cards.ts';
import type { Battle } from './battle.ts';
import { buildPool, type Build, type PlayClass } from './build.ts';
import { deriveSeed, makeRng, randomSeed, type Rng } from './rng.ts';
import { wildMonster } from './opponents.ts';

export interface ShopState { offers: (Card | null)[]; refreshCost: number }

export interface BattleSetup {
  kind: 'wild' | 'pvp';
  seed: number;
  enemy: Card[];
  enemyName: string;
  enemyInfo: string;
  enemyGold: number;
  /** 对手卡背：野怪 monster，玩家按职业 */
  enemyBack?: 'miner' | 'hacker' | 'neutral' | 'monster';
}

export interface RewardState { gold: number; card: Card | null }

export interface HistoryEntry {
  day: number;
  kind: 'wild' | 'pvp';
  enemyName: string;
  my: number;
  enemy: number;
  result: 'win' | 'lose' | 'draw';
  hpLoss: number;
}

export interface Run {
  v: 2;
  runId: string;
  name: string;
  cls: PlayClass;
  buildName: string;
  seed: number;
  counter: number;
  day: number;
  eventIdx: number;
  hp: number;
  stars: number;
  gold: number;
  deck: Card[];
  nextUid: number;
  /** 商店卡池里每种卡还剩几张 */
  pool: Record<string, number>;
  shop: ShopState | null;
  battle: BattleSetup | null;
  reward: RewardState | null;
  status: 'playing' | 'won' | 'lost';
  history: HistoryEntry[];
}

export function newRun(name: string, build: Build, seed = randomSeed()): Run {
  const run: Run = {
    v: 2,
    runId: `${Date.now().toString(36)}-${seed.toString(36)}`,
    name,
    cls: build.cls,
    buildName: build.name,
    seed,
    counter: 0,
    day: 1,
    eventIdx: 0,
    hp: CONFIG.maxHp,
    stars: 0,
    gold: CONFIG.startGold,
    deck: [],
    nextUid: 1,
    pool: buildPool(build),
    shop: null,
    battle: null,
    reward: null,
    status: 'playing',
    history: [],
  };
  enterEvent(run);
  return run;
}

export const currentEvent = (run: Run): EventKind => CONFIG.events[run.eventIdx];
export const nextRng = (run: Run): Rng => makeRng(deriveSeed(run.seed, run.counter++));
const newUid = (run: Run) => `c${run.nextUid++}`;

export const priceOf = (c: Card) => CONFIG.price[defOf(c).q] * TIER_MULT[c.tier];
export const sellPriceOf = (c: Card) => CONFIG.sellPrice * TIER_MULT[c.tier];

/* ---------------- 商店 ---------------- */

/** 按天数的品质概率抽一张；该品质卡池空了就往相邻品质找 */
export function drawFromPool(pool: Record<string, number>, day: number, rng: Rng): string | null {
  const odds = CONFIG.shopOdds(day);
  let x = rng() * odds.reduce((a, b) => a + b, 0);
  let qi = 0;
  while (x >= odds[qi] && qi < 3) { x -= odds[qi]; qi++; }
  const tryOrder = [qi, qi - 1, qi - 2, qi - 3, qi + 1, qi + 2, qi + 3].filter((q) => q >= 0 && q < 4);
  for (const q of tryOrder) {
    const ids = Object.entries(pool).filter(([id, n]) => n > 0 && defOf(id).q === QUALITIES[q]);
    const total = ids.reduce((s, [, n]) => s + n, 0);
    if (!total) continue;
    let y = rng() * total;
    for (const [id, n] of ids) {
      if ((y -= n) < 0) { pool[id]--; return id; }
    }
  }
  return null;
}

function returnOffers(run: Run) {
  for (const c of run.shop?.offers ?? []) if (c) run.pool[c.id] = (run.pool[c.id] ?? 0) + 1;
}

function rollShop(run: Run): (Card | null)[] {
  const rng = nextRng(run);
  return Array.from({ length: CONFIG.shopSize }, () => {
    const id = drawFromPool(run.pool, run.day, rng);
    return id ? makeCard(id, newUid(run)) : null;
  });
}

/** 买下第 i 张；能合成就自动合成（可能连锁：铜→银→金）。返回合成出的最高级卡 */
export function buy(run: Run, i: number): { merged: Card | null } | null {
  const c = run.shop?.offers[i];
  if (!run.shop || !c || run.gold < priceOf(c)) return null;
  run.gold -= priceOf(c);
  run.deck.push(c);
  run.shop.offers[i] = null;
  return { merged: autoMerge(run, c) };
}

/** 新卡进卡组后，只要有同名同级的就一路合上去 */
export function autoMerge(run: Run, card: Card): Card | null {
  let cur = card;
  let last: Card | null = null;
  for (;;) {
    const p = findPartner(run.deck, cur);
    if (!p) return last;
    const m = mergeCards(cur, p, newUid(run));
    run.deck = run.deck.filter((x) => x !== cur && x !== p);
    run.deck.push(m);
    cur = last = m;
  }
}

export function refresh(run: Run): boolean {
  if (!run.shop || run.gold < run.shop.refreshCost) return false;
  run.gold -= run.shop.refreshCost;
  run.shop.refreshCost += CONFIG.refreshStep;
  returnOffers(run);
  run.shop.offers = rollShop(run);
  return true;
}

/** 卖掉：给 1 金 × 等级倍数，卡放回卡池 */
export function sell(run: Run, uid: string): boolean {
  const c = run.deck.find((x) => x.uid === uid);
  if (!c) return false;
  run.gold += sellPriceOf(c);
  run.pool[c.id] = (run.pool[c.id] ?? 0) + TIER_MULT[c.tier];
  run.deck = run.deck.filter((x) => x !== c);
  return true;
}

/* ---------------- 合成 ---------------- */

export function mergeByUid(run: Run, uid: string): Card | null {
  const a = run.deck.find((c) => c.uid === uid);
  if (!a) return null;
  const b = findPartner(run.deck, a);
  if (!b) return null;
  const merged = mergeCards(a, b, newUid(run));
  run.deck = run.deck.filter((c) => c !== a && c !== b);
  run.deck.push(merged);
  return merged;
}

/** 一键合成：从低级往高级合，直到没有可合的 */
export function mergeAll(deck: Card[], uid: () => string): Card[] {
  let d = [...deck];
  for (let tier = 0; tier < 2; tier++) {
    const ids = new Set(d.filter((c) => c.tier === tier).map((c) => c.id));
    for (const id of ids) {
      const group = d.filter((c) => c.id === id && c.tier === tier).sort((x, y) => y.bonus - x.bonus);
      const rest = d.filter((c) => !group.includes(c));
      const out: Card[] = [];
      for (let i = 0; i + 1 < group.length; i += 2) out.push(mergeCards(group[i], group[i + 1], uid()));
      if (group.length % 2) out.push(group[group.length - 1]);
      d = [...rest, ...out];
    }
  }
  return d;
}

export const hasMerge = (deck: Card[]) => deck.some((a) => deck.some((b) => canMerge(a, b)));
export function mergeAllRun(run: Run) { run.deck = mergeAll(run.deck, () => newUid(run)); }

/* ---------------- 事件流程 ---------------- */

export function enterEvent(run: Run) {
  run.shop = null;
  run.battle = null;
  const ev = currentEvent(run);
  if (ev === 'shop') {
    run.shop = { offers: rollShop(run), refreshCost: CONFIG.refreshBase };
  } else if (ev === 'wild') {
    const m = wildMonster(run.day, nextRng(run));
    run.battle = {
      kind: 'wild', seed: deriveSeed(run.seed, run.counter++), enemy: m.cards,
      enemyName: m.name, enemyInfo: `第 ${run.day} 天的野怪 · 打赢可以挑走它的一张卡`, enemyGold: 0, enemyBack: 'monster',
    };
  }
  // pvp：需要异步去数据库匹配，由 UI 调 setPvpOpponent
}

export function setPvpOpponent(run: Run, enemy: Card[], enemyName: string, enemyInfo: string, enemyGold = 0, enemyCls = '') {
  const enemyBack = enemyCls === 'miner' || enemyCls === 'hacker' ? enemyCls : 'neutral';
  run.battle = { kind: 'pvp', seed: deriveSeed(run.seed, run.counter++), enemy, enemyName, enemyInfo, enemyGold, enemyBack };
}

/** 对战打完：永久成长写回卡组，结算金币、星星、血量、野怪奖励 */
export function finishBattle(run: Run, bt: Battle): HistoryEntry {
  const setup = run.battle!;
  const after = new Map(bt.decks[0].map((c) => [c.uid, c.bonus]));
  for (const c of run.deck) if (after.has(c.uid)) c.bonus = after.get(c.uid)!;
  run.gold += bt.goldEarned[0];

  const w = bt.winner();
  const result = w === 'draw' ? 'draw' : w === 0 ? 'win' : 'lose';
  let hpLoss = 0;
  if (result === 'win') run.stars++;
  if (result === 'lose') {
    hpLoss = CONFIG.lossDamage(run.day);
    run.hp = Math.max(0, run.hp - hpLoss);
  }
  if (setup.kind === 'wild' && result === 'win') {
    const gold = CONFIG.wildGold(run.day);
    run.gold += gold;
    const rng = nextRng(run);
    const pick = setup.enemy[Math.floor(rng() * setup.enemy.length)];
    run.reward = { gold, card: pick ? { uid: newUid(run), id: pick.id, tier: pick.tier as Tier, bonus: 0 } : null };
  }
  const entry: HistoryEntry = {
    day: run.day, kind: setup.kind, enemyName: setup.enemyName,
    my: bt.totals[0], enemy: bt.totals[1], result, hpLoss,
  };
  run.history.push(entry);
  if (run.stars >= CONFIG.starsToWin) run.status = 'won';
  else if (run.hp <= 0) run.status = 'lost';
  return entry;
}

export function takeReward(run: Run, take: boolean): Card | null {
  const r = run.reward;
  if (!r) return null;
  let merged: Card | null = null;
  if (take && r.card) {
    run.deck.push(r.card);
    merged = autoMerge(run, r.card);
  } else run.gold += CONFIG.skipCardGold;
  run.reward = null;
  return merged;
}

export function advance(run: Run) {
  if (run.status !== 'playing') return;
  if (currentEvent(run) === 'shop') returnOffers(run);
  run.reward = null;
  run.eventIdx++;
  if (run.eventIdx >= CONFIG.events.length) {
    run.eventIdx = 0;
    run.day++;
    run.gold += CONFIG.dailyIncome;
  }
  enterEvent(run);
}

export const qualityOf = (c: Card): Quality => defOf(c).q;

import './carddb.ts';
import { CONFIG } from './config.ts';
import { cardsOfClass, defOf, estPower, makeCard, QUALITIES, TIER_MULT, type Card, type Tier } from './cards.ts';
import { buildPool, presetBuild, type PlayClass } from './build.ts';
import { makeRng, pick, randInt, shuffle, type Rng } from './rng.ts';
import { drawFromPool, mergeAll, priceOf } from './run.ts';

/* ---------------- 参考玩家（机器人）：用同一套经济规则、预设构筑攒卡组 ---------------- */

export interface BotOptions {
  cls?: PlayClass;
  /** 收入倍率：1 = 正常玩家，<1 = 偏弱的玩家 */
  goldFactor?: number;
}

export interface BotResult { deck: Card[]; gold: number; cls: PlayClass }

/** 卡组每轮期望牌面分（对手也有 ≥10 张时，自己大约只有 10 张能上场） */
export function deckPower(deck: Card[]): number {
  const sum = deck.reduce((s, c) => s + estPower(c), 0);
  return sum * Math.min(1, 10 / Math.max(1, deck.length));
}

/**
 * 按真实规则模拟一个玩家打到第 day 天某个事件之前：
 * 商店里优先买「能凑合成」和「性价比高」的卡，能合就合；永久成长按「打过的场次 × 上场概率」估算。
 */
export function botRun(day: number, rng: Rng, until: 'wild' | 'pvp', opts: BotOptions = {}): BotResult {
  const cls = opts.cls ?? pick(rng, ['miner', 'hacker'] as const);
  const factor = opts.goldFactor ?? 1;
  const pool = buildPool(presetBuild(cls));
  let uid = 0;
  const next = () => `b${uid++}`;
  let gold = CONFIG.startGold * factor;
  let deck: Card[] = [];
  const stopIdx = CONFIG.events.indexOf(until);

  const value = (c: Card) => {
    const owned = deck.filter((o) => o.id === c.id && o.tier === 0).length;
    return estPower(c) / priceOf(c) + (owned % 2 === 1 ? 3 : 0) + (deck.length >= 10 ? -1 : 0);
  };

  for (let d = 1; d <= day; d++) {
    if (d > 1) gold += CONFIG.dailyIncome * factor;
    for (let ei = 0; ei < CONFIG.events.length; ei++) {
      if (d === day && ei >= stopIdx) return { deck, gold: Math.floor(gold), cls };
      const ev = CONFIG.events[ei];
      if (ev === 'shop') {
        let refreshCost = CONFIG.refreshBase;
        for (let tries = 0; tries < 4; tries++) {
          const offers: Card[] = [];
          for (let k = 0; k < CONFIG.shopSize; k++) {
            const id = drawFromPool(pool, d, rng);
            if (id) offers.push(makeCard(id, next()));
          }
          offers.sort((a, b) => value(b) - value(a));
          for (const o of offers) {
            if (gold >= priceOf(o) && value(o) > 2.2) { gold -= priceOf(o); deck.push(o); }
            else pool[o.id]++;
          }
          if (gold < refreshCost + 3) break;
          gold -= refreshCost;
          refreshCost += CONFIG.refreshStep;
        }
        deck = mergeAll(deck, next);
      } else {
        // 打一场：估算永久成长和赚到的金币
        const onBoard = Math.min(1, 10 / Math.max(1, deck.length));
        for (const c of deck) {
          for (const [op, n = 0] of defOf(c).fx) {
            const v = n * TIER_MULT[c.tier] * 3 * onBoard;
            if (op === 'grow') c.bonus += Math.round(v);
            if (op === 'gold') gold += v;
          }
        }
        if (ev === 'wild') gold += CONFIG.wildGold(d) + CONFIG.skipCardGold;
      }
    }
  }
  return { deck, gold: Math.floor(gold), cls };
}

const refCache = new Map<number, number>();
/** 第 day 天打野怪时，参考玩家的平均牌力 */
export function refPower(day: number): number {
  let v = refCache.get(day);
  if (v === undefined) {
    let s = 0;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const cls = i % 2 ? 'miner' : 'hacker';
      s += deckPower(botRun(day, makeRng(i * 7919 + day * 104729), 'wild', { cls }).deck);
    }
    v = s / n;
    refCache.set(day, v);
  }
  return v;
}

/* ---------------- 野怪：用中立卡拼出目标牌力 ---------------- */

const MONSTERS = ['史莱姆', '哥布林', '野狼群', '骷髅兵', '兽人营地', '石像鬼', '食人魔', '巨魔', '飞龙', '远古巨龙'];

export function wildTarget(day: number, rng: Rng): number {
  return refPower(day) * CONFIG.wildRatio(day) * (0.9 + 0.2 * rng());
}

export function wildMonster(day: number, rng: Rng): { name: string; cards: Card[] } {
  const name = MONSTERS[Math.min(day, MONSTERS.length) - 1];
  // 第 1 天：一张全新的「成长」，整场 1+2+3×2 = 9 分，随便一张卡基本都能赢
  if (day === 1) return { name, cards: [makeCard('n02', 'm0')] };

  const odds = CONFIG.shopOdds(day);
  const allowed = cardsOfClass('neutral').filter((d) => odds[QUALITIES.indexOf(d.q)] > 0);
  const maxTier = CONFIG.wildMaxTier(day);
  const target = wildTarget(day, rng);
  // 贪心：每次加一张「牌力最接近剩余目标 / 剩余张数」的卡，最多 10 张（保证全部能上场）
  const cards: Card[] = [];
  let sum = 0;
  for (let i = 0; i < 10 && sum < target * 0.95; i++) {
    const want = (target - sum) / Math.max(1, Math.min(10 - i, Math.ceil((target - sum) / 25)));
    const cands = shuffle(rng, [...allowed]).slice(0, 10).map((d) => makeCard(d.id, `m${i}`, randInt(rng, 0, maxTier) as Tier));
    cands.sort((a, b) => Math.abs(estPower(a) - want) - Math.abs(estPower(b) - want));
    cards.push(cands[0]);
    sum += estPower(cands[0]);
  }
  return { name, cards };
}

/* ---------------- 没匹配到真人时的路人对手 ---------------- */

const BOT_NAMES = ['阿土', '小李', '老王', '翻牌侠', '咸鱼', '欧皇', '非酋', '摸鱼王', '牌佬', '路人甲'];

export function botGhost(day: number, rng: Rng): { name: string; deck: Card[]; gold: number; cls: PlayClass } {
  const r = botRun(day, rng, 'pvp');
  return { name: `${pick(rng, BOT_NAMES)}（AI）`, ...r };
}

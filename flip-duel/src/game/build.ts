/** 构筑：每个职业从 35 张职业卡里选正好 20 种，每种带 1~4 张，决定商店会刷出什么 */
import './carddb.ts';
import { CONFIG } from './config.ts';
import { cardsOfClass, CARD_DB, CLASS_NAMES, type ClassId } from './cards.ts';

export type PlayClass = Exclude<ClassId, 'neutral'>;

export interface Build {
  id: string;
  name: string;
  cls: PlayClass;
  cards: Record<string, number>;
}

export const buildDistinct = (b: Build) => Object.values(b.cards).filter((n) => n > 0).length;
export const buildCopies = (b: Build) => Object.values(b.cards).reduce((s, n) => s + n, 0);

export function buildProblems(b: Build): string[] {
  const out: string[] = [];
  const d = buildDistinct(b);
  if (d !== CONFIG.buildDistinct) out.push(`需要正好 ${CONFIG.buildDistinct} 种卡（现在 ${d} 种）`);
  for (const [id, n] of Object.entries(b.cards)) {
    const def = CARD_DB.get(id);
    if (!def || def.cls !== b.cls) out.push(`${def?.name ?? id} 不是${CLASS_NAMES[b.cls]}卡`);
    if (n < 0 || n > CONFIG.maxCopies) out.push(`${def?.name ?? id} 最多带 ${CONFIG.maxCopies} 张`);
  }
  return out;
}

/** 本局商店卡池：构筑卡 + 全部中立卡各 4 张 */
export function buildPool(b: Build): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const d of cardsOfClass('neutral')) pool[d.id] = CONFIG.neutralCopies;
  for (const [id, n] of Object.entries(b.cards)) if (n > 0) pool[id] = n;
  return pool;
}

const PRESETS: Record<PlayClass, { name: string; cards: Record<string, number> }> = {
  miner: {
    name: '深挖矿工',
    cards: {
      m01: 4, m02: 3, m03: 4, m08: 2, m10: 2, m11: 4, m12: 2, m15: 2, m16: 3, m18: 2,
      m21: 3, m22: 2, m24: 2, m26: 2, m27: 2, m30: 1, m31: 1, m32: 1, m33: 1, m34: 1,
    },
  },
  hacker: {
    name: '代码连锁',
    cards: {
      h01: 4, h04: 3, h05: 2, h07: 2, h09: 3, h10: 4, h13: 2, h14: 3, h16: 2, h18: 3,
      h20: 2, h22: 2, h24: 3, h26: 2, h27: 2, h29: 2, h31: 1, h33: 1, h34: 1, h35: 1,
    },
  },
};

export function presetBuild(cls: PlayClass, id = `preset-${cls}`): Build {
  return { id, name: PRESETS[cls].name, cls, cards: { ...PRESETS[cls].cards } };
}

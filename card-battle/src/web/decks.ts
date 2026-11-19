/**
 * 自建卡组和收藏，存在浏览器本地（localStorage）。
 * 只在这台设备、这个浏览器里有效；清除浏览器数据会丢失，所以构筑页提供"导出/导入"做备份。
 */
import type { DeckList } from '../types.ts';
import { CARDS, DECKS, validateDeck } from '../cards.ts';

export const MAX_DECKS = 10;
const DECK_KEY = 'card-battle.decks.v1';
const FAV_KEY = 'card-battle.favs.v1';

export interface SavedDeck {
  id: string;
  name: string;
  /** 卡名 → 张数 */
  cards: Record<string, number>;
  /** 卡盒主题色（THEMES 的 key）；不设 = 按卡组属性自动 */
  theme?: string;
  /** 封面卡名；不设 = 自动选阶数最高的生物 */
  cover?: string;
}

/** 卡盒可选的主题色 */
export const THEMES: Record<string, { name: string; a: string; b: string }> = {
  fire: { name: '火红', a: '#e4572e', b: '#7a2410' },
  water: { name: '水蓝', a: '#2e86de', b: '#123f73' },
  grass: { name: '森绿', a: '#3fa34d', b: '#1d5a26' },
  lightning: { name: '雷黄', a: '#d9a614', b: '#6b4f00' },
  teal: { name: '青碧', a: '#1fa39a', b: '#0b4a45' },
  violet: { name: '暗紫', a: '#7e57c2', b: '#311b6b' },
  rose: { name: '樱粉', a: '#e86a92', b: '#7d2342' },
  colorless: { name: '岩灰', a: '#8d8a80', b: '#45423a' },
  night: { name: '夜黑', a: '#3a4250', b: '#12161d' },
};

/** 卡组的主属性：能量和生物里最多的那种 */
function autoTheme(cards: Record<string, number>): string {
  const score: Record<string, number> = {};
  for (const [n, c] of Object.entries(cards)) {
    const d = CARDS[n];
    const t = d.kind === 'energy' ? d.provides : d.kind === 'creature' ? d.type : null;
    if (t && t !== 'colorless') score[t] = (score[t] ?? 0) + c * (d.kind === 'energy' ? 1 : 2);
  }
  let best = 'colorless';
  let bs = 0;
  for (const [t, s] of Object.entries(score)) {
    if (s > bs) {
      best = t;
      bs = s;
    }
  }
  return best;
}

export const deckTheme = (d: SavedDeck) => THEMES[d.theme ?? ''] ?? THEMES[autoTheme(d.cards)];

/** 封面卡：指定的那张（还在卡组里时），否则阶数最高的生物 */
export function deckCover(d: SavedDeck): string | null {
  if (d.cover && d.cards[d.cover]) return d.cover;
  let best: string | null = null;
  let stage = -1;
  for (const n of Object.keys(d.cards)) {
    const c = CARDS[n];
    if (c.kind === 'creature' && c.stage > stage) {
      best = n;
      stage = c.stage;
    }
  }
  return best;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式等情况下存不了，本次会话内仍然可用 */
  }
}

/** 读出来的数据可能是旧版本或被改坏的，逐条清洗 */
function clean(list: unknown): SavedDeck[] {
  if (!Array.isArray(list)) return [];
  const out: SavedDeck[] = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const { id, name, cards, theme, cover } = d as Partial<SavedDeck>;
    if (typeof id !== 'string' || typeof name !== 'string' || !cards || typeof cards !== 'object') continue;
    const fixed: Record<string, number> = {};
    for (const [k, v] of Object.entries(cards)) {
      if (CARDS[k] && Number.isInteger(v) && v > 0) fixed[k] = v;
    }
    const deck: SavedDeck = { id, name: name.slice(0, 30) || '未命名卡组', cards: fixed };
    if (typeof theme === 'string' && THEMES[theme]) deck.theme = theme;
    if (typeof cover === 'string' && CARDS[cover]) deck.cover = cover;
    out.push(deck);
  }
  return out.slice(0, MAX_DECKS);
}

let decks: SavedDeck[] = clean(read(DECK_KEY, []));
let favs = new Set<string>(read<string[]>(FAV_KEY, []).filter((n) => CARDS[n]));

export const getDecks = () => decks;
export const getDeck = (id: string) => decks.find((d) => d.id === id) ?? null;

export function saveDecks(next: SavedDeck[]): void {
  decks = next.slice(0, MAX_DECKS);
  write(DECK_KEY, decks);
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function createDeck(name: string, cards: Record<string, number> = {}): SavedDeck | null {
  if (decks.length >= MAX_DECKS) return null;
  const d: SavedDeck = { id: newId(), name, cards: { ...cards } };
  saveDecks([...decks, d]);
  return d;
}

export function duplicateDeck(id: string): SavedDeck | null {
  const src = getDeck(id);
  if (!src || decks.length >= MAX_DECKS) return null;
  const d: SavedDeck = { ...src, id: newId(), name: `${src.name}（副本）`.slice(0, 30), cards: { ...src.cards } };
  saveDecks([...decks, d]);
  return d;
}

export function updateDeck(d: SavedDeck): void {
  saveDecks(decks.map((x) => (x.id === d.id ? d : x)));
}

export function deleteDeck(id: string): void {
  saveDecks(decks.filter((d) => d.id !== id));
}

export const deckTotal = (d: SavedDeck) => Object.values(d.cards).reduce((a, b) => a + b, 0);
export const toDeckList = (d: SavedDeck): DeckList => ({ name: d.name, cards: Object.entries(d.cards) });
export const deckProblems = (d: SavedDeck) => validateDeck(Object.entries(d.cards));

/** 预设卡组转成可编辑的格式（复制用） */
export function presetCards(key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [n, c] of DECKS[key].cards) out[n] = (out[n] ?? 0) + c;
  return out;
}

// ---------- 收藏 ----------

export const isFav = (name: string) => favs.has(name);
export function toggleFav(name: string): void {
  if (favs.has(name)) favs.delete(name);
  else favs.add(name);
  write(FAV_KEY, [...favs]);
}

// ---------- 导出 / 导入（备份用） ----------

export const exportText = () => JSON.stringify({ decks, favs: [...favs] });

export function importText(text: string): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return '内容不是有效的备份数据';
  }
  const obj = data as { decks?: unknown; favs?: unknown };
  const incoming = clean(obj.decks);
  if (!incoming.length) return '备份里没有可用的卡组';
  const before = decks.length;
  const merged = [...decks];
  for (const d of incoming) {
    if (merged.length >= MAX_DECKS) break;
    merged.push({ ...d, id: newId() });
  }
  saveDecks(merged);
  if (Array.isArray(obj.favs)) {
    for (const n of obj.favs) if (typeof n === 'string' && CARDS[n]) favs.add(n);
    write(FAV_KEY, [...favs]);
  }
  const added = decks.length - before;
  return added ? `导入了 ${added} 个卡组` : `卡组已满 ${MAX_DECKS} 个，没有导入`;
}

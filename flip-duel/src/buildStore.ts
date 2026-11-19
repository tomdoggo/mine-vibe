/** 构筑好的卡组存在本机 localStorage。没有预设卡组，玩家自己组 */
import { buildProblems, type Build, type PlayClass } from './game/build.ts';
import { CARD_DB } from './game/cards.ts';

const KEY = 'flipduel.builds.v1';
const SEL_KEY = 'flipduel.build.selected';
export const MAX_BUILDS = 8;

let builds: Build[] = load();

function load(): Build[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(raw)) {
      // 以前版本会送两套预设卡组（id b-miner / b-hacker），现在不送了，删掉
      const list: Build[] = raw.filter((b: Build) => b.id !== 'b-miner' && b.id !== 'b-hacker');
      // 丢掉已经不存在的卡（以后删卡时不至于崩）
      for (const b of list) for (const id of Object.keys(b.cards)) if (!CARD_DB.has(id)) delete b.cards[id];
      if (list.length !== raw.length) localStorage.setItem(KEY, JSON.stringify(list));
      return list;
    }
  } catch { /* ignore */ }
  return [];
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(builds)); } catch { /* ignore */ }
}

export const getBuilds = () => builds;
export const getBuild = (id: string | null) => builds.find((b) => b.id === id);
export const isValid = (b: Build) => buildProblems(b).length === 0;

export function createBuild(cls: PlayClass, name?: string, cards: Record<string, number> = {}): Build | null {
  if (builds.length >= MAX_BUILDS) return null;
  const id = `b${Date.now().toString(36)}`;
  const b: Build = { id, name: name ?? `${cls === 'miner' ? '矿工' : '黑客'}卡组`, cls, cards: { ...cards } };
  builds.push(b);
  persist();
  return b;
}

export function updateBuild(b: Build) { persist(); return b; }

export function deleteBuild(id: string) {
  builds = builds.filter((b) => b.id !== id);
  persist();
}

export function getSelected(): Build | undefined {
  let id: string | null = null;
  try { id = localStorage.getItem(SEL_KEY); } catch { /* ignore */ }
  return getBuild(id) ?? builds.find(isValid);
}
export function setSelected(id: string) {
  try { localStorage.setItem(SEL_KEY, id); } catch { /* ignore */ }
}

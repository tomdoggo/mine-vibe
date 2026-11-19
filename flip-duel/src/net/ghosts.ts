import type { Card } from '../game/cards.ts';

export interface Ghost {
  runId: string;
  name: string;
  cls: string;
  day: number;
  stars: number;
  hp: number;
  gold: number;
  deck: Card[];
}

const LOCAL_KEY = 'flipduel.ghosts.v2';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch(path, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/* 服务器连不上时（比如打包成静态页面），退回到本机 localStorage，只能匹配到自己以前的存档 */
function localPool(): Ghost[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]'); } catch { return []; }
}
function saveLocal(g: Ghost) {
  try {
    const pool = localPool().filter((x) => !(x.runId === g.runId && x.day === g.day));
    pool.push(g);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(pool.slice(-200)));
  } catch { /* 存不了就算了 */ }
}

export async function uploadGhost(g: Ghost): Promise<'server' | 'local'> {
  saveLocal(g);
  try {
    await api('/api/ghosts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g) });
    return 'server';
  } catch {
    return 'local';
  }
}

export async function findGhost(day: number, excludeRunId: string): Promise<Ghost | null> {
  try {
    const r = await api<{ ghost: Ghost | null }>(`/api/ghosts/match?day=${day}&exclude=${encodeURIComponent(excludeRunId)}`);
    return r.ghost;
  } catch {
    const pool = localPool().filter((g) => g.runId !== excludeRunId);
    if (!pool.length) return null;
    const best = Math.min(...pool.map((g) => Math.abs(g.day - day)));
    const cands = pool.filter((g) => Math.abs(g.day - day) === best);
    return cands[Math.floor(Math.random() * cands.length)];
  }
}

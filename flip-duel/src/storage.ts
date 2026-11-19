import type { Run } from './game/run.ts';

const RUN_KEY = 'flipduel.run.v1';
const NAME_KEY = 'flipduel.name';

export function loadRun(): Run | null {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null');
    return r && r.v === 2 ? r : null;
  } catch { return null; }
}
export function saveRun(run: Run | null) {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch { /* 隐私模式等情况下存不了，不影响本局 */ }
}
export function loadName(): string {
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) return n;
  } catch { /* ignore */ }
  // 第一次：随机起一个名字并记下来，之后一直用它
  const n = `玩家${Math.floor(1000 + Math.random() * 9000)}`;
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
  return n;
}
export function saveName(n: string) {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
}

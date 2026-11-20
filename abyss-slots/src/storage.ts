/** localStorage 在隐私模式 / 被嵌入的页面里可能直接抛异常，统一包一层 */
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不了就算了，不影响游戏 */
  }
}

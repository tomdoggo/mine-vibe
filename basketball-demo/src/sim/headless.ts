/**
 * 不渲染跑比赛用的“万能空对象”：任何属性都是它自己，调用也返回它自己，用来顶替 Phaser 的场景与显示对象。
 * 赛季后台模拟和 scripts/ 下的批量脚本都用它。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const headlessScene: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === Symbol.toPrimitive) return () => 0;
    if (key === 'then') return undefined;
    return headlessScene;
  },
  apply: () => headlessScene,
});

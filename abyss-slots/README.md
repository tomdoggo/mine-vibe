# 深渊老虎机（abyss-slots）

3D 黑暗风 3×3 老虎机 Demo。10 枚金币开局，每转自选押 1–10 枚，目标是 100 转之内赢到尽可能多的金币。

- 技术栈：Vite + TypeScript + three.js（界面是 DOM 叠在 WebGL 画布上），竖屏优先
- 图案、金币贴图、音效全部在运行时生成，没有任何美术 / 音频资源文件

## 运行

```bash
npm install
npm run dev     # http://localhost:5178 ，同一 Wi-Fi 下手机可用终端打印的 Network 地址打开
npm run build   # 类型检查 + 打包
npm run sim     # 数值模拟：返还率、中奖率、各种下注策略打完 100 转的结果分布
```

网址加 `?seed=123` 可以复现同一局。开发模式下控制台输入 `__slot.win(500)` 可以直接看金币雨。

## 规则

- 9 个格子各自独立按权重抽符号
- 横、竖、斜共 8 条线，任意一条三连即中奖，奖金 = 下注 × 赔率，多条线叠加
- 赔率达到 15 倍算大奖：金币雨 + 震屏
- 金币输光或 100 转用完即结算

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/game/config.ts` | 所有可调数值：初始金币、转数、符号权重与赔率 |
| `src/game/slot.ts` | 纯逻辑：抽盘面、判奖、对局状态（不依赖渲染，`sim` 直接复用） |
| `src/render/scene.ts` | 机器模型、灯光、相机、泛光后期 |
| `src/render/reels.ts` | 3 个滚筒的旋转动画与中奖线高亮 |
| `src/render/coins.ts` | 金币喷射、弹跳、堆积（InstancedMesh + 沙堆模型，不用物理引擎） |
| `src/render/symbols.ts` | 用 canvas 现画的符号 / 金币 / 招牌贴图 |
| `src/audio.ts` | WebAudio 合成音效 |
| `scripts/sim.ts` | 数值模拟脚本 |

# 篮球模拟 Demo

俯视视角的 5v5 篮球比赛模拟：场上 10 名球员全部自主决策（投篮 / 传球 / 突破 / 空切 / 盯人 / 抢断 / 抢篮板），
没有任何玩家操作，只能看、调速度。

## 启动

```bash
cd basketball-demo
npm install
npm run dev
```

浏览器打开 http://localhost:5174

## 结构

- `src/sim/Match.ts`   规则与裁决：球权、24 秒、投篮命中率模型、传球截断、篮板、发球、节次、统计
- `src/sim/ai.ts`      球员决策：持球人按“期望得分”在投/传/突/运之间选，无球人站位与空切，防守人盯人与抢断
- `src/sim/Player.ts`  球员本体：移动、软碰撞、朝向、姿态（出手 / 起跳）与渲染
- `src/sim/Ball.ts`    球：持球运球、传球/投篮抛物线、落地滚动
- `src/sim/court.ts`   球场几何（1 米 = 20 像素）、站位点、三分判定
- `src/data/players.ts` 两队名单与能力值（0~1）：速度、篮下、中投、三分、传球、突破、防守、篮板

## 常用调参位置

- 节数 / 每节时长：`Match.ts` 的 `QUARTERS`、`QUARTER_SEC`
- 出手意愿：`ai.ts` `thinkHandler()` 里的 `threshold`
- 命中率曲线：`Match.ts` `shotProbability()`
- 站位：`court.ts` `OFFENSE_SPOTS`
- 球员能力：`players.ts`

---

美术素材（均为 CC0）：Ninja Adventure 角色（Pixel-boy，Superpowers asset packs）、OpenGameArt 篮球。详见 `public/assets/README.md`。

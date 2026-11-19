# card-battle：集换式卡牌规则引擎 + 启发式 AI

一个人练牌用的对战程序。规则按标准的"前场 / 备战区 / 能量 / 进化 / 奖赏卡"玩法实现，示例卡全部是原创生物。

## 运行

需要 Node 22.6+（直接运行 .ts，无需打包）。

```bash
npm install
npm run dev          # 网页界面（http://localhost:5176），点卡出牌
npm run play         # 命令行版：你 vs 启发式 AI，默认你用火焰卡组
npm run play -- --deck water --seed 42   # 换卡组；固定种子可复盘同一局
npm run sim -- 400   # AI 对 AI 批量对局：测引擎稳定性、AI 强弱、卡组平衡
npm run artifact     # 打包成单文件 artifact/card-battle.html，用于发布到 claude.ai（手机登录账号即可玩）
npm run typecheck
```

## 结构

| 文件 | 作用 |
| --- | --- |
| `src/types.ts` | 卡牌定义、对局状态、动作、Agent 接口 |
| `src/engine.ts` | 规则引擎：合法动作、执行动作、伤害、状态、昏厥、胜负 |
| `src/cards.ts` | 卡表和卡组（加卡就在这里） |
| `src/ai/heuristic.ts` | 启发式 AI：手写的出牌优先级 |
| `src/ai/random.ts` | 随机 AI，当基线 |
| `src/web/main.ts` / `style.css` | 网页界面：把"你"实现成一个等点击的 Agent |
| `src/cli.ts` / `src/sim.ts` | 命令行对战 / 批量模拟 |

引擎只回答"现在能做什么"和"做了会怎样"，"选哪个"交给 `Agent`。以后换成 MCTS 或大模型 AI，只要实现同一个 `Agent` 接口，引擎不用改。

## 加一张卡

在 `src/cards.ts` 的 `LIST` 里加一条：

```ts
creature({
  name: '某某', stage: 1, evolvesFrom: '某某幼体', hp: 90, type: 'fire', weakness: 'water', retreat: 1,
  attacks: [
    { name: '撞击', cost: ['fire', 'colorless'], damage: 50 },
    { name: '点火', cost: ['fire'], damage: 10, text: '使对手灼伤', effect: (c) => c.g.burn(c.defender) },
  ],
}),
```

- 简单数值卡只填数据就行；有特殊效果的写 `effect` / `damageFn`，用 `c.g` 上的方法（`flip`、`drawCards`、`searchDeck`、`choose`、`heal`、`setRotation`、`switchActive`、`discardEnergy`……）。
- 效果会让玩家做选择时，用 `g.choose()`，并给一个 `kind`，让 AI 知道这是什么选择（见 `ChoiceKind`）。
- AI 是按卡名认识训练家卡的（`heuristic.ts` 里的 `trainer('博士笔记')`）。新训练家卡要在那里加一条"什么时候用"，否则 AI 永远不会打它。

## 已知未实现

竞技场卡、宝可梦道具、特殊能量、"下回合不能攻击"这类跨回合效果、奖赏卡选择（现在直接拿最上面的）、撤退时选择丢哪个能量。

## 当前模拟结果（400 局/组）

- 启发式 vs 随机：约 99% 胜率，说明 AI 规则有效
- 火 vs 水（都是启发式）：37% : 63%。火系弱水，水系的弱点（雷）在这两套卡组里没人打得到，所以水组占优。

/**
 * 命令行对战：你 vs 启发式 AI
 *   npm run play -- --deck fire --seed 42
 * --deck 选你的卡组（fire / water），AI 用另一套；--seed 固定随机数可复盘
 */
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Action, Agent, ChoiceRequest, PlayerId } from './types.ts';
import { Game } from './engine.ts';
import { DECKS } from './cards.ts';
import { HeuristicAgent } from './ai/heuristic.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

class HumanAgent implements Agent {
  name = '你';
  private rl: readline.Interface;
  constructor(rl: readline.Interface) {
    this.rl = rl;
  }

  private async ask(max: number, allowZero: boolean): Promise<number> {
    for (;;) {
      const ans = (await this.rl.question('> ')).trim();
      if (ans === 'q') {
        console.log('已退出');
        process.exit(0);
      }
      const n = Number(ans);
      if (Number.isInteger(n) && n >= (allowZero ? 0 : 1) && n <= max) return n;
      console.log(`请输入 ${allowZero ? 0 : 1}-${max} 的数字（q 退出）`);
    }
  }

  async chooseAction(g: Game, me: PlayerId, actions: Action[]): Promise<Action> {
    console.log('\n' + g.render(me));
    console.log('\n你可以：');
    actions.forEach((a, i) => console.log(`  ${i + 1}. ${g.describeAction(me, a)}`));
    return actions[(await this.ask(actions.length, false)) - 1];
  }

  async choose(_g: Game, _me: PlayerId, req: ChoiceRequest): Promise<number> {
    console.log(`\n${req.prompt}`);
    if (req.optional) console.log('  0. 跳过 / 完成');
    req.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
    return (await this.ask(req.options.length, req.optional)) - 1;
  }
}

const mine = arg('deck', 'fire');
const theirs = mine === 'fire' ? 'water' : 'fire';
if (!DECKS[mine]) {
  console.error(`没有卡组 ${mine}，可选：${Object.keys(DECKS).join(' / ')}`);
  process.exit(1);
}
const seed = Number(arg('seed', String(Date.now() % 1e9)));
const rl = readline.createInterface({ input: stdin, output: stdout });
console.log(`种子 ${seed}｜你：${DECKS[mine].name}  vs  AI：${DECKS[theirs].name}（输入编号操作，q 退出）`);

const g = new Game([DECKS[mine], DECKS[theirs]], [new HumanAgent(rl), new HeuristicAgent()], seed, (m) => console.log(m));
const r = await g.run();
console.log(`\n${r.winner === 'draw' ? '平局' : r.winner === 0 ? '你赢了！' : 'AI 赢了'}（${r.reason}，共 ${r.turns} 回合）`);
rl.close();

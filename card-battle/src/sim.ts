/**
 * AI 对 AI 批量对局，用来测规则引擎有没有崩、AI 强弱、卡组平衡
 *   npm run sim -- 200
 */
import type { Agent, DeckList } from './types.ts';
import { Game } from './engine.ts';
import { DECKS } from './cards.ts';
import { HeuristicAgent } from './ai/heuristic.ts';
import { RandomAgent } from './ai/random.ts';

const N = Number(process.argv[2] ?? 200);

async function series(label: string, mkA: (i: number) => Agent, deckA: DeckList, mkB: (i: number) => Agent, deckB: DeckList) {
  let aWins = 0, bWins = 0, draws = 0, turns = 0;
  const reasons = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const swap = i % 2 === 1; // 交换座位，抵消准备阶段顺序的影响
    const agents: [Agent, Agent] = swap ? [mkB(i), mkA(i)] : [mkA(i), mkB(i)];
    const decks: [DeckList, DeckList] = swap ? [deckB, deckA] : [deckA, deckB];
    const g = new Game(decks, agents, 10_000 + i);
    let r;
    try {
      r = await g.run();
    } catch (e) {
      console.error(`对局崩溃（seed ${10_000 + i}）：`, e);
      console.error(g.s.log.slice(-15).join('\n'));
      process.exit(1);
    }
    turns += r.turns;
    const key = r.reason.replace(/^.*?(牌库耗尽|场上没有生物|拿完全部奖赏卡|超过回合上限|同时)/, '$1');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
    if (r.winner === 'draw') draws++;
    else if ((r.winner === 0) !== swap) aWins++;
    else bWins++;
  }
  const pct = (n: number) => ((n / N) * 100).toFixed(1) + '%';
  console.log(`\n${label}`);
  console.log(`  A 胜 ${pct(aWins)}｜B 胜 ${pct(bWins)}｜平 ${pct(draws)}｜平均 ${(turns / N).toFixed(1)} 回合`);
  console.log(`  结束原因：${[...reasons].map(([k, v]) => `${k} ${v}`).join('，')}`);
}

const t0 = Date.now();
let games = 0;
// 卡组两两对打（都是启发式 AI），看平衡
const keys = Object.keys(DECKS);
for (let a = 0; a < keys.length; a++) {
  for (let b = a + 1; b < keys.length; b++) {
    const A = DECKS[keys[a]], B = DECKS[keys[b]];
    await series(`${A.name} vs ${B.name}`, () => new HeuristicAgent(A.name), A, () => new HeuristicAgent(B.name), B);
    games += N;
  }
}
// 启发式 vs 随机，看 AI 是否有效
for (const k of keys) {
  await series(`启发式(${DECKS[k].name}) vs 随机`, () => new HeuristicAgent('启发'), DECKS[k], (i) => new RandomAgent('随机', i + 1), DECKS[k]);
  games += N;
}
console.log(`\n${games} 局，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

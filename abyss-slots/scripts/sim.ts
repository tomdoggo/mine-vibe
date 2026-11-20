/**
 * 数值模拟：npm run sim -- [局数倍率，默认 1]
 * 1. 单次旋转：返还率（RTP）、中奖率、各符号贡献
 * 2. 整局 100 转：不同下注策略的破产率 / 中位数 / 平均值（全跳过 / 全拿玩偶）
 * 3. 单个玩偶的价值：只拿这一个玩偶、其余全跳过时的结果
 */
import { CONFIG, DOLLS, SYMBOLS, type DollId } from '../src/game/config.ts';
import {
  clampBet, evaluate, isOver, maxBetOf, newSession, offerDue, rollGrid, rollOffer, skipOffer, spinChain, takeDoll,
  type Session,
} from '../src/game/slot.ts';
import { makeRng } from '../src/game/rng.ts';

const K = Number(process.argv[2] ?? 1);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`.padStart(8);
const pad = (s: string | number, n: number) => String(s).padStart(n);

console.log('\n== 1. 单次旋转');
{
  const n = 2_000_000 * K;
  const rng = makeRng(20261120);
  let ret = 0, hit = 0, big = 0;
  const bySym = new Map<string, { n: number; ret: number }>();
  for (let i = 0; i < n; i++) {
    const { wins, mult } = evaluate(rollGrid(rng));
    ret += mult;
    if (mult > 0) hit++;
    if (mult >= 15) big++;
    for (const w of wins) {
      const e = bySym.get(w.symbol) ?? { n: 0, ret: 0 };
      e.n++; e.ret += w.mult;
      bySym.set(w.symbol, e);
    }
  }
  console.log(`返还率 ${pct(ret / n)}   中奖率 ${pct(hit / n)}   大奖率(≥15倍) ${pct(big / n)}`);
  console.log('符号    赔率   每线出现率   返还贡献');
  for (const s of SYMBOLS) {
    const e = bySym.get(s.id) ?? { n: 0, ret: 0 };
    console.log(`${s.name}  ${pad(`x${s.mult}`, 5)}   ${pct(e.n / n / 8)}   ${pct(e.ret / n)}`);
  }
}

console.log('\n== 1b. 带玩偶时的单转返还率（押 10，深渊 1 层，各 30 万转）');
{
  const rtp = (dolls: DollId[]) => {
    const n = 300_000 * K;
    const rng = makeRng(99);
    let bet = 0, back = 0;
    const s = newSession();
    s.dolls = dolls;
    for (let i = 0; i < n; i++) {
      s.coins = 1000; s.spinsLeft = 100; s.spinsDone = 0;
      const chain = spinChain(s, 10, rng);
      bet += 10;
      back += chain.reduce((a, r) => a + r.payout + r.refund + r.interest, 0);
    }
    return back / bet;
  };
  const base = rtp([]);
  console.log(`${'（无）'.padEnd(5, '　')} ${pct(base)}`);
  for (const d of DOLLS) {
    const r = rtp([d.id]);
    console.log(`${d.name.padEnd(5, '　')} ${pct(r)}  (${r >= base ? '+' : ''}${((r - base) * 100).toFixed(1)}%)`);
  }
  console.log(`${'全部 10 个'.padEnd(5, '　')} ${pct(rtp(DOLLS.map((d) => d.id)))}`);
}

interface Stats { bust: number; up: number; median: number; mean: number; p90: number; max: number }

/** dolls: 'take' = 每次都拿第一个玩偶；'skip' = 每次都跳过拿金币；only = 只在出现这个玩偶时拿，其余跳过 */
function play(n: number, pick: (s: Session) => number, opts: { dolls: 'take' | 'skip'; only?: DollId }): Stats {
  const finals: number[] = [];
  let bust = 0, up = 0;
  for (let i = 0; i < n; i++) {
    const rng = makeRng(i * 7919 + 13);
    const s = newSession();
    while (!isOver(s)) {
      if (offerDue(s)) {
        const offer = rollOffer(s, rng);
        if (offer) {
          const want = opts.only ? offer.find((id) => id === opts.only) : opts.dolls === 'take' ? offer[0] : undefined;
          if (want) takeDoll(s, want);
          else skipOffer(s);
        }
      }
      spinChain(s, clampBet(s, pick(s)), rng);
    }
    finals.push(s.coins);
    if (s.coins < CONFIG.minBet) bust++;
    if (s.coins > CONFIG.startCoins) up++;
  }
  finals.sort((a, b) => a - b);
  return {
    bust: bust / n, up: up / n, median: finals[n >> 1], mean: finals.reduce((a, b) => a + b, 0) / n,
    p90: finals[Math.floor(n * 0.9)], max: finals[n - 1],
  };
}

const strategies: [string, (s: Session) => number][] = [
  ['每次押 1', () => 1],
  ['每次押 10', () => 10],
  ['押一成身家', (s) => Math.ceil(s.coins * 0.1)],
  ['押三成身家', (s) => Math.ceil(s.coins * 0.3)],
  ['每次押到上限', (s) => maxBetOf(s)],
];

for (const dolls of ['skip', 'take'] as const) {
  console.log(`\n== 2${dolls === 'take' ? 'b' : 'a'}. 整局（${CONFIG.startCoins} 金币开局，${CONFIG.maxSpins} 转，${dolls === 'take' ? '每次都拿玩偶' : '每次都跳过拿金币'}）`);
  console.log('策略            破产率    赚到钱   中位数       平均值    90分位      最高');
  for (const [name, pick] of strategies) {
    const r = play(20_000 * K, pick, { dolls });
    console.log(`${name.padEnd(8, '　')} ${pct(r.bust)} ${pct(r.up)} ${pad(r.median, 8)} ${pad(r.mean.toFixed(0), 12)} ${pad(r.p90, 9)} ${pad(r.max, 9)}`);
  }
}

console.log('\n== 3. 单个玩偶的价值（押一成身家；只拿这一个玩偶，其余全跳过；对比全跳过）');
{
  const pick = strategies[2][1];
  const base = play(20_000 * K, pick, { dolls: 'skip' });
  console.log('玩偶        中位数   破产率');
  console.log(`${'（全跳过）'.padEnd(5, '　')} ${pad(base.median, 8)} ${pct(base.bust)}`);
  for (const d of DOLLS) {
    const r = play(20_000 * K, pick, { dolls: 'skip', only: d.id });
    console.log(`${d.name.padEnd(5, '　')} ${pad(r.median, 8)} ${pct(r.bust)}`);
  }
}

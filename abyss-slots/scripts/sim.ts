/**
 * 数值模拟：npm run sim -- [局数倍率，默认 1]
 * 1. 单次旋转：返还率（RTP）、中奖率、各符号贡献
 * 2. 整局 100 转：不同下注策略的破产率 / 中位数 / 平均值（不买玩偶 / 买玩偶）
 * 3. 单个玩偶的价值：开局白送这一个玩偶，对最终金币的影响
 */
import { CONFIG, DOLLS, SYMBOLS, type DollId } from '../src/game/config.ts';
import { buyDoll, clampBet, evaluate, isOver, newSession, rollGrid, spinChain, type Session } from '../src/game/slot.ts';
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

interface Stats { bust: number; up: number; median: number; mean: number; p90: number; max: number }

function play(n: number, pick: (s: Session) => number, opts: { shop?: boolean; gift?: DollId } = {}): Stats {
  const finals: number[] = [];
  let bust = 0, up = 0;
  for (let i = 0; i < n; i++) {
    const rng = makeRng(i * 7919 + 13);
    const s = newSession();
    if (opts.gift) s.dolls.push(opts.gift);
    while (!isOver(s)) {
      // 买玩偶的策略：从便宜的开始，买完手里还剩 20 金币以上就买
      if (opts.shop) for (const d of DOLLS) if (s.coins - d.price >= 20) buyDoll(s, d.id);
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
  ['每次押 3', () => 3],
  ['押一成身家', (s) => Math.ceil(s.coins * 0.1)],
  ['押三成身家', (s) => Math.ceil(s.coins * 0.3)],
  ['每次押满', () => CONFIG.maxBet],
];

for (const shop of [false, true]) {
  console.log(`\n== 2${shop ? 'b' : 'a'}. 整局（${CONFIG.startCoins} 金币开局，${CONFIG.maxSpins} 转，${shop ? '买得起就买玩偶' : '不买玩偶'}）`);
  console.log('策略            破产率    赚到钱   中位数   平均值    90分位    最高');
  for (const [name, pick] of strategies) {
    const r = play(20_000 * K, pick, { shop });
    console.log(`${name.padEnd(8, '　')} ${pct(r.bust)} ${pct(r.up)} ${pad(r.median, 8)} ${pad(r.mean.toFixed(1), 8)} ${pad(r.p90, 9)} ${pad(r.max, 7)}`);
  }
}

console.log('\n== 3. 单个玩偶的价值（开局白送，押一成身家，对比不带玩偶）');
{
  const pick = strategies[2][1];
  const base = play(20_000 * K, pick);
  console.log('玩偶      价格   中位数   平均值   平均值增量');
  console.log(`${'（无）'.padEnd(5, '　')} ${pad('-', 5)} ${pad(base.median, 8)} ${pad(base.mean.toFixed(1), 8)}`);
  for (const d of DOLLS) {
    const r = play(20_000 * K, pick, { gift: d.id });
    console.log(`${d.name.padEnd(5, '　')} ${pad(d.price, 5)} ${pad(r.median, 8)} ${pad(r.mean.toFixed(1), 8)} ${pad((r.mean - base.mean >= 0 ? '+' : '') + (r.mean - base.mean).toFixed(1), 10)}`);
  }
}

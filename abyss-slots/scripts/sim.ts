/**
 * 数值模拟：npm run sim -- [局数倍率，默认 1]
 * 1. 单次旋转：返还率（RTP）、中奖率、各符号贡献
 * 2. 整局 100 转：不同下注策略的破产率 / 中位数 / 平均值
 */
import { CONFIG, SYMBOLS } from '../src/game/config.ts';
import { clampBet, evaluate, isOver, newSession, rollGrid, spin, type Session } from '../src/game/slot.ts';
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

console.log(`\n== 2. 整局（${CONFIG.startCoins} 金币开局，${CONFIG.maxSpins} 转）`);
{
  const strategies: [string, (s: Session) => number][] = [
    ['每次押 1', () => 1],
    ['每次押 3', () => 3],
    ['押一成身家', (s) => Math.ceil(s.coins * 0.1)],
    ['押三成身家', (s) => Math.ceil(s.coins * 0.3)],
    ['每次押满', () => CONFIG.maxBet],
  ];
  console.log('策略            破产率    赚到钱   中位数   平均值    90分位    最高');
  for (const [name, pick] of strategies) {
    const n = 20_000 * K;
    const finals: number[] = [];
    let bust = 0, up = 0;
    for (let i = 0; i < n; i++) {
      const rng = makeRng(i * 7919 + 13);
      const s = newSession();
      while (!isOver(s)) spin(s, clampBet(s, pick(s)), rng);
      finals.push(s.coins);
      if (s.coins < CONFIG.minBet) bust++;
      if (s.coins > CONFIG.startCoins) up++;
    }
    finals.sort((a, b) => a - b);
    const mean = finals.reduce((a, b) => a + b, 0) / n;
    console.log(
      `${name.padEnd(8, '　')} ${pct(bust / n)} ${pct(up / n)} ${pad(finals[n >> 1], 8)} ${pad(mean.toFixed(1), 8)} ${pad(finals[Math.floor(n * 0.9)], 9)} ${pad(finals[n - 1], 7)}`,
    );
  }
}

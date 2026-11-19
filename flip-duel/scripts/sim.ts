/**
 * 平衡性模拟：npm run sim -- [局数倍率，默认 1]
 * 1. 职业对抗：同一天的矿工 AI vs 黑客 AI
 * 2. 野怪曲线：参考玩家 / 偏弱玩家打每天野怪的胜率
 * 3. 单卡实测：9 张白板 + 1 张 X 对 10 张白板，X 那边多拿多少分（和估算值对比，找出超模/太弱的卡）
 * 4. 单卡胜率差：大量中期 AI 对局里，卡组里有这张卡 vs 没有的胜率差
 */
import '../src/game/carddb.ts';
import { quickBattle } from '../src/game/battle.ts';
import { CARD_DB, CLASS_NAMES, estPower, makeCard, QUALITY_NAMES, type Card } from '../src/game/cards.ts';
import { botRun, refPower, wildMonster } from '../src/game/opponents.ts';
import { makeRng } from '../src/game/rng.ts';

const K = Number(process.argv[2] ?? 1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
const pad = (s: string | number, n: number) => String(s).padStart(n);

console.log('\n== 1. 职业对抗（每天 400 场，矿工胜率 / 平局）');
{
  const row: string[] = [];
  for (const day of [2, 4, 6, 8, 10]) {
    let w = 0, d = 0;
    const n = 400 * K;
    for (let i = 0; i < n; i++) {
      const a = botRun(day, makeRng(i * 13 + day), 'pvp', { cls: 'miner' });
      const b = botRun(day, makeRng(i * 17 + day + 5), 'pvp', { cls: 'hacker' });
      const r = quickBattle(a.deck, b.deck, i, [a.gold, b.gold]).winner();
      if (r === 0) w++; else if (r === 'draw') d++;
    }
    row.push(`第${day}天 ${pct(w / n)} 平${pct(d / n)}`);
  }
  console.log(row.join('  '));
}

console.log('\n== 2. 野怪曲线（每天 300 场）');
console.log('天数  参考牌力  参考玩家胜率  偏弱玩家(6成收入)胜率');
for (let day = 1; day <= 14; day++) {
  let ref = 0, weak = 0;
  const n = 300 * K;
  for (let i = 0; i < n; i++) {
    const m = wildMonster(day, makeRng(day * 1_000_003 + i));
    const me = botRun(day, makeRng(i * 31 + day), 'wild');
    const w = botRun(day, makeRng(i * 37 + day), 'wild', { goldFactor: 0.6 });
    if (quickBattle(me.deck, m.cards, i, [me.gold, 0]).winner() === 0) ref++;
    if (quickBattle(w.deck, m.cards, i, [w.gold, 0]).winner() === 0) weak++;
  }
  console.log(`${pad(day, 3)}  ${pad(refPower(day).toFixed(0), 8)}  ${pad(pct(ref / n), 12)}  ${pad(pct(weak / n), 14)}`);
}

console.log('\n== 3. 单卡实测（铜卡，9 白板 + X vs 10 白板，200 场）：每轮比白板多/少几分，和估算对比');
const uidGen = (() => { let u = 0; return () => `s${u++}`; })();
const blanks = (n: number) => Array.from({ length: n }, () => makeCard('n01', uidGen()));
const rows: { id: string; real: number; est: number }[] = [];
for (const d of CARD_DB.values()) {
  let diff = 0;
  const n = 200 * K;
  for (let i = 0; i < n; i++) {
    const x = makeCard(d.id, uidGen());
    // 带 3 张同标签的伙伴，让【矿】【码】这类卡有东西可数
    const mates: Card[] = d.tags.length ? [] : [];
    const a = [...blanks(9 - mates.length), ...mates, x];
    const bt = quickBattle(a, blanks(10), i, [10, 10]);
    diff += (bt.totals[0] - bt.totals[1]) / 4; // 三轮权重 1+1+2
  }
  rows.push({ id: d.id, real: diff / n + 10, est: estPower(makeCard(d.id, 'e')) });
}
rows.sort((a, b) => b.real - a.real);
const show = (r: (typeof rows)[number]) => {
  const d = CARD_DB.get(r.id)!;
  return `${d.id} ${CLASS_NAMES[d.cls]}${QUALITY_NAMES[d.q]} ${d.name.padEnd(6, '　')} 实测 ${pad(r.real.toFixed(1), 5)}  估算 ${pad(r.est.toFixed(1), 5)}`;
};
console.log('最强 10 张：'); rows.slice(0, 10).forEach((r) => console.log('  ' + show(r)));
console.log('最弱 10 张：'); rows.slice(-10).forEach((r) => console.log('  ' + show(r)));
console.log('（白板本身 = 10。标签类卡在这个测试里没有伙伴，实测会偏低；持续成长类只算了一场。）');

console.log('\n== 4. 单卡胜率差（第 6 天 AI 互打，卡组里有 vs 没有，样本 ≥ 80）');
{
  const n = 3000 * K;
  const stat = new Map<string, { w: number; g: number }>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = botRun(6, makeRng(i * 101 + 7), 'pvp');
    const b = botRun(6, makeRng(i * 103 + 9), 'pvp');
    const r = quickBattle(a.deck, b.deck, i, [a.gold, b.gold]).winner();
    if (r === 'draw') continue;
    total++;
    for (const [deck, won] of [[a.deck, r === 0], [b.deck, r === 1]] as const) {
      for (const id of new Set(deck.map((c) => c.id))) {
        const s = stat.get(id) ?? { w: 0, g: 0 };
        s.g++; if (won) s.w++;
        stat.set(id, s);
      }
    }
  }
  const list = [...stat].filter(([, s]) => s.g >= 80).map(([id, s]) => ({ id, wr: s.w / s.g, g: s.g }));
  list.sort((a, b) => b.wr - a.wr);
  const fmt = (x: (typeof list)[number]) => `${x.id} ${CARD_DB.get(x.id)!.name.padEnd(6, '　')} 胜率 ${pct(x.wr)}（${x.g} 场）`;
  console.log(`共 ${total} 场有效对局`);
  console.log('最高：'); list.slice(0, 8).forEach((x) => console.log('  ' + fmt(x)));
  console.log('最低：'); list.slice(-8).forEach((x) => console.log('  ' + fmt(x)));
}

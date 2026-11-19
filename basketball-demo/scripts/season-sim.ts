/**
 * 不渲染跑完整个赛季：常规赛 + 季后赛 + 奖项，用来校验赛程 / 积分 / 奖项逻辑和各档球队的强弱。
 * 用法：npm run sim:season -- [赛季种子]
 */
import { TEAM_BY_ID, TIER_LABEL, teamOvr } from '../src/season/db';
import {
  computeAwards,
  createSeason,
  nextGame,
  playerName,
  recordResult,
  prepareGame,
  runGame,
  standings,
  teamShort,
} from '../src/season/Season';

const seed = Number(process.argv[2] ?? 7);
const st = createSeason(seed);
const t0 = Date.now();
for (let g = nextGame(st); g; g = nextGame(st)) {
  prepareGame(st, g);
  const r = runGame(g);
  recordResult(st, g.id, r);
  if (g.stage !== 'regular') console.log(`${g.series} G${g.round}  ${teamShort(g.home)} ${r.homePts} : ${r.awayPts} ${teamShort(g.away)}`);
}
console.log(`\n${st.games.length} 场，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒\n`);
for (const [i, s] of standings(st).entries()) {
  const t = TEAM_BY_ID.get(s.team)!;
  console.log(`${i + 1}. ${t.short.padEnd(8)} ${TIER_LABEL[t.tier]} 实力 ${teamOvr(t)}  ${s.w}-${s.l}  得 ${(s.pf / (s.w + s.l)).toFixed(1)} 失 ${(s.pa / (s.w + s.l)).toFixed(1)}`);
}
console.log(`\n总冠军：${st.champion ? teamShort(st.champion) : '-'}`);
for (const a of computeAwards(st)) {
  console.log(`\n${a.name}`);
  a.top.forEach((e, i) => console.log(`  ${i + 1}. ${playerName(e.pid)}（${teamShort(e.team)}）${e.text}`));
}

// 伤病按稳定性分段：每段球员数、受伤人数
const { PLAYER_BY_ID } = await import('../src/season/db');
const buckets = new Map<string, { n: number; hurt: number }>();
const hurt = new Set(st.injuries.map((i) => i.pid));
for (const t of st.teams) for (const pid of TEAM_BY_ID.get(t)!.roster) {
  const s = PLAYER_BY_ID.get(pid)!.attrs.stability;
  const k = s < 60 ? '<60' : s < 75 ? '60-74' : s < 85 ? '75-84' : '85+';
  const b = buckets.get(k) ?? { n: 0, hurt: 0 };
  b.n++;
  if (hurt.has(pid)) b.hurt++;
  buckets.set(k, b);
}
console.log(`
伤病 ${st.injuries.length} 次（轻 ${st.injuries.filter((i) => i.kind === 'light').length} / 重 ${st.injuries.filter((i) => i.kind === 'severe').length} / 报销 ${st.injuries.filter((i) => i.kind === 'season').length}）`);
for (const [k, b] of buckets) console.log(`  稳定性 ${k.padEnd(6)} ${b.n} 人，受伤 ${b.hurt} 人`);
console.log(`
新闻 ${st.news.length} 条，最近 25 条：`);
for (const n of [...st.news].sort((a, b) => a.order - b.order).slice(-25)) console.log(`  [${n.when}] ${n.text}`);

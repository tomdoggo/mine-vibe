import type { Attributes } from '../data/players';
import { ovr } from './lineup';
import type { Player } from './Player';

/**
 * 教练：安排出场时间。
 *  1. 开场前（planMinutes）：名单前 5 人首发，目标出场约 30 分钟（综合能力每比首发平均高 1 点多 0.4 分钟，26~34）；
 *     剩下的时间按实力分给替补：权重 = (综合能力 − 45)²，单人最多 22 分钟。
 *  2. 每个死球（发球前）重新挑场上五人（chooseLineup）：按“还欠多少出场时间 / 剩余比赛时间”排优先级，
 *     体力低于 85 开始扣分，刚上场不到 2.5 分钟的人加分（别来回换），
 *     末节关键时刻（下半场最后 4 分钟、分差 ≤ 8）主力回场，大比分（最后 7 分钟分差 ≥ 22）主力休息。
 *     五人里至少一个内线（PF/C）和一个后卫（PG/SG）。
 * 全部确定性计算（不用随机数），回放时结果一致。
 */

/** 整场比赛时间（秒）与五个位置的总出场时间 */
const GAME_SEC = 40 * 60;

export function planMinutes(defs: { attrs: Attributes; injured?: boolean }[]): number[] {
  if (defs.length <= 5) return defs.map(() => GAME_SEC);
  // 带伤（能力减半）的人按减半后的实力分时间
  const ratings = defs.map((d) => ovr(d.attrs) * (d.injured ? 0.5 : 1));
  const starterAvg = (ratings[0] + ratings[1] + ratings[2] + ratings[3] + ratings[4]) / 5;
  const targets = ratings.map((r, i) => (i < 5 ? clamp(30 + (r - starterAvg) * 0.4, 26, 34) * 60 : 0));
  const benchTotal = GAME_SEC * 5 - targets.slice(0, 5).reduce((s, x) => s + x, 0);
  const w = ratings.map((r, i) => (i < 5 ? 0 : Math.max(1, r - 45) ** 2));
  const wSum = w.reduce((s, x) => s + x, 0);
  // 按权重分，单人封顶 22 分钟，多出来的再按权重分给其他人
  let left = benchTotal;
  const open = new Set(defs.map((_, i) => i).filter((i) => i >= 5));
  for (let iter = 0; iter < 5 && left > 1 && open.size; iter++) {
    const ws = [...open].reduce((s, i) => s + w[i], 0) || wSum;
    let used = 0;
    for (const i of [...open]) {
      const add = (left * w[i]) / ws;
      const room = 22 * 60 - targets[i];
      const v = Math.min(add, room);
      targets[i] += v;
      used += v;
      if (v < add) open.delete(i);
    }
    left -= used;
  }
  return targets;
}

export interface LineupContext {
  /** 已进行的比赛时间（秒） */
  gameTime: number;
  half: number;
  /** 本半场剩余（秒） */
  clock: number;
  /** 本队领先的分数（落后为负） */
  margin: number;
}

export function chooseLineup(all: Player[], ctx: LineupContext): Player[] {
  // 重伤 / 报销的人不上场（能上场的不足五人时才让他们凑数）
  const healthy = all.filter((p) => !p.out);
  const roster = healthy.length >= 5 ? healthy : [...healthy, ...all.filter((p) => p.out)];
  if (roster.length <= 5) return roster.slice(0, 5);
  const remain = Math.max(60, GAME_SEC - ctx.gameTime);
  const late = ctx.half >= 2 && ctx.clock < 240;
  const clutch = late && Math.abs(ctx.margin) <= 8;
  const garbage = ctx.half >= 2 && ctx.clock < 420 && Math.abs(ctx.margin) >= 22;
  const prio = (p: Player): number => {
    let v = (p.targetSec - p.stats.sec) / remain;
    if (p.stamina < 85) v -= (85 - p.stamina) / 25;
    if (p.onCourt) {
      v += 0.12;
      if (ctx.gameTime - p.enteredAt < 150) v += 0.6;
    }
    if (clutch && p.starter && p.stamina >= 35) v += 2;
    if (garbage) v += p.starter ? -2 : 0.5;
    return v;
  };
  const scored = roster.map((p, i) => ({ p, i, v: prio(p) }));
  scored.sort((x, y) => y.v - x.v || x.i - y.i);
  // 只看优先级，不看位置
  return scored.slice(0, 5).map((x) => x.p);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

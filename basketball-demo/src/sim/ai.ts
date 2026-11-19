import { rng } from './rng';
import {
  PX_PER_M,
  attackHoop,
  clampToCourt,
  defendHoop,
  defenseHomeSpot,
  dist,
  isThree,
  metersTo,
  offenseSpot,
  pointSegment,
  type Vec,
} from './court';
import { clamp } from './attrs';
import type { Match } from './Match';

/**
 * 球员对三分的偏好：做决策时把三分的期望得分高估 10%。
 * 三分的真实收益（对普通射手）故意定得比中投低，这个偏好让球员仍然愿意出手三分，
 * 于是「被防守逼到只能投三分」对进攻方是真实的损失，而不是无成本的替代。
 */
const THREE_BIAS = 1.1;
import type { Player } from './Player';

/** 决策间隔（秒），加一点随机避免所有人同一帧决策 */
const DECIDE_INTERVAL = 0.25;

/**
 * 球员每帧调用：根据球的状态选择自己的行为。
 * 所有“选择”都在这里，Match 只负责执行与裁决。
 */
export function think(p: Player, m: Match, dt: number): void {
  const ball = m.ball;
  const st = ball.state;

  // 持球计时
  if (st.kind === 'held' && st.holder === p) p.holdTime += dt;
  else p.holdTime = 0;

  // 站位抖动：每隔一会儿换一个小偏移，让无球人别钉在原地
  p.jitterTimer -= dt;
  if (p.jitterTimer <= 0) {
    p.jitterTimer = 1.2 + rng() * 1.5;
    const r = 1.1 * PX_PER_M;
    p.jitter = { x: (rng() - 0.5) * 2 * r, y: (rng() - 0.5) * 2 * r };
  }

  // 发球阶段：持球人站在底线外等待，其他人按 Match 指定的站位跑
  if (m.phase === 'inbound') {
    if (st.kind === 'held' && st.holder === p) {
      p.intent = '发球';
      p.target = null;
    }
    return;
  }

  switch (st.kind) {
    case 'dead':
      return;
    case 'loose':
      // 篮板还没判定：继续冲抢卡位
      if (st.pending) thinkRebound(p, m.possession === p.teamId ? attackHoop(p.teamId) : defendHoop(p.teamId), null);
      else thinkLoose(p, m);
      return;
    case 'pass':
      if (st.to === p) {
        p.intent = '接球';
        p.target = st.end;
        p.face(st.end);
      } else if (st.to.teamId === p.teamId) {
        thinkOffBall(p, m, st.to, dt);
      } else {
        thinkDefense(p, m, st.to);
      }
      return;
    case 'shot':
      thinkRebound(p, attackHoop(st.shooter.teamId), st.shooter);
      return;
    case 'held':
      if (st.holder === p) thinkHandler(p, m);
      else if (st.holder.teamId === p.teamId) thinkOffBall(p, m, st.holder, dt);
      else thinkDefense(p, m, st.holder);
      return;
  }
}

/** 地板球：每队离球最近的两人去抢，其他人回位 */
function thinkLoose(p: Player, m: Match): void {
  const ball = m.ball;
  const mates = m.teamPlayers(p.teamId)
    .slice()
    .sort((a, b) => dist(a.pos, ball.pos) - dist(b.pos, ball.pos));
  const claimed = ball.state.kind === 'loose' && ball.state.claimant === p;
  const chaser = claimed || mates.indexOf(p) < 2;
  if (chaser) {
    p.intent = '抢球';
    const st = ball.state;
    const lead = st.kind === 'loose' ? { x: ball.pos.x + st.vel.x * 0.3, y: ball.pos.y + st.vel.y * 0.3 } : ball.pos;
    p.target = clampToCourt(lead);
    p.speedMul = 1;
    return;
  }
  // 球在本方半场附近 → 退防站位；否则到进攻站位
  const nearOwn = dist(ball.pos, defendHoop(p.teamId)) < dist(ball.pos, attackHoop(p.teamId));
  p.intent = nearOwn ? '退防' : '跑位';
  p.target = nearOwn ? defenseHomeSpot(p.teamId, p.spot) : offenseSpot(p.teamId, p.spot, p.spotVariant);
  p.speedMul = 1;
}

/** 投篮飞行中：内线和附近的人冲抢篮板，其他人停留 */
function thinkRebound(p: Player, hoop: Vec, shooter: Player | null): void {
  const dM = metersTo(p.pos, hoop);
  // 篮板能力越高，卡位越靠近篮筐：篮板 85 以上站 1.2m 起，50 以下站 2.8m 起
  const reb = clamp((p.eff.rebound - 50) / 35, 0, 1);
  if (p === shooter) {
    p.target = null;
    p.intent = '出手';
    return;
  }
  // 所有人都往篮下收缩：内线站 1.2~1.8m，外线站 2.4~3.2m
  p.intent = reb >= 0.5 ? '卡位' : '冲板';
  const ang = Math.atan2(p.pos.y - hoop.y, p.pos.x - hoop.x);
  const r = (1.2 + (1 - reb) * 1.6 + (p.slot % 3) * 0.3) * PX_PER_M;
  p.target = clampToCourt({ x: hoop.x + Math.cos(ang) * r, y: hoop.y + Math.sin(ang) * r });
  if (dM > 9) p.target = null; // 太远就不回来了，准备退防
  p.speedMul = 1;
}

/** 持球人：投 / 传 / 突 / 运球调整，按期望得分选，带随机 */
function thinkHandler(p: Player, m: Match): void {
  const hoop = attackHoop(p.teamId);
  const dM = metersTo(p.pos, hoop);
  // 后场推进时全速，到前场后持球略慢
  p.speedMul = dM > 13 ? 1.0 : 0.88;

  // 突破进行中：继续冲，到篮下再决策
  if (p.driveTimer > 0 && dM > 1.6) {
    p.intent = '突破';
    p.speedMul = 0.95 + p.driveTendency * 0.25;
    p.target = driveTarget(p, hoop);
    if (p.decideTimer > 0) return;
  }
  if (p.decideTimer > 0) return;
  p.decideTimer = DECIDE_INTERVAL + rng() * 0.15;

  const shotClock = m.shotClock;
  const myDef = m.nearestOpponentDist(p, p.pos) / PX_PER_M;
  const myProb = m.shotChance(p, p.pos, p.isMoving(), 'expect');
  const myPts = isThree(p.pos, hoop) ? 3 : 2;
  let shootEV = myProb * myPts * (myPts === 3 ? THREE_BIAS : 1);
  if (p.driveTimer > 0 && dM < 2.6) shootEV += 0.25; // 突到篮下倾向终结
  shootEV += (rng() - 0.5) * 0.2; // 手感/判断的随机性
  shootEV -= usagePenalty(p, m); // 本场出手已经明显多于队友的人，收一收

  // 出手阈值：到前场后的前几秒先传导（后场推进不算），时间越少越敢投；接球时是空位就果断出手
  const setT = m.setTime();
  let threshold = 0.92;
  if (setT < 7) threshold += 0.3;
  else if (setT < 11) threshold += 0.12;
  // 传导几秒之后，接球是空位就果断出手
  if (p.holdTime < 0.5 && myDef > 1.1 && setT >= 5) threshold -= 0.22;
  if (shotClock < 10) threshold = Math.min(threshold, Math.max(0.45, 0.92 - (10 - shotClock) * 0.08));
  if (shotClock < 2.5) threshold = -1;

  // 评估传球
  let bestPass: { to: Player; ev: number } | null = null;
  for (const mate of m.teamPlayers(p.teamId)) {
    if (mate === p) continue;
    const ev = passValue(p, mate, m, hoop);
    if (ev !== null && (!bestPass || ev > bestPass.ev)) bestPass = { to: mate, ev };
  }
  const passBias = ((75 - p.eff.assist) / 50) * 0.25; // 助攻能力高的人更爱传
  const pressured = myDef < 0.9;

  // 1) 投
  if (shootEV >= threshold && (!bestPass || bestPass.ev + 0.3 < shootEV || shotClock < 4 || rng() < 0.55)) {
    m.shoot(p);
    return;
  }
  // 2) 传
  if (bestPass) {
    const wantPass =
      (bestPass.ev > shootEV + 0.02 + passBias && rng() < 0.75) ||
      (p.holdTime > 3.2 && bestPass.ev > 0.6) ||
      (pressured && dM > 4 && bestPass.ev > 0.75 && rng() < 0.5);
    if (wantPass && shotClock > 1.2) {
      m.pass(p, bestPass.to);
      return;
    }
  }
  // 3) 突
  if (p.driveTimer <= 0 && dM > 2.3 && setT > 5) {
    // 忽略贴身的那个防守人（前 1.3m），看他身后有没有协防
    const tMin = Math.min(0.5, (1.3 * PX_PER_M) / (dM * PX_PER_M));
    const laneOpen = laneClear(p.pos, hoop, m.opponents(p.teamId), 0.8 * PX_PER_M, tMin);
    // 每次决策（约 0.25 秒）的突破概率：好的突破手持球 3 秒左右有一半机会发动
    const pDrive = laneOpen ? 0.02 + p.driveTendency * 0.06 : 0.01 * p.driveTendency;
    if (rng() < pDrive) {
      p.driveTimer = 1.1 + rng() * 0.5;
      m.tire(p, 'drive');
      p.intent = '突破';
      p.target = driveTarget(p, hoop);
      return;
    }
  }
  // 4) 运球调整：回到自己的站位附近，被贴防时往远离防守人的方向挪一点
  p.intent = dM > 13 ? '推进' : '运球';
  const spot = offenseSpot(p.teamId, p.spot, p.spotVariant);
  let tgt = { x: spot.x + p.jitter.x * 0.6, y: spot.y + p.jitter.y * 0.6 };
  const nearest = m.nearestOpponent(p, p.pos);
  if (nearest && pressured) {
    // 被贴防：一边朝站位推进一边侧向摆脱，不能只顾着远离防守人（否则会被压在底线）
    const away = { x: p.pos.x - nearest.pos.x, y: p.pos.y - nearest.pos.y };
    const al = Math.hypot(away.x, away.y) || 1;
    const fwd = { x: spot.x - p.pos.x, y: spot.y - p.pos.y };
    const fl = Math.hypot(fwd.x, fwd.y) || 1;
    const mx = fwd.x / fl + (away.x / al) * 0.8;
    const my = fwd.y / fl + (away.y / al) * 0.8;
    const ml = Math.hypot(mx, my) || 1;
    tgt = { x: p.pos.x + (mx / ml) * 1.5 * PX_PER_M, y: p.pos.y + (my / ml) * 1.5 * PX_PER_M };
  }
  p.target = clampToCourt(tgt);
}

function driveTarget(p: Player, hoop: Vec): Vec {
  // 从左右两侧切入，不直冲篮板
  const side = p.pos.y >= hoop.y ? 1 : -1;
  return clampToCourt({ x: hoop.x, y: hoop.y + side * 0.9 * PX_PER_M });
}

/** 给队友传球的价值：对方在该位置的投篮期望，减去传球线被封堵的风险 */
function passValue(from: Player, to: Player, m: Match, hoop: Vec): number | null {
  const opps = m.opponents(from.teamId);
  const lane = nearestToLane(from.pos, to.pos, opps, 0.1);
  if (lane < 0.45 * PX_PER_M) return null; // 直接被封死
  const prob = m.shotChance(to, to.pos, false, 'expect');
  const pts = isThree(to.pos, hoop) ? 3 : 2;
  let ev = prob * pts * (pts === 3 ? THREE_BIAS : 1);
  // 把球传到更靠近篮筐的人手里也有价值
  const closer = metersTo(from.pos, hoop) - metersTo(to.pos, hoop);
  ev += Math.max(-0.2, Math.min(0.25, closer * 0.04));
  if (lane < 1.0 * PX_PER_M) ev *= 0.55;
  // 传球距离：助攻 50 的人只能舒服地传 8m，助攻 100 能传 14m；超出越多价值越低，超出 4m 以上直接不考虑
  const lenM = dist(from.pos, to.pos) / PX_PER_M;
  const reach = 8 + ((from.eff.assist - 50) / 50) * 6;
  if (lenM > reach + 4) return null;
  if (lenM > reach) ev *= Math.max(0.4, 1 - (lenM - reach) * 0.15);
  if (lenM < 1.5) ev *= 0.6; // 太近没意义
  // 传球难度：线路 1.2m 范围内每多一个对手，就要多 10 点助攻才传得舒服；
  // 助攻 50 的人只敢传没人的线路，助攻 70 能越过两个人，助攻 80 越过三个人；不够的部分按比例打折，差 50 以上直接不传
  const crowd = countNearLane(from.pos, to.pos, opps, 1.2 * PX_PER_M, 0.1);
  const margin = from.eff.assist - 50 - crowd * 10;
  if (margin < -50) return null;
  if (margin < 0) ev *= Math.max(0.4, 1 + margin / 60);
  if (to === from.lastPassFrom && from.holdTime < 1.5) ev -= 0.35; // 别马上回传
  // 喂内线：篮下 3m 内的大个子值得传，哪怕看起来有人防
  if (metersTo(to.pos, hoop) < 3) ev += 0.08 * clamp((to.eff.inside - 50) / 25, 0, 1.2);
  ev -= usagePenalty(to, m);
  return ev;
}

/** 分享球：出手数比全队平均多出来的部分，每多一次扣 0.02 的价值 */
function usagePenalty(p: Player, m: Match): number {
  const mates = m.teamPlayers(p.teamId);
  const avg = mates.reduce((s, x) => s + x.stats.fga, 0) / mates.length;
  return Math.max(0, p.stats.fga - avg) * 0.04;
}

/** 线段附近最近的对手距离（忽略起点附近 tMin 以内） */
function nearestToLane(a: Vec, b: Vec, opps: Player[], tMin: number): number {
  let best = Infinity;
  for (const o of opps) {
    const { d, t } = pointSegment(o.pos, a, b);
    if (t < tMin) continue;
    if (d < best) best = d;
  }
  return best;
}

function laneClear(a: Vec, b: Vec, opps: Player[], radius: number, tMin: number): boolean {
  return nearestToLane(a, b, opps, tMin) > radius;
}

/** 线段 radius 范围内的对手人数（忽略起点附近 tMin 以内） */
function countNearLane(a: Vec, b: Vec, opps: Player[], radius: number, tMin: number): number {
  let n = 0;
  for (const o of opps) {
    const { d, t } = pointSegment(o.pos, a, b);
    if (t >= tMin && d < radius) n++;
  }
  return n;
}

/** 无球进攻：站位 + 偶尔空切。稳定性越高的人跑位越勤（隐藏特性） */
function thinkOffBall(p: Player, m: Match, handler: Player, dt: number): void {
  p.speedMul = 1;
  const hoop = attackHoop(p.teamId);
  // 跑位频率：稳定性 50 → 0.6 倍，80 → 1.27 倍，95 以上 → 1.5 倍（上限）
  const moveRate = clamp(0.6 + (p.eff.stability - 50) / 45, 0.5, 1.5);
  p.cutTimer -= dt;
  if (p.cutting) {
    if (metersTo(p.pos, hoop) < 1.8 || p.cutTimer < -1.4) {
      p.cutting = false;
      p.cutTimer = (3 + rng() * 4) / moveRate;
    } else {
      p.intent = '空切';
      return;
    }
  }
  const myDef = m.nearestOpponentDist(p, p.pos) / PX_PER_M;
  if (p.cutTimer <= 0 && handler !== p) {
    // 离篮筐 3.5m 外、身边空着、篮下不挤就可能空切；篮下能力越强越爱切（45 → 30%，60 → 60%，75 以上 90%）
    const canCut = metersTo(p.pos, hoop) > 3.5 && myDef > 1.4;
    const crowd = m.players.filter((o) => metersTo(o.pos, hoop) < 2.5).length;
    if (canCut && crowd <= 2 && rng() < clamp((p.eff.inside - 30) / 50, 0.1, 0.9)) {
      p.cutting = true;
      p.cutTimer = 0;
      m.tire(p, 'cut');
      p.target = clampToCourt({ x: hoop.x, y: hoop.y + (p.pos.y > hoop.y ? 1 : -1) * 0.8 * PX_PER_M });
      p.intent = '空切';
      return;
    }
    if (p.spot !== 'C' && p.spot !== 'PF') {
      // 外线换位：30% 概率收到中距离位，否则按能力值重挑站位，再换一个大一点的偏移，挪 1.5~3m，防守人脚步慢就跟不上
      p.spotVariant = rng() < 0.3 ? 'mid' : m.rollSpotVariant(p);
      const r = 1.6 * PX_PER_M;
      p.jitter = { x: (rng() - 0.5) * 2 * r, y: (rng() - 0.5) * 2 * r };
      p.jitterTimer = 1.5 + rng() * 1.5;
      p.cutTimer = (5 + rng() * 4) / moveRate;
    } else {
      p.cutTimer = (2 + rng() * 2) / moveRate;
    }
  }
  // 持球人还在后场：除他以外传球最好的人回来接应（离他 6m、靠前场一侧），别让传球能力差的内线被迫长传
  if (p === m.bestHandler(p.teamId, handler) && metersTo(handler.pos, hoop) > 13) {
    const dx = hoop.x - handler.pos.x;
    const dy = hoop.y - handler.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    p.intent = '接应';
    p.target = clampToCourt({ x: handler.pos.x + (dx / l) * 6 * PX_PER_M, y: handler.pos.y + (dy / l) * 6 * PX_PER_M + p.jitter.y * 0.5 });
    return;
  }
  p.intent = '';
  const spot = offenseSpot(p.teamId, p.spot, p.spotVariant);
  p.target = clampToCourt({ x: spot.x + p.jitter.x, y: spot.y + p.jitter.y });
}

/** 人盯人防守：站在对位人与篮筐之间，持球人贴近并伺机抢断 */
function thinkDefense(p: Player, m: Match, handler: Player): void {
  p.speedMul = 1;
  const hoop = defendHoop(p.teamId);
  const mark = m.markOf(p);
  const ballPos = m.ball.pos;
  const hasBall = mark === handler;
  const toHoop = { x: hoop.x - mark.pos.x, y: hoop.y - mark.pos.y };
  const len = Math.hypot(toHoop.x, toHoop.y) || 1;
  // 防守人所在区域对应的防守能力：离本方篮筐 4.5m 内看禁区防守，否则看外线防守
  const defAttr = metersTo(p.pos, hoop) < 4.5 ? p.eff.insideDef : p.eff.outsideDef;
  let tgt: Vec;
  if (hasBall) {
    p.intent = '贴防';
    const gap = 0.85 * PX_PER_M;
    tgt = { x: mark.pos.x + (toHoop.x / len) * gap, y: mark.pos.y + (toHoop.y / len) * gap };
    // 抢断尝试
    const dM = dist(p.pos, mark.pos) / PX_PER_M;
    if (dM < 1.15 && p.stealCooldown <= 0) {
      p.stealCooldown = 0.6;
      m.attemptSteal(p, mark);
    }
  } else {
    p.intent = '盯人';
    // 脚步：防守能力低的人跟人慢，容易被跑出空位（防守 50 → 0.85 倍速，80 → 1.0，100 → 1.1）
    p.speedMul = clamp(0.85 + ((defAttr - 50) / 50) * 0.25, 0.8, 1.1);
    // 盯人距离：射手贴紧一些，离球远的对位人可以多沉一点协防
    const markM = len / PX_PER_M;
    let frac = mark.eff.three > 75 ? 0.17 : 0.28;
    if (dist(mark.pos, ballPos) > 8 * PX_PER_M) frac += 0.14;
    if (markM < 2.5) frac = 0.4; // 篮下站在人和篮之间
    frac = Math.min(0.5, frac);
    const base = { x: mark.pos.x + toHoop.x * frac, y: mark.pos.y + toHoop.y * frac };
    tgt = { x: base.x + (ballPos.x - base.x) * 0.12, y: base.y + (ballPos.y - base.y) * 0.12 };
  }
  // 不要退到篮筐身后
  if (dist(tgt, hoop) < 0.6 * PX_PER_M) {
    tgt = { x: hoop.x - (toHoop.x / len) * 0.6 * PX_PER_M, y: hoop.y - (toHoop.y / len) * 0.6 * PX_PER_M };
  }
  p.target = clampToCourt(tgt);
  if (!p.isMoving()) p.face(mark.pos);
}

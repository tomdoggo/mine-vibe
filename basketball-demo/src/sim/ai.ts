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
import type { Match } from './Match';
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
    p.jitterTimer = 1.2 + Math.random() * 1.5;
    const r = 1.1 * PX_PER_M;
    p.jitter = { x: (Math.random() - 0.5) * 2 * r, y: (Math.random() - 0.5) * 2 * r };
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
      thinkLoose(p, m);
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
      thinkRebound(p, st.shooter);
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
  const chaser = mates.indexOf(p) < 2;
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
  p.target = nearOwn ? defenseHomeSpot(p.teamId, p.role) : offenseSpot(p.teamId, p.role);
  p.speedMul = 1;
}

/** 投篮飞行中：内线和附近的人冲抢篮板，其他人停留 */
function thinkRebound(p: Player, shooter: Player): void {
  const hoop = attackHoop(shooter.teamId);
  const dM = metersTo(p.pos, hoop);
  const big = p.role === 'PF' || p.role === 'C';
  if (p === shooter) {
    p.target = null;
    p.intent = '出手';
    return;
  }
  if (big || dM < 4.5) {
    p.intent = '卡位';
    // 往篮筐附近 1~1.8m 的位置靠，保持各自角度
    const ang = Math.atan2(p.pos.y - hoop.y, p.pos.x - hoop.x);
    const r = (1.2 + (p.slot % 3) * 0.3) * PX_PER_M;
    p.target = clampToCourt({ x: hoop.x + Math.cos(ang) * r, y: hoop.y + Math.sin(ang) * r });
  } else {
    p.intent = '';
    p.target = null;
  }
  p.speedMul = 1;
}

/** 持球人：投 / 传 / 突 / 运球调整，按价值选，带随机 */
function thinkHandler(p: Player, m: Match): void {
  p.speedMul = 0.88;
  const hoop = attackHoop(p.teamId);
  const dM = metersTo(p.pos, hoop);

  // 突破进行中：继续冲，到篮下再决策
  if (p.driveTimer > 0 && dM > 1.6) {
    p.intent = '突破';
    p.speedMul = 0.95 + p.def.attrs.drive * 0.25;
    p.target = driveTarget(p, hoop);
    if (p.decideTimer > 0) return;
  }
  if (p.decideTimer > 0) return;
  p.decideTimer = DECIDE_INTERVAL + Math.random() * 0.15;

  const shotClock = m.shotClock;
  const myDef = m.nearestOpponentDist(p, p.pos) / PX_PER_M;
  const myProb = m.shotProbability(p, p.pos, myDef, p.isMoving());
  const myPts = isThree(p.pos, hoop) ? 3 : 2;
  let shootEV = myProb * myPts;
  if (p.driveTimer > 0 && dM < 2.6) shootEV += 0.25; // 突到篮下倾向终结
  shootEV += (Math.random() - 0.5) * 0.2; // 手感/判断的随机性

  // 出手阈值：时间越少越敢投；刚拿球的前几秒更愿意传导；接球时是空位就果断出手
  let threshold = 0.98;
  if (shotClock > 16) threshold += 0.22; // 进攻前 8 秒先传导
  if (p.holdTime < 0.5 && myDef > 1.1) threshold -= 0.22;
  if (shotClock < 10) threshold = Math.min(threshold, Math.max(0.45, 0.98 - (10 - shotClock) * 0.08));
  if (shotClock < 2.5) threshold = -1;

  // 评估传球
  let bestPass: { to: Player; ev: number } | null = null;
  for (const mate of m.teamPlayers(p.teamId)) {
    if (mate === p) continue;
    const ev = passValue(p, mate, m, hoop);
    if (ev !== null && (!bestPass || ev > bestPass.ev)) bestPass = { to: mate, ev };
  }
  const passBias = (0.5 - p.def.attrs.passing) * 0.25; // 传球好的人更爱传
  const pressured = myDef < 0.9;

  // 1) 投
  if (shootEV >= threshold && (!bestPass || bestPass.ev + 0.3 < shootEV || shotClock < 4 || Math.random() < 0.55)) {
    m.shoot(p);
    return;
  }
  // 2) 传
  if (bestPass) {
    const wantPass =
      (bestPass.ev > shootEV + 0.15 + passBias && Math.random() < 0.75) ||
      (p.holdTime > 3.2 && bestPass.ev > 0.6) ||
      (pressured && dM > 4 && bestPass.ev > 0.75 && Math.random() < 0.5);
    if (wantPass && shotClock > 1.2) {
      m.pass(p, bestPass.to);
      return;
    }
  }
  // 3) 突
  if (p.driveTimer <= 0 && dM > 2.3 && shotClock < 19) {
    // 忽略贴身的那个防守人（前 1.3m），看他身后有没有协防
    const tMin = Math.min(0.5, (1.3 * PX_PER_M) / (dM * PX_PER_M));
    const laneOpen = laneClear(p.pos, hoop, m.opponents(p.teamId), 0.8 * PX_PER_M, tMin);
    // 每次决策（约 0.25 秒）的突破概率：好的突破手持球 3 秒左右有一半机会发动
    const pDrive = laneOpen ? 0.02 + p.def.attrs.drive * 0.06 : 0.01 * p.def.attrs.drive;
    if (Math.random() < pDrive) {
      p.driveTimer = 1.1 + Math.random() * 0.5;
      p.intent = '突破';
      p.target = driveTarget(p, hoop);
      return;
    }
  }
  // 4) 运球调整：回到自己的站位附近，被贴防时往远离防守人的方向挪一点
  p.intent = '运球';
  const spot = offenseSpot(p.teamId, p.role);
  let tgt = { x: spot.x + p.jitter.x * 0.6, y: spot.y + p.jitter.y * 0.6 };
  const nearest = m.nearestOpponent(p, p.pos);
  if (nearest && pressured) {
    const away = { x: p.pos.x - nearest.pos.x, y: p.pos.y - nearest.pos.y };
    const len = Math.hypot(away.x, away.y) || 1;
    tgt = { x: p.pos.x + (away.x / len) * 1.2 * PX_PER_M, y: p.pos.y + (away.y / len) * 1.2 * PX_PER_M };
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
  const defM = m.nearestOpponentDist(to, to.pos) / PX_PER_M;
  const prob = m.shotProbability(to, to.pos, defM, false);
  const pts = isThree(to.pos, hoop) ? 3 : 2;
  let ev = prob * pts;
  // 把球传到更靠近篮筐的人手里也有价值
  const closer = metersTo(from.pos, hoop) - metersTo(to.pos, hoop);
  ev += Math.max(-0.2, Math.min(0.25, closer * 0.04));
  if (lane < 1.0 * PX_PER_M) ev *= 0.55;
  const lenM = dist(from.pos, to.pos) / PX_PER_M;
  if (lenM > 11) ev *= 0.7;
  if (lenM < 1.5) ev *= 0.6; // 太近没意义
  if (to === from.lastPassFrom && from.holdTime < 1.5) ev -= 0.35; // 别马上回传
  return ev;
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

/** 无球进攻：站位 + 偶尔空切 */
function thinkOffBall(p: Player, m: Match, handler: Player, dt: number): void {
  p.speedMul = 1;
  const hoop = attackHoop(p.teamId);
  p.cutTimer -= dt;
  if (p.cutting) {
    if (metersTo(p.pos, hoop) < 1.8 || p.cutTimer < -1.4) {
      p.cutting = false;
      p.cutTimer = 4 + Math.random() * 5;
    } else {
      p.intent = '空切';
      return;
    }
  }
  const myDef = m.nearestOpponentDist(p, p.pos) / PX_PER_M;
  if (p.cutTimer <= 0 && (p.role === 'SF' || p.role === 'SG' || p.role === 'PF') && myDef > 1.4 && handler !== p) {
    // 篮下没有太多人才切
    const crowd = m.players.filter((o) => metersTo(o.pos, hoop) < 2.5).length;
    if (crowd <= 2) {
      p.cutting = true;
      p.cutTimer = 0;
      p.target = clampToCourt({ x: hoop.x, y: hoop.y + (p.pos.y > hoop.y ? 1 : -1) * 0.8 * PX_PER_M });
      p.intent = '空切';
      return;
    }
    p.cutTimer = 2 + Math.random() * 2;
  }
  p.intent = '';
  const spot = offenseSpot(p.teamId, p.role);
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
    // 盯人距离：射手贴紧一些，离球远的对位人可以多沉一点协防
    const markM = len / PX_PER_M;
    let frac = mark.def.attrs.three > 0.6 ? 0.17 : 0.28;
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

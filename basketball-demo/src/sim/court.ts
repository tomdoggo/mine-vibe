import type { Role, TeamId } from '../data/players';

/**
 * 俯视全场。真实球场 28m × 15m，这里 1 米 = 20 像素，球场 560 × 300。
 * 画面顶部留给记分牌。
 */
export const PX_PER_M = 20;
export const COURT = {
  left: 40,
  top: 52,
  width: 560,
  height: 300,
} as const;
export const COURT_RIGHT = COURT.left + COURT.width;
export const COURT_BOTTOM = COURT.top + COURT.height;
export const COURT_CY = COURT.top + COURT.height / 2;

/** 篮筐离底线 1.575m */
export const HOOP_INSET = 1.575 * PX_PER_M;
export const THREE_RADIUS = 6.75 * PX_PER_M;
/** 底角三分线到边线距离 0.9m（直线段） */
export const THREE_CORNER_Y = 0.9 * PX_PER_M;
export const KEY_WIDTH = 4.9 * PX_PER_M;
export const KEY_LENGTH = 5.8 * PX_PER_M;
export const CIRCLE_RADIUS = 1.8 * PX_PER_M;
export const RIM_RADIUS = 0.23 * PX_PER_M;

export interface Vec {
  x: number;
  y: number;
}

/** 每支球队进攻的篮筐：蓝队往右攻、红队往左攻 */
export const ATTACK_DIR: Record<TeamId, 1 | -1> = { blue: 1, red: -1 };

export function hoopFor(dir: 1 | -1): Vec {
  return { x: dir === 1 ? COURT_RIGHT - HOOP_INSET : COURT.left + HOOP_INSET, y: COURT_CY };
}

export function attackHoop(team: TeamId): Vec {
  return hoopFor(ATTACK_DIR[team]);
}

export function defendHoop(team: TeamId): Vec {
  return hoopFor(ATTACK_DIR[team] === 1 ? -1 : 1);
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 距离某篮筐多少米 */
export function metersTo(p: Vec, hoop: Vec): number {
  return dist(p, hoop) / PX_PER_M;
}

/** 是否在三分线外（相对给定篮筐） */
export function isThree(p: Vec, hoop: Vec): boolean {
  const dy = Math.abs(p.y - hoop.y);
  const halfH = COURT.height / 2;
  // 底角直线段：边线内 0.9m 的横线之外算三分
  if (dy > halfH - THREE_CORNER_Y) return true;
  return dist(p, hoop) > THREE_RADIUS;
}

/** 把点限制在球场内（留一点边） */
export function clampToCourt(p: Vec, margin = 4): Vec {
  return {
    x: Math.min(COURT_RIGHT - margin, Math.max(COURT.left + margin, p.x)),
    y: Math.min(COURT_BOTTOM - margin, Math.max(COURT.top + margin, p.y)),
  };
}

/**
 * 进攻站位（相对进攻篮筐，单位米）。dx 为沿进攻方向离篮筐的距离（正数 = 远离篮筐、往中场），
 * dy 为垂直方向偏移。
 */
const OFFENSE_SPOTS: Record<Role, { dx: number; dy: number }> = {
  PG: { dx: 7.4, dy: 0.4 }, // 弧顶三分
  SG: { dx: 5.4, dy: -5.2 }, // 侧翼三分
  SF: { dx: 4.4, dy: 4.4 }, // 另一侧 45 度中距离
  PF: { dx: 3.4, dy: -3.0 }, // 肘区
  C: { dx: 1.6, dy: 2.4 }, // 低位
};

export function offenseSpot(team: TeamId, role: Role): Vec {
  const dir = ATTACK_DIR[team];
  const hoop = attackHoop(team);
  const s = OFFENSE_SPOTS[role];
  return { x: hoop.x - dir * s.dx * PX_PER_M, y: hoop.y + s.dy * PX_PER_M };
}

/** 退防/发球时的站位（在本方半场） */
export function defenseHomeSpot(team: TeamId, role: Role): Vec {
  const dir = ATTACK_DIR[team];
  const hoop = defendHoop(team);
  const s = OFFENSE_SPOTS[role];
  // 站在防守篮筐前方，比进攻站位更靠近篮筐一些
  return { x: hoop.x + dir * (s.dx * 0.75 + 0.5) * PX_PER_M, y: hoop.y + s.dy * 0.8 * PX_PER_M };
}

/** 底线发球点：在被进球的篮筐底线外侧 */
export function inboundSpot(team: TeamId): Vec {
  const hoop = defendHoop(team);
  const dir = ATTACK_DIR[team];
  return { x: hoop.x - dir * (HOOP_INSET + 6), y: hoop.y + 40 };
}

/** 接发球点 */
export function inboundReceiveSpot(team: TeamId): Vec {
  const hoop = defendHoop(team);
  const dir = ATTACK_DIR[team];
  return { x: hoop.x + dir * 4.5 * PX_PER_M, y: hoop.y - 30 };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 点 p 到线段 ab 的距离，以及投影参数 t（0~1） */
export function pointSegment(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = clamp01(t);
  const px = a.x + vx * t;
  const py = a.y + vy * t;
  return { d: Math.hypot(p.x - px, p.y - py), t };
}

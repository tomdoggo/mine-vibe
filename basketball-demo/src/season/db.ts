import playersJson from '../data/db/players.json';
import teamsJson from '../data/db/teams.json';
import type { Attributes, PlayerDef, Role, TeamDef, TeamId } from '../data/players';
import { ovr } from '../sim/lineup';

/** 球员库（data/db/players.json，由 scripts/build-db.ts 生成） */
export interface DbPlayer {
  id: string;
  name: string;
  short: string;
  role: Role;
  height: number;
  weight: number;
  age: number;
  number: number;
  sprite: number;
  /** 传奇（有真实原型）还是生成的角色球员 */
  legend: boolean;
  badges: string[];
  attrs: Attributes;
}

export type Tier = 'elite' | 'normal' | 'weak';

/** 球队库（data/db/teams.json）：roster 前 5 人是首发 */
export interface DbTeam {
  id: string;
  name: string;
  short: string;
  tier: Tier;
  color: string;
  roster: string[];
}

export const PLAYERS: DbPlayer[] = playersJson as DbPlayer[];
export const DB_TEAMS: DbTeam[] = teamsJson as DbTeam[];
export const PLAYER_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));
export const TEAM_BY_ID = new Map(DB_TEAMS.map((t) => [t.id, t]));

export const TIER_LABEL: Record<Tier, string> = { elite: '强队', normal: '普通', weak: '杂牌' };

export function playerOvr(p: DbPlayer): number {
  return Math.round(ovr(p.attrs));
}

/** 球队实力：首发平均 × 0.7 + 替补平均 × 0.3 */
export function teamOvr(t: DbTeam): number {
  const r = t.roster.map((id) => ovr(PLAYER_BY_ID.get(id)!.attrs));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.round(avg(r.slice(0, 5)) * 0.7 + avg(r.slice(5)) * 0.3);
}

function toPlayerDef(p: DbPlayer): PlayerDef {
  return {
    id: p.id,
    number: p.number,
    name: p.name,
    short: p.short,
    role: p.role,
    height: p.height,
    weight: p.weight,
    age: p.age,
    badges: p.badges,
    sprite: p.sprite,
    attrs: { ...p.attrs },
  };
}

const hexToNum = (hex: string) => parseInt(hex.replace('#', ''), 16);
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** 深色队色在深色背景上看不清：文字用提亮后的颜色 */
function readableCss(c: number): string {
  let [r, g, b] = rgb(c);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 130) {
    const k = (130 - lum) / (255 - lum);
    r = Math.round(r + (255 - r) * k);
    g = Math.round(g + (255 - g) * k);
    b = Math.round(b + (255 - b) * k);
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function colorDist(a: number, b: number): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** 客场白色球衣（两队队色太接近时用） */
const AWAY_WHITE = 0xe8e8ee;

/**
 * 按伤病排名单：重伤 / 报销的人不在名单里；原首发缺阵由替补里实力最好的补上；
 * 带轻伤（能力减半）的首发如果实力不如最好的替补，就由替补首发、他改打替补（出场时间按减半后的实力分，自然变少）。
 */
export function arrangeRoster(roster: string[], injured: Set<string>, out: Set<string>): { ids: string[]; injured: Set<string> } {
  const rating = (id: string) => ovr(PLAYER_BY_ID.get(id)!.attrs) * (injured.has(id) ? 0.5 : 1);
  let avail = roster.filter((id) => !out.has(id));
  if (avail.length < 5) avail = roster.slice(); // 实在凑不齐五人，伤员也得上
  // 综合能力（轻伤减半）最高的 5 人首发，位置不管；同分按名单顺序
  const ids = avail.map((id, i) => ({ id, i, r: rating(id) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.id);
  return { ids, injured };
}

/** 把库里的两支球队变成一场比赛用的两队：主队是蓝方（往右攻），客队是红方；队色太接近时客队穿白 */
export function matchTeams(homeId: string, awayId: string, setup?: { injured: string[]; out: string[] }): Record<TeamId, TeamDef> {
  const injured = new Set(setup?.injured ?? []);
  const out = new Set(setup?.out ?? []);
  const home = TEAM_BY_ID.get(homeId)!;
  const away = TEAM_BY_ID.get(awayId)!;
  const hc = hexToNum(home.color);
  let ac = hexToNum(away.color);
  if (colorDist(hc, ac) < 120) ac = colorDist(hc, AWAY_WHITE) < 120 ? 0x222222 : AWAY_WHITE;
  const mk = (t: DbTeam, id: TeamId, color: number): TeamDef => ({
    id,
    name: t.short,
    short: t.short,
    color,
    colorCss: readableCss(color),
    players: arrangeRoster(t.roster, injured, out).ids.map((pid) => ({ ...toPlayerDef(PLAYER_BY_ID.get(pid)!), injured: injured.has(pid) || undefined })),
  });
  return { blue: mk(home, 'blue', hc), red: mk(away, 'red', ac) };
}

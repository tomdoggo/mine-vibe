export type TeamId = 'blue' | 'red';
export type Role = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/** 球员能力值，全部 0~1 */
export interface Attributes {
  /** 移动速度 */
  speed: number;
  /** 近距离终结（上篮/篮下） */
  inside: number;
  /** 中距离 */
  mid: number;
  /** 三分 */
  three: number;
  /** 传球精度（减少失误、提升传球意愿） */
  passing: number;
  /** 持球突破意愿与成功率 */
  drive: number;
  /** 防守：抢断、干扰 */
  defense: number;
  /** 篮板 */
  rebound: number;
}

export interface PlayerDef {
  number: number;
  name: string;
  role: Role;
  /** 角色精灵表编号（public/assets/chars/<id>.png） */
  sprite: number;
  attrs: Attributes;
}

export interface TeamDef {
  id: TeamId;
  name: string;
  color: number;
  colorCss: string;
  players: PlayerDef[];
}

const a = (
  speed: number,
  inside: number,
  mid: number,
  three: number,
  passing: number,
  drive: number,
  defense: number,
  rebound: number,
): Attributes => ({ speed, inside, mid, three, passing, drive, defense, rebound });

export const TEAMS: Record<TeamId, TeamDef> = {
  blue: {
    id: 'blue',
    name: '蓝队',
    color: 0x3b82f6,
    colorCss: '#5ea0ff',
    players: [
      { number: 1, name: '阿光', role: 'PG', sprite: 2, attrs: a(0.9, 0.5, 0.65, 0.7, 0.9, 0.75, 0.6, 0.3) },
      { number: 7, name: '小七', role: 'SG', sprite: 5, attrs: a(0.8, 0.55, 0.7, 0.85, 0.6, 0.6, 0.5, 0.35) },
      { number: 11, name: '老陈', role: 'SF', sprite: 12, attrs: a(0.75, 0.7, 0.65, 0.6, 0.6, 0.7, 0.65, 0.5) },
      { number: 23, name: '大牛', role: 'PF', sprite: 22, attrs: a(0.6, 0.8, 0.5, 0.3, 0.45, 0.5, 0.7, 0.8) },
      { number: 33, name: '塔哥', role: 'C', sprite: 25, attrs: a(0.5, 0.9, 0.4, 0.15, 0.4, 0.35, 0.75, 0.9) },
    ],
  },
  red: {
    id: 'red',
    name: '红队',
    color: 0xef4444,
    colorCss: '#ff6b6b',
    players: [
      { number: 3, name: '飞哥', role: 'PG', sprite: 3, attrs: a(0.95, 0.55, 0.6, 0.65, 0.85, 0.85, 0.55, 0.3) },
      { number: 8, name: '阿豪', role: 'SG', sprite: 6, attrs: a(0.8, 0.5, 0.75, 0.8, 0.55, 0.55, 0.55, 0.35) },
      { number: 15, name: '老白', role: 'SF', sprite: 9, attrs: a(0.7, 0.65, 0.7, 0.65, 0.65, 0.6, 0.7, 0.5) },
      { number: 21, name: '铁柱', role: 'PF', sprite: 10, attrs: a(0.6, 0.8, 0.55, 0.35, 0.45, 0.5, 0.75, 0.8) },
      { number: 50, name: '山哥', role: 'C', sprite: 13, attrs: a(0.45, 0.9, 0.35, 0.1, 0.35, 0.3, 0.8, 0.95) },
    ],
  },
};

export const ROLE_ORDER: Role[] = ['PG', 'SG', 'SF', 'PF', 'C'];

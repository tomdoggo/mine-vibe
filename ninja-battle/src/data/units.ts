export type UnitKind = 'melee' | 'ranged' | 'cavalry';
export type TeamId = 'player' | 'enemy';

export const UNIT_KINDS: UnitKind[] = ['melee', 'ranged', 'cavalry'];

export interface UnitStats {
  kind: UnitKind;
  name: string;
  desc: string;
  hp: number;
  /** 攻击力。每次攻击实际伤害在 atk 的 80%~120% 之间随机并向上取整（见 RULES.atkVariance），直接扣对方 hp，没有防御 */
  atk: number;
  /** 碰撞体尺寸（透视前） */
  width: number;
  height: number;
  cost: number;
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  melee: {
    kind: 'melee',
    name: '足轻',
    desc: '前列 · 冲锋对撞',
    hp: 25,
    atk: 10,
    width: 10,
    height: 14,
    cost: 10,
  },
  ranged: {
    kind: 'ranged',
    name: '弓兵',
    desc: '中列 · 原地齐射',
    hp: 20,
    atk: 10,
    width: 10,
    height: 14,
    cost: 15,
  },
  cavalry: {
    kind: 'cavalry',
    name: '骑兵',
    desc: '后列 · 加速冲锋',
    hp: 30,
    atk: 10,
    width: 20,
    height: 16,
    cost: 25,
  },
};

/** 占位色块配色：我方蓝系，敌方红系 */
export const TEAM_COLORS: Record<TeamId, Record<UnitKind, number>> = {
  player: { melee: 0x4a90e2, ranged: 0x8fd0ff, cavalry: 0x2a5aa8 },
  enemy: { melee: 0xe25c4a, ranged: 0xffb08a, cavalry: 0xa8302a },
};

export const TEAM_NAME: Record<TeamId, string> = { player: '我军', enemy: '敌军' };
export const TEAM_TEXT_COLOR: Record<TeamId, string> = { player: '#7fc1ff', enemy: '#ff8f7f' };

export interface Composition {
  melee: number;
  ranged: number;
  cavalry: number;
}

/** 默认编制：足轻 10、弓兵 10、骑兵 5，双方各 25 人 */
export const DEFAULT_COMPOSITION: Composition = { melee: 10, ranged: 10, cavalry: 5 };

export function compositionTotal(c: Composition): number {
  return c.melee + c.ranged + c.cavalry;
}

/** 方阵从前到后按 UNIT_KINDS 排列，相邻方阵即数组里的前后邻居 */
export function adjacentKinds(kind: UnitKind): UnitKind[] {
  const i = UNIT_KINDS.indexOf(kind);
  return UNIT_KINDS.filter((_, j) => Math.abs(j - i) === 1);
}

export interface BattleConfig {
  player: Composition;
  enemy: Composition;
}

export function defaultBattleConfig(): BattleConfig {
  return {
    player: { ...DEFAULT_COMPOSITION },
    enemy: { ...DEFAULT_COMPOSITION },
  };
}

/** 一方的得分，两项分开统计 */
export interface TeamScore {
  /** 对敌方造成的 hp 伤害总和（不含溢出） */
  damage: number;
  /** 击杀数 */
  kills: number;
  /** 击杀分（按被击杀单位的兵种累加） */
  killScore: number;
  /** 按出手方阵拆分的得分（伤害分 + 击杀分），三项之和等于总分 */
  byKind: Record<UnitKind, number>;
}

export function emptyScore(): TeamScore {
  return { damage: 0, kills: 0, killScore: 0, byKind: { melee: 0, ranged: 0, cavalry: 0 } };
}

/** 某个方阵的得分占本方总分的百分比（整数），总分为 0 时返回 0 */
export function kindSharePercent(s: TeamScore, kind: UnitKind): number {
  const total = scoreTotal(s);
  return total > 0 ? Math.round((s.byKind[kind] / total) * 100) : 0;
}

/** 方阵得分，每个方阵一行：足轻 329(36%) / 弓兵 96(10%) / 骑兵 493(54%) */
export function kindScoreLines(s: TeamScore): string[] {
  return UNIT_KINDS.map((k) => `${UNIT_STATS[k].name} ${s.byKind[k]}(${kindSharePercent(s, k)}%)`);
}

export function scoreTotal(s: TeamScore): number {
  return s.damage + s.killScore;
}

export interface BattleResult {
  winner: TeamId | 'draw';
  score: Record<TeamId, TeamScore>;
  playerStart: number;
  playerAlive: number;
  enemyStart: number;
  enemyAlive: number;
  elapsedMs: number;
  config: BattleConfig;
}

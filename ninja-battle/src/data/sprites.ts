import type { TeamId, UnitKind } from './units';

/**
 * 素材来自 Ninja Adventure Asset Pack（Pixel-Boy & AAA，CC0）
 * https://pixel-boy.itch.io/ninja-adventure-asset-pack
 */
export const ASSET_ROOT = 'assets/ninja-adventure';

export type WeaponKind = 'lance' | 'bow' | 'katana';
export type HorseColor = 'brown' | 'black';

export interface UnitSprite {
  /** Actor/Character 下的角色目录名 */
  char: string;
  weapon: WeaponKind;
  horse?: HorseColor;
}

export const UNIT_SPRITES: Record<TeamId, Record<UnitKind, UnitSprite>> = {
  player: {
    melee: { char: 'NinjaBlue', weapon: 'lance' },
    ranged: { char: 'NinjaWater', weapon: 'bow' },
    cavalry: { char: 'RedGladiator', weapon: 'katana', horse: 'black' },
  },
  enemy: {
    melee: { char: 'NinjaRed', weapon: 'lance' },
    ranged: { char: 'NinjaFire', weapon: 'bow' },
    cavalry: { char: 'GladiatorBlue', weapon: 'katana', horse: 'brown' },
  },
};

export const CHARACTERS: string[] = Array.from(
  new Set(Object.values(UNIT_SPRITES).flatMap((byKind) => Object.values(byKind).map((s) => s.char))),
);
export const HORSES: HorseColor[] = ['brown', 'black'];
export const WEAPONS: WeaponKind[] = ['lance', 'bow', 'katana'];

/**
 * 角色精灵表规格：16x16 一帧，4 列是朝向（下、上、左、右）。
 * Walk.png 4 行 = 4 帧行走；Attack.png 1 行；Dead.png 单帧。
 * 本游戏统一使用“朝右”列，朝左时 flipX。
 */
export const CHAR_FRAME = 16;
export const DIR_RIGHT = 3;
export const WALK_FRAMES_RIGHT = [3, 7, 11, 15];

export const HORSE_FRAME = { width: 23, height: 16 };

export const TEX = {
  /** 溃逃时头上冒的汗滴，运行时用 Graphics 生成 */
  sweat: 'fx-sweat',
  walk: (c: string) => `char-${c}-walk`,
  attack: (c: string) => `char-${c}-attack`,
  dead: (c: string) => `char-${c}-dead`,
  horse: (h: HorseColor) => `horse-${h}`,
  weapon: (w: WeaponKind) => `weapon-${w}`,
  arrow: 'fx-arrow',
  slash: 'fx-slash',
  explosion: 'fx-explosion',
  heal: 'fx-heal',
  smoke: 'fx-smoke',
} as const;

export const ANIM = {
  walk: (c: string) => `anim-${c}-walk`,
  horseRun: (h: HorseColor) => `anim-horse-${h}-run`,
  slash: 'anim-fx-slash',
  explosion: 'anim-fx-explosion',
  heal: 'anim-fx-heal',
  smoke: 'anim-fx-smoke',
} as const;

/** 特效精灵表的帧尺寸 */
export const FX_FRAMES = {
  slash: { width: 26, height: 32, count: 5, rate: 20 },
  explosion: { width: 40, height: 40, count: 9, rate: 16 },
  heal: { width: 32, height: 32, count: 5, rate: 12 },
  smoke: { width: 32, height: 32, count: 6, rate: 14 },
} as const;

/** 武器在手中的摆放：相对单位中心的偏移（朝右时），以及待机/攻击时的角度 */
export interface WeaponPose {
  dx: number;
  dy: number;
  idleAngle: number;
  attackAngle: number;
}
export const WEAPON_POSE: Record<WeaponKind, WeaponPose> = {
  lance: { dx: 5, dy: -1, idleAngle: 0, attackAngle: 90 },
  bow: { dx: 6, dy: 0, idleAngle: 90, attackAngle: 90 },
  katana: { dx: 6, dy: -3, idleAngle: 25, attackAngle: 110 },
};

/** 骑兵：马相对骑手的偏移 */
export const HORSE_DY = 5;
/** 攻击帧保持多久（毫秒） */
export const ATTACK_POSE_MS = 220;

import type { Game } from './engine.ts';

export type EType = 'fire' | 'water' | 'grass' | 'lightning' | 'colorless';
/** 互斥的特殊状态（睡眠/麻痹/混乱）；中毒、灼伤是独立标记 */
export type Rotation = 'asleep' | 'paralyzed' | 'confused';
export type PlayerId = 0 | 1;
/** 'active' = 前场；数字 = 备战区下标 */
export type Slot = 'active' | number;

// ---------- 卡牌定义（静态数据） ----------

export interface AttackCtx {
  g: Game;
  me: PlayerId;
  attacker: InPlay;
  defender: InPlay;
}

export interface AttackDef {
  name: string;
  cost: EType[];
  /** 基础伤害（弱点/抗性之前） */
  damage: number;
  text?: string;
  /** 需要动态计算伤害时提供（可掷硬币），返回弱点/抗性之前的伤害 */
  damageFn?: (ctx: AttackCtx) => number | Promise<number>;
  /** 给 AI 估算用的期望伤害（不掷硬币） */
  estimate?: (attacker: InPlay) => number;
  /** 造成伤害之后的附加效果 */
  effect?: (ctx: AttackCtx) => void | Promise<void>;
}

export interface AbilityCtx {
  g: Game;
  me: PlayerId;
  self: InPlay;
}

export interface AbilityDef {
  name: string;
  text: string;
  canUse: (ctx: AbilityCtx) => boolean;
  use: (ctx: AbilityCtx) => void | Promise<void>;
}

export interface CreatureDef {
  kind: 'creature';
  name: string;
  /** 0 = 基础，1 = 1 阶，2 = 2 阶 */
  stage: 0 | 1 | 2;
  evolvesFrom?: string;
  hp: number;
  type: EType;
  weakness?: EType;
  resistance?: EType;
  retreat: number;
  attacks: AttackDef[];
  ability?: AbilityDef;
  /** 被击倒时对手拿几张奖赏卡，默认 1 */
  prizes?: number;
}

export interface TrainerCtx {
  g: Game;
  me: PlayerId;
}

export interface TrainerDef {
  kind: 'trainer';
  sub: 'item' | 'supporter';
  name: string;
  text: string;
  canPlay?: (ctx: TrainerCtx) => boolean;
  play: (ctx: TrainerCtx) => void | Promise<void>;
}

export interface EnergyDef {
  kind: 'energy';
  name: string;
  provides: EType;
}

export type CardDef = CreatureDef | TrainerDef | EnergyDef;

// ---------- 对局状态（动态） ----------

export interface Card {
  uid: number;
  def: CardDef;
}

/** 场上的一只生物：进化链叠在 stack 里，最上面那张是当前形态 */
export interface InPlay {
  stack: Card[];
  energy: Card[];
  damage: number;
  rotation: Rotation | null;
  poisoned: boolean;
  burned: boolean;
  /** 放上场或进化的回合，用于"本回合不能再进化" */
  playedTurn: number;
  abilityTurn: number;
}

export interface PlayerState {
  name: string;
  deck: Card[];
  hand: Card[];
  discard: Card[];
  prizes: Card[];
  active: InPlay | null;
  bench: InPlay[];
  energyAttached: boolean;
  supporterPlayed: boolean;
  retreated: boolean;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  current: PlayerId;
  /** 全局回合数，从 1 开始；第 1 回合 = 先攻方的第一回合 */
  turn: number;
  first: PlayerId;
  winner: PlayerId | 'draw' | null;
  reason: string;
  log: string[];
}

export interface DeckList {
  name: string;
  cards: Array<[string, number]>;
}

// ---------- 玩家决策接口 ----------

export type Action =
  | { type: 'playBasic'; uid: number }
  | { type: 'evolve'; uid: number; target: Slot }
  | { type: 'attach'; uid: number; target: Slot }
  | { type: 'trainer'; uid: number }
  | { type: 'ability'; target: Slot }
  | { type: 'retreat'; to: number }
  | { type: 'attack'; index: number }
  | { type: 'end' };

export type ChoiceKind =
  | 'goFirst'
  | 'setupActive'
  | 'setupBench'
  | 'promote'
  | 'search'
  | 'retrieve'
  | 'heal'
  | 'attachTarget'
  | 'switchTo'
  | 'retreatEnergy'
  | 'oppBench'
  | 'leapSeed';

export interface ChoiceOption {
  label: string;
  card?: Card;
  slot?: Slot;
}

export interface ChoiceRequest {
  kind: ChoiceKind;
  prompt: string;
  options: ChoiceOption[];
  /** true 时可以返回 -1 表示跳过/完成 */
  optional: boolean;
  /** 给 AI 的提示：贴的是哪种能量（attachTarget） */
  etype?: EType;
  /** 给 AI 的提示：要造成多少伤害（oppBench 狙击） */
  amount?: number;
}

/** 人类玩家、启发式 AI、以后的 MCTS / 大模型 AI 都实现这个接口 */
export interface Agent {
  name: string;
  chooseAction(g: Game, me: PlayerId, actions: Action[]): Action | Promise<Action>;
  choose(g: Game, me: PlayerId, req: ChoiceRequest): number | Promise<number>;
}

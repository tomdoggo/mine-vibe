import Phaser from 'phaser';
import type { Attributes, PlayerDef, Role, TeamDef, TeamId } from '../data/players';
import { ANIM, JUMP_ROW, SHOOT_ROW, TEX, frameIndex, type Facing } from '../data/sprites';
import { textStyle } from '../ui/text';
import { clampToCourt, type SpotVariant, type Vec } from './court';
import { speedForHeight, spotIndex } from './lineup';
import { rng } from './rng';
import { staminaFactor } from './fatigue';
import { INJURED_MUL, type InjuryKind } from './injury';

/** 球员姿态：正常 / 投篮出手（锁住移动）/ 起跳（封盖、争抢篮板） */
export type Pose = 'normal' | 'shoot' | 'jump';

/** 脚下圆盘半径（像素） */
const DISC_R = 9;

/** 模型按身高缩放：170cm → 0.9 倍，230cm → 1.5 倍，线性插值并截断 */
const HEIGHT_MIN_CM = 170;
const HEIGHT_MAX_CM = 230;
const SCALE_MIN = 0.9;
const SCALE_MAX = 1.5;
export function bodyScaleFor(heightCm: number): number {
  const t = (heightCm - HEIGHT_MIN_CM) / (HEIGHT_MAX_CM - HEIGHT_MIN_CM);
  return SCALE_MIN + Math.min(1, Math.max(0, t)) * (SCALE_MAX - SCALE_MIN);
}

/** 单场个人数据 */
export interface PlayerStats {
  /** 出场时间（比赛秒） */
  sec: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
}

/** 球员的全部可变状态（回放快照用），对其他球员的引用存为下标 */
export interface PlayerSnapshot {
  stats: PlayerStats;
  pos: Vec;
  vel: Vec;
  facing: Facing;
  target: Vec | null;
  speedMul: number;
  pose: Pose;
  poseTimer: number;
  decideTimer: number;
  holdTime: number;
  stealCooldown: number;
  intent: string;
  driveTimer: number;
  lastPassFrom: number;
  floor: number;
  boostAmount: number;
  boostUntil: number;
  cutTimer: number;
  cutting: boolean;
  spotVariant: SpotVariant;
  jitter: Vec;
  jitterTimer: number;
  stamina: number;
  onCourt: boolean;
  spot: Role;
  enteredAt: number;
  injury: InjuryKind | null;
  newInjury: { kind: InjuryKind; games: number } | null;
  targetSec: number;
}

export const emptyPlayerStats = (): PlayerStats => ({
  sec: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  pf: 0,
});

/**
 * 球员本体：位置、移动、朝向和精灵渲染。
 * “做什么”由 ai.ts 决定，这里只负责“朝目标走”和把姿态画出来。
 */
export class Player {
  readonly def: PlayerDef;
  readonly team: TeamDef;
  readonly teamId: TeamId;
  /** 名单上的位置标签（引擎不看） */
  readonly role: Role;
  /** 本场的站位：按场上五人的能力值分配（lineup.ts），换人后重新分配；引擎里所有“位置”判断都看它 */
  spot: Role;
  /** 站位序号 0~4（对位、发球接应按它） */
  slot: number;
  /** 体力 0~100：场上随时间和动作消耗，场下恢复（fatigue.ts） */
  stamina = 100;
  /** 当前实际能力值 = 能力值 × 体力系数；所有比赛结算都用它，不用 def.attrs */
  eff: Attributes;
  /** 是否在场上（替补席上的人不参与模拟、不显示） */
  onCourt = true;
  /** 最近一次上场的比赛时间（秒），教练用来保证每段至少打一会儿 */
  enteredAt = 0;
  /** 教练给的本场目标出场时间（比赛秒），开场时按实力算好，整场不变 */
  targetSec = 0;
  /** 首发 */
  starter = false;
  /** 当前伤病（含赛前带来的轻伤）：有伤全能力值减半；重伤 / 报销不能上场 */
  injury: InjuryKind | null = null;
  /** 本场新受的伤（赛季据此记录缺阵场数） */
  newInjury: { kind: InjuryKind; games: number } | null = null;
  /** 移动速度倍率：按身高 */
  private readonly speedBase: number;
  stats: PlayerStats = emptyPlayerStats();

  pos: Vec;
  vel: Vec = { x: 0, y: 0 };
  facing: Facing = 'down';
  /** 目标点（null = 原地） */
  target: Vec | null = null;
  /** 速度倍率（持球时略慢、突破时略快） */
  speedMul = 1;
  pose: Pose = 'normal';
  private poseTimer = 0;

  // ---- AI 用的记忆 ----
  /** 下次重新决策的倒计时（秒） */
  decideTimer = 0;
  /** 持球已多久 */
  holdTime = 0;
  /** 抢断冷却 */
  stealCooldown = 0;
  /** 当前决策标签（显示用，例如“突破”） */
  intent = '';
  /** 突破承诺剩余时间 */
  driveTimer = 0;
  /** 刚把球传给我的人（避免来回倒脚） */
  lastPassFrom: Player | null = null;
  /** 本半场随机区间的下限（相对能力值，-50 ~ -25），每半场开始时由 Match 掷定 */
  floor = -50;
  /** 接到传球后的投篮加成（助攻能力带来），到期时间为比赛累计秒 */
  boostAmount = 0;
  boostUntil = 0;
  /** 无球跑动：下一次空切倒计时 */
  cutTimer = 2 + rng() * 3;
  /** 正在空切 */
  cutting = false;
  /** 本回合的站位变体（每次球权变化时随机）：外线可能站中距离，内线可能拉出三分线 */
  spotVariant: SpotVariant = 'base';
  /** 在站位附近的随机偏移 */
  jitter: Vec = { x: 0, y: 0 };
  jitterTimer = 0;

  readonly sprite: Phaser.GameObjects.Sprite;
  /** 模型缩放倍数（按身高） */
  readonly bodyScale: number;
  /** 脚下的队色圆盘，上面写位置和号码 */
  private readonly disc: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly intentLabel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, def: PlayerDef, team: TeamDef, spot: Role, pos: Vec) {
    this.def = def;
    this.team = team;
    this.teamId = team.id;
    this.role = def.role;
    this.spot = spot;
    this.slot = spotIndex(spot);
    this.eff = { ...def.attrs };
    if (def.injured) {
      this.injury = 'light';
      this.setStamina(100);
    }
    this.speedBase = speedForHeight(def.height);
    this.pos = { ...pos };
    this.disc = scene.add.graphics();
    this.disc.fillStyle(team.color, 0.6);
    this.disc.fillCircle(0, 0, DISC_R);
    this.disc.lineStyle(1, team.color, 1);
    this.disc.strokeCircle(0, 0, DISC_R);
    this.sprite = scene.add.sprite(pos.x, pos.y, TEX.char(def.sprite), frameIndex(0, 'down'));
    this.sprite.setOrigin(0.5, 0.85);
    this.bodyScale = bodyScaleFor(def.height);
    this.sprite.setScale(this.bodyScale);
    this.label = scene.add
      .text(pos.x, pos.y, `${spot}.${def.number}`, { ...textStyle(6, '#ffffff'), fontStyle: 'bold' })
      .setOrigin(0.5, 0.5)
      .setStroke('#000000', 1.5);
    this.intentLabel = scene.add.text(pos.x, pos.y, '', textStyle(6, '#ffffff')).setOrigin(0.5, 1).setAlpha(0.85);
  }

  /** 基础速度（像素/秒），由身高决定 */
  get speed(): number {
    return 112 * this.speedBase * this.speedMul;
  }

  /** 突破倾向 0~1：篮下比三分好得越多越爱突，三分手更愿意留在外线 */
  get driveTendency(): number {
    const a = this.eff;
    const t = 0.5 + (a.inside - a.three) / 60 + (a.assist - 70) / 200;
    return t < 0.05 ? 0.05 : t > 1 ? 1 : t;
  }

  isMoving(): boolean {
    return Math.hypot(this.vel.x, this.vel.y) > 8;
  }

  facingVec(): Vec {
    switch (this.facing) {
      case 'left':
        return { x: -1, y: 0 };
      case 'right':
        return { x: 1, y: 0 };
      case 'up':
        return { x: 0, y: -1 };
      default:
        return { x: 0, y: 1 };
    }
  }

  face(toward: Vec): void {
    const dx = toward.x - this.pos.x;
    const dy = toward.y - this.pos.y;
    if (Math.abs(dx) >= Math.abs(dy)) this.facing = dx >= 0 ? 'right' : 'left';
    else this.facing = dy >= 0 ? 'down' : 'up';
  }

  setPose(pose: Pose, seconds: number): void {
    this.pose = pose;
    this.poseTimer = seconds;
  }

  canMove(): boolean {
    return this.pose === 'normal';
  }

  /** 每帧：朝目标移动、与他人保持距离、更新渲染 */
  update(dtSec: number, others: Player[]): void {
    this.decideTimer -= dtSec;
    this.stealCooldown = Math.max(0, this.stealCooldown - dtSec);
    this.driveTimer = Math.max(0, this.driveTimer - dtSec);
    if (this.poseTimer > 0) {
      this.poseTimer -= dtSec;
      if (this.poseTimer <= 0) this.pose = 'normal';
    }

    let desired: Vec = { x: 0, y: 0 };
    if (this.canMove() && this.target) {
      const dx = this.target.x - this.pos.x;
      const dy = this.target.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 1.5) {
        // 接近目标时减速，避免抖动
        const sp = this.speed * Math.min(1, d / 10);
        desired = { x: (dx / d) * sp, y: (dy / d) * sp };
      }
    }
    // 与其他球员的软碰撞：太近就互相推开
    let sepX = 0;
    let sepY = 0;
    for (const o of others) {
      if (o === this) continue;
      const dx = this.pos.x - o.pos.x;
      const dy = this.pos.y - o.pos.y;
      const d = Math.hypot(dx, dy);
      const minD = 9;
      if (d < minD && d > 0.01) {
        const push = (minD - d) / minD;
        sepX += (dx / d) * push * 60;
        sepY += (dy / d) * push * 60;
      }
    }
    desired.x += sepX;
    desired.y += sepY;

    // 平滑加速
    const k = Math.min(1, dtSec * 10);
    this.vel = { x: this.vel.x + (desired.x - this.vel.x) * k, y: this.vel.y + (desired.y - this.vel.y) * k };
    this.pos = clampToCourt({ x: this.pos.x + this.vel.x * dtSec, y: this.pos.y + this.vel.y * dtSec }, 2);

    if (this.isMoving() && this.pose === 'normal') {
      if (Math.abs(this.vel.x) >= Math.abs(this.vel.y)) this.facing = this.vel.x >= 0 ? 'right' : 'left';
      else this.facing = this.vel.y >= 0 ? 'down' : 'up';
    }
    this.render();
  }

  private render(): void {
    const id = this.def.sprite;
    let lift = 0;
    if (this.pose === 'shoot') {
      this.sprite.anims.stop();
      this.sprite.setFrame(frameIndex(SHOOT_ROW, this.facing));
      lift = 3;
    } else if (this.pose === 'jump') {
      this.sprite.anims.stop();
      this.sprite.setFrame(frameIndex(JUMP_ROW, this.facing));
      lift = 6 * Math.sin(Math.min(1, this.poseTimer / 0.45) * Math.PI);
    } else if (this.isMoving()) {
      const key = ANIM.walk(id, this.facing);
      if (this.sprite.anims.currentAnim?.key !== key || !this.sprite.anims.isPlaying) this.sprite.play(key, true);
    } else {
      this.sprite.anims.stop();
      this.sprite.setFrame(frameIndex(0, this.facing));
    }
    this.sprite.setPosition(Math.round(this.pos.x), Math.round(this.pos.y - lift));
    this.sprite.setDepth(this.pos.y);
    this.disc.setPosition(this.pos.x, this.pos.y + 1);
    this.disc.setDepth(this.pos.y - 2);
    // 位置 + 号码写在圆盘下半部，不被精灵挡住
    this.label.setPosition(this.pos.x, this.pos.y + 4);
    this.label.setDepth(this.pos.y + 50);
    this.intentLabel.setPosition(this.pos.x, this.pos.y - 21 * this.bodyScale - lift);
    this.intentLabel.setDepth(this.pos.y + 50);
    this.intentLabel.setText(this.intent);
  }

  private showIntent = true;

  setShowIntent(show: boolean): void {
    this.showIntent = show;
    this.intentLabel.setVisible(show && this.onCourt);
  }

  /** 站位（换人后重新分配） */
  setSpot(spot: Role): void {
    this.spot = spot;
    this.slot = spotIndex(spot);
    this.label.setText(`${spot}.${this.def.number}`);
  }

  /** 设置体力并刷新实际能力值 */
  setStamina(v: number): void {
    this.stamina = v < 0 ? 0 : v > 100 ? 100 : v;
    const f = staminaFactor(this.stamina) * (this.injury ? INJURED_MUL : 1);
    const a = this.def.attrs;
    const e = this.eff;
    e.inside = a.inside * f;
    e.mid = a.mid * f;
    e.three = a.three * f;
    e.rebound = a.rebound * f;
    e.assist = a.assist * f;
    e.insideDef = a.insideDef * f;
    e.outsideDef = a.outsideDef * f;
    e.stability = a.stability * f;
  }

  /** 重伤 / 赛季报销：不能上场 */
  get out(): boolean {
    return this.injury === 'severe' || this.injury === 'season';
  }

  /** 上场 / 下场：替补席上的人隐藏 */
  setOnCourt(v: boolean): void {
    this.onCourt = v;
    this.sprite.setVisible(v);
    this.disc.setVisible(v);
    this.label.setVisible(v);
    this.intentLabel.setVisible(v && this.showIntent);
    if (!v) {
      this.vel = { x: 0, y: 0 };
      this.target = null;
      this.pose = 'normal';
      this.poseTimer = 0;
      this.driveTimer = 0;
      this.cutting = false;
      this.intent = '';
    }
  }

  /** 瞬移到某点（发球、半场重置） */
  teleport(p: Vec): void {
    this.pos = { ...p };
    this.vel = { x: 0, y: 0 };
    this.target = null;
  }

  // ---------- 回放快照 ----------
  snapshot(indexOf: (p: Player | null) => number): PlayerSnapshot {
    return {
      stats: { ...this.stats },
      pos: { ...this.pos },
      vel: { ...this.vel },
      facing: this.facing,
      target: this.target ? { ...this.target } : null,
      speedMul: this.speedMul,
      pose: this.pose,
      poseTimer: this.poseTimer,
      decideTimer: this.decideTimer,
      holdTime: this.holdTime,
      stealCooldown: this.stealCooldown,
      intent: this.intent,
      driveTimer: this.driveTimer,
      lastPassFrom: indexOf(this.lastPassFrom),
      floor: this.floor,
      boostAmount: this.boostAmount,
      boostUntil: this.boostUntil,
      cutTimer: this.cutTimer,
      cutting: this.cutting,
      spotVariant: this.spotVariant,
      jitter: { ...this.jitter },
      jitterTimer: this.jitterTimer,
      stamina: this.stamina,
      onCourt: this.onCourt,
      spot: this.spot,
      enteredAt: this.enteredAt,
      injury: this.injury,
      newInjury: this.newInjury ? { ...this.newInjury } : null,
      targetSec: this.targetSec,
    };
  }

  restore(s: PlayerSnapshot, players: Player[]): void {
    this.stats = { ...s.stats };
    this.pos = { ...s.pos };
    this.vel = { ...s.vel };
    this.facing = s.facing;
    this.target = s.target ? { ...s.target } : null;
    this.speedMul = s.speedMul;
    this.pose = s.pose;
    this.poseTimer = s.poseTimer;
    this.decideTimer = s.decideTimer;
    this.holdTime = s.holdTime;
    this.stealCooldown = s.stealCooldown;
    this.intent = s.intent;
    this.driveTimer = s.driveTimer;
    this.lastPassFrom = s.lastPassFrom < 0 ? null : players[s.lastPassFrom];
    this.floor = s.floor;
    this.boostAmount = s.boostAmount;
    this.boostUntil = s.boostUntil;
    this.cutTimer = s.cutTimer;
    this.cutting = s.cutting;
    this.spotVariant = s.spotVariant;
    this.jitter = { ...s.jitter };
    this.jitterTimer = s.jitterTimer;
    this.injury = s.injury;
    this.newInjury = s.newInjury ? { ...s.newInjury } : null;
    this.targetSec = s.targetSec;
    this.setStamina(s.stamina);
    this.setSpot(s.spot);
    this.enteredAt = s.enteredAt;
    this.setOnCourt(s.onCourt);
    this.render();
  }
}

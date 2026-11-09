import Phaser from 'phaser';
import type { PlayerDef, TeamDef, TeamId, Role } from '../data/players';
import { ANIM, JUMP_ROW, SHOOT_ROW, TEX, frameIndex, type Facing } from '../data/sprites';
import { textStyle } from '../ui/text';
import { clampToCourt, type Vec } from './court';

/** 球员姿态：正常 / 投篮出手（锁住移动）/ 起跳（封盖、争抢篮板） */
export type Pose = 'normal' | 'shoot' | 'jump';

/**
 * 球员本体：位置、移动、朝向和精灵渲染。
 * “做什么”由 ai.ts 决定，这里只负责“朝目标走”和把姿态画出来。
 */
export class Player {
  readonly def: PlayerDef;
  readonly team: TeamDef;
  readonly teamId: TeamId;
  readonly role: Role;
  /** 同队内编号 0~4（与站位、对位绑定） */
  readonly slot: number;

  pos: Vec;
  vel: Vec = { x: 0, y: 0 };
  facing: Facing = 'down';
  /** 目标点（null = 原地） */
  target: Vec | null = null;
  /** 速度倍率（持球时略慢） */
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
  /** 无球跑动：下一次空切倒计时 */
  cutTimer = 2 + Math.random() * 3;
  /** 正在空切 */
  cutting = false;
  /** 在站位附近的随机偏移 */
  jitter: Vec = { x: 0, y: 0 };
  jitterTimer = 0;

  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly intentLabel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, def: PlayerDef, team: TeamDef, slot: number, pos: Vec) {
    this.def = def;
    this.team = team;
    this.teamId = team.id;
    this.role = def.role;
    this.slot = slot;
    this.pos = { ...pos };
    this.ring = scene.add.graphics();
    this.ring.lineStyle(1.5, team.color, 0.95);
    this.ring.strokeEllipse(0, 0, 11, 6);
    this.ring.fillStyle(team.color, 0.18);
    this.ring.fillEllipse(0, 0, 11, 6);
    this.sprite = scene.add.sprite(pos.x, pos.y, TEX.char(def.sprite), frameIndex(0, 'down'));
    this.sprite.setOrigin(0.5, 0.85);
    this.label = scene.add.text(pos.x, pos.y, `${def.number}`, textStyle(6, team.colorCss)).setOrigin(0.5, 1);
    this.intentLabel = scene.add.text(pos.x, pos.y, '', textStyle(5, '#ffffff')).setOrigin(0.5, 1).setAlpha(0.85);
  }

  /** 基础速度（像素/秒）：能力 0.5 → 95，1.0 → 125 */
  get speed(): number {
    return (65 + this.def.attrs.speed * 60) * this.speedMul;
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
    this.ring.setPosition(this.pos.x, this.pos.y);
    this.ring.setDepth(this.pos.y - 2);
    this.label.setPosition(this.pos.x, this.pos.y - 15 - lift);
    this.label.setDepth(this.pos.y + 50);
    this.intentLabel.setPosition(this.pos.x, this.pos.y - 20 - lift);
    this.intentLabel.setDepth(this.pos.y + 50);
    this.intentLabel.setText(this.intent);
  }

  setShowIntent(show: boolean): void {
    this.intentLabel.setVisible(show);
  }

  /** 瞬移到某点（发球、节间重置） */
  teleport(p: Vec): void {
    this.pos = { ...p };
    this.vel = { x: 0, y: 0 };
    this.target = null;
  }
}

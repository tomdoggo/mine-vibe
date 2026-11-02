import Phaser from 'phaser';
import type { TeamId, UnitKind } from '../data/units';
import { TEX } from '../data/sprites';

/**
 * 箭矢：沿抛物线飞向瞄准点，不做飞行途中的碰撞，
 * 落到瞄准点高度时由 BattleScene 判定命中。
 */
export class Projectile extends Phaser.Physics.Arcade.Image {
  readonly team: TeamId;
  /** 射出这支箭的兵种，用于按方阵计分 */
  readonly kind: UnitKind;
  readonly damage: number;
  /** 瞄准点（落点） */
  readonly aimX: number;
  readonly aimY: number;
  /** 注定落空的箭，落地时不判定命中 */
  miss = false;
  life = 4000;

  constructor(scene: Phaser.Scene, x: number, y: number, team: TeamId, kind: UnitKind, damage: number, aimX: number, aimY: number) {
    super(scene, x, y, TEX.arrow);
    this.team = team;
    this.kind = kind;
    this.damage = damage;
    this.aimX = aimX;
    this.aimY = aimY;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(aimY + 50);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /** 已经下落并到达落点高度 */
  get landed(): boolean {
    return this.arcadeBody.velocity.y > 0 && this.y >= this.aimY;
  }
}

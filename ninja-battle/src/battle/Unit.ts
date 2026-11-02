import Phaser from 'phaser';
import { UNIT_STATS, type TeamId, type UnitKind, type UnitStats } from '../data/units';
import {
  ANIM,
  ATTACK_POSE_MS,
  DIR_RIGHT,
  HORSE_DY,
  TEX,
  UNIT_SPRITES,
  WEAPON_POSE,
  type UnitSprite,
} from '../data/sprites';
import { RULES } from '../data/rules';
import { FONT, GAME_WIDTH, RENDER_SCALE } from '../config';
import type { BattleScene } from '../scenes/BattleScene';
import { scaleAt } from './perspective';

/**
 * idle      站在原位
 * charging  沿自己这条线直线冲锋，线上没敌人就并到相邻的线（只有这个状态下近战/骑兵会造成伤害）
 * returning 折返回原位（不造成伤害）
 * fleeing   hp 过低溃逃：朝本方后方直线跑出屏幕，不还手、不听指令，跑出去后从场上移除
 * fled      已经跑出屏幕
 * dead      阵亡
 */
export type UnitState = 'idle' | 'charging' | 'returning' | 'fleeing' | 'fled' | 'dead';

/**
 * 单个士兵。本体是 Arcade Sprite，马和武器是跟随移动的挂件。
 * 行为由 BattleScene 按阶段下达（startCharge / startReturn），自己只负责执行。
 */
export class Unit extends Phaser.Physics.Arcade.Sprite {
  readonly team: TeamId;
  readonly kind: UnitKind;
  readonly stats: UnitStats;
  readonly look: UnitSprite;
  /** 前进方向：我方 +1（向右），敌方 -1（向左） */
  readonly dir: 1 | -1;
  /** 出发位置，返程时回到这里 */
  readonly home: { x: number; y: number };

  hp: number;
  maxHp: number;
  state: UnitState = 'idle';
  /** 本次冲锋已经对撞的次数 */
  clashCount = 0;

  /** 与每个敌人上一次对撞的时间（elapsed 毫秒），用于去重 */
  readonly lastClashAt = new Map<Unit, number>();

  private facing: 1 | -1;
  private speed = 0;
  /** 冲锋时超过这个 x 就算到了敌阵尾端 */
  private chargeLimitX = 0;
  /** 本次冲锋已持续的毫秒数，超过 RULES.maxChargeMs 折返 */
  private chargeTime = 0;
  /** 当前冲锋目标，只决定冲哪条线；死了或被甩到身后才换 */
  private chaseTarget: Unit | null = null;
  /** 当前正在冲的那条线的 y，用来判断换目标时有没有换线 */
  private laneY: number | null = null;
  /** 溃逃时下一滴汗的倒计时 */
  private sweatTimer = 0;
  /** 本次回撤的峰值速度和加速度 */
  private returnMaxSpeed = 0;
  private returnAccel = 0;
  private attackPoseTimer = 0;
  private readonly battle: BattleScene;

  private horse?: Phaser.GameObjects.Sprite;
  private weapon: Phaser.GameObjects.Image;
  /** 头上的 hp 数字（当前/上限）和右下角的攻击力区间 */
  private hpLabel: Phaser.GameObjects.Text;
  private atkLabel: Phaser.GameObjects.Text;

  constructor(scene: BattleScene, x: number, y: number, team: TeamId, kind: UnitKind) {
    const look = UNIT_SPRITES[team][kind];
    super(scene, x, y, TEX.walk(look.char), DIR_RIGHT);
    this.battle = scene;
    this.team = team;
    this.kind = kind;
    this.look = look;
    this.stats = UNIT_STATS[kind];
    this.dir = team === 'player' ? 1 : -1;
    this.facing = this.dir;
    this.home = { x, y };

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(scaleAt(y));

    this.maxHp = this.stats.hp;
    this.hp = this.maxHp;

    if (look.horse) {
      this.horse = scene.add.sprite(x, y + HORSE_DY, TEX.horse(look.horse), 0);
    }
    this.weapon = scene.add.image(x, y, TEX.weapon(look.weapon));
    // 阵列很密（行距 18 像素），数字做得很小并贴在人物身上，放大到手机屏幕后仍可读
    this.hpLabel = scene.add
      .text(x, y, '', { fontFamily: FONT, fontSize: '6px', color: '#ffffff' })
      .setOrigin(0, 1)
      .setStroke('#000000', 2)
      .setResolution(RENDER_SCALE);
    this.atkLabel = scene.add
      .text(x, y, `${this.stats.atk}`, { fontFamily: FONT, fontSize: '5px', color: '#ff5a4a' })
      .setOrigin(1, 0)
      .setStroke('#000000', 2)
      .setResolution(RENDER_SCALE);
    this.refreshHpLabel();

    this.arcadeBody.setSize(this.stats.width, this.stats.height, true);
    this.applyFacing();
    this.updateVisual(false);
  }

  get alive(): boolean {
    return this.state !== 'dead' && this.state !== 'fled';
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /**
   * 对撞时是否会还手：足轻和骑兵都是近战，冲锋中或站在原位被撞到都会还手；
   * 返程中不还手；弓兵永远只挨打。
   */
  get canDealDamage(): boolean {
    return this.kind !== 'ranged' && (this.state === 'charging' || this.state === 'idle');
  }

  // ---------- 阶段指令 ----------

  /** 开始冲锋，limitX 是敌阵尾端的 x */
  startCharge(limitX: number): void {
    if (!this.alive || this.state === 'fleeing') return;
    this.state = 'charging';
    this.clashCount = 0;
    this.chargeLimitX = limitX;
    this.chargeTime = 0;
    this.chaseTarget = null;
    this.laneY = null;
    this.speed = this.chargeRule.startSpeed;
    this.setFacing(this.dir);
  }

  /** 本兵种的冲锋速度参数 */
  private get chargeRule(): { startSpeed: number; maxSpeed: number; accel: number } {
    return this.kind === 'cavalry' ? RULES.cavalry : RULES.infantry;
  }

  /**
   * 折返回原位：逐渐加速，峰值速度按离原位的距离反推，保证大约 returnDuration 内到位。
   * 路程 = 加速段(梯形) + 匀速段：D = T·[ v0·f/2 + vmax·(1 - f/2) ]，解出 vmax。
   */
  startReturn(): void {
    if (!this.alive || this.state === 'returning' || this.state === 'fleeing') return;
    this.state = 'returning';
    const T = RULES.returnDuration / 1000;
    const f = RULES.returnAccelRatio;
    const v0 = RULES.returnStartSpeed;
    const dist = Math.hypot(this.home.x - this.x, this.home.y - this.y);
    const avg = Math.max(RULES.minReturnSpeed, dist / T);
    this.returnMaxSpeed = Math.max(v0, (avg - (v0 * f) / 2) / (1 - f / 2));
    this.returnAccel = (this.returnMaxSpeed - v0) / (T * f);
    this.speed = v0;
    this.setFacing(this.dir === 1 ? -1 : 1);
  }

  /** 被打溃：背对敌人往本方后方跑，边跑边淡出，淡完就从场上移除 */
  private startFlee(): void {
    this.state = 'fleeing';
    this.chaseTarget = null;
    this.sweatTimer = 0;
    this.setFacing(this.dir === 1 ? -1 : 1);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: RULES.flee.fadeMs,
      ease: 'Quad.In',
      onComplete: () => {
        if (this.state === 'fleeing') this.leaveField();
      },
    });
  }

  /** 头顶冒一滴汗：向后上方弹出再落下淡掉 */
  private emitSweat(): void {
    const scene = this.scene;
    if (!scene.textures.exists(TEX.sweat)) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x9fe3ff, 1);
      g.fillRect(1, 0, 1, 1);
      g.fillRect(0, 1, 3, 2);
      g.fillStyle(0xffffff, 1);
      g.fillRect(1, 1, 1, 1);
      g.generateTexture(TEX.sweat, 3, 3);
      g.destroy();
    }
    const s = this.scaleX;
    const back = -this.dir * 4 * s;
    const drop = scene.add
      .image(this.x + back, this.y - this.stats.height * s, TEX.sweat)
      .setScale(s)
      .setDepth(this.depth + 0.4)
      .setAlpha(this.alpha);
    scene.tweens.add({
      targets: drop,
      x: drop.x + back * 1.5,
      y: drop.y - 5 * s,
      duration: 160,
      ease: 'Quad.Out',
      yoyo: true,
      hold: 0,
      onYoyo: () => scene.tweens.add({ targets: drop, alpha: 0, duration: 160 }),
      onComplete: () => drop.destroy(),
    });
  }

  /** 由 BattleScene 在一次有效对撞后调用。只有冲锋中的单位计次，撞满上限折返 */
  registerClash(): void {
    this.attackPoseTimer = ATTACK_POSE_MS;
    if (this.state !== 'charging') return;
    this.clashCount++;
    const limit = this.kind === 'cavalry' ? RULES.cavalry.maxClashes : RULES.infantry.maxClashes;
    if (this.clashCount >= limit) this.startReturn();
  }

  /** 弓兵射击的出手动作 */
  playAttackPose(): void {
    this.attackPoseTimer = ATTACK_POSE_MS;
  }

  // ---------- 每帧 ----------

  tick(dt: number): void {
    if (!this.alive) return;
    const body = this.arcadeBody;
    this.setDepth(this.y);
    this.setScale(scaleAt(this.y));
    if (this.attackPoseTimer > 0) this.attackPoseTimer -= dt;

    switch (this.state) {
      case 'charging': {
        // 直线冲锋：横向全速前进，纵向慢慢并到目标所在的线上；
        // 目标优先自己这条线上的敌人，没有就相邻线，死了或被甩到身后才换；前方没有敌人、冲过敌阵尾端或超时都折返
        this.chargeTime += dt;
        const passed = this.dir > 0 ? this.x >= this.chargeLimitX : this.x <= this.chargeLimitX;
        const rule = this.chargeRule;
        const t = this.chaseTarget;
        if (!t || !t.alive || (t.x - this.x) * this.dir <= 0) {
          this.chaseTarget = this.battle.laneTarget(this);
          const newLane = this.chaseTarget ? this.chaseTarget.home.y : null;
          // 中途换到另一条线：速度掉一截再重新加速；第一次选线不算
          if (newLane !== null && this.laneY !== null && Math.abs(newLane - this.laneY) > 1) {
            this.speed = Math.max(rule.startSpeed, this.speed * RULES.laneChangeSpeedKeep);
          }
          this.laneY = newLane;
        }
        if (passed || this.chargeTime >= RULES.maxChargeMs || !this.chaseTarget) {
          this.startReturn();
          break;
        }
        this.speed = Math.min(rule.maxSpeed, this.speed + (rule.accel * dt) / 1000);
        const laneY = this.chaseTarget.home.y;
        const dy = laneY - this.y;
        const maxVy = this.speed * RULES.laneSteerRatio;
        // 这一帧能到线上就不要冲过头
        const vy = Math.abs(dy) < 0.5 ? 0 : Phaser.Math.Clamp((dy * 1000) / dt, -maxVy, maxVy);
        body.setVelocity(this.dir * this.speed, vy);
        this.setFacing(this.dir);
        this.updateVisual(true);
        break;
      }
      case 'returning': {
        const dx = this.home.x - this.x;
        const dy = this.home.y - this.y;
        const dist = Math.hypot(dx, dy);
        // 这一帧能走到或跨过原位就直接吸附，否则速度快时会在原位两侧来回抖
        const stepDist = (this.speed * dt) / 1000;
        if (dist <= Math.max(2, stepDist)) {
          this.setPosition(this.home.x, this.home.y);
          body.setVelocity(0, 0);
          this.state = 'idle';
          this.setFacing(this.dir);
          this.updateVisual(false);
        } else {
          this.speed = Math.min(this.returnMaxSpeed, this.speed + (this.returnAccel * dt) / 1000);
          body.setVelocity((dx / dist) * this.speed, (dy / dist) * this.speed);
          if (Math.abs(dx) > 1) this.setFacing(dx > 0 ? 1 : -1);
          this.updateVisual(true);
        }
        break;
      }
      case 'fleeing': {
        body.setVelocity(-this.dir * RULES.flee.speed, 0);
        this.updateVisual(true);
        this.sweatTimer -= dt;
        if (this.sweatTimer <= 0) {
          this.emitSweat();
          this.sweatTimer = RULES.flee.sweatInterval;
        }
        // 一般是淡出结束后消失；万一先跑出了屏幕也直接移除
        const margin = this.stats.width * 2;
        const out = this.dir === 1 ? this.x < -margin : this.x > GAME_WIDTH + margin;
        if (out) this.leaveField();
        break;
      }
      default:
        body.setVelocity(0, 0);
        this.updateVisual(false);
    }
  }

  /** 溃逃单位跑出屏幕：从场上移除，不算死也不算幸存 */
  private leaveField(): void {
    this.state = 'fled';
    this.scene.tweens.killTweensOf(this);
    this.arcadeBody.setVelocity(0, 0);
    this.arcadeBody.enable = false;
    this.battle.onUnitFled(this);
    this.weapon.destroy();
    this.hpLabel.destroy();
    this.atkLabel.destroy();
    this.horse?.destroy();
    this.horse = undefined;
    this.destroy();
  }

  // ---------- 伤害 ----------

  /** 攻击力 × 80%~120% 随机，向上取整 */
  rollDamage(): number {
    const v = RULES.atkVariance;
    return Math.ceil(this.stats.atk * Phaser.Math.FloatBetween(1 - v, 1 + v));
  }

  /** 直接扣血，没有防御。source / sourceKind 是造成伤害的一方及其方阵，用于计分 */
  takeDamage(dmg: number, source: TeamId, sourceKind: UnitKind): void {
    if (!this.alive) return;
    const dealt = Math.min(dmg, this.hp);
    this.hp -= dmg;
    this.refreshHpLabel();
    // 这一下打死了，或者打到溃逃线以下（只算第一次），都按击杀计给攻击方
    const killed = this.hp <= 0;
    const routed = !killed && this.hp < RULES.flee.hpBelow && this.state !== 'fleeing';
    this.battle.recordDamage(source, sourceKind, this, dealt, killed || routed);
    this.battle.showFloatingText(this.x, this.y - this.stats.height, `-${dmg}`, '#ffdd55');
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => {
      if (this.active) this.clearTint();
    });
    if (killed) this.die();
    else if (routed) this.startFlee();
  }

  // ---------- 渲染 ----------

  /** 头上一直显示剩余 hp：不足 10 红色，不足 20 黄色，其他绿色 */
  private refreshHpLabel(): void {
    const hp = Math.max(0, this.hp);
    const color = hp < 10 ? '#ff5a4a' : hp < 20 ? '#ffd84a' : '#6fe07a';
    this.hpLabel.setText(`${hp}`).setColor(color);
  }

  private setFacing(f: 1 | -1): void {
    if (f === this.facing) return;
    this.facing = f;
    this.applyFacing();
  }

  private applyFacing(): void {
    const left = this.facing < 0;
    this.setFlipX(left);
    this.horse?.setFlipX(left);
    this.weapon.setFlipX(left);
  }

  /** 根据状态切换行走动画 / 待机帧 / 攻击帧，并同步挂件 */
  private updateVisual(moving: boolean): void {
    const posing = this.attackPoseTimer > 0;
    if (posing) {
      if (this.anims.isPlaying) this.anims.stop();
      this.setTexture(TEX.attack(this.look.char), DIR_RIGHT);
    } else if (moving) {
      this.anims.play(ANIM.walk(this.look.char), true);
    } else {
      if (this.anims.isPlaying) this.anims.stop();
      this.setTexture(TEX.walk(this.look.char), DIR_RIGHT);
    }

    if (this.horse) {
      if (moving) this.horse.anims.play(ANIM.horseRun(this.look.horse!), true);
      else if (this.horse.anims.isPlaying) {
        this.horse.anims.stop();
        this.horse.setFrame(0);
      }
    }
    this.syncAttachments(posing);
  }

  private syncAttachments(posing: boolean): void {
    const pose = WEAPON_POSE[this.look.weapon];
    const f = this.facing;
    const s = this.scaleX;
    const angle = posing ? pose.attackAngle : pose.idleAngle;
    this.weapon
      .setPosition(this.x + pose.dx * s * f, this.y + pose.dy * s)
      .setAngle(angle * f)
      .setScale(s)
      .setDepth(this.depth + 0.2)
      .setAlpha(this.alpha);
    if (this.horse) {
      this.horse
        .setPosition(this.x, this.y + HORSE_DY * s)
        .setScale(s)
        .setDepth(this.depth + 0.1)
        .setAlpha(this.alpha);
    }
    // 数字不随透视缩放，只跟着位置走
    const halfH = (this.stats.height / 2) * s;
    const halfW = (this.stats.width / 2) * s;
    // 血量挂在右上角外侧，和左下角的攻击力关于人物中心对称
    this.hpLabel.setPosition(this.x + halfW - 3, this.y - halfH + 4).setDepth(this.depth + 0.3).setAlpha(this.alpha);
    // 攻击力挂在左下角外侧：右上角压在身体左下角内一点，数字大半露在人物外面
    this.atkLabel.setPosition(this.x - halfW + 3, this.y + halfH - 4).setDepth(this.depth + 0.3).setAlpha(this.alpha);
  }

  private die(): void {
    this.state = 'dead';
    this.hp = 0;
    this.arcadeBody.setVelocity(0, 0);
    this.arcadeBody.enable = false;
    this.battle.onUnitDied(this);

    if (this.anims.isPlaying) this.anims.stop();
    this.setTexture(TEX.dead(this.look.char));
    this.weapon.destroy();
    this.hpLabel.destroy();
    this.atkLabel.destroy();
    if (this.horse) {
      // 马跑掉
      const horse = this.horse;
      horse.anims.play(ANIM.horseRun(this.look.horse!), true);
      this.scene.tweens.add({
        targets: horse,
        x: horse.x - this.dir * 120,
        alpha: 0,
        duration: 1200,
        ease: 'Quad.In',
        onComplete: () => horse.destroy(),
      });
      this.horse = undefined;
    }
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      delay: 500,
      duration: 500,
      onComplete: () => this.destroy(),
    });
  }
}

import Phaser from 'phaser';
import { FIELD_BOTTOM, FIELD_TOP, GAME_HEIGHT, GAME_WIDTH, HORIZON_Y, SCENE } from '../config';
import {
  TEAM_NAME,
  UNIT_KINDS,
  adjacentKinds,
  TEAM_TEXT_COLOR,
  type BattleConfig,
  type BattleResult,
  type Composition,
  type TeamId,
  type TeamScore,
  type UnitKind,
  emptyScore,
  kindScoreLines,
  scoreTotal,
} from '../data/units';
import { RULES } from '../data/rules';
import { ANIM } from '../data/sprites';
import { Unit } from '../battle/Unit';
import { Projectile } from '../battle/Projectile';
import { formationSlots } from '../battle/formation';
import { FLAT_CENTER_Y } from '../battle/perspective';
import { makeButton, textStyle } from '../ui/Button';
import { applyLogicalView } from '../ui/view';

/**
 * 对战流程：
 *   deploy   布阵中：点中间的“开战”才开始
 *   opening  列阵停顿
 *   volley   弓兵原地齐射，固定射对方足轻队
 *   infantry 步兵冲锋，对撞 N 次或到敌阵尾端后折返
 *   cavalry  骑兵加速冲锋，到敌阵尾端后折返
 *   done     全员归位，结算
 */
type Phase = 'deploy' | 'opening' | 'volley' | 'infantry' | 'cavalry' | 'done';

const PHASE_LABEL: Record<Phase, string> = {
  deploy: '布阵中 · 点击开战',
  opening: '两军列阵',
  volley: '第一阶段 · 弓兵齐射',
  infantry: '第二阶段 · 足轻冲锋',
  cavalry: '第三阶段 · 骑兵冲锋',
  done: '战斗结束',
};

const TEAMS: TeamId[] = ['player', 'enemy'];

/** 操作区位置：屏幕左下角（x 是左边缘，y 是竖直中心） */
const foeOf = (t: TeamId): TeamId => (t === 'player' ? 'enemy' : 'player');

export class BattleScene extends Phaser.Scene {
  private battleConfig!: BattleConfig;
  private units: Record<TeamId, Unit[]> = { player: [], enemy: [] };
  private groups!: Record<TeamId, Phaser.Physics.Arcade.Group>;
  private projectiles: Projectile[] = [];
  private startCount: Record<TeamId, number> = { player: 0, enemy: 0 };
  /** 双方得分：伤害分与击杀分分开统计 */
  private score: Record<TeamId, TeamScore> = { player: emptyScore(), enemy: emptyScore() };
  /** 各方阵地的最尾端 x（含余量），对方冲到这里就折返 */
  private rearX: Record<TeamId, number> = { player: 0, enemy: 0 };
  /** 各方已经逃出屏幕的人数 */
  private fled: Record<TeamId, number> = { player: 0, enemy: 0 };

  private phase: Phase = 'deploy';
  private deployUI: Phaser.GameObjects.GameObject[] = [];
  /** 结算结果，战斗结束后才有；留给调试和后续流程用 */
  result?: BattleResult;
  /** 当前阶段的倒计时（开场等待 / 阶段结束后的停顿） */
  private phaseTimer = 0;
  /** 齐射轮次表：每一轮列出本轮开火的队伍 */
  private volleyRounds: TeamId[][] = [];
  private volleyRound = 0;
  private volleyTimer = 0;

  private hudText!: Record<TeamId, Phaser.GameObjects.Text>;
  /** 计分板下面三行方阵得分，字号比上面小一号 */
  private hudKinds!: Record<TeamId, Phaser.GameObjects.Text>;
  private phaseText!: Phaser.GameObjects.Text;

  private elapsed = 0;
  private ended = false;

  constructor() {
    super(SCENE.BATTLE);
  }

  init(data: BattleConfig): void {
    this.battleConfig = data;
    // Scene 实例会被复用，每次开战都要重置状态
    this.units = { player: [], enemy: [] };
    this.projectiles = [];
    this.startCount = { player: 0, enemy: 0 };
    this.score = { player: emptyScore(), enemy: emptyScore() };
    this.rearX = { player: 0, enemy: 0 };
    this.fled = { player: 0, enemy: 0 };
    this.phase = 'deploy';
    this.phaseTimer = RULES.openingDelay;
    this.deployUI = [];
    this.result = undefined;
    this.volleyRounds = [];
    this.volleyRound = 0;
    this.volleyTimer = 0;
    this.elapsed = 0;
    this.ended = false;
  }

  create(): void {
    applyLogicalView(this);
    this.drawBattlefield();

    this.physics.world.setBounds(0, FIELD_TOP - 20, GAME_WIDTH, FIELD_BOTTOM - FIELD_TOP + 40);

    this.groups = { player: this.physics.add.group(), enemy: this.physics.add.group() };
    this.deployArmy('player', this.battleConfig.player);
    this.deployArmy('enemy', this.battleConfig.enemy);

    // 敌我重叠即“对撞”；用 overlap 而不是 collider，双方互相穿过
    this.physics.add.overlap(this.groups.player, this.groups.enemy, (a, b) =>
      this.onClash(a as unknown as Unit, b as unknown as Unit),
    );

    this.createHud();
    this.createDeployUI();
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;
    const dt = delta;
    // 布阵阶段不计时
    if (this.phase !== 'deploy') this.elapsed += dt;

    for (const u of [...this.units.player]) u.tick(dt);
    for (const u of [...this.units.enemy]) u.tick(dt);
    this.tickProjectiles(dt);
    this.tickPhase(dt);

    this.updateHud();
  }

  // ---------- 部署 ----------

  private deployArmy(team: TeamId, comp: Composition): void {
    const slots = formationSlots(team, comp);
    for (const slot of slots) {
      const unit = new Unit(this, slot.x, slot.y, team, slot.kind);
      this.groups[team].add(unit);
      this.units[team].push(unit);
    }
    this.startCount[team] = this.units[team].length;
    const xs = slots.map((s) => s.x);
    // 我方在左，尾端是最小 x；敌方在右，尾端是最大 x
    this.rearX[team] =
      team === 'player' ? Math.min(...xs) - RULES.rearMargin : Math.max(...xs) + RULES.rearMargin;
  }

  // ---------- 布阵 ----------

  /** 开战前只有战场中间的开战按钮 */
  private createDeployUI(): void {
    const start = makeButton(this, GAME_WIDTH / 2, FLAT_CENTER_Y, 96, 30, '开 战', () => this.startBattle(), 16);
    start.container.setDepth(1002);
    start.bg.setFillStyle(0x8a3b2a).setStrokeStyle(2, 0xffe9a8);
    start.bg.on('pointerover', () => start.bg.setFillStyle(0xb0503a));
    start.bg.on('pointerout', () => start.bg.setFillStyle(0x8a3b2a));
    this.deployUI.push(start.container);
  }

  /** 点击开战：收起开战按钮，进入流程 */
  private startBattle(): void {
    if (this.phase !== 'deploy') return;
    for (const obj of this.deployUI) obj.destroy();
    this.deployUI = [];
    this.phaseTimer = RULES.openingDelay;
    this.enterPhase('opening');
    this.announce('合战开始!', '#ffffff');
  }

  // ---------- 阶段流程 ----------

  private tickPhase(dt: number): void {
    switch (this.phase) {
      case 'deploy':
        break;

      case 'opening':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.enterPhase('volley');
        break;

      case 'volley': {
        if (this.volleyRound < this.volleyRounds.length) {
          this.volleyTimer -= dt;
          // 第二轮起要等上一轮的箭全部落地
          const landed = this.volleyRound === 0 || this.projectiles.length === 0;
          if (this.volleyTimer <= 0 && landed) {
            for (const team of this.volleyRounds[this.volleyRound]) this.fireVolley(team);
            this.volleyRound++;
            this.volleyTimer = RULES.volley.interval;
          }
        } else if (this.projectiles.length === 0) {
          this.phaseTimer -= dt;
          if (this.phaseTimer <= 0) this.enterPhase('infantry');
        }
        break;
      }

      case 'infantry':
        // 所有步兵都不再冲锋（已折返或阵亡）后，进入骑兵阶段
        if (!this.anyCharging('melee')) {
          this.phaseTimer -= dt;
          if (this.phaseTimer <= 0) this.enterPhase('cavalry');
        }
        break;

      case 'cavalry':
        // 全员归位后结算
        if (this.allIdle()) {
          this.phaseTimer -= dt;
          if (this.phaseTimer <= 0) this.enterPhase('done');
        }
        break;

      case 'done':
        break;
    }
  }

  private enterPhase(p: Phase): void {
    this.phase = p;
    if (p !== 'opening') this.phaseTimer = RULES.phaseGap;
    this.phaseText.setText(PHASE_LABEL[p]);

    switch (p) {
      case 'volley':
        this.volleyRounds = Array.from({ length: RULES.volley.count }, () => [...TEAMS]);
        this.volleyRound = 0;
        this.volleyTimer = 0;
        this.announce(PHASE_LABEL[p], '#ffe9a8');
        break;
      case 'infantry':
        this.announce(PHASE_LABEL[p], '#ffe9a8');
        this.chargeAll('melee');
        break;
      case 'cavalry':
        this.announce(PHASE_LABEL[p], '#ffe9a8');
        this.chargeAll('cavalry');
        break;
      case 'done':
        this.finish(this.judgeWinner());
        break;
      case 'deploy':
      case 'opening':
        break;
    }
  }

  private chargeAll(kind: UnitKind): void {
    for (const team of TEAMS) {
      const limit = this.rearX[foeOf(team)];
      for (const u of this.units[team]) {
        if (u.kind === kind && u.alive) u.startCharge(limit);
      }
    }
  }

  private anyCharging(kind: UnitKind): boolean {
    return TEAMS.some((t) => this.units[t].some((u) => u.kind === kind && u.state === 'charging'));
  }

  private allIdle(): boolean {
    // 溃逃中的单位不听指令，不等它们
    return TEAMS.every((t) => this.units[t].every((u) => !u.alive || u.state === 'idle' || u.state === 'fleeing'));
  }

  // ---------- 齐射 ----------

  /**
   * 每个存活弓兵各射一箭，瞄准对方的固定目标方阵（RULES.volley.target）；
   * 每支箭有 driftChance 的概率偏到相邻方阵，missChance 的概率直接落空。
   */
  private fireVolley(team: TeamId): void {
    const foes = this.units[foeOf(team)].filter((u) => u.alive);
    if (foes.length === 0) return;
    for (const archer of this.units[team]) {
      if (archer.kind !== 'ranged' || !archer.alive) continue;
      const miss = Math.random() < RULES.volley.missChance;
      const target = this.pickArrowTarget(foes, RULES.volley.target);
      this.spawnArrow(archer, target, miss);
      archer.playAttackPose();
    }
  }

  /** 从 foes 里挑一个目标：先按概率决定是否偏到相邻方阵，再在该方阵里随机；方阵打空了就退到相邻方阵 */
  private pickArrowTarget(foes: Unit[], intended: UnitKind): Unit {
    let kind = intended;
    if (Math.random() < RULES.volley.driftChance) {
      kind = Phaser.Utils.Array.GetRandom(adjacentKinds(intended));
    }
    const candidates = [kind, ...adjacentKinds(kind), ...UNIT_KINDS];
    for (const k of candidates) {
      const pool = foes.filter((u) => u.kind === k);
      if (pool.length > 0) return Phaser.Utils.Array.GetRandom(pool);
    }
    return Phaser.Utils.Array.GetRandom(foes);
  }

  private spawnArrow(from: Unit, target: Unit, miss: boolean): void {
    const { scatterX, scatterY, arrowSpeed, arrowGravity, missOffset } = RULES.volley;
    let aimX = target.x + Phaser.Math.Between(-scatterX, scatterX);
    let aimY = target.y + Phaser.Math.Between(-scatterY, scatterY);
    if (miss) {
      // 落空的箭：明显偏离目标，前后左右随机一个方向
      aimX += Phaser.Math.Between(0, 1) ? missOffset : -missOffset;
      aimY += Phaser.Math.Between(-scatterY, scatterY);
    }
    const sx = from.x + from.dir * 5;
    const sy = from.y - 4;
    const dx = aimX - sx;
    const dy = aimY - sy;
    const t = (Math.hypot(dx, dy) || 1) / arrowSpeed;
    // 抛物线：水平匀速，竖直方向补偿重力
    const vx = dx / t;
    const vy = dy / t - 0.5 * arrowGravity * t;

    const p = new Projectile(this, sx, sy, from.team, from.kind, from.rollDamage(), aimX, aimY);
    p.miss = miss;
    this.projectiles.push(p);
    p.arcadeBody.setAllowGravity(true);
    p.arcadeBody.setGravityY(arrowGravity);
    p.arcadeBody.setVelocity(vx, vy);
  }

  private tickProjectiles(dt: number): void {
    for (const p of [...this.projectiles]) {
      p.life -= dt;
      const v = p.arcadeBody.velocity;
      p.setRotation(Math.atan2(v.y, v.x));
      if (p.landed || p.life <= 0) {
        this.resolveArrow(p);
        this.projectiles.splice(this.projectiles.indexOf(p), 1);
        p.destroy();
      }
    }
  }

  /** 箭落地：命中落点附近最近的敌人，否则插在地上淡出；miss 的箭一定落空 */
  private resolveArrow(p: Projectile): void {
    const foes = p.miss ? [] : this.units[foeOf(p.team)];
    let best: Unit | null = null;
    let bestDist: number = RULES.volley.hitRadius;
    for (const u of foes) {
      if (!u.alive) continue;
      const d = Phaser.Math.Distance.Between(p.aimX, p.aimY, u.x, u.y);
      if (d <= bestDist) {
        bestDist = d;
        best = u;
      }
    }
    if (best) {
      best.takeDamage(p.damage, p.team, p.kind);
      return;
    }
    const stuck = this.add.image(p.x, p.y, p.texture.key).setRotation(p.rotation).setDepth(p.aimY - 1);
    this.tweens.add({ targets: stuck, alpha: 0, delay: 600, duration: 500, onComplete: () => stuck.destroy() });
  }

  // ---------- 对撞 ----------

  private onClash(a: Unit, b: Unit): void {
    if (!a.alive || !b.alive) return;
    // 双方都不在冲锋状态就只是擦肩而过
    const aHits = a.canDealDamage;
    const bHits = b.canDealDamage;
    if (!aHits && !bHits) return;
    // 同一对单位短时间内只算一次对撞
    const last = a.lastClashAt.get(b) ?? Number.NEGATIVE_INFINITY;
    if (this.elapsed - last < RULES.clashCooldown) return;
    a.lastClashAt.set(b, this.elapsed);
    b.lastClashAt.set(a, this.elapsed);

    // 先算伤害再一起结算，避免先手打死对方后对方无法还击
    const dmgToB = aHits ? a.rollDamage() : 0;
    const dmgToA = bHits ? b.rollDamage() : 0;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    if (aHits) {
      b.takeDamage(dmgToB, a.team, a.kind);
      a.registerClash();
      this.playFx(ANIM.slash, mx, my - 2, { flipX: a.dir < 0, depth: my + 1 });
    }
    if (bHits) {
      a.takeDamage(dmgToA, b.team, b.kind);
      b.registerClash();
      this.playFx(ANIM.slash, mx, my - 2, { flipX: b.dir < 0, depth: my + 1 });
    }
    if (a.kind === 'cavalry' || b.kind === 'cavalry') {
      this.playFx(ANIM.smoke, mx, my + 4, { depth: my + 2 });
    }
  }

  // ---------- 由 Unit 回调 ----------

  /** 播放一次性特效动画，结束后自动销毁 */
  playFx(
    anim: string,
    x: number,
    y: number,
    opts: { scale?: number; flipX?: boolean; depth?: number } = {},
  ): Phaser.GameObjects.Sprite {
    const s = this.add
      .sprite(x, y, '')
      .setScale(opts.scale ?? 1)
      .setFlipX(opts.flipX ?? false)
      .setDepth(opts.depth ?? 850);
    s.play(anim);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }

  showFloatingText(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, textStyle(10, color)).setOrigin(0.5).setDepth(950);
    t.setStroke('#000000', 2);
    this.tweens.add({
      targets: t,
      y: y - 14,
      alpha: 0,
      duration: 650,
      ease: 'Quad.Out',
      onComplete: () => t.destroy(),
    });
  }

  /**
   * 冲锋目标：优先自己这条线（出发时的行）上前方的敌人，没有就看相邻的线，再没有就更远的线；
   * 同一条线上取离自己最近的。线按出发位置的 y 比较，差得越少越“同一条线”。没有任何前方敌人则 null。
   * 目标只决定往哪条线冲，途中撞到任何敌人都照常结算。
   */
  laneTarget(unit: Unit): Unit | null {
    let best: Unit | null = null;
    let bestLane = Number.POSITIVE_INFINITY;
    let bestAhead = Number.POSITIVE_INFINITY;
    for (const u of this.units[foeOf(unit.team)]) {
      if (!u.alive) continue;
      const ahead = (u.x - unit.x) * unit.dir;
      if (ahead <= 0) continue;
      const lane = Math.abs(u.home.y - unit.home.y);
      // 线差先比，差不到半个行距算同一条线，再比谁更近
      const sameLane = Math.abs(lane - bestLane) < 1;
      if (lane < bestLane - 1 || (sameLane && ahead < bestAhead)) {
        bestLane = lane;
        bestAhead = ahead;
        best = u;
      }
    }
    return best;
  }

  /** 溃逃单位跑出了屏幕：从队伍里移除，不算幸存（击杀分在打溃它的那一下已经记过） */
  onUnitFled(unit: Unit): void {
    const list = this.units[unit.team];
    const idx = list.indexOf(unit);
    if (idx >= 0) list.splice(idx, 1);
    this.fled[unit.team]++;
  }

  onUnitDied(unit: Unit): void {
    const list = this.units[unit.team];
    const idx = list.indexOf(unit);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** 由 Unit.takeDamage 调用：team 的 kind 方阵对 victim 造成了 dealt 点伤害，killed 表示这一下打死了它 */
  recordDamage(team: TeamId, kind: UnitKind, victim: Unit, dealt: number, killed: boolean): void {
    const s = this.score[team];
    s.damage += dealt;
    let gained = dealt;
    if (killed) {
      s.kills++;
      s.killScore += RULES.killScore[victim.kind];
      gained += RULES.killScore[victim.kind];
    }
    s.byKind[kind] += gained;
  }

  // ---------- 结算 ----------

  /** 总分（伤害分 + 击杀分）高者胜，相同为平局 */
  private judgeWinner(): BattleResult['winner'] {
    const p = scoreTotal(this.score.player);
    const e = scoreTotal(this.score.enemy);
    if (p === e) return 'draw';
    return p > e ? 'player' : 'enemy';
  }

  private finish(winner: BattleResult['winner']): void {
    if (this.ended) return;
    this.ended = true;
    for (const team of TEAMS) {
      for (const u of this.units[team]) u.arcadeBody.setVelocity(0, 0);
    }
    this.result = {
      winner,
      score: this.score,
      playerStart: this.startCount.player,
      playerAlive: this.units.player.length,
      enemyStart: this.startCount.enemy,
      enemyAlive: this.units.enemy.length,
      elapsedMs: this.elapsed,
      config: this.battleConfig,
    };
    // 停一下让最后一击看清楚，再在战场上直接盖出胜负
    this.time.delayedCall(900, () => this.showResultOverlay(winner));
  }

  /** 不切场景：战场中央盖一块半透明面板，只显示胜负、双方总分和再战按钮，明细计分板上已经有 */
  private showResultOverlay(winner: BattleResult['winner']): void {
    const cx = GAME_WIDTH / 2;
    const cy = FLAT_CENTER_Y;
    const title = winner === 'player' ? '胜  利' : winner === 'enemy' ? '败  北' : '平  局';
    const titleColor = winner === 'player' ? '#ffe9a8' : winner === 'enemy' ? '#ff8f7f' : '#ffffff';
    const p = scoreTotal(this.score.player);
    const e = scoreTotal(this.score.enemy);

    const panel = this.add.rectangle(cx, cy, 200, 96, 0x000000, 0.72).setStrokeStyle(1, 0xffe9a8, 0.8).setDepth(1100);
    const titleText = this.add.text(cx, cy - 30, title, textStyle(22, titleColor)).setOrigin(0.5).setDepth(1101);
    const colon = this.add.text(cx, cy - 4, ':', textStyle(14, '#ffffff')).setOrigin(0.5).setDepth(1101);
    const left = this.add
      .text(cx - 8, cy - 4, `${TEAM_NAME.player} ${p}`, textStyle(14, TEAM_TEXT_COLOR.player))
      .setOrigin(1, 0.5)
      .setDepth(1101);
    const right = this.add
      .text(cx + 8, cy - 4, `${e} ${TEAM_NAME.enemy}`, textStyle(14, TEAM_TEXT_COLOR.enemy))
      .setOrigin(0, 0.5)
      .setDepth(1101);
    for (const t of [titleText, colon, left, right]) t.setStroke('#000000', 2);

    const again = makeButton(this, cx, cy + 28, 110, 24, '再战一场', () => this.scene.restart(this.battleConfig), 12);
    again.container.setDepth(1102);

    const all = [panel, titleText, colon, left, right, again.container];
    for (const o of all) o.setAlpha(0);
    this.tweens.add({ targets: all, alpha: 1, duration: 350 });
  }

  // ---------- 绘制 ----------

  /** 天空 + 地平线 + 带透视感的草地（近处条纹宽、远处条纹窄且发白） */
  private drawBattlefield(): void {
    const g = this.add.graphics().setDepth(-10);
    const horizon = HORIZON_Y;

    const skyTop = Phaser.Display.Color.ValueToColor(0x4f7fb8);
    const skyBottom = Phaser.Display.Color.ValueToColor(0xb7dcee);
    const skyBands = 8;
    for (let i = 0; i < skyBands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(skyTop, skyBottom, skyBands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      const y0 = Math.floor((horizon * i) / skyBands);
      const y1 = Math.floor((horizon * (i + 1)) / skyBands);
      g.fillRect(0, y0, GAME_WIDTH, y1 - y0);
    }
    g.fillStyle(0xfff3c4, 1);
    g.fillCircle(540, 58, 14);
    this.drawCloud(g, 90, 50, 1);
    this.drawCloud(g, 300, 36, 1.3);
    this.drawCloud(g, 440, 78, 0.8);

    g.fillStyle(0x7f9bb6, 1);
    for (let x = -60; x < GAME_WIDTH + 60; x += 120) {
      g.fillTriangle(x, horizon, x + 75, horizon - 42, x + 150, horizon);
    }
    g.fillStyle(0x66849e, 1);
    for (let x = 10; x < GAME_WIDTH + 60; x += 140) {
      g.fillTriangle(x, horizon, x + 55, horizon - 24, x + 110, horizon);
    }
    g.fillStyle(0x4f7a3c, 1);
    for (let x = 0; x < GAME_WIDTH; x += 9) {
      const h = 3 + ((x * 7) % 5);
      g.fillRect(x, horizon - h, 6, h);
    }

    const near = Phaser.Display.Color.ValueToColor(0x5f8f3c);
    const nearAlt = Phaser.Display.Color.ValueToColor(0x6a9c45);
    const far = Phaser.Display.Color.ValueToColor(0x9fbf8a);
    let y = horizon;
    let i = 0;
    while (y < GAME_HEIGHT) {
      const h = Math.max(2, Math.round(2 + i * 1.6));
      const t = Phaser.Math.Clamp((y - horizon) / (GAME_HEIGHT - horizon), 0, 1);
      const base = i % 2 === 0 ? near : nearAlt;
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(far, base, 100, Math.round(Math.pow(t, 0.6) * 100));
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, y, GAME_WIDTH, h);
      y += h;
      i++;
    }

    g.fillStyle(0x8a7a55, 0.55);
    for (let yy = FIELD_TOP - 6; yy < GAME_HEIGHT; yy += 14) {
      const w = 1 + ((yy - horizon) / (GAME_HEIGHT - horizon)) * 3;
      g.fillRect(GAME_WIDTH / 2 - w / 2, yy, w, 7);
    }

  }

  private drawCloud(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(x, y, 34 * s, 8 * s);
    g.fillRect(x + 8 * s, y - 6 * s, 16 * s, 6 * s);
    g.fillRect(x + 4 * s, y + 8 * s, 26 * s, 3 * s);
  }


  private createHud(): void {
    this.hudText = {
      player: this.add.text(12, 8, '', textStyle(12, TEAM_TEXT_COLOR.player)).setDepth(1001),
      enemy: this.add.text(GAME_WIDTH - 12, 8, '', textStyle(12, TEAM_TEXT_COLOR.enemy)).setOrigin(1, 0).setAlign('right').setDepth(1001),
    };
    this.hudKinds = {
      player: this.add.text(12, 0, '', textStyle(9, TEAM_TEXT_COLOR.player)).setDepth(1001),
      enemy: this.add.text(GAME_WIDTH - 12, 0, '', textStyle(9, TEAM_TEXT_COLOR.enemy)).setOrigin(1, 0).setAlign('right').setDepth(1001),
    };
    this.phaseText = this.add
      .text(GAME_WIDTH / 2, 10, PHASE_LABEL[this.phase], textStyle(10, '#ffffff'))
      .setOrigin(0.5, 0)
      .setDepth(1001);
    for (const t of [...Object.values(this.hudText), ...Object.values(this.hudKinds), this.phaseText]) t.setStroke('#000000', 2);
  }

  private updateHud(): void {
    for (const team of TEAMS) {
      const s = this.score[team];
      const main = this.hudText[team];
      main.setText(
        `${TEAM_NAME[team]} ${this.units[team].length}/${this.startCount[team]}${this.fled[team] ? `  逃 ${this.fled[team]}` : ''}\n` +
          `伤害 ${s.damage}  击杀 ${s.kills}(${s.killScore})  总分 ${scoreTotal(s)}`,
      );
      this.hudKinds[team].setText(kindScoreLines(s).join('\n')).setY(main.y + main.height + 1);
    }
  }

  private announceText?: Phaser.GameObjects.Text;

  /** 屏幕中央的大字公告，同一时间只保留一条 */
  private announce(text: string, color: string): void {
    if (this.announceText) {
      this.tweens.killTweensOf(this.announceText);
      this.announceText.destroy();
    }
    const t = this.add
      .text(GAME_WIDTH / 2, 72, text, textStyle(16, color))
      .setOrigin(0.5)
      .setDepth(1100);
    this.announceText = t;
    t.setStroke('#000000', 3);
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: 62,
      delay: 900,
      duration: 500,
      onComplete: () => {
        t.destroy();
        if (this.announceText === t) this.announceText = undefined;
      },
    });
  }
}

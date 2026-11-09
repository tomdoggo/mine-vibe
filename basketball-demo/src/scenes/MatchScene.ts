import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SCENE } from '../config';
import { TEAMS } from '../data/players';
import { drawCourt } from '../sim/CourtView';
import { Match, type MatchEvent, type TeamStats } from '../sim/Match';
import { makeButton, textStyle, type UIButton } from '../ui/text';
import { applyLogicalView } from '../ui/view';

const SPEEDS = [0, 1, 2, 4] as const;

/**
 * 比赛场景：球场 + 记分牌 + 事件解说，驱动 Match 推进。
 * 顶部 52px 是记分牌区域，下面是整片球场。
 */
export class MatchScene extends Phaser.Scene {
  private match!: Match;
  private speed = 1;
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private shotClockText!: Phaser.GameObjects.Text;
  private logTexts: Phaser.GameObjects.Text[] = [];
  private speedButtons: UIButton[] = [];
  private showIntent = true;
  private endPanel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENE.MATCH);
  }

  create(): void {
    applyLogicalView(this);
    this.speed = 1;
    this.endPanel = null;
    this.logTexts = [];
    this.speedButtons = [];

    drawCourt(this);
    this.match = new Match(this);
    this.match.onEvent = (e) => this.handleEvent(e);
    for (const p of this.match.players) p.setShowIntent(this.showIntent);

    this.buildHud();
  }

  private buildHud(): void {
    // 记分牌背景
    this.add.rectangle(GAME_WIDTH / 2, 24, GAME_WIDTH, 48, 0x1e1e26).setDepth(1000);
    this.add.rectangle(GAME_WIDTH / 2, 48, GAME_WIDTH, 1, 0x3a3a48).setDepth(1000);

    this.scoreText = this.add.text(12, 6, '', textStyle(13)).setDepth(1001);
    this.clockText = this.add.text(12, 26, '', textStyle(9, '#cfcfd8')).setDepth(1001);
    this.shotClockText = this.add.text(165, 26, '', textStyle(9, '#ffd166')).setDepth(1001);

    // 事件解说：最近 3 条
    for (let i = 0; i < 3; i++) {
      const t = this.add
        .text(232, 5 + i * 13, '', textStyle(8, i === 2 ? '#ffffff' : '#9a9aa8'))
        .setDepth(1001)
        .setAlpha(i === 2 ? 1 : 0.8);
      this.logTexts.push(t);
    }

    // 速度控制
    const labels = ['暂停', '1x', '2x', '4x'];
    SPEEDS.forEach((sp, i) => {
      const b = makeButton(this, 480 + i * 34, 14, 30, 16, labels[i], () => this.setSpeed(sp), 8);
      b.container.setDepth(1002);
      this.speedButtons.push(b);
    });
    const intentBtn = makeButton(
      this,
      585,
      36,
      100,
      16,
      '显示意图：开',
      () => {
        this.showIntent = !this.showIntent;
        intentBtn.setLabel(`显示意图：${this.showIntent ? '开' : '关'}`);
        for (const p of this.match.players) p.setShowIntent(this.showIntent);
      },
      8,
    );
    intentBtn.container.setDepth(1002);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 1, '蓝队向右进攻，红队向左进攻；场上所有球员自主决策', textStyle(6, '#9a9aa8'))
      .setOrigin(0.5, 1)
      .setDepth(1001);
    this.setSpeed(1);
  }

  private setSpeed(sp: number): void {
    this.speed = sp;
    SPEEDS.forEach((s, i) => this.speedButtons[i].setActive(s === sp));
  }

  update(_time: number, deltaMs: number): void {
    // 单步最多 1/30 秒，避免切后台回来跳一大步
    const dt = Math.min(deltaMs / 1000, 1 / 30) * this.speed;
    if (dt > 0) {
      // 高倍速时拆成小步，保证决策与碰撞稳定
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < steps; i++) this.match.update(dt / steps);
    }
    this.refreshHud();
    if (this.match.phase === 'finished' && !this.endPanel) this.showEndPanel();
  }

  private refreshHud(): void {
    const m = this.match;
    const b = m.stats.blue.pts;
    const r = m.stats.red.pts;
    this.scoreText.setText(`${TEAMS.blue.name} ${b}  :  ${r} ${TEAMS.red.name}`);
    const poss = m.phase === 'play' || m.phase === 'inbound' ? `  球权：${TEAMS[m.possession].name}` : '';
    this.clockText.setText(`${m.clockText()}${poss}`);
    const sc = m.phase === 'play' ? Math.ceil(m.shotClock) : 24;
    this.shotClockText.setText(`24秒：${sc}`);
    const color = sc <= 5 ? '#ff6b6b' : '#ffd166';
    if (this.shotClockText.style.color !== color) this.shotClockText.setColor(color);
    const recent = m.log.slice(-3);
    for (let i = 0; i < 3; i++) this.logTexts[i].setText(recent[i] ?? '');
  }

  private handleEvent(e: MatchEvent): void {
    if (!e.float) return;
    const t = this.add
      .text(e.float.pos.x, e.float.pos.y - 14, e.float.text, textStyle(10, e.float.color))
      .setOrigin(0.5)
      .setDepth(2000)
      .setStroke('#000000', 2);
    this.tweens.add({
      targets: t,
      y: e.float.pos.y - 34,
      alpha: 0,
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  private showEndPanel(): void {
    const m = this.match;
    const w = 340;
    const h = 190;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2 + 20;
    const bg = this.add.rectangle(0, 0, w, h, 0x15151c, 0.94).setStrokeStyle(1, 0xdddddd);
    const title = this.add
      .text(0, -h / 2 + 12, `终场  ${TEAMS.blue.name} ${m.stats.blue.pts} : ${m.stats.red.pts} ${TEAMS.red.name}`, textStyle(13))
      .setOrigin(0.5, 0);
    const line = (st: TeamStats) =>
      `得分 ${st.pts}  投篮 ${st.fgm}/${st.fga} (${pct(st.fgm, st.fga)})  三分 ${st.tpm}/${st.tpa}\n` +
      `篮板 ${st.reb}  助攻 ${st.ast}  抢断 ${st.stl}  失误 ${st.tov}`;
    const blue = this.add.text(-w / 2 + 14, -h / 2 + 40, `${TEAMS.blue.name}\n${line(m.stats.blue)}`, {
      ...textStyle(8, TEAMS.blue.colorCss),
      lineSpacing: 3,
    });
    const red = this.add.text(-w / 2 + 14, -h / 2 + 92, `${TEAMS.red.name}\n${line(m.stats.red)}`, {
      ...textStyle(8, TEAMS.red.colorCss),
      lineSpacing: 3,
    });
    const btn = makeButton(this, 0, h / 2 - 20, 100, 20, '再来一场', () => this.scene.restart(), 10);
    this.endPanel = this.add.container(cx, cy, [bg, title, blue, red, btn.container]).setDepth(3000);
  }
}

function pct(m: number, a: number): string {
  return a === 0 ? '0%' : `${Math.round((m / a) * 100)}%`;
}

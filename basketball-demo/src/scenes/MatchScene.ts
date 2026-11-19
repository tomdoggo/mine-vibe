import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, LAYOUT, SCENE } from '../config';
import { Timeline } from '../replay/Timeline';
import { drawCourt } from '../sim/CourtView';
import { COURT, COURT_BOTTOM, COURT_RIGHT } from '../sim/court';
import { Match, STEP, type MatchEvent } from '../sim/Match';
import { randomSeed } from '../sim/rng';
import { createMatch, resultFromMatch, type Game } from '../season/Season';
import { seasonBridge } from '../season/bridge';
import { PlayerCard } from '../ui/PlayerCard';
import { ProgressBar } from '../ui/ProgressBar';
import { StatsChart } from '../ui/StatsChart';
import { StatsPanel } from '../ui/StatsPanel';
import { makeButton, textStyle, type UIButton } from '../ui/text';
import { applyLogicalView } from '../ui/view';

/** 播放速度循环：1x → 2x → 4x → 8x → 1x */
const SPEEDS = [1, 2, 4, 8] as const;
const DEFAULT_SPEED = 1;
const LOG_LINES = 8;
/** 快进（跳过全场 / 拖进度条定位）时每帧最多花的毫秒数 */
const FF_BUDGET_MS = 25;

/**
 * 比赛场景：顶部记分牌，左侧球场 + 进度条 + 事件日志，右侧数据面板。
 * 模拟按固定步长推进（可复现），进度条拖动 = 恢复最近的分钟快照再快算到目标时刻。
 */
export class MatchScene extends Phaser.Scene {
  private match!: Match;
  private timeline!: Timeline;
  private speed = DEFAULT_SPEED;
  /** 固定步长累加器 */
  private acc = 0;
  /** 快进目标比赛时间（秒）；Infinity = 跳到终场；null = 正常播放 */
  private seekTarget: number | null = null;
  /** 首次观看结束后解锁进度条 */
  private unlocked = false;
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private shotClockText!: Phaser.GameObjects.Text;
  private logTexts: Phaser.GameObjects.Text[] = [];
  private speedBtn!: UIButton;
  private skipBtn!: UIButton;
  private showIntent = true;
  private panel!: StatsPanel;
  private card!: PlayerCard;
  private chart!: StatsChart;
  private bar!: ProgressBar;
  private endPanel: Phaser.GameObjects.Container | null = null;
  /** 赛季比赛（从赛季总览进来的）；null = 友谊赛 */
  private seasonGame: Game | null = null;
  private reported = false;
  /** 正在飘的提示文字（定位时一并清掉） */
  private readonly floats = new Set<Phaser.GameObjects.Text>();

  constructor() {
    super(SCENE.MATCH);
  }

  create(): void {
    applyLogicalView(this);
    this.speed = DEFAULT_SPEED;
    this.acc = 0;
    this.seekTarget = null;
    this.unlocked = false;
    this.endPanel = null;
    this.logTexts = [];
    this.floats.clear();

    const data = this.scene.settings.data as { seed?: number; game?: Game } | undefined;
    this.seasonGame = data?.game ?? null;
    this.reported = false;
    const seed = this.seasonGame?.seed ?? data?.seed ?? randomSeed();

    drawCourt(this);
    this.match = this.seasonGame ? createMatch(this.seasonGame, this) : new Match(this, seed);
    this.match.onEvent = (e) => this.handleEvent(e);
    this.timeline = new Timeline(this.match);
    for (const p of this.match.players) p.setShowIntent(this.showIntent);

    this.buildHud(seed);
    this.buildLog();
    this.bar = new ProgressBar(this, COURT.left + 8, (COURT_BOTTOM + LAYOUT.logTop) / 2, COURT_RIGHT - COURT.left - 16, COURT_RIGHT - 8, LAYOUT.logTop + 5);
    this.bar.onSeek = (t) => this.seek(t);
    this.panel = new StatsPanel(this, this.match);
    this.card = new PlayerCard(this);
    this.chart = new StatsChart(this, this.match, this.timeline);
    this.panel.onPlayerClick = (p) => this.card.show(p);
  }

  private buildHud(seed: number): void {
    const h = LAYOUT.hudHeight;
    this.add.rectangle(GAME_WIDTH / 2, h / 2, GAME_WIDTH, h, 0x1e1e26).setDepth(1000);
    this.add.rectangle(GAME_WIDTH / 2, h, GAME_WIDTH, 1, 0x3a3a48).setDepth(1000);

    this.scoreText = this.add.text(16, 8, '', textStyle(17)).setDepth(1001);
    this.clockText = this.add.text(16, 34, '', textStyle(10, '#cfcfd8')).setDepth(1001);
    // 24 秒：紧贴球场上方正中
    this.shotClockText = this.add
      .text((COURT.left + COURT_RIGHT) / 2, COURT.top - 3, '', textStyle(10, '#ffd166'))
      .setOrigin(0.5, 1)
      .setDepth(1001);

    // 速度控制：一个按钮循环切换
    this.speedBtn = makeButton(this, 700, 20, 88, 20, '', () => this.cycleSpeed(), 9);
    this.speedBtn.container.setDepth(1002);
    this.add.text(700 - 44, 38, '点击切换播放速度', textStyle(7, '#8a8a98')).setDepth(1001);
    const chartBtn = makeButton(this, 804, 20, 64, 20, '统计图', () => this.chart.toggle(), 9);
    chartBtn.container.setDepth(1002);
    this.add.text(804, 44, `种子 ${seed}`, textStyle(7, '#6a6a78')).setOrigin(0.5).setDepth(1001);
    if (this.seasonGame) {
      const back = makeButton(this, 590, 20, 80, 20, '返回赛季', () => this.backToSeason(), 9);
      back.container.setDepth(1002);
    }
    this.skipBtn = makeButton(this, 896, 44, 104, 18, '跳过全场', () => this.startSkip(), 9);
    this.skipBtn.container.setDepth(1002);
    const intentBtn = makeButton(
      this,
      896,
      20,
      104,
      20,
      '显示意图：开',
      () => {
        this.showIntent = !this.showIntent;
        intentBtn.setLabel(`显示意图：${this.showIntent ? '开' : '关'}`);
        for (const p of this.match.players) p.setShowIntent(this.showIntent);
      },
      9,
    );
    intentBtn.container.setDepth(1002);
    this.setSpeed(DEFAULT_SPEED);
  }

  private buildLog(): void {
    const x = COURT.left;
    const w = COURT_RIGHT - COURT.left;
    const top = LAYOUT.logTop;
    const h = LAYOUT.logBottom - top;
    this.add.rectangle(x + w / 2, top + h / 2, w, h, 0x1b1b24, 0.96).setStrokeStyle(1, 0x3a3a48).setDepth(1000);
    this.add.text(x + 8, top + 5, '比赛进程', textStyle(9, '#8a8a98')).setDepth(1001);
    const lineH = (h - 22) / LOG_LINES;
    for (let i = 0; i < LOG_LINES; i++) {
      const t = this.add
        .text(x + 8, top + 19 + i * lineH, '', textStyle(8, i === LOG_LINES - 1 ? '#ffffff' : '#b0b0bc'))
        .setDepth(1001);
      this.logTexts.push(t);
    }
  }

  private setSpeed(sp: number): void {
    this.speed = sp;
    this.speedBtn.setLabel(`速度 ${sp}x`);
  }

  private cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }

  /** 跳过全场：分摊到多帧快进到终场，避免卡死界面 */
  private startSkip(): void {
    if (this.seekTarget !== null || this.match.phase === 'finished') return;
    this.beginFastForward(Infinity);
  }

  /** 拖动进度条定位：恢复最近的分钟快照，再快算到目标时刻 */
  private seek(t: number): void {
    if (!this.timeline.restoreFor(t)) return;
    for (const f of this.floats) f.destroy();
    this.floats.clear();
    if (this.endPanel) {
      this.endPanel.destroy(true);
      this.endPanel = null;
    }
    this.acc = 0;
    this.beginFastForward(t);
  }

  private beginFastForward(target: number): void {
    this.seekTarget = target;
    this.skipBtn.setLabel('快进中…');
    this.skipBtn.setActive(true);
  }

  private endFastForward(): void {
    this.seekTarget = null;
    this.skipBtn.setLabel('跳过全场');
    this.skipBtn.setActive(false);
  }

  update(_time: number, deltaMs: number): void {
    if (this.seekTarget !== null) {
      const start = performance.now();
      while (this.match.phase !== 'finished' && this.match.gameTime() < this.seekTarget && performance.now() - start < FF_BUDGET_MS) {
        this.match.update(STEP);
      }
      if (this.match.phase === 'finished' || this.match.gameTime() >= this.seekTarget) this.endFastForward();
      this.afterStep();
      return;
    }
    // 固定步长：单帧最多累计 1/30 秒（切后台回来不跳大步），高倍速就是一帧多走几步
    this.acc += Math.min(deltaMs / 1000, 1 / 30) * this.speed;
    while (this.acc >= STEP && this.match.phase !== 'finished') {
      this.match.update(STEP);
      this.acc -= STEP;
    }
    this.afterStep();
  }

  private afterStep(): void {
    this.refreshHud();
    this.panel.update();
    this.bar.setProgress(this.match.gameTime());
    this.chart.update();
    if (this.match.phase === 'finished') {
      this.timeline.recordFinal();
      // 赛季比赛：第一次打完就把结果交给赛季（回看已打过的比赛时赛季会忽略）
      if (this.seasonGame && !this.reported) {
        this.reported = true;
        seasonBridge.report(this.seasonGame.id, resultFromMatch(this.seasonGame, this.match));
      }
      if (!this.unlocked) {
        this.unlocked = true;
        this.bar.setLocked(false);
      }
      if (!this.endPanel) this.showEndPanel();
    }
  }

  private refreshHud(): void {
    const m = this.match;
    const b = m.score('blue');
    const r = m.score('red');
    const score = `${m.teams.blue.name} ${b}  :  ${r} ${m.teams.red.name}`;
    if (this.scoreText.text !== score) this.scoreText.setText(score);
    const clock = m.clockText();
    if (this.clockText.text !== clock) this.clockText.setText(clock);
    const sc = m.phase === 'play' ? Math.ceil(m.shotClock) : 24;
    const scText = `24秒：${sc}`;
    if (this.shotClockText.text !== scText) this.shotClockText.setText(scText);
    const color = sc <= 5 ? '#ff6b6b' : '#ffd166';
    if (this.shotClockText.style.color !== color) this.shotClockText.setColor(color);
    const recent = m.log.slice(-LOG_LINES);
    const offset = LOG_LINES - recent.length;
    for (let i = 0; i < LOG_LINES; i++) {
      const v = i < offset ? '' : recent[i - offset];
      if (this.logTexts[i].text !== v) this.logTexts[i].setText(v);
    }
  }

  private handleEvent(e: MatchEvent): void {
    if (!e.float || this.seekTarget !== null) return;
    const t = this.add
      .text(e.float.pos.x, e.float.pos.y - 14, e.float.text, textStyle(11, e.float.color))
      .setOrigin(0.5)
      .setDepth(2000)
      .setStroke('#000000', 2);
    this.floats.add(t);
    this.tweens.add({
      targets: t,
      y: e.float.pos.y - 34,
      alpha: 0,
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.floats.delete(t);
        t.destroy();
      },
    });
  }

  private showEndPanel(): void {
    const m = this.match;
    const w = 340;
    const h = 118;
    const cx = (COURT.left + COURT_RIGHT) / 2;
    const cy = GAME_HEIGHT / 2 - 30;
    const bg = this.add.rectangle(0, 0, w, h, 0x15151c, 0.94).setStrokeStyle(1, 0xdddddd);
    const title = this.add
      .text(0, -h / 2 + 14, `终场  ${m.teams.blue.name} ${m.score('blue')} : ${m.score('red')} ${m.teams.red.name}`, textStyle(15))
      .setOrigin(0.5, 0);
    const hint = this.add
      .text(0, -h / 2 + 42, '拖动下方进度条可回看任意时刻；点「统计图」看分钟走势', textStyle(8, '#9a9aa8'))
      .setOrigin(0.5, 0);
    const btn = this.seasonGame
      ? makeButton(this, 0, h / 2 - 22, 110, 22, '返回赛季', () => this.backToSeason(), 10)
      : makeButton(this, 0, h / 2 - 22, 110, 22, '再来一场', () => this.scene.restart({ seed: randomSeed() }), 10);
    this.endPanel = this.add.container(cx, cy, [bg, title, hint, btn.container]).setDepth(3000);
  }

  /** 回到赛季总览；没打完的比赛不记结果（之后可以重新观看或后台模拟，结果一样） */
  private backToSeason(): void {
    this.scene.stop();
    seasonBridge.exit();
  }
}

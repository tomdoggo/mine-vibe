import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import type { TeamId } from '../data/players';
import type { Timeline } from '../replay/Timeline';
import { MINUTES, type Match } from '../sim/Match';
import type { PlayerStats } from '../sim/Player';
import { makeButton, textStyle, type UIButton } from './text';

const W = 680;
const H = 420;
/** 绘图区（容器局部坐标） */
const PLOT = { left: -W / 2 + 52, right: W / 2 - 150, top: -H / 2 + 92, bottom: H / 2 - 34 };
const LEGEND_X = W / 2 - 138;

type View = 'team' | 'player';
type StatKey = keyof PlayerStats;

const STATS: { key: StatKey; label: string }[] = [
  { key: 'pts', label: '得分' },
  { key: 'reb', label: '篮板' },
  { key: 'ast', label: '助攻' },
  { key: 'stl', label: '抢断' },
  { key: 'blk', label: '盖帽' },
  { key: 'tov', label: '失误' },
  { key: 'pf', label: '犯规' },
  { key: 'fga', label: '出手' },
];

/** 球员视图五条线的配色 */
const PLAYER_COLORS = ['#ffd166', '#7ee0ff', '#ff8fa3', '#9bff9b', '#d9a7ff', '#ffb36b', '#6bffd9', '#c0c0ff', '#ff6bd6', '#e0e0a0'];

interface Series {
  label: string;
  color: string;
  /** 下标 = 分钟（0 ~ MINUTES），null = 还没播到 */
  values: (number | null)[];
}

/**
 * 分钟粒度的统计折线图：横轴比赛分钟，纵轴所选数据的累计值。
 * 两种视图：队伍（蓝 / 红两条线）、球员（某队五人各一条线）；点图例可以隐藏 / 显示某条线。
 * 数据来自 Timeline 每分钟的样本，比赛进行中也能看，播到哪画到哪。
 */
export class StatsChart {
  private readonly scene: Phaser.Scene;
  private readonly match: Match;
  private readonly timeline: Timeline;
  private container: Phaser.GameObjects.Container | null = null;
  private plot: Phaser.GameObjects.Container | null = null;
  private marker: Phaser.GameObjects.Graphics | null = null;
  private view: View = 'team';
  private team: TeamId = 'blue';
  private stat: StatKey = 'pts';
  /** 被隐藏的线（按视图分别记） */
  private readonly hidden: Record<View, Set<number>> = { team: new Set(), player: new Set() };
  private drawnVersion = -1;
  private markerMinute = -1;
  /** 图例数值对应的分钟 */
  private legendMinute = -1;
  private viewBtns: Partial<Record<View, UIButton>> = {};
  private teamBtns: Partial<Record<TeamId, UIButton>> = {};
  private statBtns: Partial<Record<StatKey, UIButton>> = {};

  constructor(scene: Phaser.Scene, match: Match, timeline: Timeline) {
    this.scene = scene;
    this.match = match;
    this.timeline = timeline;
  }

  get isOpen(): boolean {
    return this.container !== null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.show();
  }

  show(): void {
    this.close();
    const s = this.scene;
    const items: Phaser.GameObjects.GameObject[] = [];
    const mask = s.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.45).setInteractive();
    mask.on('pointerdown', () => this.close());
    items.push(mask);
    const bg = s.add.rectangle(0, 0, W, H, 0x15151c, 0.97).setStrokeStyle(1, 0x5a5a6a);
    bg.setInteractive();
    items.push(bg);
    const left = -W / 2 + 18;
    const top = -H / 2 + 12;
    items.push(s.add.text(left, top, '数据走势（按分钟）', textStyle(13, '#ffffff')));
    const close = makeButton(s, W / 2 - 34, top + 10, 52, 18, '关闭', () => this.close(), 9);
    items.push(close.container);

    // 第一行：视图切换 + 球员视图的球队切换
    const row1 = top + 36;
    items.push(s.add.text(left, row1 - 7, '视图', textStyle(8, '#8a8a98')));
    const mkView = (v: View, x: number, label: string) => {
      const b = makeButton(s, x, row1, 56, 18, label, () => this.setView(v), 9);
      this.viewBtns[v] = b;
      items.push(b.container);
    };
    mkView('team', left + 52, '队伍');
    mkView('player', left + 112, '球员');
    items.push(s.add.text(left + 160, row1 - 7, '球队', textStyle(8, '#8a8a98')));
    (['blue', 'red'] as const).forEach((t, i) => {
      const b = makeButton(s, left + 212 + i * 60, row1, 56, 18, this.match.teams[t].name, () => this.setTeam(t), 9);
      this.teamBtns[t] = b;
      items.push(b.container);
    });
    // 第二行：数据项
    const row2 = row1 + 26;
    items.push(s.add.text(left, row2 - 7, '数据', textStyle(8, '#8a8a98')));
    STATS.forEach((st, i) => {
      const b = makeButton(s, left + 52 + i * 50, row2, 46, 18, st.label, () => this.setStat(st.key), 9);
      this.statBtns[st.key] = b;
      items.push(b.container);
    });
    items.push(s.add.text(LEGEND_X, PLOT.top - 2, '图例（数值为当前时刻；点击隐藏 / 显示）', textStyle(8, '#8a8a98')));

    this.plot = s.add.container(0, 0);
    this.marker = s.add.graphics();
    items.push(this.plot, this.marker);
    this.container = s.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2, items).setDepth(5000);
    this.drawnVersion = -1;
    this.markerMinute = -1;
    this.syncButtons();
    this.update();
  }

  close(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
      this.plot = null;
      this.marker = null;
    }
  }

  private setView(v: View): void {
    this.view = v;
    this.drawnVersion = -1;
    this.syncButtons();
  }

  private setTeam(t: TeamId): void {
    this.team = t;
    if (this.view === 'team') this.view = 'player';
    this.drawnVersion = -1;
    this.syncButtons();
  }

  private setStat(k: StatKey): void {
    this.stat = k;
    this.drawnVersion = -1;
    this.syncButtons();
  }

  private syncButtons(): void {
    for (const [v, b] of Object.entries(this.viewBtns)) b?.setActive(v === this.view);
    for (const [t, b] of Object.entries(this.teamBtns)) b?.setActive(this.view === 'player' && t === this.team);
    for (const [k, b] of Object.entries(this.statBtns)) b?.setActive(k === this.stat);
  }

  /** 每帧由场景调用：数据有新样本或当前时间跨过分钟时重画 */
  update(): void {
    if (!this.container || !this.plot || !this.marker) return;
    if (this.drawnVersion !== this.timeline.version) {
      this.drawnVersion = this.timeline.version;
      this.redraw();
      this.markerMinute = -1;
    }
    const nowMin = this.match.gameTime() / 60;
    // 图例里的数值跟着当前时刻走：跨分钟时重画一次
    if (Math.floor(nowMin) !== this.legendMinute) this.redraw();
    const q = Math.round(nowMin * 20) / 20;
    if (q !== this.markerMinute) {
      this.markerMinute = q;
      this.marker.clear();
      const x = this.xAt(nowMin);
      this.marker.lineStyle(1, 0xffffff, 0.35);
      this.marker.lineBetween(x, PLOT.top, x, PLOT.bottom);
    }
  }

  private xAt(minute: number): number {
    return PLOT.left + ((PLOT.right - PLOT.left) * minute) / MINUTES;
  }

  private buildSeries(): Series[] {
    const samples = this.timeline.samples;
    const players = this.match.roster;
    const at = (m: number, idxs: number[]): number | null => {
      const row = samples[m];
      if (!row) return null;
      let v = 0;
      for (const i of idxs) v += row[i][this.stat];
      return v;
    };
    const minutes = Array.from({ length: MINUTES + 1 }, (_, m) => m);
    if (this.view === 'team') {
      return (['blue', 'red'] as const).map((t) => {
        const idxs = players.map((p, i) => (p.teamId === t ? i : -1)).filter((i) => i >= 0);
        return { label: this.match.teams[t].name, color: this.match.teams[t].colorCss, values: minutes.map((m) => at(m, idxs)) };
      });
    }
    return players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.teamId === this.team)
      .map(({ p, i }, n) => ({
        label: `#${p.def.number} ${p.def.short ?? p.def.name}`,
        color: PLAYER_COLORS[n % PLAYER_COLORS.length],
        values: minutes.map((m) => at(m, [i])),
      }));
  }

  private redraw(): void {
    const plot = this.plot;
    if (!plot) return;
    const s = this.scene;
    plot.removeAll(true);
    const series = this.buildSeries();
    const hidden = this.hidden[this.view];
    this.legendMinute = Math.floor(this.match.gameTime() / 60);

    // 纵轴范围：可见线的最大值，向上取整到好看的刻度
    let max = 0;
    series.forEach((se, i) => {
      if (hidden.has(i)) return;
      for (const v of se.values) if (v !== null && v > max) max = v;
    });
    const step = niceStep(Math.max(max, 4) / 4);
    const yMax = Math.max(step, Math.ceil(Math.max(max, 1) / step) * step);
    const yAt = (v: number) => PLOT.bottom - ((PLOT.bottom - PLOT.top) * v) / yMax;

    const g = s.add.graphics();
    plot.add(g);
    // 网格与纵轴刻度
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      const y = yAt(v);
      g.lineStyle(1, v === 0 ? 0x5a5a6a : 0x2a2a36, 1);
      g.lineBetween(PLOT.left, y, PLOT.right, y);
      plot.add(s.add.text(PLOT.left - 6, y, `${Math.round(v)}`, textStyle(8, '#8a8a98')).setOrigin(1, 0.5));
    }
    // 横轴：每 5 分钟一个刻度，半场一道竖线
    for (let m = 0; m <= MINUTES; m += 5) {
      const x = this.xAt(m);
      g.lineStyle(1, m === MINUTES / 2 ? 0x5a5a6a : 0x2a2a36, 1);
      g.lineBetween(x, PLOT.top, x, PLOT.bottom);
      plot.add(s.add.text(x, PLOT.bottom + 4, `${m}`, textStyle(8, '#8a8a98')).setOrigin(0.5, 0));
    }
    plot.add(s.add.text(PLOT.left, PLOT.bottom + 16, '上半场', textStyle(8, '#6a6a78')));
    plot.add(s.add.text(this.xAt(MINUTES / 2) + 4, PLOT.bottom + 16, '下半场', textStyle(8, '#6a6a78')));
    plot.add(s.add.text(PLOT.right, PLOT.bottom + 16, '分钟', textStyle(8, '#6a6a78')).setOrigin(1, 0));
    const statLabel = STATS.find((x) => x.key === this.stat)?.label ?? this.stat;
    plot.add(s.add.text(PLOT.left, PLOT.top - 12, `${statLabel}（累计）`, textStyle(8, '#cfcfd8')).setOrigin(0, 1));

    // 折线
    series.forEach((se, i) => {
      if (hidden.has(i)) return;
      const color = Phaser.Display.Color.HexStringToColor(se.color).color;
      g.lineStyle(2, color, 1);
      let started = false;
      se.values.forEach((v, m) => {
        if (v === null) return;
        const x = this.xAt(m);
        const y = yAt(v);
        if (!started) {
          g.beginPath();
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      });
      if (started) g.strokePath();
      g.fillStyle(color, 1);
      se.values.forEach((v, m) => {
        if (v !== null) g.fillCircle(this.xAt(m), yAt(v), 2);
      });
    });

    // 图例：颜色块 + 名称 + 当前时刻所在分钟的值；点击切换显示
    series.forEach((se, i) => {
      const y = PLOT.top + 14 + i * 20;
      const off = hidden.has(i);
      const swatch = s.add.rectangle(LEGEND_X + 6, y, 12, 12, Phaser.Display.Color.HexStringToColor(se.color).color, off ? 0.25 : 1);
      let m = Math.min(MINUTES, this.legendMinute);
      while (m > 0 && se.values[m] === null) m--;
      const cur = se.values[m];
      const label = s.add.text(LEGEND_X + 16, y, `${se.label}  ${cur ?? '-'}`, textStyle(9, off ? '#6a6a78' : '#e8e8f0')).setOrigin(0, 0.5);
      const hit = s.add.zone(LEGEND_X + 60, y, 130, 18).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        if (hidden.has(i)) hidden.delete(i);
        else hidden.add(i);
        this.drawnVersion = -1;
      });
      plot.add([swatch, label, hit]);
    });
  }
}

/** 1 / 2 / 5 × 10^n 的好看刻度 */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
  return m * p;
}

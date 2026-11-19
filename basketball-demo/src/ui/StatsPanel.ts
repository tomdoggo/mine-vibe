import Phaser from 'phaser';
import { LAYOUT } from '../config';
import type { TeamId } from '../data/players';
import type { Match } from '../sim/Match';
import type { Player, PlayerStats } from '../sim/Player';
import { FLOOR_GRADE_SYMBOL, floorGrade } from '../sim/attrs';
import { makeButton, textStyle } from './text';

/** 投篮类列的显示模式：百分比（两位小数）或 命中/出手 */
type ShotMode = 'pct' | 'ratio';

interface Column {
  key: string;
  width: number;
  value: (s: PlayerStats, mode: ShotMode) => string;
}

const shot = (m: number, a: number, mode: ShotMode) =>
  mode === 'ratio' ? `${m}/${a}` : a === 0 ? '-' : `${((m / a) * 100).toFixed(1)}%`;
const minutes = (sec: number) => `${Math.floor(sec / 60)}`;

/** 出场时间 / 投篮 / 三分 / 罚球 / 得分 / 篮板 / 助攻 / 抄截 / 盖帽 / 失误 / 犯规；球员行与全队行共用 */
const COLUMNS: Column[] = [
  { key: 'MIN', width: 22, value: (s) => minutes(s.sec) },
  { key: 'FG', width: 35, value: (s, mode) => shot(s.fgm, s.fga, mode) },
  { key: '3P', width: 35, value: (s, mode) => shot(s.tpm, s.tpa, mode) },
  { key: 'FT', width: 35, value: (s, mode) => shot(s.ftm, s.fta, mode) },
  { key: 'PTS', width: 25, value: (s) => `${s.pts}` },
  { key: 'REB', width: 25, value: (s) => `${s.reb}` },
  { key: 'AST', width: 25, value: (s) => `${s.ast}` },
  { key: 'STL', width: 25, value: (s) => `${s.stl}` },
  { key: 'BLK', width: 25, value: (s) => `${s.blk}` },
  { key: 'TOV', width: 25, value: (s) => `${s.tov}` },
  { key: 'PF', width: 22, value: (s) => `${s.pf}` },
];

/** 行高：十人名单时压缩 */
const rowHeight = (n: number) => (n > 5 ? 15 : 17);

interface Row {
  /** 球员行；全队行为 null */
  player: Player | null;
  teamId: TeamId;
  bg: Phaser.GameObjects.Rectangle;
  /** 编号左侧的状态符号；全队行为 null */
  mark: Phaser.GameObjects.Text | null;
  name: Phaser.GameObjects.Text | null;
  cells: Phaser.GameObjects.Text[];
}

/**
 * 右侧数据面板：两队各一张表，第一行是以队名标识的全队合计，下面五行球员，列完全对齐；点球员名打开球员卡。
 */
export class StatsPanel {
  private readonly match: Match;
  private readonly container: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];
  private mode: ShotMode = 'pct';
  /** 名字下方的体力条 */
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly barSpots: { p: Player; x: number; y: number }[] = [];
  onPlayerClick: (p: Player) => void = () => {};

  constructor(scene: Phaser.Scene, match: Match) {
    this.match = match;
    const x = LAYOUT.panelX;
    const y = LAYOUT.panelTop;
    const w = LAYOUT.panelWidth;
    const h = LAYOUT.panelBottom - LAYOUT.panelTop;
    this.container = scene.add.container(0, 0).setDepth(1500);
    this.container.add(scene.add.rectangle(x + w / 2, y + h / 2, w, h, 0x1b1b24, 0.96).setStrokeStyle(1, 0x3a3a48));
    this.container.add(scene.add.text(x + 10, y + 8, '球员数据', textStyle(11, '#ffffff')));
    // 切换投篮列的显示方式
    const toggle = makeButton(scene, x + w - 56, y + 16, 96, 18, '显示：命中率', () => {
      this.mode = this.mode === 'pct' ? 'ratio' : 'pct';
      toggle.setLabel(this.mode === 'pct' ? '显示：命中率' : '显示：命中/出手');
      this.update();
    }, 8);
    this.container.add(toggle.container);

    // 列从右往左排，算出每列右边界
    const rights: number[] = [];
    let right = x + w - 10;
    for (let i = COLUMNS.length - 1; i >= 0; i--) {
      rights[i] = right;
      right -= COLUMNS[i].width;
    }

    let cy = y + 32;
    const ROW_H = rowHeight(match.teamRoster('blue').length);
    for (const teamId of ['blue', 'red'] as const) {
      const team = match.teams[teamId];
      // 列标题
      this.container.add(scene.add.text(x + 10, cy, '球员', textStyle(8, '#8a8a98')));
      COLUMNS.forEach((c, i) => this.container.add(scene.add.text(rights[i], cy, c.key, textStyle(8, '#8a8a98')).setOrigin(1, 0)));
      cy += 14;
      // 第一行：全队合计，用队名标识
      const totalBg = scene.add.rectangle(x + w / 2, cy + ROW_H / 2 - 1, w - 12, ROW_H - 1, team.color, 0.12);
      this.container.add(totalBg);
      this.container.add(scene.add.text(x + 10, cy, team.name, textStyle(8, team.colorCss)));
      this.rows.push({ player: null, teamId, bg: totalBg, mark: null, name: null, cells: this.makeCells(scene, rights, cy, team.colorCss) });
      cy += ROW_H;
      this.container.add(scene.add.rectangle(x + w / 2, cy - 1, w - 12, 1, 0x3a3a48));
      // 球员行
      for (const p of match.teamRoster(teamId)) {
        const bg = scene.add.rectangle(x + w / 2, cy + ROW_H / 2 - 1, w - 12, ROW_H - 1, team.color, 0);
        this.container.add(bg);
        // 状态符号（不佳 △ / 普通 ○ / 极佳 ◎）放在编号左侧，每半场掷下限后刷新
        const mark = scene.add.text(x + 10, cy, '', textStyle(8, '#9a9aa8'));
        this.container.add(mark);
        // 十人名单时只写简称（不带号码），名字下方是体力条；替补席上的人名字变暗
        const label = match.roster.length > 10 ? p.def.short ?? p.def.name : `${p.def.number} ${p.def.name}`;
        const name = scene.add.text(x + 22, cy, label, textStyle(match.roster.length > 10 ? 7.5 : 8, '#e8e8f0'));
        name.setInteractive({ useHandCursor: true });
        name.on('pointerover', () => name.setColor('#ffd166'));
        name.on('pointerout', () => this.paintName(p, name));
        name.on('pointerdown', () => this.onPlayerClick(p));
        this.container.add(name);
        if (match.fatigue) this.barSpots.push({ p, x: x + 22, y: cy + ROW_H - 3 });
        this.rows.push({ player: p, teamId, bg, mark, name, cells: this.makeCells(scene, rights, cy, '#e8e8f0') });
        cy += ROW_H;
      }
      cy += ROW_H > 15 ? 18 : 8;
    }
    this.bars = scene.add.graphics();
    this.container.add(this.bars);
    if (match.fatigue) {
      this.container.add(scene.add.text(x + 10, y + 22, '名字下横条 = 体力（黄 <80 能力开始下降，红 <50）；名字变暗 = 替补席，红 = 受伤', textStyle(6.5, '#6a6a78')));
    }
  }

  private paintName(p: Player, t: Phaser.GameObjects.Text): void {
    // 受伤：红色（重伤 / 报销更暗）
    if (p.injury) t.setColor(p.out ? '#9a5050' : '#ff8a8a');
    else t.setColor(p.onCourt ? '#e8e8f0' : '#7a7a88');
  }

  private makeCells(scene: Phaser.Scene, rights: number[], cy: number, color: string): Phaser.GameObjects.Text[] {
    return COLUMNS.map((_, i) => {
      const t = scene.add.text(rights[i], cy, '', textStyle(8, color)).setOrigin(1, 0);
      this.container.add(t);
      return t;
    });
  }

  update(): void {
    const holder = this.match.ball.holder;
    for (const row of this.rows) {
      const s = row.player ? row.player.stats : this.match.teamStats(row.teamId);
      row.cells.forEach((t, i) => {
        const v = COLUMNS[i].value(s, this.mode);
        if (t.text !== v) t.setText(v);
      });
      if (row.player) {
        row.bg.setFillStyle(row.player.team.color, holder === row.player ? 0.28 : 0);
        const sym = row.player.onCourt ? FLOOR_GRADE_SYMBOL[floorGrade(row.player.floor)] : '';
        if (row.mark && row.mark.text !== sym) row.mark.setText(sym);
        if (row.name && row.name.style.color !== '#ffd166') this.paintName(row.player, row.name);
      }
    }
    this.bars.clear();
    for (const b of this.barSpots) {
      const st = b.p.stamina;
      this.bars.fillStyle(0x2a2a36, 1);
      this.bars.fillRect(b.x, b.y, 22, 1.5);
      this.bars.fillStyle(st >= 80 ? 0x7ed957 : st >= 50 ? 0xffd166 : 0xff6b6b, 1);
      this.bars.fillRect(b.x, b.y, (22 * st) / 100, 1.5);
    }
  }
}

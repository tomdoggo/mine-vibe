import Phaser from 'phaser';
import { HALF_SEC, MINUTES } from '../sim/Match';
import { textStyle } from './text';

const TRACK_H = 6;
const HIT_H = 18;

/** 比赛时间（秒）→ "上半场 12:34" */
export function formatGameTime(t: number): string {
  const total = MINUTES * 60;
  const tt = Math.max(0, Math.min(total, t));
  const half = tt < HALF_SEC ? 1 : 2;
  const remain = Math.max(0, Math.ceil(HALF_SEC - (tt - (half - 1) * HALF_SEC)));
  const mm = Math.floor(remain / 60);
  const ss = remain % 60;
  return `${half === 1 ? '上半场' : '下半场'} ${mm}:${ss.toString().padStart(2, '0')}`;
}

/**
 * 球场下方的比赛进度条：按比赛时间走（钟停着时不动）。
 * 首次观看时锁定、只能看；终场后解锁，拖动或点击任意位置回看。
 */
export class ProgressBar {
  onSeek: (t: number) => void = () => {};
  private readonly x: number;
  private readonly w: number;
  private readonly total = MINUTES * 60;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly knob: Phaser.GameObjects.Arc;
  private readonly tip: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private locked = true;
  private dragging = false;
  private progress = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, hintX: number, hintY: number) {
    this.x = x;
    this.w = w;
    const depth = 1200;
    scene.add.rectangle(x + w / 2, y, w, TRACK_H, 0x2a2a36, 1).setDepth(depth);
    this.fill = scene.add.rectangle(x, y, 0, TRACK_H, 0x5ea0ff, 1).setOrigin(0, 0.5).setDepth(depth + 1);
    // 刻度：每 5 分钟一格，半场处一道亮线
    const ticks = scene.add.graphics().setDepth(depth + 2);
    for (let m = 5; m < MINUTES; m += 5) {
      const tx = x + (w * m) / MINUTES;
      const isHalf = m === MINUTES / 2;
      ticks.lineStyle(1, isHalf ? 0xdddddd : 0x4a4a58, 1);
      ticks.lineBetween(tx, y - (isHalf ? 6 : 3), tx, y + (isHalf ? 6 : 3));
    }
    this.knob = scene.add.circle(x, y, 5, 0xffffff, 1).setDepth(depth + 3);
    this.tip = scene.add.text(x, y - 9, '', textStyle(8, '#ffffff')).setOrigin(0.5, 1).setDepth(depth + 4).setVisible(false);
    this.hint = scene.add.text(hintX, hintY, '', textStyle(8, '#6a6a78')).setOrigin(1, 0).setDepth(depth + 4);
    this.zone = scene.add.zone(x + w / 2, y, w + 12, HIT_H).setInteractive({ useHandCursor: true });
    this.zone.setDepth(depth + 5);
    this.zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.locked) return;
      this.dragging = true;
      this.preview(p.worldX);
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging) this.preview(p.worldX);
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.tip.setVisible(false);
      this.onSeek(this.timeAt(p.worldX));
    });
    this.setLocked(true);
  }

  private timeAt(worldX: number): number {
    const r = Math.max(0, Math.min(1, (worldX - this.x) / this.w));
    return r * this.total;
  }

  private place(t: number): void {
    const r = Math.max(0, Math.min(1, t / this.total));
    this.fill.width = this.w * r;
    this.knob.x = this.x + this.w * r;
    this.tip.x = this.knob.x;
  }

  private preview(worldX: number): void {
    const t = this.timeAt(worldX);
    this.place(t);
    this.tip.setText(formatGameTime(t)).setVisible(true);
  }

  /** 每帧由场景调用：拖动中不跟随比赛 */
  setProgress(t: number): void {
    // 加时：进度条只画常规时间，停在最右端
    t = Math.min(t, this.total);
    this.progress = t;
    if (!this.dragging) this.place(t);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.dragging = false;
    this.tip.setVisible(false);
    this.knob.setFillStyle(locked ? 0x9a9aa8 : 0xffffff);
    this.hint.setText(locked ? '首次观看不能拖动进度条，终场后可回看' : '拖动进度条回看任意时刻');
    if (locked) this.zone.disableInteractive();
    else this.zone.setInteractive({ useHandCursor: true });
    this.place(this.progress);
  }
}

import Phaser from 'phaser';
import { BALL_SCALE, TEX } from '../data/sprites';
import { COURT, COURT_BOTTOM, COURT_RIGHT, type Vec } from './court';
import type { Player } from './Player';

export type BallState =
  | { kind: 'held'; holder: Player }
  | { kind: 'pass'; from: Player; to: Player; start: Vec; end: Vec; t: number; duration: number; peak: number }
  | {
      kind: 'shot';
      shooter: Player;
      start: Vec;
      end: Vec;
      t: number;
      duration: number;
      peak: number;
      willScore: boolean;
      points: 1 | 2 | 3;
    }
  | {
      kind: 'loose';
      vel: Vec;
      /** 刚弹出来的一小段时间谁都拿不到（模拟弹框） */
      grace: number;
      /** 是投篮不中后的篮板球（拿到算篮板） */
      rebound?: boolean;
      /** 篮板对抗尚未判定（球还在弹框，落地瞬间再判） */
      pending?: boolean;
      /** 篮板对抗的赢家：claimUntil 之前只有他能拿到球 */
      claimant?: Player;
      claimUntil?: number;
    }
  | { kind: 'dead' };

/** 球的快照：状态里的球员引用换成下标 */
export interface BallSnapshot {
  pos: Vec;
  height: number;
  dribblePhase: number;
  state: Record<string, unknown>;
}

/** BallState 里引用球员的字段 */
const REF_KEYS = new Set(['holder', 'from', 'to', 'shooter', 'claimant']);

/**
 * 球：位置 + 离地高度，状态决定每帧怎么走。
 * 持球时跟着持球人手上并模拟运球起伏；传球/投篮沿抛物线飞；落地后滚动并减速。
 */
export class Ball {
  pos: Vec;
  height = 0;
  state: BallState = { kind: 'dead' };
  private dribblePhase = 0;
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, pos: Vec) {
    this.pos = { ...pos };
    this.shadow = scene.add.ellipse(pos.x, pos.y, 6, 3, 0x000000, 0.35);
    this.sprite = scene.add.image(pos.x, pos.y, TEX.ball).setScale(BALL_SCALE);
  }

  get holder(): Player | null {
    return this.state.kind === 'held' ? this.state.holder : null;
  }

  isInFlight(): boolean {
    return this.state.kind === 'pass' || this.state.kind === 'shot';
  }

  /** 当前落点（飞行中是终点，否则是自身位置） */
  landing(): Vec {
    if (this.state.kind === 'pass' || this.state.kind === 'shot') return this.state.end;
    return this.pos;
  }

  update(dtSec: number): void {
    const s = this.state;
    switch (s.kind) {
      case 'held': {
        const h = s.holder;
        // 球拿在身体前方偏进攻方向一点
        const dir = h.facingVec();
        this.pos = { x: h.pos.x + dir.x * 5 + 3 * (dir.y !== 0 ? 1 : 0), y: h.pos.y + dir.y * 5 + 2 };
        if (h.isMoving()) {
          this.dribblePhase += dtSec * 9;
          this.height = 2 + Math.abs(Math.sin(this.dribblePhase)) * 5;
        } else {
          this.dribblePhase += dtSec * 6;
          this.height = 3 + Math.abs(Math.sin(this.dribblePhase)) * 4;
        }
        break;
      }
      case 'pass':
      case 'shot': {
        s.t = Math.min(1, s.t + dtSec / s.duration);
        this.pos = {
          x: s.start.x + (s.end.x - s.start.x) * s.t,
          y: s.start.y + (s.end.y - s.start.y) * s.t,
        };
        // 抛物线：起手高度 ~8，终点高度：投篮到篮筐 ~10，传球 ~6
        const endH = s.kind === 'shot' ? 10 : 6;
        const startH = 8;
        this.height = startH + (endH - startH) * s.t + 4 * s.peak * s.t * (1 - s.t);
        break;
      }
      case 'loose': {
        s.grace = Math.max(0, s.grace - dtSec);
        this.pos = { x: this.pos.x + s.vel.x * dtSec, y: this.pos.y + s.vel.y * dtSec };
        // 出界反弹（球场边线外一点点），并把球推回界内，避免卡在场外
        const minX = COURT.left - 4;
        const maxX = COURT_RIGHT + 4;
        const minY = COURT.top - 4;
        const maxY = COURT_BOTTOM + 4;
        if (this.pos.x < minX) {
          this.pos.x = minX;
          s.vel.x = Math.abs(s.vel.x) * 0.6;
        } else if (this.pos.x > maxX) {
          this.pos.x = maxX;
          s.vel.x = -Math.abs(s.vel.x) * 0.6;
        }
        if (this.pos.y < minY) {
          this.pos.y = minY;
          s.vel.y = Math.abs(s.vel.y) * 0.6;
        } else if (this.pos.y > maxY) {
          this.pos.y = maxY;
          s.vel.y = -Math.abs(s.vel.y) * 0.6;
        }
        const friction = Math.exp(-dtSec * 1.6);
        s.vel = { x: s.vel.x * friction, y: s.vel.y * friction };
        // 弹跳衰减
        this.height = Math.max(0, this.height - dtSec * 40);
        break;
      }
      case 'dead':
        this.height = 0;
        break;
    }
    this.render();
  }

  private render(): void {
    this.sprite.setPosition(this.pos.x, this.pos.y - this.height);
    this.sprite.setScale(BALL_SCALE * (1 + this.height / 60));
    this.sprite.setDepth(this.pos.y + 100 + this.height);
    this.shadow.setPosition(this.pos.x, this.pos.y + 1);
    this.shadow.setAlpha(Math.max(0.1, 0.35 - this.height / 120));
    this.shadow.setDepth(this.pos.y - 1);
  }

  // ---------- 回放快照 ----------
  snapshot(indexOf: (p: Player | null) => number): BallSnapshot {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.state)) {
      if (REF_KEYS.has(k)) out[k] = indexOf(v as Player);
      else if (v && typeof v === 'object') out[k] = { ...(v as Vec) };
      else out[k] = v;
    }
    return { pos: { ...this.pos }, height: this.height, dribblePhase: this.dribblePhase, state: out };
  }

  restore(s: BallSnapshot, players: Player[]): void {
    const st: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.state)) {
      if (REF_KEYS.has(k)) st[k] = players[v as number];
      else if (v && typeof v === 'object') st[k] = { ...(v as Vec) };
      else st[k] = v;
    }
    this.state = st as unknown as BallState;
    this.pos = { ...s.pos };
    this.height = s.height;
    this.dribblePhase = s.dribblePhase;
    this.render();
  }
}

import * as THREE from 'three';
import { SYMBOLS, type SymbolId } from '../game/config.ts';
import { LINES, type Grid } from '../game/slot.ts';
import { symbolTextures } from './symbols.ts';

/** 每个滚筒是一个 12 面棱柱，正面同时露出 3 格 */
const SEGMENTS = 12;
const STEP = (Math.PI * 2) / SEGMENTS;
export const CELL = 1.0;
export const REEL_RADIUS = CELL / (2 * Math.tan(STEP / 2));
export const REEL_GAP = 1.14;
/** 上下两行在正面看到的高度偏移 */
export const ROW_OFFSET = REEL_RADIUS * Math.sin(STEP);

const mod = (n: number, m: number) => ((n % m) + m) % m;
const easeOutBack = (t: number, s = 1.7) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
const randomSymbol = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)].id;

interface Segment {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  sym: SymbolId;
  /** 高亮强度：0 = 压暗，1 = 正常，>1 = 中奖闪烁 */
  level: number;
}

class Reel {
  readonly group = new THREE.Group();
  private segs: Segment[] = [];
  /** 当前正对玩家的那一面 */
  private center = 0;
  private anim: { t: number; dur: number; from: number; total: number; done: () => void } | null = null;

  private readonly tex: Record<SymbolId, THREE.Texture>;
  private readonly onStop: () => void;

  constructor(tex: Record<SymbolId, THREE.Texture>, onStop: () => void) {
    this.tex = tex;
    this.onStop = onStop;
    const geo = new THREE.PlaneGeometry(CELL, CELL);
    for (let i = 0; i < SEGMENTS; i++) {
      const sym = randomSymbol();
      const mat = new THREE.MeshBasicMaterial({ map: tex[sym] });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = REEL_RADIUS;
      const pivot = new THREE.Group();
      pivot.rotation.x = i * STEP;
      pivot.add(mesh);
      this.group.add(pivot);
      this.segs.push({ mesh, mat, sym, level: 1 });
    }
  }

  get spinning() {
    return this.anim !== null;
  }

  /** 正面第 row 行（0 上 / 1 中 / 2 下）对应哪一面 */
  seg(row: number) {
    return this.segs[mod(this.center + row - 1, SEGMENTS)];
  }

  private paintSeg(seg: Segment, sym: SymbolId) {
    seg.sym = sym;
    seg.mat.map = this.tex[sym];
  }

  /** 转到指定结果（从上到下 3 个符号） */
  spin(result: SymbolId[], turns: number, dur: number): Promise<void> {
    // 多转半圈：目标面此刻正好在背面，换贴图不会被看见
    const steps = turns * SEGMENTS + SEGMENTS / 2;
    const target = mod(this.center - steps, SEGMENTS);
    for (let i = 0; i < SEGMENTS; i++) {
      const d = Math.min(mod(i - this.center, SEGMENTS), mod(this.center - i, SEGMENTS));
      if (d >= 3) this.paintSeg(this.segs[i], randomSymbol());
    }
    result.forEach((sym, row) => {
      this.paintSeg(this.segs[mod(target + row - 1, SEGMENTS)], sym);
    });
    const from = -this.center * STEP;
    this.center = target;
    return new Promise((done) => {
      this.anim = { t: 0, dur, from, total: steps * STEP, done };
    });
  }

  update(dt: number) {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    // 前段匀速，最后一小段带回弹地刹停
    const brake = 0.42;
    const k = 4.7; // easeOutBack 在起点的斜率（s + 3），保证两段速度连续
    const v = a.total / (a.dur - brake + brake / k);
    const cruise = a.dur - brake;
    let ang: number;
    if (a.t < cruise) ang = v * a.t;
    else ang = v * cruise + ((v * brake) / k) * easeOutBack(Math.min(1, (a.t - cruise) / brake));
    this.group.rotation.x = a.from + ang;
    if (a.t >= a.dur) {
      this.group.rotation.x = -this.center * STEP;
      this.anim = null;
      this.onStop();
      a.done();
    }
  }

  setLevels(levels: [number, number, number] | null) {
    for (const s of this.segs) s.level = 1;
    if (levels) levels.forEach((lv, row) => (this.seg(row).level = lv));
  }

  paint(time: number) {
    for (const s of this.segs) {
      const lv = s.level > 1 ? 1.25 + 0.75 * Math.sin(time * 9) ** 2 : s.level;
      s.mat.color.setScalar(lv);
    }
  }
}

/** 3 个滚筒 + 中奖线 */
export class Reels {
  readonly group = new THREE.Group();
  private reels: Reel[] = [];
  private lines: THREE.Mesh[] = [];
  private time = 0;

  constructor(onReelStop: (col: number) => void) {
    const tex = symbolTextures();
    for (let col = 0; col < 3; col++) {
      const reel = new Reel(tex, () => onReelStop(col));
      reel.group.position.set((col - 1) * REEL_GAP, 0, -REEL_RADIUS);
      this.group.add(reel.group);
      this.reels.push(reel);
    }
    // 8 条中奖线：平时隐藏，中奖时亮起
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 1.5, 0.35),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cellPos = (i: number) => new THREE.Vector2(((i % 3) - 1) * REEL_GAP, (1 - Math.floor(i / 3)) * ROW_OFFSET);
    for (const [a, , c] of LINES) {
      const p = cellPos(a), q = cellPos(c);
      const len = p.distanceTo(q) + CELL * 0.9;
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.07), mat);
      bar.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, 0.3);
      bar.rotation.z = Math.atan2(q.y - p.y, q.x - p.x);
      bar.visible = false;
      this.group.add(bar);
      this.lines.push(bar);
    }
  }

  /** 射线点中了盘面上的哪个符号（转动中不算） */
  pick(ray: THREE.Raycaster): SymbolId | null {
    let best: SymbolId | null = null, bestDist = Infinity;
    for (const reel of this.reels) {
      if (reel.spinning) return null;
      for (let row = 0; row < 3; row++) {
        const seg = reel.seg(row);
        const hit = ray.intersectObject(seg.mesh)[0];
        if (hit && hit.distance < bestDist) { bestDist = hit.distance; best = seg.sym; }
      }
    }
    return best;
  }

  /** 三个滚筒依次停下 */
  spin(grid: Grid, fast = false): Promise<void> {
    this.clearHighlight();
    const base = fast ? 0.55 : 0.9;
    const gap = fast ? 0.2 : 0.38;
    return Promise.all(
      this.reels.map((r, col) => r.spin([grid[col], grid[3 + col], grid[6 + col]], 1 + col, base + col * gap)),
    ).then(() => undefined);
  }

  highlight(lineIds: number[]) {
    const win = new Set<number>();
    for (const id of lineIds) {
      LINES[id].forEach((c) => win.add(c));
      this.lines[id].visible = true;
    }
    this.reels.forEach((r, col) =>
      r.setLevels([0, 1, 2].map((row) => (win.has(row * 3 + col) ? 2 : 0.3)) as [number, number, number]),
    );
  }

  clearHighlight() {
    for (const l of this.lines) l.visible = false;
    for (const r of this.reels) r.setLevels(null);
  }

  update(dt: number) {
    this.time += dt;
    for (const r of this.reels) {
      r.update(dt);
      r.paint(this.time);
    }
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 9) ** 2;
    for (const l of this.lines) if (l.visible) (l.material as THREE.MeshBasicMaterial).opacity = pulse;
  }
}

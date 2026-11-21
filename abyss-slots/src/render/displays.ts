import * as THREE from 'three';
import type { SymbolId } from '../game/config.ts';
import { symbolCanvas } from './symbols.ts';

/**
 * 机台上的两块“显示屏”：赔率表、状态栏（金币 / 剩余转数 / 深渊进度）。
 * 都是小画布贴图 + 自带的点阵字体，一个贴图像素在屏幕上就是一个方块，和像素场景的颗粒度接近。
 */

/** 5×7 点阵字：只收录用得到的字符 */
const FONT: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
};

function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string) {
  g.fillStyle = color;
  for (const ch of text) {
    const glyph = FONT[ch];
    if (glyph) {
      glyph.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] === '#') g.fillRect(x + rx * scale, y + ry * scale, scale, scale);
        }
      });
    }
    // 小数点占的位置窄一点，数字不至于被撑散
    x += (ch === '.' ? 4 : 6) * scale;
  }
}

/** 显示屏放不下太长的数字：一百万以上缩写成 M / B（向下取整） */
export function compact(n: number): string {
  if (n < 1e6) return String(n);
  const [div, unit] = n < 1e9 ? [1e6, 'M'] : [1e9, 'B'];
  const v = n / div;
  return `${v < 10 ? Math.floor(v * 100) / 100 : v < 100 ? Math.floor(v * 10) / 10 : Math.floor(v)}${unit}`;
}

const BG = '#0b0709';
const FRAME = '#9a6a22';
const GOLD = '#ffc531';
const BONE = '#e9dfc4';
const BLOOD = '#ff3a3a';
const BOOST = '#5bffb2';

function panel(w: number, h: number, worldW: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, (worldW * h) / w),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }),
  );
  const clear = () => {
    g.fillStyle = FRAME;
    g.fillRect(0, 0, w, h);
    g.fillStyle = BG;
    g.fillRect(2, 2, w - 4, h - 4);
  };
  return { g, tex, mesh, clear, w, h };
}

export interface PayRow {
  id: SymbolId;
  mult: number;
  /** 被玩偶改过（用另一种颜色标出来） */
  boosted: boolean;
}

export interface Status {
  coins: number;
  spinsLeft: number;
  level: number;
  /** 这一层已经转了几次 / 一层要转几次 */
  progress: number;
  perLevel: number;
}

export const DISPLAY_WIDTH = 4.6;

export class Displays {
  readonly group = new THREE.Group();
  /** 赔率表 264×76，状态栏 264×40，宽度都是 DISPLAY_WIDTH */
  private pay = panel(264, 76, DISPLAY_WIDTH);
  private status = panel(264, 40, DISPLAY_WIDTH);
  private icons = new Map<SymbolId, HTMLCanvasElement>();
  private lastPay = '';
  private lastStatus = '';

  constructor(layer: number) {
    this.pay.mesh.position.y = this.statusHeight / 2 + 0.08 + this.payHeight / 2;
    this.group.add(this.status.mesh, this.pay.mesh);
    this.group.traverse((o) => o.layers.set(layer));
  }

  get payHeight() {
    return (DISPLAY_WIDTH * this.pay.h) / this.pay.w;
  }

  get statusHeight() {
    return (DISPLAY_WIDTH * this.status.h) / this.status.w;
  }

  /** 赔率表：3 列 2 行，从贵到便宜 */
  setPaytable(rows: PayRow[]) {
    const key = JSON.stringify(rows);
    if (key === this.lastPay) return;
    this.lastPay = key;
    const { g, clear, tex } = this.pay;
    clear();
    rows.forEach((r, i) => {
      const cx = 2 + (i % 3) * 87, cy = 3 + Math.floor(i / 3) * 36;
      let icon = this.icons.get(r.id);
      if (!icon) this.icons.set(r.id, (icon = symbolCanvas(r.id, false)));
      g.drawImage(icon, cx + 1, cy + 1);
      drawText(g, `x${r.mult}`, cx + 36, cy + 10, 2, r.boosted ? BOOST : GOLD);
    });
    tex.needsUpdate = true;
  }

  /** 状态栏：金币 | 剩余转数 | 深渊层数 + 本层进度 */
  setStatus(s: Status) {
    const key = JSON.stringify(s);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    const { g, clear, tex } = this.status;
    clear();
    // 金币
    disc(g, 14, 20, 7, '#8a5a08');
    disc(g, 14, 20, 6, GOLD);
    g.fillStyle = '#fff3b0';
    g.fillRect(11, 16, 2, 2);
    drawText(g, compact(s.coins), 26, 13, 2, GOLD);
    // 剩余转数：沙漏
    g.fillStyle = BONE;
    for (let i = 0; i < 7; i++) {
      const half = 6 - Math.min(i, 5);
      g.fillRect(118 - half, 13 + i, half * 2, 1);
      g.fillRect(118 - half, 26 - i, half * 2, 1);
    }
    drawText(g, String(s.spinsLeft), 130, 13, 2, BONE);
    // 深渊：血宝石 + 层数 + 进度条
    g.fillStyle = BLOOD;
    for (let dy = -7; dy <= 7; dy++) {
      const half = Math.max(0, 5 - Math.ceil(Math.abs(dy) * 0.7));
      g.fillRect(182 - half, 20 + dy, half * 2 + 1, 1);
    }
    drawText(g, String(s.level), 192, 13, 2, BLOOD);
    const barX = 192 + String(s.level).length * 12 + 2;
    const seg = Math.max(2, Math.floor((258 - barX) / s.perLevel) - 1);
    for (let i = 0; i < s.perLevel; i++) {
      g.fillStyle = i < s.progress ? BLOOD : '#3a1418';
      g.fillRect(barX + i * (seg + 1), 14, seg, 12);
    }
    tex.needsUpdate = true;
  }
}

/** 不抗锯齿的实心圆 */
function disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  g.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.6));
    g.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

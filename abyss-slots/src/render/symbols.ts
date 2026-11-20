import * as THREE from 'three';
import type { SymbolId } from '../game/config.ts';

/** 所有图案都用 canvas 现画（不依赖图片资源和 emoji 字体），再缩成低分辨率的像素贴图 */
const S = 256;

type Painter = (g: CanvasRenderingContext2D) => void;

/** 像素风下不要柔光：缩小后只会糊成一团脏色。保留这个函数是为了以后想切回柔光时只改一处 */
function glow(g: CanvasRenderingContext2D, _color: string, _blur = 22) {
  g.shadowBlur = 0;
}

const PAINT: Record<SymbolId, Painter> = {
  candle(g) {
    glow(g, '#ff9a2e', 30);
    // 烛身
    const body = g.createLinearGradient(96, 0, 160, 0);
    body.addColorStop(0, '#8d8470');
    body.addColorStop(0.5, '#e9dfc4');
    body.addColorStop(1, '#6f6756');
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(100, 118, 56, 104, 6);
    g.fill();
    // 蜡泪
    g.beginPath();
    g.roundRect(100, 112, 56, 16, 8);
    g.roundRect(108, 120, 10, 34, 5);
    g.roundRect(140, 120, 9, 22, 5);
    g.fillStyle = '#f3ead2';
    g.fill();
    // 烛芯
    g.shadowBlur = 0;
    g.fillStyle = '#221a14';
    g.fillRect(126, 98, 4, 16);
    // 火焰
    glow(g, '#ff7a1a', 40);
    const fl = g.createRadialGradient(128, 82, 2, 128, 70, 44);
    fl.addColorStop(0, '#fffbe0');
    fl.addColorStop(0.35, '#ffc23d');
    fl.addColorStop(1, '#ff4d0f');
    g.fillStyle = fl;
    g.beginPath();
    g.moveTo(128, 28);
    g.bezierCurveTo(152, 62, 152, 86, 128, 104);
    g.bezierCurveTo(104, 86, 104, 62, 128, 28);
    g.fill();
  },
  dagger(g) {
    g.translate(128, 128);
    g.rotate(Math.PI / 4);
    glow(g, '#8fd3ff', 26);
    // 刀刃
    const blade = g.createLinearGradient(-16, 0, 16, 0);
    blade.addColorStop(0, '#dfe9f2');
    blade.addColorStop(0.5, '#8795a3');
    blade.addColorStop(0.52, '#f4f8fb');
    blade.addColorStop(1, '#6e7c8a');
    g.fillStyle = blade;
    g.beginPath();
    g.moveTo(0, -108);
    g.lineTo(17, -74);
    g.lineTo(14, 22);
    g.lineTo(-14, 22);
    g.lineTo(-17, -74);
    g.closePath();
    g.fill();
    // 护手
    glow(g, '#ffb14a', 14);
    g.fillStyle = '#b98a2e';
    g.beginPath();
    g.roundRect(-46, 20, 92, 15, 7);
    g.fill();
    // 握柄
    g.fillStyle = '#3d2418';
    g.beginPath();
    g.roundRect(-10, 34, 20, 52, 4);
    g.fill();
    g.strokeStyle = '#7a4b2c';
    g.lineWidth = 3;
    for (let y = 44; y < 84; y += 10) {
      g.beginPath();
      g.moveTo(-10, y);
      g.lineTo(10, y + 6);
      g.stroke();
    }
    // 柄头宝石
    glow(g, '#ff2a3c', 20);
    g.fillStyle = '#d3152b';
    g.beginPath();
    g.arc(0, 96, 12, 0, Math.PI * 2);
    g.fill();
  },
  eye(g) {
    glow(g, '#a45cff', 34);
    // 眼白
    g.fillStyle = '#e8dff0';
    g.beginPath();
    g.moveTo(22, 128);
    g.quadraticCurveTo(128, 30, 234, 128);
    g.quadraticCurveTo(128, 226, 22, 128);
    g.fill();
    g.save();
    g.clip();
    g.shadowBlur = 0;
    // 虹膜
    const iris = g.createRadialGradient(128, 128, 6, 128, 128, 54);
    iris.addColorStop(0, '#f2c8ff');
    iris.addColorStop(0.4, '#9a3df0');
    iris.addColorStop(1, '#2a0a52');
    g.fillStyle = iris;
    g.beginPath();
    g.arc(128, 128, 54, 0, Math.PI * 2);
    g.fill();
    // 竖瞳
    g.fillStyle = '#07030c';
    g.beginPath();
    g.ellipse(128, 128, 13, 46, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    g.arc(146, 106, 8, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 眼眶
    glow(g, '#a45cff', 12);
    g.strokeStyle = '#3a1466';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(22, 128);
    g.quadraticCurveTo(128, 30, 234, 128);
    g.quadraticCurveTo(128, 226, 22, 128);
    g.stroke();
  },
  skull(g) {
    glow(g, '#9dffc9', 26);
    const bone = g.createRadialGradient(112, 88, 10, 128, 110, 110);
    bone.addColorStop(0, '#fbf6e6');
    bone.addColorStop(1, '#a89f86');
    g.fillStyle = bone;
    // 颅骨 + 下颌
    g.beginPath();
    g.arc(128, 106, 78, Math.PI * 0.92, Math.PI * 0.08);
    g.bezierCurveTo(204, 160, 182, 168, 176, 176);
    g.lineTo(172, 218);
    g.quadraticCurveTo(128, 232, 84, 218);
    g.lineTo(80, 176);
    g.bezierCurveTo(74, 168, 52, 160, 54, 124);
    g.fill();
    g.shadowBlur = 0;
    // 眼窝
    g.fillStyle = '#0a0709';
    g.beginPath();
    g.ellipse(98, 116, 22, 26, -0.15, 0, Math.PI * 2);
    g.ellipse(158, 116, 22, 26, 0.15, 0, Math.PI * 2);
    g.fill();
    // 眼窝里的鬼火
    glow(g, '#3dffa0', 18);
    g.fillStyle = '#5bffb2';
    g.beginPath();
    g.arc(98, 120, 6, 0, Math.PI * 2);
    g.arc(158, 120, 6, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // 鼻孔
    g.fillStyle = '#0a0709';
    g.beginPath();
    g.moveTo(128, 142);
    g.lineTo(140, 166);
    g.lineTo(116, 166);
    g.closePath();
    g.fill();
    // 牙缝
    g.strokeStyle = '#1b1512';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(88, 190);
    g.lineTo(168, 190);
    for (let x = 100; x <= 156; x += 14) {
      g.moveTo(x, 180);
      g.lineTo(x, 222);
    }
    g.stroke();
  },
  coin(g) {
    glow(g, '#ffc531', 36);
    const gold = g.createRadialGradient(100, 96, 8, 128, 128, 100);
    gold.addColorStop(0, '#fff3b0');
    gold.addColorStop(0.5, '#f2b324');
    gold.addColorStop(1, '#8a5a08');
    g.fillStyle = gold;
    g.beginPath();
    g.arc(128, 128, 92, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#7a4d06';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(128, 128, 72, 0, Math.PI * 2);
    g.stroke();
    // 中间一颗五角星
    g.fillStyle = '#7a4d06';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 22 : 52;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,250,210,.55)';
    g.beginPath();
    g.ellipse(96, 84, 26, 12, -0.7, 0, Math.PI * 2);
    g.fill();
  },
  seven(g) {
    glow(g, '#ff1030', 44);
    const red = g.createLinearGradient(0, 40, 0, 220);
    red.addColorStop(0, '#ff8a7a');
    red.addColorStop(0.35, '#ff1f3a');
    red.addColorStop(1, '#7a0010');
    g.fillStyle = red;
    g.beginPath();
    g.moveTo(52, 40);
    g.lineTo(208, 40);
    g.lineTo(208, 74);
    g.quadraticCurveTo(140, 140, 128, 222);
    g.lineTo(82, 222);
    g.quadraticCurveTo(96, 136, 152, 82);
    g.lineTo(52, 82);
    g.closePath();
    g.fill();
    g.fill(); // 再叠一层，光晕更浓
    g.shadowBlur = 0;
    g.strokeStyle = '#ffd9a0';
    g.lineWidth = 3;
    g.stroke();
    // 往下滴的血
    g.fillStyle = '#b00018';
    g.beginPath();
    g.roundRect(66, 80, 9, 30, 5);
    g.roundRect(92, 80, 7, 18, 4);
    g.fill();
  },
};

function makeCanvas(w = S, h = S) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/**
 * 像素化：把高清画布缩到 w×h，再把颜色压成少数几档，得到硬边的像素画。
 * 图案本身仍然用矢量路径画，这样改图案不用一个个像素去点。
 */
export function pixelate(src: HTMLCanvasElement, w: number, h: number, levels = 5): HTMLCanvasElement {
  const [c, g] = makeCanvas(w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const q = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] / q) * q;
    d[i + 1] = Math.round(d[i + 1] / q) * q;
    d[i + 2] = Math.round(d[i + 2] / q) * q;
    d[i + 3] = d[i + 3] > 110 ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function toTexture(c: HTMLCanvasElement, pixel = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  return t;
}

/** 符号贴图的边长（像素） */
const SYMBOL_PX = 32;

/** 单个符号的像素画布（DOM 的赔率表也复用它） */
export function symbolCanvas(id: SymbolId, withBg = true): HTMLCanvasElement {
  const [c, g] = makeCanvas();
  if (withBg) {
    g.fillStyle = '#17111a';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#0a0709';
    g.fillRect(0, 0, S, 8);
    g.fillRect(0, S - 8, S, 8);
  }
  g.save();
  g.translate(S / 2, S / 2);
  g.scale(0.82, 0.82);
  g.translate(-S / 2, -S / 2);
  PAINT[id](g);
  g.restore();
  return pixelate(c, SYMBOL_PX, SYMBOL_PX, 6);
}

export function symbolTextures(): Record<SymbolId, THREE.Texture> {
  const out = {} as Record<SymbolId, THREE.Texture>;
  for (const id of Object.keys(PAINT) as SymbolId[]) out[id] = toTexture(symbolCanvas(id));
  return out;
}

/** 金币正反面的浮雕贴图 */
export function coinFaceTexture(): THREE.Texture {
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#b9925a';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#c29a5e';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 14 : 34;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  return toTexture(pixelate(c, 16, 16, 5));
}

/** 机器顶上的招牌 */
export function signTexture(): THREE.Texture {
  const [c, g] = makeCanvas(1024, 192);
  g.fillStyle = '#0b0709';
  g.fillRect(0, 0, 1024, 192);
  g.font = '900 132px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  glow(g, '#ff2a1a', 40);
  const grad = g.createLinearGradient(0, 30, 0, 170);
  grad.addColorStop(0, '#ffe7a8');
  grad.addColorStop(0.5, '#ff8a2a');
  grad.addColorStop(1, '#c2161a');
  g.fillStyle = grad;
  g.fillText('A B Y S S', 512, 104);
  return toTexture(pixelate(c, 128, 24, 6));
}

/** 盖在滚轮窗口上的上下暗角，假装滚筒的曲面阴影 */
export function windowShadeTexture(): THREE.Texture {
  const [c, g] = makeCanvas(8, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(0,0,0,.8)');
  grad.addColorStop(0.22, 'rgba(0,0,0,.12)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(0.78, 'rgba(0,0,0,.12)');
  grad.addColorStop(1, 'rgba(0,0,0,.8)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  return toTexture(c, false);
}

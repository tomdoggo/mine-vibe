/**
 * 程序生成的卡面插画（SVG）。同一张卡永远画出同一张图：外形由卡名决定，配色和背景元素由属性决定。
 * 不需要任何图片文件，发布成单文件网页也能显示。
 */
import type { CardDef, CreatureDef, EType, TrainerDef } from '../types.ts';

interface Palette { bg1: string; bg2: string; body: string; belly: string; dark: string; motif: string }

const PAL: Record<EType, Palette> = {
  fire: { bg1: '#ffe0a8', bg2: '#f08a4b', body: '#f26a3d', belly: '#ffd27a', dark: '#7a1e0e', motif: '#ffb347' },
  water: { bg1: '#d6efff', bg2: '#5aa9e6', body: '#3d8fd9', belly: '#cde9ff', dark: '#0d3b66', motif: '#ffffff' },
  grass: { bg1: '#e4f7cf', bg2: '#7cc45c', body: '#4fae4a', belly: '#e3f6b8', dark: '#1f5a2a', motif: '#2f8a3a' },
  lightning: { bg1: '#fff7c9', bg2: '#f6cf3c', body: '#ffcd1f', belly: '#fff3c0', dark: '#5c4400', motif: '#fff9e0' },
  colorless: { bg1: '#f5f3ee', bg2: '#c9c3b8', body: '#e2d6c3', belly: '#fffaf0', dark: '#4a4238', motif: '#ffffff' },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** 背景上的属性元素 */
function motif(t: EType, p: Palette, r: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x = 10 + r() * 140;
    const y = 10 + r() * 80;
    const s = 0.6 + r() * 0.8;
    switch (t) {
      case 'fire':
        out.push(`<path d="M${f(x)} ${f(y + 12 * s)}c${f(-7 * s)} 0 ${f(-9 * s)} ${f(-8 * s)} ${f(-4 * s)} ${f(-14 * s)}c0 ${f(4 * s)} ${f(3 * s)} ${f(5 * s)} ${f(4 * s)} ${f(2 * s)}c${f(1 * s)} ${f(-4 * s)} ${f(4 * s)} ${f(-6 * s)} ${f(4 * s)} ${f(-10 * s)}c${f(6 * s)} ${f(6 * s)} ${f(7 * s)} ${f(22 * s)} ${f(-4 * s)} ${f(22 * s)}z" fill="${p.motif}" opacity=".45"/>`);
        break;
      case 'water':
        out.push(`<path d="M${f(x - 14 * s)} ${f(y)}q${f(7 * s)} ${f(-6 * s)} ${f(14 * s)} 0t${f(14 * s)} 0" fill="none" stroke="${p.motif}" stroke-width="${f(2.5 * s)}" stroke-linecap="round" opacity=".55"/>`);
        break;
      case 'grass':
        out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(8 * s)}" ry="${f(3.5 * s)}" transform="rotate(${Math.round(r() * 180)} ${f(x)} ${f(y)})" fill="${p.motif}" opacity=".3"/>`);
        break;
      case 'lightning':
        out.push(`<path d="M${f(x)} ${f(y - 10 * s)}l${f(-6 * s)} ${f(10 * s)}h${f(5 * s)}l${f(-4 * s)} ${f(10 * s)}l${f(10 * s)} ${f(-13 * s)}h${f(-5 * s)}l${f(4 * s)} ${f(-7 * s)}z" fill="${p.motif}" opacity=".7"/>`);
        break;
      default:
        out.push(`<g fill="${p.motif}" opacity=".7"><circle cx="${f(x)}" cy="${f(y)}" r="${f(6 * s)}"/><circle cx="${f(x + 7 * s)}" cy="${f(y + 1)}" r="${f(5 * s)}"/><circle cx="${f(x - 7 * s)}" cy="${f(y + 2)}" r="${f(4 * s)}"/></g>`);
    }
  }
  return out.join('');
}

/** 尾巴末端的形状，跟属性走 */
function tailTip(t: EType, x: number, y: number, p: Palette): string {
  switch (t) {
    case 'fire':
      return `<path d="M${x} ${y + 6}c-6 0-7-7-3-12c0 3 2 4 3 2c1-3 3-5 3-8c5 5 6 18-3 18z" fill="#ff9f1c" stroke="${p.dark}" stroke-width="1"/>`;
    case 'water':
      return `<path d="M${x - 2} ${y}l10-7l-2 9l2 9l-10-7z" fill="${p.belly}" stroke="${p.dark}" stroke-width="1"/>`;
    case 'grass':
      return `<ellipse cx="${x + 4}" cy="${y - 3}" rx="8" ry="4" transform="rotate(-35 ${x + 4} ${y - 3})" fill="#7fd36b" stroke="${p.dark}" stroke-width="1"/>`;
    case 'lightning':
      return `<path d="M${x} ${y}l6-9l-2 6h6l-8 12l2-7z" fill="#fff06a" stroke="${p.dark}" stroke-width="1"/>`;
    default:
      return `<circle cx="${x + 3}" cy="${y - 2}" r="5" fill="${p.belly}" stroke="${p.dark}" stroke-width="1"/>`;
  }
}

function creatureArt(d: CreatureDef, id: string): string {
  const p = PAL[d.type];
  const r = seeded(hash(d.name));
  const s = 0.85 + d.stage * 0.17; // 进化阶段越高体型越大
  const cx = 80 + (r() - 0.5) * 10;
  const by = 66; // 身体中心
  const brx = (24 + r() * 8) * s;
  const bry = (17 + r() * 5) * s;
  const hx = cx + (r() - 0.5) * 14;
  const hy = by - bry - 10 * s;
  const hr = (13 + r() * 4) * s;
  const ears = Math.floor(r() * 3);
  const eye = 2.6 + r() * 1.6;
  const facing = r() < 0.5 ? -1 : 1;
  const parts: string[] = [];

  // 二阶：翅膀 / 背刺
  if (d.stage === 2) {
    if (r() < 0.5) {
      parts.push(`<path d="M${f(cx - 6)} ${f(by - bry + 6)}q-34 -30 -42 -6q16 -2 22 10z" fill="${p.belly}" stroke="${p.dark}" stroke-width="1.2" opacity=".95"/>`);
      parts.push(`<path d="M${f(cx + 6)} ${f(by - bry + 6)}q34 -30 42 -6q-16 -2 -22 10z" fill="${p.belly}" stroke="${p.dark}" stroke-width="1.2" opacity=".95"/>`);
    } else {
      for (let i = -2; i <= 2; i++) {
        const x = cx + i * brx * 0.35;
        const y = by - bry * Math.cos((i / 3) * 1.2) + 2;
        parts.push(`<path d="M${f(x - 5)} ${f(y)}l5 -11l5 11z" fill="${p.dark}" opacity=".85"/>`);
      }
    }
  }

  // 尾巴
  const tx = cx - facing * (brx + 14);
  const ty = by - 12;
  parts.push(`<path d="M${f(cx - facing * brx * 0.7)} ${f(by + 4)}Q${f(cx - facing * (brx + 18))} ${f(by + 6)} ${f(tx)} ${f(ty)}" fill="none" stroke="${p.body}" stroke-width="${f(5 * s)}" stroke-linecap="round"/>`);
  parts.push(tailTip(d.type, tx, ty, p));

  // 脚
  for (const dx of [-0.5, 0.5]) {
    parts.push(`<ellipse cx="${f(cx + dx * brx)}" cy="${f(by + bry - 2)}" rx="${f(6 * s)}" ry="${f(4 * s)}" fill="${p.body}" stroke="${p.dark}" stroke-width="1"/>`);
  }
  // 身体 + 肚子
  parts.push(`<ellipse cx="${f(cx)}" cy="${by}" rx="${f(brx)}" ry="${f(bry)}" fill="url(#${id}b)" stroke="${p.dark}" stroke-width="1.4"/>`);
  parts.push(`<ellipse cx="${f(cx + facing * 3)}" cy="${f(by + 4)}" rx="${f(brx * 0.55)}" ry="${f(bry * 0.6)}" fill="${p.belly}" opacity=".9"/>`);

  // 耳朵 / 角
  const earL = hx - hr * 0.6;
  const earR = hx + hr * 0.6;
  const earY = hy - hr * 0.55;
  if (ears === 0) {
    for (const ex of [earL, earR]) parts.push(`<path d="M${f(ex - 6)} ${f(earY + 4)}L${f(ex)} ${f(earY - 12 * s)}L${f(ex + 6)} ${f(earY + 4)}z" fill="${p.body}" stroke="${p.dark}" stroke-width="1.2"/>`);
  } else if (ears === 1) {
    for (const ex of [earL, earR]) parts.push(`<circle cx="${f(ex)}" cy="${f(earY)}" r="${f(6 * s)}" fill="${p.body}" stroke="${p.dark}" stroke-width="1.2"/>`);
  } else {
    for (const ex of [earL, earR]) parts.push(`<path d="M${f(ex - 2)} ${f(earY + 4)}q${f((ex < hx ? -6 : 6))} -10 ${f((ex < hx ? -2 : 2))} -16l4 2q-3 6 2 14z" fill="${p.dark}"/>`);
  }
  // 头
  parts.push(`<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(hr)}" fill="url(#${id}b)" stroke="${p.dark}" stroke-width="1.4"/>`);
  // 眼睛 + 嘴
  const ex = hr * 0.42;
  for (const sx of [-1, 1]) {
    const x = hx + sx * ex + facing * 2;
    parts.push(`<circle cx="${f(x)}" cy="${f(hy - 1)}" r="${f(eye)}" fill="#fff" stroke="${p.dark}" stroke-width=".8"/>`);
    parts.push(`<circle cx="${f(x + facing * 0.8)}" cy="${f(hy - 0.6)}" r="${f(eye * 0.55)}" fill="#1b1b1b"/>`);
  }
  parts.push(`<path d="M${f(hx + facing * 2 - 3)} ${f(hy + hr * 0.45)}q3 3 6 0" fill="none" stroke="${p.dark}" stroke-width="1.2" stroke-linecap="round"/>`);
  parts.push(`<circle cx="${f(hx - ex - 2)}" cy="${f(hy + 4)}" r="2.2" fill="#ff7b9c" opacity=".55"/><circle cx="${f(hx + ex + 2)}" cy="${f(hy + 4)}" r="2.2" fill="#ff7b9c" opacity=".55"/>`);

  return svg(id, p, motif(d.type, p, r), parts.join(''));
}

function svg(id: string, p: Palette, back: string, front: string): string {
  return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient>
<radialGradient id="${id}b" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="${p.belly}"/><stop offset=".45" stop-color="${p.body}"/><stop offset="1" stop-color="${p.body}"/></radialGradient>
</defs>
<rect width="160" height="100" fill="url(#${id}g)"/>${back}
<ellipse cx="80" cy="91" rx="46" ry="6" fill="#000" opacity=".12"/>${front}</svg>`;
}

// ---------- 训练家 / 能量 ----------

const TRAINER_PAL: Record<'item' | 'supporter', Palette> = {
  item: { bg1: '#ece4ff', bg2: '#9b7ce0', body: '#7e57c2', belly: '#ffffff', dark: '#3b1f7a', motif: '#ffffff' },
  supporter: { bg1: '#ffe9d1', bg2: '#f59b45', body: '#ef6c00', belly: '#fff3e6', dark: '#6b2f00', motif: '#ffffff' },
};

function trainerIcon(d: TrainerDef, p: Palette): string {
  const n = d.name;
  const stroke = `stroke="${p.dark}" stroke-width="2" stroke-linejoin="round"`;
  if (n.includes('药') || n.includes('喷雾')) {
    return `<rect x="70" y="22" width="20" height="10" rx="2" fill="${p.dark}"/><path d="M64 34h32v44a8 8 0 0 1-8 8H72a8 8 0 0 1-8-8z" fill="#7fe0c2" ${stroke}/><path d="M74 58h12M80 52v12" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (n.includes('球')) {
    return `<circle cx="80" cy="54" r="28" fill="#fff" ${stroke}/><path d="M52 54a28 28 0 0 1 56 0z" fill="#e85d4a" ${stroke}/><path d="M52 54h56" ${stroke}/><circle cx="80" cy="54" r="8" fill="#fff" ${stroke}/>`;
  }
  if (n.includes('替换')) {
    return `<path d="M50 42h50l-10-10M110 66H60l10 10" fill="none" stroke="${p.dark}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (n.includes('回收')) {
    return `<path d="M80 28a26 26 0 1 1-24 16" fill="none" stroke="${p.dark}" stroke-width="6" stroke-linecap="round"/><path d="M48 36l8 9l9-8" fill="none" stroke="${p.dark}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="80" cy="54" r="9" fill="#ffd23f" ${stroke}/>`;
  }
  if (n.includes('搜索')) {
    return `<circle cx="74" cy="48" r="18" fill="#e6f4ff" ${stroke}/><path d="M87 61l16 16" stroke="${p.dark}" stroke-width="7" stroke-linecap="round"/><path d="M72 38l-5 10h6l-4 9l10-12h-6l4-7z" fill="#ffcd1f"/>`;
  }
  if (n.includes('种子')) {
    return `<ellipse cx="80" cy="70" rx="16" ry="10" fill="#a0703c" ${stroke}/><path d="M80 62V40" stroke="#3c8d2f" stroke-width="4" stroke-linecap="round"/><ellipse cx="70" cy="40" rx="11" ry="6" transform="rotate(-25 70 40)" fill="#6cc24a" ${stroke}/><ellipse cx="90" cy="34" rx="11" ry="6" transform="rotate(25 90 34)" fill="#6cc24a" ${stroke}/>`;
  }
  // 支援者：人物剪影 + 道具
  const prop = n.includes('笔记') || n.includes('助手')
    ? `<rect x="92" y="54" width="24" height="18" rx="2" fill="#fff" ${stroke}/><path d="M104 54v18" ${stroke}/>`
    : n.includes('侦察')
      ? `<circle cx="98" cy="60" r="6" fill="#cfe8ff" ${stroke}/><circle cx="112" cy="60" r="6" fill="#cfe8ff" ${stroke}/>`
      : n.includes('呼唤')
        ? `<path d="M94 56l20-10v28l-20-10z" fill="#fff" ${stroke}/>`
        : `<path d="M96 48l6 12l13 2l-9 9l2 13l-12-6l-12 6l2-13l-9-9l13-2z" fill="#ffd23f" ${stroke}/>`;
  return `<circle cx="70" cy="38" r="13" fill="${p.belly}" ${stroke}/><path d="M46 86c0-22 10-32 24-32s24 10 24 32z" fill="${p.body}" ${stroke}/>${prop}`;
}

function energyIcon(t: EType): string {
  const glyph: Record<EType, string> = {
    fire: '<path d="M80 80c-16 0-20-16-11-28c0 7 4 9 7 5c2-7 7-12 6-22c14 13 18 45-2 45z" fill="#fff"/>',
    water: '<path d="M80 26c10 16 18 26 18 36a18 18 0 0 1-36 0c0-10 8-20 18-36z" fill="#fff"/>',
    grass: '<path d="M60 74c0-26 18-40 40-44c0 26-14 44-40 44z" fill="#fff"/><path d="M62 72l30-34" stroke="#3fa34d" stroke-width="3"/>',
    lightning: '<path d="M86 24L64 58h14l-8 22l24-34H80z" fill="#5c4400"/>',
    colorless: '<path d="M80 30l8 16l18 2l-13 12l4 18l-17-9l-17 9l4-18l-13-12l18-2z" fill="#fff"/>',
  };
  const p = PAL[t];
  return `<circle cx="80" cy="54" r="34" fill="${p.body}" stroke="${p.dark}" stroke-width="2.5"/>${glyph[t]}`;
}

const cache = new Map<string, string>();

export function cardArt(d: CardDef): string {
  const hit = cache.get(d.name);
  if (hit) return hit;
  const id = 'a' + hash(d.name).toString(36);
  let out: string;
  if (d.kind === 'creature') out = creatureArt(d, id);
  else if (d.kind === 'trainer') {
    const p = TRAINER_PAL[d.sub];
    out = svg(id, p, motif('colorless', p, seeded(hash(d.name))), trainerIcon(d, p));
  } else {
    const p = PAL[d.provides];
    out = svg(id, p, motif(d.provides, p, seeded(hash(d.name))), energyIcon(d.provides));
  }
  cache.set(d.name, out);
  return out;
}

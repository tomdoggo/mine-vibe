import type { DollId } from '../game/config.ts';

/** 玩偶的像素画：12×12，每个字符一个像素，'.' 是透明 */
interface Art {
  palette: Record<string, string>;
  rows: string[];
}

const K = '#0a0709';

const ART: Record<DollId, Art> = {
  imp: {
    palette: { o: '#ff7a1a', y: '#ffe07a', w: '#e9dfc4', d: '#8d8470', k: K },
    rows: [
      '.....o......',
      '....oyo.....',
      '....oyo.....',
      '.....o......',
      '...wwwwww...',
      '...wwwwww...',
      '...wkwwkw...',
      '...wwwwww...',
      '...wwkkww...',
      '...wwwwww...',
      '..wwwwwwww..',
      '..dddddddd..',
    ],
  },
  raven: {
    palette: { b: '#4d4470', p: '#7d6fae', r: '#ff2a3c', y: '#f2b324' },
    rows: [
      '............',
      '....bbbb....',
      '...bbbbbb...',
      '...brbbbbyy.',
      '...bbbbbby..',
      '..bbbbbbb...',
      '.bbbbbbbbb..',
      '.bbbpbbbbb..',
      '.bbppbbbb...',
      '..bbbbbbb...',
      '...y...y....',
      '..yy..yy....',
    ],
  },
  ghost: {
    palette: { w: '#cfe8ff', s: '#8fb0d6', k: K },
    rows: [
      '....wwww....',
      '...wwwwww...',
      '..wwwwwwww..',
      '..wkkwwkkw..',
      '..wkkwwkkw..',
      '..wwwwwwww..',
      '..wwwkkwww..',
      '..wwwkkwww..',
      '..wwwwwwww..',
      '..swwwwwws..',
      '..sw.ww.ws..',
      '..s..ss..s..',
    ],
  },
  bat: {
    palette: { p: '#7a35c8', w: '#f1e8ff', v: '#d08bff', k: K },
    rows: [
      '............',
      'p..........p',
      'pp...pp...pp',
      'ppp.pppp.ppp',
      'pppppppppppp',
      'ppppwwwwpppp',
      'pp.pwvkwp.pp',
      'p..pwvkwp..p',
      '....pwwp....',
      '.....pp.....',
      '....p..p....',
      '............',
    ],
  },
  skeleton: {
    palette: { w: '#efe8d2', s: '#a89f86', k: K },
    rows: [
      '...wwwwww...',
      '..wwwwwwww..',
      '..wkkwwkkw..',
      '..wkkwwkkw..',
      '..wwwkkwww..',
      '...swwwws...',
      '...wkwkwk...',
      '....wwww....',
      '..w.swws.w..',
      '..w.wkkw.w..',
      '....w..w....',
      '...ss..ss...',
    ],
  },
  rat: {
    palette: { g: '#9a93a6', p: '#ff8fa8', y: '#ffc531', k: K },
    rows: [
      '............',
      '.gg....gg...',
      '.gpg..gpg...',
      '..gggggg....',
      '..gkggkg....',
      '..gggggg.yy.',
      '...gppg.yyyy',
      '..gggggggyy.',
      '.ggggggggg..',
      '.ggggggggg..',
      '..gg...gg...',
      '.pp....pp...',
    ],
  },
  hound: {
    palette: { r: '#a3202c', d: '#6a121c', w: '#f4efe0', y: '#ffd23d' },
    rows: [
      '............',
      '.r.r..r.r...',
      '.rrr..rrr...',
      '.ryr..ryr...',
      '.rrrr.rrrr..',
      '.rww..rww...',
      '..rrrrrrr...',
      '..rrrrrrrr..',
      '..rrrrrrrrr.',
      '..drrrrrd.r.',
      '..d.r.r.d...',
      '..d.r.r.d...',
    ],
  },
  cat: {
    palette: { b: '#4b4268', g: '#5bffb2', p: '#ff8fa8' },
    rows: [
      '............',
      '..b.....b...',
      '..bb...bb...',
      '..bbbbbbb...',
      '..bgbbbgb...',
      '..bbbpbbb...',
      '...bbbbb..b.',
      '..bbbbbbb.b.',
      '..bbbbbbb.b.',
      '..bbbbbbbbb.',
      '..bb.b.bb...',
      '..bb.b.bb...',
    ],
  },
  owl: {
    palette: { n: '#7a5632', t: '#c09a62', w: '#f4efe0', y: '#ffc531', k: K },
    rows: [
      '............',
      '..n......n..',
      '..nnnnnnnn..',
      '..nwwnnwwn..',
      '..nwknnkwn..',
      '..nwwyywwn..',
      '..nnnyynnn..',
      '.nntnnnntnn.',
      '.nnnttttnnn.',
      '.nnnttttnnn.',
      '..nnnnnnnn..',
      '...yy..yy...',
    ],
  },
  mimic: {
    palette: { y: '#f2b324', n: '#6a4324', w: '#f4efe0', r: '#c2161a', k: K },
    rows: [
      '............',
      '..yyyyyyyy..',
      '.ynnnnnnnny.',
      '.ynnnnnnnny.',
      '.yyyyyyyyyy.',
      '.kwkwkwkwkk.',
      '.krrrrrrrrk.',
      '.kkwkwkwkwk.',
      '.yyyyyyyyyy.',
      '.ynnnyynnny.',
      '.ynnnyynnny.',
      '.yyyyyyyyyy.',
    ],
  },
};

export const ART_SIZE = 12;

/** 玩偶的像素格：每格是颜色或 null（透明）。3D 体素模型从这份数据挤出来 */
export function dollPixels(id: DollId): (string | null)[][] {
  const { palette, rows } = ART[id];
  return rows.map((row) => Array.from({ length: ART_SIZE }, (_, x) => palette[row[x]] ?? null));
}

/** 四周各留 1 像素给描边 */
export const DOLL_ART_SIZE = ART_SIZE + 2;
const OUTLINE = '#f4efe0';

/** 画成一张带浅色描边的小画布（3D 贴图和界面图标共用）。深色玩偶在暗背景上全靠这圈描边才看得清 */
export function dollCanvas(id: DollId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = DOLL_ART_SIZE;
  const g = c.getContext('2d')!;
  const { palette, rows } = ART[id];
  const solid = (x: number, y: number) => palette[rows[y]?.[x]] !== undefined;
  g.fillStyle = OUTLINE;
  for (let y = -1; y <= ART_SIZE; y++) {
    for (let x = -1; x <= ART_SIZE; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
        g.fillRect(x + 1, y + 1, 1, 1);
      }
    }
  }
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  });
  return c;
}

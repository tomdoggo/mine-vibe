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

export const DOLL_ART_SIZE = 12;

/** 画成一张 12×12 的小画布（3D 贴图和商店图标共用） */
export function dollCanvas(id: DollId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = DOLL_ART_SIZE;
  const g = c.getContext('2d')!;
  const { palette, rows } = ART[id];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

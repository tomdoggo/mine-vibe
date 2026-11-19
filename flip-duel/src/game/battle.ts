import { BOARD_SIZE, CONFIG } from './config.ts';
import { baseScore, cloneCard, defOf, fxText, TIER_MULT, type Card } from './cards.ts';
import { makeRng, shuffle, type Rng } from './rng.ts';

export type Side = 0 | 1; // 0 = 我方（A），1 = 对手（B）
export interface Slot { card: Card; side: Side }

export interface Mark { index: number; kind: 'buff' | 'debuff' | 'destroy' | 'grow'; v: number }
export interface Flip {
  index: number;
  side: Side;
  /** 这张牌本轮最终得分（已乘轮次倍率） */
  points: number;
  /** 被摧毁 / 被封锁时为 true，得 0 分且不触发效果 */
  blocked?: 'destroyed' | 'silenced';
  /** 自身永久成长了多少 */
  gained: number;
  stolen: number;
  gold: number;
  marks: Mark[];
  /** 触发了哪些效果（给「记录」窗口用；纯点数的牌为空） */
  notes: string[];
  /** 这张卡原本的点数（底分 + 永久成长，翻开那一刻），界面用它判断本轮是加了（绿）还是减了（红） */
  own: number;
}

const R = CONFIG.rows;
const C = CONFIG.cols;
const rowOf = (i: number) => Math.floor(i / C);
const colOf = (i: number) => i % C;
const NEIGHBORS: number[][] = Array.from({ length: BOARD_SIZE }, (_, i) => {
  const r = rowOf(i), c = colOf(i);
  const out: number[] = [];
  if (r > 0) out.push(i - C);
  if (r < R - 1) out.push(i + C);
  if (c > 0) out.push(i - 1);
  if (c < C - 1) out.push(i + 1);
  return out;
});
const isEdge = (i: number) => rowOf(i) === 0 || rowOf(i) === R - 1 || colOf(i) === 0 || colOf(i) === C - 1;
const isCorner = (i: number) => (rowOf(i) === 0 || rowOf(i) === R - 1) && (colOf(i) === 0 || colOf(i) === C - 1);
const hasShield = (c: Card) => defOf(c).fx.some((f) => f[0] === 'shield');

/**
 * 一场对战 = 3 轮。每轮：双方卡组各自洗牌，轮流从顶上抽，随机位置铺满 20 格，
 * 一方抽空后由另一方补满；然后先上后下、先左后右逐张结算效果。
 */
export class Battle {
  readonly decks: [Card[], Card[]];
  readonly rng: Rng;
  readonly gold: [number, number];
  round = 0;
  totals: [number, number] = [0, 0];
  roundTotals: [number, number][] = [];
  board: (Slot | null)[] = [];
  goldEarned: [number, number] = [0, 0];

  constructor(a: Card[], b: Card[], seed: number, gold: [number, number] = [0, 0]) {
    // 拷贝一份：永久成长在对战中途就生效，结束后再写回玩家卡组
    this.decks = [a.map(cloneCard), b.map(cloneCard)];
    this.rng = makeRng(seed);
    this.gold = gold;
  }

  get done() { return this.round >= CONFIG.rounds; }
  get mult() { return CONFIG.roundMult[Math.min(this.round, CONFIG.rounds - 1)]; }

  deal(): (Slot | null)[] {
    const piles = this.decks.map((d) => shuffle(this.rng, [...d]));
    const drawn: Slot[] = [];
    let turn: Side = this.rng() < 0.5 ? 0 : 1;
    while (drawn.length < BOARD_SIZE && (piles[0].length || piles[1].length)) {
      const side: Side = piles[turn].length ? turn : ((1 - turn) as Side);
      drawn.push({ card: piles[side].pop()!, side });
      turn = (1 - turn) as Side;
    }
    const pos = shuffle(this.rng, [...Array(BOARD_SIZE).keys()]);
    this.board = Array(BOARD_SIZE).fill(null);
    drawn.forEach((s, i) => (this.board[pos[i]] = s));
    return this.board;
  }

  resolve(): Flip[] {
    const b = this.board;
    const m = this.mult;
    const mod = new Array<number>(BOARD_SIZE).fill(0);
    const dead = new Array<boolean>(BOARD_SIZE).fill(false);
    const done = new Array<boolean>(BOARD_SIZE).fill(false);
    const nextAdd = [0, 0];
    const nextMul = [1, 1];
    const silenced = [false, false];
    const virus = [0, 0]; // 病毒：本轮之后该方每张牌扣的分
    const rt: [number, number] = [0, 0];
    const flips: Flip[] = [];
    let prevRaw = 0;

    const sideAt = (j: number) => b[j]?.side;
    const count = (idx: number[], side: Side) => idx.filter((j) => sideAt(j) === side).length;

    for (let i = 0; i < BOARD_SIZE; i++) {
      const slot = b[i];
      if (!slot) continue;
      const { card, side: s } = slot;
      const e = (1 - s) as Side;
      const def = defOf(card);
      const tm = TIER_MULT[card.tier];
      const shield = hasShield(card);
      done[i] = true;
      const f: Flip = { index: i, side: s, points: 0, gained: 0, stolen: 0, gold: 0, marks: [], notes: [], own: 0 };

      let blocked: Flip['blocked'];
      if (dead[i] && !shield) blocked = 'destroyed';
      else if (silenced[s]) {
        silenced[s] = false;
        if (!shield) blocked = 'silenced';
      }
      if (blocked) {
        f.blocked = blocked;
        f.own = (baseScore(card) + card.bonus) * m;
        f.notes.push(blocked === 'destroyed' ? '被摧毁，得 0 分' : '被封锁，得 0 分');
        flips.push(f);
        prevRaw = 0;
        continue;
      }

      // ---------- 计分 ----------
      let raw = baseScore(card) + card.bonus + mod[i];
      if (mod[i] > 0) f.notes.push(`受相邻友方加成 +${mod[i]}`);
      if (mod[i] < 0) f.notes.push(`受相邻敌方削弱 ${mod[i]}`);
      const r = rowOf(i), c = colOf(i);
      for (const fx of def.fx) {
        const [op, n = 0, tag] = fx;
        const v = n * tm;
        const before = raw;
        switch (op) {
          case 'grow': card.bonus += v; raw += v; f.gained += v; break;
          case 'adjAlly': raw += v * count(NEIGHBORS[i], s); break;
          case 'adjEnemy': raw += v * count(NEIGHBORS[i], e); break;
          case 'rowAlly': raw += v * count([...Array(C).keys()].map((k) => r * C + k).filter((j) => j !== i), s); break;
          case 'colAlly': raw += v * count([...Array(R).keys()].map((k) => k * C + c).filter((j) => j !== i), s); break;
          case 'prevAlly': raw += v * count([...Array(i).keys()], s); break;
          case 'alone': if (count(NEIGHBORS[i], s) === 0) raw += v; break;
          case 'edge': if (isEdge(i)) raw += v; break;
          case 'corner': if (isCorner(i)) raw += v; break;
          case 'center': if (!isEdge(i)) raw += v; break;
          case 'early': if (r < 2) raw += v; break;
          case 'late': if (r >= R - 2) raw += v; break;
          case 'round3': if (this.round === CONFIG.rounds - 1) raw += v; break;
          case 'scaleRound': raw += v * (this.round + 1); break;
          case 'perTag': raw += v * this.decks[s].filter((o) => o !== card && defOf(o).tags.includes(tag!)).length; break;
          case 'perGold': raw += v * Math.floor(this.gold[s] / 5); break;
          case 'copyPrev': raw += prevRaw; break;
        }
        if (op === 'grow') f.notes.push(`永久成长 +${v}`);
        else if (raw !== before) f.notes.push(`${fxText(fx, card.tier)}：${raw > before ? '+' : ''}${raw - before}`);
      }
      if (nextAdd[s] > 0) f.notes.push(`受上一张友方加成 +${nextAdd[s]}`);
      if (nextAdd[s] < 0) f.notes.push(shield ? '免疫了敌方削弱' : `受敌方削弱 ${nextAdd[s]}`);
      if (!(shield && nextAdd[s] < 0)) raw += nextAdd[s];
      nextAdd[s] = 0;
      if (virus[s]) f.notes.push(shield ? '免疫了病毒' : `中病毒 -${virus[s]}`);
      if (!shield) raw -= virus[s];
      if (nextMul[s] > 1) f.notes.push(`得分 ×${nextMul[s]}`);
      raw = Math.max(0, raw) * nextMul[s];
      nextMul[s] = 1;
      f.points = raw * m;
      f.own = (baseScore(card) + card.bonus) * m;
      this.totals[s] += f.points;
      rt[s] += f.points;

      // ---------- 翻开后的效果 ----------
      const enemyTargets = (idx: number[]) => idx.filter((j) => sideAt(j) === e && !done[j] && !hasShield(b[j]!.card));
      for (const [op, n = 0, tag] of def.fx) {
        const v = n * tm;
        switch (op) {
          case 'growAdj': {
            let k = 0;
            for (const j of NEIGHBORS[i]) if (sideAt(j) === s) { b[j]!.card.bonus += v; f.marks.push({ index: j, kind: 'grow', v }); k++; }
            if (k) f.notes.push(`相邻 ${k} 张友方永久 +${v}`);
            break;
          }
          case 'growTag': {
            const hit = this.decks[s].filter((o) => defOf(o).tags.includes(tag!));
            for (const o of hit) o.bonus += v;
            if (hit.length) f.notes.push(`卡组里 ${hit.length} 张【${tag}】永久 +${v}`);
            break;
          }
          case 'growRandom': {
            const others = this.decks[s].filter((o) => o !== card);
            if (others.length) {
              const o = others[Math.floor(this.rng() * others.length)];
              o.bonus += v;
              f.notes.push(`【${defOf(o).name}】永久 +${v}`);
            }
            break;
          }
          case 'buffAdj': {
            let k = 0;
            for (const j of NEIGHBORS[i]) if (sideAt(j) === s && !done[j]) { mod[j] += v; f.marks.push({ index: j, kind: 'buff', v }); k++; }
            if (k) f.notes.push(`相邻 ${k} 张未翻开友方本轮 +${v}`);
            break;
          }
          case 'buffNext': nextAdd[s] += v; f.notes.push(`下一张友方 +${v}`); break;
          case 'doubleNext': nextMul[s] *= 1 + tm; f.notes.push(`下一张友方得分 ×${1 + tm}`); break;
          case 'debuffAdj': {
            const ts = enemyTargets(NEIGHBORS[i]);
            for (const j of ts) { mod[j] -= v; f.marks.push({ index: j, kind: 'debuff', v }); }
            if (ts.length) f.notes.push(`相邻 ${ts.length} 张敌方本轮 -${v}`);
            break;
          }
          case 'debuffNext': nextAdd[e] -= v; f.notes.push(`下一张敌方 -${v}`); break;
          case 'silenceNext': silenced[e] = true; f.notes.push('封锁下一张敌方'); break;
          case 'destroyAdjEnemy': {
            const ts = enemyTargets(NEIGHBORS[i]);
            for (const j of ts) { dead[j] = true; f.marks.push({ index: j, kind: 'destroy', v: 0 }); }
            if (ts.length) f.notes.push(`摧毁相邻 ${ts.length} 张敌方`);
            break;
          }
          case 'destroyRandomEnemy': {
            const pool = enemyTargets([...Array(BOARD_SIZE).keys()]).filter((j) => !dead[j]);
            shuffle(this.rng, pool);
            const ts = pool.slice(0, tm * Math.max(1, n));
            for (const j of ts) { dead[j] = true; f.marks.push({ index: j, kind: 'destroy', v: 0 }); }
            if (ts.length) f.notes.push(`随机摧毁 ${ts.length} 张敌方`);
            break;
          }
          case 'steal': {
            const x = Math.min(v * m, this.totals[e]);
            this.totals[e] -= x; rt[e] -= x;
            this.totals[s] += x; rt[s] += x;
            f.stolen += x;
            if (x) f.notes.push(`从对手偷走 ${x} 分`);
            break;
          }
          case 'virus': virus[e] += v; f.notes.push(`本轮之后敌方每张 -${v}`); break;
          case 'gold': this.goldEarned[s] += v; f.gold += v; f.notes.push(`获得 ${v} 金`); break;
        }
      }
      prevRaw = raw;
      flips.push(f);
    }
    this.roundTotals.push(rt);
    this.round++;
    return flips;
  }

  winner(): Side | 'draw' {
    const [a, b] = this.totals;
    return a === b ? 'draw' : a > b ? 0 : 1;
  }
}

/** 不带动画直接打完，模拟和 AI 用 */
export function quickBattle(a: Card[], b: Card[], seed: number, gold: [number, number] = [0, 0]): Battle {
  const bt = new Battle(a, b, seed, gold);
  while (!bt.done) { bt.deal(); bt.resolve(); }
  return bt;
}

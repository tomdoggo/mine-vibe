import { CONFIG } from '../game/config.ts';
import type { Battle, Flip } from '../game/battle.ts';
import type { Card } from '../game/cards.ts';
import { backHTML, cardHTML, esc } from './cardView.ts';
import type { BackKind } from './art.ts';
import type { LiveState } from './cardView.ts';

export interface BattleViewOpts {
  battle: Battle;
  myName: string;
  foeName: string;
  /** 双方卡背（按职业）；敌方牌带红色光晕 */
  backs: [BackKind, BackKind];
  onDone: (root: HTMLElement) => void;
  /** 点已翻开的牌看详情 */
  onInspect?: (card: Card, live?: LiveState) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** x8 时：整盘翻开 20 张 × 25ms 错开 + 单张 220ms */
const BOARD_FLIP_MS = 20 * 25 + 240;
/** x8 时：整轮效果结算大约用时 */
const RESOLVE_MS = 2000;

/** 播放速度 x1 / x2 / x4 / x8（默认 x8 最快），记在本机 */
const SPEEDS = [1, 2, 4, 8] as const;
const SPEED_KEY = 'flipduel.speed';
function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    if ((SPEEDS as readonly number[]).includes(v)) return v;
  } catch { /* ignore */ }
  return 8;
}

/**
 * 对战画面。每一轮：发牌（背面朝上）→ 点底部圆形按钮「翻开」→ 整盘翻开 → 先上后下、先左后右结算效果。
 * 同一个圆形按钮依次变成：翻开 → 快进 → 继续 / 结果。
 * 左下：「重播」把刚结算完的这一轮从翻牌开始再放一遍；旁边的速度按钮在 x1/x2/x4/x8 之间切换。
 */
export function mountBattle(root: HTMLElement, o: BattleViewOpts) {
  const bt = o.battle;
  root.innerHTML = `
  <div class="battle">
    <div class="scorebar">
      <div class="sb me"><div class="sb-name">${esc(o.myName)}</div><div class="sb-score" data-s="0">0</div></div>
      <div class="round-now">第 <b>1</b> / ${CONFIG.rounds} 轮</div>
      <div class="sb foe"><div class="sb-name">${esc(o.foeName)}</div><div class="sb-score" data-s="1">0</div></div>
    </div>
    <div class="board-wrap"><div class="board"></div></div>
    <div class="controls round-controls">
      <div class="ctl-left">
        <button class="small-btn" data-b="replay" disabled>重播</button>
        <button class="small-btn speed-btn" data-b="speed"></button>
      </div>
      <button class="round-btn" data-b="main"><span>翻开</span></button>
      <span></span>
    </div>
  </div>`;

  const board = root.querySelector<HTMLElement>('.board')!;
  const mainBtn = root.querySelector<HTMLButtonElement>('[data-b=main]')!;
  const mainLabel = mainBtn.querySelector('span')!;
  const replayBtn = root.querySelector<HTMLButtonElement>('[data-b=replay]')!;
  const speedBtn = root.querySelector<HTMLButtonElement>('[data-b=speed]')!;
  let speed = loadSpeed();
  /** 时间倍数：x8 = 1，x1 = 8 */
  const slow = () => 8 / speed;
  const showSpeed = () => {
    speedBtn.textContent = `x${speed}`;
    board.style.setProperty('--flipdur', `${0.22 * slow()}s`);
  };
  const scoreEl = [0, 1].map((s) => root.querySelector<HTMLElement>(`[data-s="${s}"]`)!);
  const shown: [number, number] = [0, 0];
  /** 本轮已结算的牌的即时状态（点开详情时显示） */
  const live = new Map<number, Flip>();
  let phase: 'dealt' | 'flipping' | 'resolved' = 'dealt';
  let fast = false;
  /** 本轮的结算结果和结算前的样子（重播用） */
  let lastFlips: Flip[] = [];
  let preFaces: string[] = [];
  let preTotals: [number, number] = [0, 0];

  const setMain = (label: string, mode: string) => {
    mainLabel.textContent = label;
    mainBtn.dataset.mode = mode;
  };

  /** 顶部只显示第几轮（不显示每轮比分） */
  const roundNow = root.querySelector<HTMLElement>('.round-now b')!;
  const setRounds = () => {
    roundNow.textContent = String(Math.min(bt.round + 1, CONFIG.rounds));
  };

  const bump = (side: number, delta: number) => {
    shown[side] += delta;
    const el = scoreEl[side];
    el.textContent = String(shown[side]);
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  };

  const popup = (cell: Element, cls: string, html: string) => {
    const pop = document.createElement('div');
    pop.className = `pop ${cls}`;
    pop.innerHTML = html;
    cell.appendChild(pop);
    setTimeout(() => pop.remove(), 1000);
  };

  const deal = () => {
    const slots = bt.deal();
    live.clear();
    board.innerHTML = slots
      .map((s, i) =>
        s
          ? `<div class="cell ${s.side === 0 ? 'mine' : 'theirs'} dealing" style="--d:${i * 25}ms">
               <div class="flip"><div class="face back">${backHTML(o.backs[s.side])}</div><div class="face front"></div></div>
             </div>`
          : `<div class="cell empty"></div>`,
      )
      .join('');
    phase = 'dealt';
    replayBtn.disabled = true;
    setMain('翻开', 'flip');
    setRounds();
  };

  /** 第二步：按顺序逐张结算（牌已经全部翻开了） */
  const showFlip = async (f: Flip, step: number) => {
    const cell = board.children[f.index] as HTMLElement;
    const slot = bt.board[f.index]!;
    cell.classList.add('resolving');
    live.set(f.index, f);
    cell.querySelector('.front')!.innerHTML = cardHTML(slot.card, { side: f.side, score: f.points, ref: f.own });
    const side = f.side === 0 ? 'me' : 'foe';
    if (f.blocked) {
      cell.classList.add('blocked');
      popup(cell, 'bad', f.blocked === 'destroyed' ? '💥 被摧毁' : '🔒 被封锁');
    } else {
      const extra = [
        f.gained ? `<small class="g">成长+${f.gained}</small>` : '',
        f.stolen ? `<small class="s">偷 ${f.stolen}</small>` : '',
        f.gold ? `<small class="y">+${f.gold} 金</small>` : '',
      ].join('');
      popup(cell, side, `+${f.points}${extra}`);
      bump(f.side, f.points + f.stolen);
      if (f.stolen) bump(1 - f.side, -f.stolen);
    }
    for (const mk of f.marks) {
      const target = board.children[mk.index] as HTMLElement;
      target.classList.remove('mk-buff', 'mk-debuff', 'mk-destroy', 'mk-grow');
      void target.offsetWidth;
      target.classList.add(`mk-${mk.kind}`);
      const label = { buff: `+${mk.v}`, debuff: `-${mk.v}`, destroy: '💥', grow: `永久+${mk.v}` }[mk.kind];
      popup(target, `mark ${mk.kind}`, label);
    }
    if (!fast) await sleep(f.marks.length || f.blocked ? step * 1.6 : step);
    cell.classList.remove('resolving');
    cell.classList.add('resolved');
  };

  /** 播放一轮：整盘翻开 → 逐张结算（x8 时约 0.7s + 2s，速度越慢越久） */
  const play = async () => {
    phase = 'flipping';
    fast = false;
    replayBtn.disabled = true;
    setMain('快进', 'skip');
    const k = slow();
    // 第一步：先把整个盘面翻开（显示结算前的分数）
    bt.board.forEach((slot, i) => {
      if (!slot) return;
      const cell = board.children[i] as HTMLElement;
      cell.querySelector('.front')!.innerHTML = preFaces[i];
      cell.style.setProperty('--fd', `${i * 25 * k}ms`);
      cell.classList.add('open');
    });
    if (!fast) await sleep(BOARD_FLIP_MS * k);
    // 第二步：先上后下、先左后右结算效果
    const weight = lastFlips.reduce((s, f) => s + (f.marks.length || f.blocked ? 1.6 : 1), 0);
    const step = Math.min(160, RESOLVE_MS / Math.max(1, weight)) * k;
    for (const f of lastFlips) await showFlip(f, step);
    // 以引擎的总分为准（防止显示累计误差）
    shown[0] = bt.totals[0]; shown[1] = bt.totals[1];
    scoreEl[0].textContent = String(shown[0]);
    scoreEl[1].textContent = String(shown[1]);
    phase = 'resolved';
    replayBtn.disabled = false;
    if (bt.done) setMain('结果', 'result');
    else setMain('继续', 'next');
  };

  const flipAll = async () => {
    if (phase !== 'dealt') return;
    // 记下结算前的样子，再让引擎算出整轮结果
    preFaces = bt.board.map((slot) => (slot ? cardHTML(slot.card, { side: slot.side }) : ''));
    preTotals = [shown[0], shown[1]];
    lastFlips = bt.resolve();
    await play();
  };

  /** 重播：牌瞬间盖回去，分数退回本轮开始前，再从翻牌开始放一遍 */
  const replay = async () => {
    if (phase !== 'resolved' || !lastFlips.length) return;
    board.classList.add('no-anim');
    for (const cell of board.children as HTMLCollectionOf<HTMLElement>) {
      cell.classList.remove('open', 'resolving', 'resolved', 'blocked', 'mk-buff', 'mk-debuff', 'mk-destroy', 'mk-grow', 'dealing');
      cell.querySelectorAll('.pop').forEach((p) => p.remove());
    }
    void board.offsetWidth;
    board.classList.remove('no-anim');
    live.clear();
    shown[0] = preTotals[0]; shown[1] = preTotals[1];
    scoreEl[0].textContent = String(shown[0]);
    scoreEl[1].textContent = String(shown[1]);
    await play();
  };

  replayBtn.onclick = () => void replay();
  speedBtn.onclick = () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* ignore */ }
    showSpeed();
  };
  showSpeed();

  mainBtn.onclick = () => {
    if (phase === 'dealt') void flipAll();
    else if (phase === 'flipping') fast = true;
    else if (bt.done) o.onDone(root);
    else deal();
  };
  board.onclick = (e) => {
    if (phase === 'dealt') return void flipAll();
    const cell = (e.target as HTMLElement).closest('.cell.open');
    if (!cell || !o.onInspect) return;
    const idx = [...board.children].indexOf(cell);
    const slot = bt.board[idx];
    const f = live.get(idx);
    if (slot) o.onInspect(slot.card, f && { score: f.points, ref: f.own, notes: f.notes, blocked: !!f.blocked });
  };

  deal();
}

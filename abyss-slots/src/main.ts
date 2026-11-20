import './style.css';
import { BIG_WIN_MULT, CONFIG, SYMBOLS } from './game/config.ts';
import { clampBet, isOver, newSession, spin, type Session } from './game/slot.ts';
import { makeRng, randomSeed } from './game/rng.ts';
import { MOUTH, SLOT, Stage } from './render/scene.ts';
import { symbolCanvas } from './render/symbols.ts';
import { isMuted, setMuted, sfx, unlock } from './audio.ts';
import { load, save } from './storage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  coins: $('coins'), coinsBox: $('coins').parentElement!, spins: $('spins'), bet: $('bet'),
  range: $<HTMLInputElement>('bet-range'), spin: $<HTMLButtonElement>('spin'),
  banner: $('banner'), modal: $('modal'), mute: $('btn-mute'),
};

const BEST_KEY = 'abyss-slots:best';
const params = new URLSearchParams(location.search);
/** 网址加 ?seed=123 可以复现同一局 */
const rng = makeRng(params.has('seed') ? Number(params.get('seed')) : randomSeed());

let session: Session = newSession();
let bet = 1;
/** 滚轮还在转 */
let spinning = false;
/** 屏幕上显示的金币数：下注立刻扣，赢的钱要等金币真正落进币盘才一枚枚加上去 */
let shown = 0;

const stage = new Stage($('stage'), (col) => sfx.reelStop(col));
const coins = stage.coins;

coins.onLand = (value) => {
  if (!value) return;
  shown += value;
  el.coins.textContent = String(shown);
  el.coinsBox.classList.remove('bump');
  void el.coinsBox.offsetWidth;
  el.coinsBox.classList.add('bump');
  sfx.coin();
};
coins.onInsert = () => sfx.insert();

/* ---------------- 界面 ---------------- */

function refresh() {
  bet = clampBet(session, bet);
  el.coins.textContent = String(shown);
  el.spins.textContent = String(session.spinsLeft);
  el.bet.textContent = String(bet);
  el.range.max = String(Math.max(1, Math.min(CONFIG.maxBet, session.coins)));
  el.range.value = String(bet);
  el.spin.disabled = spinning || isOver(session);
}

function setBet(v: number) {
  if (spinning) return;
  const next = clampBet(session, v);
  if (next !== bet) sfx.click();
  bet = next;
  refresh();
}

function banner(html: string, big: boolean) {
  el.banner.className = 'banner';
  el.banner.innerHTML = html;
  void el.banner.offsetWidth;
  el.banner.className = `banner show${big ? ' big' : ''}`;
}

/** 把 total 枚金币分给 n 个模型（大奖时一枚模型代表好几枚） */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n), extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

const wait = (s: number) => new Promise<void>((r) => coins.later(s, r));

/* ---------------- 一次旋转 ---------------- */

async function doSpin() {
  if (spinning || isOver(session)) return;
  unlock();
  spinning = true;
  const before = session.coins;
  const result = spin(session, bet, rng);

  // 下注：金币从币盘飞进投币口
  shown -= result.bet;
  // 币盘里的模型数量有上限，金币特别多时不一定要真的拿走
  const extra = coins.count - Math.min(before - result.bet, coins.count);
  coins.take(Math.min(result.bet, Math.max(extra, 0)), SLOT);
  sfx.spin();
  refresh();

  await stage.reels.spin(result.grid);

  if (result.payout > 0) {
    const big = result.mult >= BIG_WIN_MULT;
    stage.reels.highlight(result.wins.map((w) => w.line));
    sfx.win(big);
    banner(`${big ? '<small>大 奖</small>' : ''}+${result.payout}`, big);

    // 金币喷出来：小奖一枚模型 = 一枚金币，大奖封顶 420 枚模型
    const n = Math.min(result.payout, 420);
    const values = split(result.payout, n);
    const dur = Math.min(0.25 + n * 0.012, 2.6);
    if (big) {
      // 大奖：一半从出币口喷，一半从天上砸下来，再加震屏
      const half = Math.ceil(n / 2);
      coins.fountain(MOUTH, values.slice(0, half), dur, 1.15);
      coins.rain(values.slice(half), dur + 0.6);
      stage.punch(1, 1);
    } else {
      coins.fountain(MOUTH, values, dur);
    }
    for (let t = 0; t < dur; t += 0.1) coins.later(t, () => stage.glowMouth(big ? 1 : 0.7));
    await wait(big ? 0.9 : 0.35);
  } else {
    await wait(0.12);
  }

  spinning = false;
  refresh();
  if (isOver(session)) void finish();
}

/* ---------------- 结算 ---------------- */

async function finish() {
  // 等金币都落完再弹结算
  while (coins.busy) await wait(0.2);
  await wait(0.5);
  const final = session.coins;
  const best = Math.max(final, Number(load(BEST_KEY) ?? 0));
  save(BEST_KEY, String(best));
  const bust = final < CONFIG.minBet;
  const profit = final - CONFIG.startCoins;
  if (bust) sfx.lose();
  else if (profit > 0) sfx.win(final >= 100);
  const title = bust ? '输个精光' : profit > 0 ? (final >= 200 ? '满载而归' : '小赚一笔') : '白忙一场';
  const used = CONFIG.maxSpins - session.spinsLeft;
  showModal(`
    <h2>${title}</h2>
    <p>${bust ? `第 ${used} 转就把金币输光了` : `${CONFIG.maxSpins} 转结束，最终金币`}</p>
    <div class="final">${final}</div>
    <p>本局最高 ${session.peak} · 历史最佳 ${best}</p>
    <button class="btn" data-act="restart">再来一局</button>
  `);
}

function showModal(html: string) {
  el.modal.innerHTML = `<div class="card">${html}</div>`;
  el.modal.hidden = false;
}

function showPaytable() {
  const rows = [...SYMBOLS].reverse().map((s) => `<tr><td data-sym="${s.id}"></td><td>${s.name} ×3</td><td>×${s.mult}</td></tr>`).join('');
  showModal(`
    <h2>玩法</h2>
    <p>${CONFIG.startCoins} 枚金币开局，每转自选押 ${CONFIG.minBet}–${CONFIG.maxBet} 枚。<br>
    横、竖、斜共 8 条线，任意一条三连即中奖，<br>奖金 = 下注 × 赔率，多条线叠加。<br>
    目标：${CONFIG.maxSpins} 转之内赢到尽可能多的金币。</p>
    <table class="pay">${rows}</table>
    <button class="btn" data-act="close">知道了</button>
  `);
  el.modal.querySelectorAll<HTMLElement>('[data-sym]').forEach((td) => {
    td.appendChild(symbolCanvas(td.dataset.sym as (typeof SYMBOLS)[number]['id'], false));
  });
}

function restart() {
  session = newSession();
  bet = 1;
  shown = 0;
  spinning = false;
  coins.reset();
  stage.reels.clearHighlight();
  // 开局的金币也从出币口吐出来
  coins.fountain(MOUTH, split(session.coins, session.coins), 0.5, 0.8);
  refresh();
}

/* ---------------- 事件 ---------------- */

el.spin.addEventListener('click', () => void doSpin());
$('bet-minus').addEventListener('click', () => setBet(bet - 1));
$('bet-plus').addEventListener('click', () => setBet(bet + 1));
$('bet-max').addEventListener('click', () => setBet(CONFIG.maxBet));
el.range.addEventListener('input', () => setBet(Number(el.range.value)));
$('btn-info').addEventListener('click', () => { unlock(); sfx.click(); showPaytable(); });
el.mute.addEventListener('click', () => {
  unlock();
  setMuted(!isMuted());
  el.mute.classList.toggle('off', isMuted());
});
el.mute.classList.toggle('off', isMuted());
el.modal.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (!act) return;
  unlock();
  sfx.click();
  el.modal.hidden = true;
  if (act === 'restart') restart();
});
window.addEventListener('keydown', (e) => {
  if (!el.modal.hidden) return;
  if (e.code === 'Space') { e.preventDefault(); void doSpin(); }
  if (e.code === 'ArrowLeft') setBet(bet - 1);
  if (e.code === 'ArrowRight') setBet(bet + 1);
});

/* ---------------- 主循环 ---------------- */

let last = performance.now();
function frame(now: number) {
  // 切后台回来时 dt 会很大，夹一下避免金币瞬移
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  stage.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

restart();
if (import.meta.env.DEV) {
  // 调试用：控制台里 __slot.win(500) 直接看金币雨
  (window as unknown as Record<string, unknown>).__slot = {
    stage,
    get session() { return session; },
    win(n: number, big = n >= 100) {
      session.coins += n;
      const k = Math.min(n, 420);
      if (big) { coins.fountain(MOUTH, split(n, k).slice(0, k >> 1), 2, 1.15); coins.rain(split(n, k).slice(k >> 1), 2.6); stage.punch(1, 1); }
      else coins.fountain(MOUTH, split(n, k), 1);
      refresh();
    },
  };
}

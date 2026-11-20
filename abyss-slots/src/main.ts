import './style.css';
import { BIG_WIN_MULT, CONFIG, DOLLS, SYMBOLS, type DollId, type SymbolId } from './game/config.ts';
import {
  abyssLevel, clampBet, DOLL_BY_ID, isOver, MAX_DOLLS, maxBetOf, newSession, offerDue, rollOffer, SELL_PRICE,
  sellDoll, skipOffer, spin, SYMBOL_BY_ID, symbolOdds, takeDoll,
  type Session, type SpinResult,
} from './game/slot.ts';
import { makeRng, randomSeed } from './game/rng.ts';
import { MOUTH, SLOT, Stage } from './render/scene.ts';
import { symbolCanvas } from './render/symbols.ts';
import { dollCanvas } from './render/dollArt.ts';
import { isMuted, setMuted, sfx, unlock } from './audio.ts';
import { load, save } from './storage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  coins: $('coins'), coinsBox: $('coins').parentElement!, spins: $('spins'), abyss: $('abyss'), bet: $('bet'),
  hud: document.querySelector<HTMLElement>('.hud')!, panel: document.querySelector<HTMLElement>('.panel')!,
  range: $<HTMLInputElement>('bet-range'), spin: $<HTMLButtonElement>('spin'),
  banner: $('banner'), toasts: $('toasts'), modal: $('modal'), mute: $('btn-mute'),
};

const BEST_KEY = 'abyss-slots:best';
const params = new URLSearchParams(location.search);
/** 网址加 ?seed=123 可以复现同一局 */
const rng = makeRng(params.has('seed') ? Number(params.get('seed')) : randomSeed());

let session: Session = newSession();
let bet = 1;
/** 滚轮还在转 */
let spinning = false;
/** 屏幕上显示的金币数：花钱立刻扣，赚的钱要等金币真正落进币盘才一枚枚加上去 */
let shown = 0;

const stage = new Stage($('stage'), (col) => sfx.reelStop(col));
const coins = stage.coins;

coins.onLand = (value) => {
  if (!value) return;
  shown += value;
  el.coins.textContent = fmt(shown);
  el.coinsBox.classList.remove('bump');
  void el.coinsBox.offsetWidth;
  el.coinsBox.classList.add('bump');
  sfx.coin();
};
coins.onInsert = () => sfx.insert();

/* ---------------- 界面 ---------------- */

/** 顶栏位置有限，金币太多时缩写成“万 / 亿” */
function fmt(n: number) {
  if (n >= 1e8) return `${Math.floor(n / 1e6) / 100}亿`;
  if (n >= 1e5) return `${Math.floor(n / 1e3) / 10}万`;
  return String(n);
}

/** 告诉 3D 镜头顶栏和底部面板各占了多高，机器要完整露在两者之间 */
function syncInsets() {
  const app = document.getElementById('app')!.getBoundingClientRect();
  // 两条界面的边缘都是渐变淡出的，淡出那一段不算遮挡
  const top = el.hud.getBoundingClientRect().bottom - app.top - 12;
  const bottom = app.bottom - el.panel.getBoundingClientRect().top - 20;
  stage.setInsets(Math.max(0, Math.round(top)), Math.max(0, Math.round(bottom)));
}

function refresh() {
  bet = clampBet(session, bet);
  el.coins.textContent = fmt(shown);
  el.spins.textContent = String(session.spinsLeft);
  el.abyss.textContent = String(abyssLevel(session));
  el.bet.textContent = String(bet);
  el.range.max = String(Math.max(1, Math.min(maxBetOf(session), session.coins)));
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

/** 飘字提示：玩偶触发时带头像，其他消息传 null */
function toast(doll: DollId | null, text: string) {
  const row = document.createElement('div');
  row.className = 'toast';
  if (doll) row.append(dollCanvas(doll), `${DOLL_BY_ID[doll].name} ${text}`);
  else row.append(text);
  el.toasts.appendChild(row);
  row.addEventListener('animationend', () => row.remove());
}

/** 白拿的小额金币（跳过选择、卖玩偶）：从出币口吐出来 */
function drip(amount: number) {
  if (amount <= 0) return;
  coins.fountain(MOUTH, split(amount, amount), 0.2, 0.8);
  stage.glowMouth(0.5);
}

/** 把 total 枚金币分给 n 个模型（大奖时一枚模型代表好几枚） */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n), extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 花掉 amount 枚金币：数字立刻扣，币盘里的金币飞向 target */
function spend(amount: number, before: number, target: Parameters<typeof coins.take>[1]) {
  shown -= amount;
  // 币盘里的模型数量有上限，金币特别多时不一定要真的拿走
  const extra = coins.count - Math.min(before - amount, coins.count);
  coins.take(Math.min(amount, Math.max(extra, 0)), target);
}

const wait = (s: number) => new Promise<void>((r) => coins.later(s, r));

/* ---------------- 一次旋转 ---------------- */

/** 播放一次旋转的结果（逻辑已经结算完，这里只管演出） */
async function present(result: SpinResult) {
  if (result.free) banner('<small>免费旋转</small>', false);
  sfx.spin();
  refresh();
  await stage.reels.spin(result.grid);

  for (const e of result.events) {
    stage.dolls.trigger(e.doll);
    toast(e.doll, e.text);
  }
  const gain = result.payout + result.refund + result.interest;
  if (result.payout > 0) {
    const big = result.payout >= result.bet * BIG_WIN_MULT;
    stage.reels.highlight(result.wins.map((w) => w.line));
    sfx.win(big);
    banner(`${big ? '<small>大 奖</small>' : ''}+${result.payout}`, big);

    // 金币喷出来：小奖一枚模型 = 一枚金币，大奖封顶 420 枚模型
    const n = Math.min(gain, 420);
    const values = split(gain, n);
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
    drip(gain);
    await wait(result.events.length ? 0.3 : 0.12);
  }
}

async function doSpin() {
  if (spinning || isOver(session) || !el.modal.hidden) return;
  unlock();
  spinning = true;
  const before = session.coins;
  const level = abyssLevel(session);
  let result = spin(session, bet, rng);
  // 下注：金币从币盘飞进投币口
  spend(result.bet, before, SLOT);
  await present(result);
  // 渡鸦：免费再转，可以连锁
  for (let chain = 0; result.freeSpin && chain < 50; chain++) {
    await wait(0.45);
    result = spin(session, result.bet, rng, true);
    await present(result);
  }
  spinning = false;
  if (abyssLevel(session) > level) {
    stage.setAbyss(abyssLevel(session));
    stage.punch(0.5, 0.6);
    toast(null, `深渊 ${abyssLevel(session)} 层 · 下注上限 ${maxBetOf(session)}`);
  }
  refresh();
  if (isOver(session)) void finish();
  else offerDolls();
}

/* ---------------- 玩偶：二选一 / 出售 ---------------- */

/** 到点了就弹出玩偶选择（开局一次，之后每 offerEvery 转一次） */
function offerDolls() {
  if (!offerDue(session)) return;
  const offer = rollOffer(session, rng);
  if (!offer) return;
  const cards = offer.map((id) => `<button class="pick" data-take="${id}"><span data-doll="${id}"></span>
    <span class="name">${DOLL_BY_ID[id].name}</span><span class="desc">${DOLL_BY_ID[id].desc}</span></button>`).join('');
  showModal(`
    <h2>挑一个玩偶</h2>
    <p>摆在币盘两侧，效果一直生效（${session.dolls.length} / ${MAX_DOLLS}）</p>
    <div class="offer">${cards}</div>
    <button class="btn ghost" data-skip="1">跳过，拿 ${CONFIG.dollPrice} 金币</button>
  `);
  mountDollIcons();
}

function mountDollIcons() {
  el.modal.querySelectorAll<HTMLElement>('[data-doll]').forEach((box) => {
    box.replaceWith(dollCanvas(box.dataset.doll as DollId));
  });
}

function showDoll(id: DollId) {
  const d = DOLL_BY_ID[id];
  showModal(`
    <div class="detail-icon"><span data-doll="${id}"></span></div>
    <h2>${d.name}</h2>
    <p>${d.desc}</p>
    <button class="btn ghost" data-sell="${id}">出售，拿 ${SELL_PRICE} 金币</button>
    <button class="btn" data-act="close">留着</button>
  `);
  mountDollIcons();
}

/** 点盘面上的符号：显示算上玩偶之后的实际赔率 */
function showSymbol(id: SymbolId) {
  const o = symbolOdds(session, id);
  const changed = o.mult !== o.base;
  const notes = o.notes.map((n) => `<p class="note">${DOLL_BY_ID[n.doll].name}：${n.text}</p>`).join('');
  // 这些玩偶不改单个符号的赔率，而是满足条件时整体加成，也提醒一下
  const global = (['hound', 'cat', 'mimic'] as const).filter((d) => session.dolls.includes(d))
    .map((d) => `<p>${DOLL_BY_ID[d].name}：${DOLL_BY_ID[d].desc}</p>`).join('');
  showModal(`
    <div class="detail-icon" data-sym="${id}"></div>
    <h2>${SYMBOL_BY_ID[id].name} 三连</h2>
    <div class="odds">×${o.mult}${o.bonus ? ` +${o.bonus}` : ''}${changed ? `<s>×${o.base}</s>` : ''}</div>
    <p>奖金 = 下注 × ${o.mult}${o.bonus ? ` + ${o.bonus}` : ''}，按现在的下注 ${bet} 是 ${bet * o.mult + o.bonus} 金币</p>
    <p>每格出现概率 ${(o.chance * 100).toFixed(1)}%</p>
    ${notes}${global}
    <button class="btn" data-act="close">知道了</button>
  `);
  mountSymbolIcons();
}

function mountSymbolIcons() {
  el.modal.querySelectorAll<HTMLElement>('[data-sym]').forEach((box) => {
    box.appendChild(symbolCanvas(box.dataset.sym as SymbolId, false));
  });
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
  showModal(`
    <h2>${title}</h2>
    <p>${bust ? '金币输光了' : '转数用完，最终金币'}</p>
    <div class="final">${fmt(final)}</div>
    <p>深渊 ${abyssLevel(session)} 层 · 玩偶 ${session.dolls.length} 个<br>本局最高 ${fmt(session.peak)} · 历史最佳 ${fmt(best)}</p>
    <button class="btn" data-act="restart">再来一局</button>
  `);
}

function showModal(html: string) {
  el.modal.innerHTML = `<div class="card">${html}</div>`;
  el.modal.hidden = false;
}

function showPaytable() {
  const rows = [...SYMBOLS].reverse().map((sym) => {
    const o = symbolOdds(session, sym.id);
    return `<tr><td data-sym="${sym.id}"></td><td>${sym.name} ×3</td><td>×${o.mult}${o.bonus ? ` +${o.bonus}` : ''}</td></tr>`;
  }).join('');
  showModal(`
    <h2>玩法</h2>
    <p>${CONFIG.startCoins} 枚金币开局，${CONFIG.maxSpins} 转之内赢到尽可能多的金币。<br>
    横、竖、斜共 8 条线，三连即中奖，奖金 = 下注 × 赔率。<br>
    每转 ${CONFIG.abyssEvery} 次深渊加深一层，下注上限翻倍。<br>
    开局和每转 ${CONFIG.offerEvery} 次可以二选一拿一个玩偶，<br>点玩偶可以出售，点盘面上的符号可以看实际赔率。</p>
    <table class="pay">${rows}</table>
    <button class="btn" data-act="close">知道了</button>
  `);
  mountSymbolIcons();
}

function restart() {
  session = newSession();
  bet = 1;
  shown = 0;
  spinning = false;
  coins.reset();
  stage.reels.clearHighlight();
  stage.dolls.set(session.dolls);
  stage.setAbyss(1);
  // 开局的金币也从出币口吐出来
  coins.fountain(MOUTH, split(session.coins, session.coins), 0.5, 0.8);
  refresh();
  offerDolls();
}

/* ---------------- 事件 ---------------- */

el.spin.addEventListener('click', () => void doSpin());
$('bet-minus').addEventListener('click', () => setBet(bet - 1));
$('bet-plus').addEventListener('click', () => setBet(bet + 1));
$('bet-max').addEventListener('click', () => setBet(maxBetOf(session)));
el.range.addEventListener('input', () => setBet(Number(el.range.value)));
$('btn-info').addEventListener('click', () => { unlock(); sfx.click(); showPaytable(); });
el.mute.addEventListener('click', () => {
  unlock();
  setMuted(!isMuted());
  el.mute.classList.toggle('off', isMuted());
});
el.mute.classList.toggle('off', isMuted());
el.modal.addEventListener('click', (e) => {
  const data = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset;
  if (!data) return;
  unlock();
  if (data.take) {
    if (!takeDoll(session, data.take as DollId)) return;
    sfx.win(false);
    stage.dolls.set(session.dolls);
  } else if (data.skip) {
    sfx.click();
    drip(skipOffer(session));
  } else if (data.sell) {
    sfx.click();
    drip(sellDoll(session, data.sell as DollId));
    stage.dolls.set(session.dolls);
  } else if (data.act) {
    sfx.click();
  } else {
    return;
  }
  el.modal.hidden = true;
  refresh();
  if (data.act === 'restart') restart();
});

// 点 3D 画面：玩偶 → 详情 / 出售；盘面上的符号 → 实际赔率
let downAt: { x: number; y: number } | null = null;
$('stage').addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
$('stage').addEventListener('pointerup', (e) => {
  const moved = !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12;
  downAt = null;
  if (moved || spinning || !el.modal.hidden) return;
  const hit = stage.pick(e.clientX, e.clientY);
  if (!hit) return;
  unlock();
  sfx.click();
  if (hit.kind === 'doll') showDoll(hit.id);
  else showSymbol(hit.id);
});
new ResizeObserver(syncInsets).observe(el.hud);
new ResizeObserver(syncInsets).observe(el.panel);
syncInsets();

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
  // 调试用：控制台里 __slot.win(500) 直接看金币雨，__slot.give('raven') 白拿一个玩偶
  (window as unknown as Record<string, unknown>).__slot = {
    stage,
    get session() { return session; },
    refresh,
    win(n: number, big = n >= 100) {
      session.coins += n;
      const k = Math.min(n, 420);
      if (big) { coins.fountain(MOUTH, split(n, k).slice(0, k >> 1), 2, 1.15); coins.rain(split(n, k).slice(k >> 1), 2.6); stage.punch(1, 1); }
      else coins.fountain(MOUTH, split(n, k), 1);
      refresh();
    },
    give(id: DollId) {
      if (!session.dolls.includes(id)) session.dolls.push(id);
      stage.dolls.set(session.dolls);
    },
  };
}

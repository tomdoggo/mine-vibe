import './game/carddb.ts';
import { CONFIG } from './game/config.ts';
import { canMerge, CARD_DB, CLASS_ICON, CLASS_NAMES, defOf, makeCard, sortDeck, TIER_NAMES, type Card, type Tier } from './game/cards.ts';
import { Battle } from './game/battle.ts';
import {
  advance, buy, currentEvent, finishBattle, hasMerge, mergeAllRun, mergeByUid, newRun, nextRng,
  priceOf, refresh, sell, sellPriceOf, setPvpOpponent, takeReward, type Run,
} from './game/run.ts';
import { botGhost, deckPower } from './game/opponents.ts';
import { randomSeed, makeRng } from './game/rng.ts';
import { findGhost, uploadGhost } from './net/ghosts.ts';
import { loadName, loadRun, saveName, saveRun } from './storage.ts';
import * as builds from './buildStore.ts';
import { cardDetailHTML, cardHTML, esc, type LiveState } from './ui/cardView.ts';
import { mountBattle } from './ui/battleView.ts';
import { deckSelectHTML } from './ui/deckSelect.ts';
import { builderClick, builderHTML, builderLongPress, builderSearch, deckCode, importDeck, openBuilder } from './ui/builder.ts';

const app = document.getElementById('app')!;
let run: Run | null = loadRun();
let screen: 'title' | 'run' | 'builder' | 'select' = 'title';
let matching = false;

const save = () => saveRun(run);

/* ---------------- 小工具 ---------------- */

function toast(msg: string) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function showModal(html: string) {
  document.getElementById('modal')?.remove();
  const div = document.createElement('div');
  div.id = 'modal';
  div.innerHTML = html;
  document.body.appendChild(div);
}
const closeModal = () => { detail = null; document.getElementById('modal')?.remove(); };

/** 当前打开的卡牌详情（切换等级时重画用） */
let detail: { card: Card; actions: string; tier: Tier; raw: boolean; live?: LiveState } | null = null;
function openDetail(card: Card, actions = '', live?: LiveState) {
  detail = { card, actions, tier: card.tier, raw: false, live };
  showModal(cardDetailHTML(card, actions, card.tier, false, live));
}
/** 切等级 / 原始：只换弹窗内容，不重放淡入动画 */
function redrawDetail() {
  const box = document.querySelector('#modal .modal.detail');
  if (!detail || !box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = cardDetailHTML(detail.card, detail.actions, detail.tier, detail.raw, detail.live);
  box.innerHTML = tmp.querySelector('.modal.detail')!.innerHTML;
}

const EVENT_LABEL = { shop: '商店', wild: '野怪', pvp: '对战' } as const;
const EVENT_ICON = { shop: '🛒', wild: '👹', pvp: '⚔️' } as const;

function hudHTML(r: Run): string {
  const hpPct = (r.hp / CONFIG.maxHp) * 100;
  return `
  <header class="hud">
    <button class="h-day" data-act="title" title="回到标题（自动存档）">☰ 第 ${r.day} 天</button>
    <div class="h-hp"><i style="width:${hpPct}%"></i><span>❤ ${r.hp}/${CONFIG.maxHp}</span></div>
    <div class="h-star">★ ${r.stars}/${CONFIG.starsToWin}</div>
    <div class="h-gold">💰 ${r.gold}</div>
  </header>
  <nav class="track">
    <span class="t-cls cls-${r.cls}">${CLASS_ICON[r.cls]} ${CLASS_NAMES[r.cls]}</span>
    ${CONFIG.events.map((e, i) => `
      <div class="step ${i < r.eventIdx ? 'done' : i === r.eventIdx ? 'cur' : ''}">
        <span>${EVENT_ICON[e]}</span><small>${EVENT_LABEL[e]}</small>
      </div>`).join('')}
  </nav>`;
}

function deckHTML(deck: Card[]): string {
  const sorted = sortDeck(deck);
  return `
  <section class="deck">
    <div class="deck-head">
      <span>我的卡组 <b>${deck.length}</b> 张</span>
      <button class="btn small" data-act="merge-all" ${hasMerge(deck) ? '' : 'disabled'}>一键合成</button>
    </div>
    <p class="hint">盘面 20 格，双方轮流抽牌各占约一半，卡组超过 10 张时多出来的牌会分散。<b>两张同名同级会自动合成升一级</b>（数值翻倍，1星→2星→3星）。点卡看效果或出售。</p>
    ${deck.length
      ? `<div class="deck-grid">${sorted.map((c) => {
          const m = deck.some((o) => canMerge(c, o));
          return cardHTML(c, { badge: m ? '⬆' : '', extra: m ? 'mergeable' : '', attrs: `data-act="deck-card" data-uid="${c.uid}"` });
        }).join('')}</div>`
      : `<div class="empty-deck">卡组还是空的，去商店买几张吧</div>`}
  </section>`;
}

/* ---------------- 标题 ---------------- */

function renderTitle() {
  screen = 'title';
  const name = loadName();
  const canContinue = run && run.status === 'playing';
  // 欢迎页随机展示一张卡（点开看详情）
  const ids = [...CARD_DB.keys()];
  const heroId = ids[Math.floor(Math.random() * ids.length)];
  app.innerHTML = `
  <div class="title-screen">
    <div class="title-bar">
      <span class="me-name">${esc(name)}</span>
      <button class="gear-btn" data-act="settings" aria-label="设置">⚙</button>
    </div>
    <div class="title-top">
      <div class="logo"><span>翻牌</span><span>对决</span></div>
    </div>
    <div class="title-menu">
      <button class="title-card" data-act="card-info" data-v="${heroId}">${cardHTML(makeCard(heroId, 'x'))}</button>
      ${canContinue ? `<button class="menu-btn primary" data-act="continue">继续冒险<small>${CLASS_ICON[run!.cls]} 第 ${run!.day} 天 · ★${run!.stars}</small></button>` : ''}
      <button class="menu-btn ${canContinue ? '' : 'primary'}" data-act="start">开始冒险</button>
      <button class="menu-btn" data-act="builder">构筑卡组</button>
      <button class="menu-btn" data-act="practice">练习一局</button>
    </div>
  </div>`;
}

/** 设置弹窗：目前只有改名字 */
function openSettings() {
  showModal(`<div class="modal-bg" data-act="close-modal"><div class="modal settings" data-act="noop">
    <div class="d-name">设置</div>
    <label class="name-row">名字 <input id="set-name" maxlength="12" value="${esc(loadName())}" /></label>
    <div class="row">
      <button class="btn" data-act="close-modal">取消</button>
      <button class="btn primary" data-act="settings-save">保存</button>
    </div>
  </div></div>`);
  const input = document.querySelector<HTMLInputElement>('#set-name')!;
  input.focus();
  input.select();
  input.onkeydown = (e) => { if (e.key === 'Enter') document.querySelector<HTMLElement>('[data-act="settings-save"]')?.click(); };
}

/** 开始冒险 → 选择出战卡组 */
function renderSelect() {
  screen = 'select';
  app.innerHTML = deckSelectHTML();
}

/* ---------------- 构筑 ---------------- */

function renderBuilder() {
  // 重画前记下收藏册和卡组条的滚动位置，重画后还原（加卡/移卡时不跳回顶部）
  const keep = screen === 'builder';
  const colTop = app.querySelector('.collection')?.scrollTop ?? 0;
  const stripLeft = app.querySelector('.strip')?.scrollLeft ?? 0;
  screen = 'builder';
  app.innerHTML = builderHTML();
  if (keep) {
    const col = app.querySelector('.collection');
    if (col) col.scrollTop = colTop;
    const strip = app.querySelector('.strip');
    if (strip) strip.scrollLeft = stripLeft;
  }
  const input = app.querySelector<HTMLInputElement>('#b-search');
  if (input) input.oninput = () => builderSearch(app, input.value);
  bindLongPress(app.querySelector<HTMLElement>('.shelf'));
}

/** 收藏页：长按卡组弹出「复制 / 删除」选单 */
let swallowClickUntil = 0;

/**
 * 所有场景通用：长按任意一张卡 → 打开卡牌详情。
 * 卡面上的 data-card 带着星级、永久成长；对局里结算过的牌还带着即时分数（运行时数据）。
 * 图鉴里的卡（uid 'x'）只展示图鉴状态。
 */
(function bindCardLongPress() {
  let timer = 0;
  let start = { x: 0, y: 0 };
  const cancel = () => { clearTimeout(timer); timer = 0; };
  document.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).closest('.card[data-card]')) e.preventDefault();
  });
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.card[data-card]');
    if (!el || el.closest('.modal')) return;
    start = { x: e.clientX, y: e.clientY };
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      const [id, tier, bonus, codex, score, ref] = el.dataset.card!.split(':');
      if (!CARD_DB.has(id)) return;
      swallowClickUntil = Date.now() + 600; // 松手时的 click 不要再触发卡上的操作
      navigator.vibrate?.(15);
      const card: Card = { uid: codex === '1' ? 'x' : 'lp', id, tier: Number(tier) as Tier, bonus: Number(bonus) };
      const live = score !== undefined ? { score: Number(score), ref: Number(ref), notes: [], blocked: false } : undefined;
      openDetail(card, '', live);
    }, 450);
  });
  document.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) document.addEventListener(ev, cancel);
})();
function bindLongPress(shelf: HTMLElement | null) {
  if (!shelf) return;
  let timer = 0;
  let start = { x: 0, y: 0 };
  const cancel = () => { clearTimeout(timer); timer = 0; };
  shelf.addEventListener('contextmenu', (e) => e.preventDefault());
  shelf.addEventListener('pointerdown', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>('.deckbox[data-act="b-open"]');
    if (!box) return;
    start = { x: e.clientX, y: e.clientY };
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      swallowClickUntil = Date.now() + 600; // 松手时的 click 不要再打开卡组
      navigator.vibrate?.(15);
      builderLongPress(box.dataset.v!);
      renderBuilder();
    }, 450);
  });
  shelf.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) shelf.addEventListener(ev, cancel);
}

/** 写剪贴板：不是 https 时 navigator.clipboard 不可用，退回老办法 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return prompt('粘贴卡组代码');
  }
}

/* ---------------- 冒险中 ---------------- */

function renderRun() {
  screen = 'run';
  const r = run!;
  if (r.status !== 'playing' && !r.reward) return renderEnd();
  const ev = currentEvent(r);
  let body = '';
  if (r.reward) body = rewardHTML(r);
  else if (ev === 'shop') body = shopHTML(r);
  else if (!r.battle) {
    body = `<section class="panel center"><div class="spinner"></div><p>正在从数据库匹配对手…</p></section>`;
    void matchPvp();
  } else body = preBattleHTML(r);
  app.innerHTML = `<div class="screen">${hudHTML(r)}<main class="body">${body}</main></div>`;
}

function shopHTML(r: Run): string {
  const s = r.shop!;
  const shopNo = CONFIG.events.slice(0, r.eventIdx + 1).filter((e) => e === 'shop').length;
  const left = Object.values(r.pool).reduce((a, b) => a + b, 0);
  return `
  <section class="panel">
    <div class="panel-title">🛒 卡牌商店 <small>今天第 ${shopNo} 家 · 卡池剩 ${left} 张</small></div>
    <div class="offers">
      ${s.offers.map((c, i) => {
        if (!c) return `<div class="offer sold"><div class="sold-tag">已售出</div></div>`;
        const owned = r.deck.filter((o) => o.id === c.id && o.tier === 0).length;
        return `<div class="offer ${r.gold < priceOf(c) ? 'poor' : ''}">
          <div data-act="offer-info" data-i="${i}">${cardHTML(c, { badge: owned ? `有${owned}` : '' })}</div>
          <button class="price" data-act="buy" data-i="${i}">💰 ${priceOf(c)} 购买</button>
        </div>`;
      }).join('')}
    </div>
    <div class="row">
      <button class="btn" data-act="refresh" ${r.gold < s.refreshCost ? 'disabled' : ''}>🔄 刷新（${s.refreshCost} 金）</button>
      <button class="btn primary" data-act="next">离开商店 →</button>
    </div>
  </section>
  ${deckHTML(r.deck)}`;
}

function preBattleHTML(r: Run): string {
  const b = r.battle!;
  const wild = b.kind === 'wild';
  return `
  <section class="panel vs">
    <div class="panel-title">${wild ? '👹 野怪来袭' : '⚔️ 玩家对战'}</div>
    <div class="foe-name">${esc(b.enemyName)}</div>
    <div class="foe-info">${esc(b.enemyInfo)}</div>
    <div class="vs-row">
      <div><b>${r.deck.length}</b><small>我的卡</small><small>牌力 ≈ ${Math.round(deckPower(r.deck))}</small></div>
      <div class="vs-x">VS</div>
      <div><b>${b.enemy.length}</b><small>对手的卡</small><small>${wild ? `牌力 ≈ ${Math.round(deckPower(b.enemy))}` : '卡组保密'}</small></div>
    </div>
    ${wild ? `<div class="foe-cards">${sortDeck(b.enemy).map((c) => cardHTML(c, { attrs: `data-act="enemy-info" data-uid="${c.uid}"` })).join('')}</div>` : ''}
    ${r.deck.length ? '' : '<p class="warn">你还没有卡，这场必输 —— 但也只能硬着头皮上了</p>'}
    <button class="btn primary big" data-act="fight">开始对战</button>
    <p class="hint center">输了扣 ${CONFIG.lossDamage(r.day)} 点血，赢了 +1 星${wild ? `、+${CONFIG.wildGold(r.day)} 金和一张战利品` : ''}</p>
  </section>
  ${deckHTML(r.deck)}`;
}

function rewardHTML(r: Run): string {
  const rw = r.reward!;
  return `
  <section class="panel center reward">
    <div class="panel-title">🎁 战利品</div>
    <p>金币 <b class="gold">+${rw.gold}</b>（已到账）</p>
    ${rw.card ? `
      <p>从野怪的卡里随机掉落：</p>
      <div class="reward-card" data-act="reward-info">${cardHTML(rw.card)}</div>
      <div class="row">
        <button class="btn primary" data-act="reward-take">拿走这张卡</button>
        <button class="btn" data-act="reward-skip">跳过（+${CONFIG.skipCardGold} 金）</button>
      </div>` : `<button class="btn primary" data-act="reward-skip">继续</button>`}
  </section>
  ${deckHTML(r.deck)}`;
}

async function matchPvp() {
  if (matching || !run) return;
  matching = true;
  const r = run;
  try {
    await uploadGhost({ runId: r.runId, name: r.name, cls: r.cls, day: r.day, stars: r.stars, hp: r.hp, gold: r.gold, deck: r.deck });
    const g = await findGhost(r.day, r.runId);
    const deck = g?.deck.filter((c) => CARD_DB.has(c.id));
    if (g && deck) {
      const cls = g.cls === 'miner' || g.cls === 'hacker' ? `${CLASS_ICON[g.cls]} ${CLASS_NAMES[g.cls]} · ` : '';
      setPvpOpponent(r, deck, g.name, `${cls}第 ${g.day} 天的卡组 · 当时 ★${g.stars} ❤${g.hp}`, g.gold ?? 0, g.cls);
    } else {
      const bot = botGhost(r.day, nextRng(r));
      setPvpOpponent(r, bot.deck, bot.name, `${CLASS_ICON[bot.cls]} ${CLASS_NAMES[bot.cls]} · 数据库里暂时没有别人的卡组，先和 AI 打`, bot.gold, bot.cls);
    }
    save();
  } finally {
    matching = false;
  }
  if (run === r && screen === 'run') renderRun();
}

function startBattle() {
  const r = run!;
  const b = r.battle!;
  const bt = new Battle(r.deck, b.enemy, b.seed, [r.gold, b.enemyGold]);
  const growBefore = r.deck.reduce((s, c) => s + c.bonus, 0);
  app.innerHTML = `<div class="screen">${hudHTML(r)}<main class="body battle-body"></main></div>`;
  const host = app.querySelector<HTMLElement>('.battle-body')!;
  mountBattle(host, {
    battle: bt,
    myName: r.name,
    foeName: b.enemyName,
    backs: [r.cls, b.enemyBack ?? (b.kind === 'wild' ? 'monster' : 'neutral')],
    onInspect: (c, live) => openDetail(c, '', live),
    onDone: (root) => {
      const e = finishBattle(r, bt);
      const grown = r.deck.reduce((s, c) => s + c.bonus, 0) - growBefore;
      save();
      showResult(root, {
        result: e.result, my: e.my, foe: e.enemy,
        lines: [
          e.result === 'win' ? `★ +1（${r.stars}/${CONFIG.starsToWin}）` : e.result === 'lose' ? `❤ -${e.hpLoss}（剩 ${r.hp}）` : '平局，不加星也不扣血',
          bt.goldEarned[0] ? `卡牌效果赚了 ${bt.goldEarned[0]} 金` : '',
          grown ? `卡牌永久成长共 +${grown}` : '',
          r.reward ? '还有战利品等你挑！' : '',
        ],
        buttons: [{ label: '继续', act: 'after-battle' }],
      });
    },
  });
}

function showResult(root: HTMLElement, o: { result: 'win' | 'lose' | 'draw'; my: number; foe: number; lines: string[]; buttons: { label: string; act: string }[] }) {
  const title = { win: '胜利！', lose: '失败', draw: '平局' }[o.result];
  const div = document.createElement('div');
  div.className = `overlay ${o.result}`;
  div.innerHTML = `
    <div class="result">
      <div class="r-title">${title}</div>
      <div class="r-score"><span class="me">${o.my}</span> : <span class="foe">${o.foe}</span></div>
      ${o.lines.filter(Boolean).map((l) => `<p>${l}</p>`).join('')}
      <div class="row">${o.buttons.map((b, i) => `<button class="btn ${i ? '' : 'primary'}" data-act="${b.act}">${b.label}</button>`).join('')}</div>
    </div>`;
  root.appendChild(div);
}

function renderEnd() {
  const r = run!;
  const won = r.status === 'won';
  const wins = r.history.filter((h) => h.result === 'win').length;
  app.innerHTML = `
  <div class="screen">
    ${hudHTML(r)}
    <main class="body">
      <section class="panel center end ${won ? 'win' : 'lose'}">
        <div class="end-title">${won ? `🏆 集齐 ${CONFIG.starsToWin} 星，通关！` : '💀 冒险结束'}</div>
        <p>${CLASS_ICON[r.cls]} ${esc(r.buildName)} · 坚持了 ${r.day} 天 · 打了 ${r.history.length} 场 · 赢 ${wins} 场</p>
        <button class="btn primary big" data-act="new-run">再来一次</button>
        <button class="btn ghost" data-act="title">回到标题</button>
      </section>
      <section class="panel">
        <div class="panel-title">战绩</div>
        <ol class="history">
          ${r.history.map((h) => `<li class="${h.result}"><span>第${h.day}天 ${h.kind === 'wild' ? '👹' : '⚔️'} ${esc(h.enemyName)}</span><b>${h.my} : ${h.enemy}</b></li>`).join('')}
        </ol>
      </section>
      ${deckHTML(r.deck)}
    </main>
  </div>`;
}

/* ---------------- 练习：两个中期 AI 卡组 ---------------- */

function startPractice() {
  const rng = makeRng(randomSeed());
  const sel = builds.getSelected();
  const a = botGhost(6, rng);
  const b = botGhost(6, rng);
  const bt = new Battle(a.deck, b.deck, randomSeed(), [a.gold, b.gold]);
  app.innerHTML = `<div class="screen"><main class="body battle-body"></main></div>`;
  const host = app.querySelector<HTMLElement>('.battle-body')!;
  mountBattle(host, {
    battle: bt,
    myName: `${CLASS_ICON[a.cls]} 我（AI 代打）`, foeName: `${CLASS_ICON[b.cls]} 练习对手`,
    backs: [a.cls, b.cls],
    onInspect: (c, live) => openDetail(c, '', live),
    onDone: (root) => {
      const w = bt.winner();
      showResult(root, {
        result: w === 'draw' ? 'draw' : w === 0 ? 'win' : 'lose', my: bt.totals[0], foe: bt.totals[1],
        lines: [sel ? '' : ''],
        buttons: [{ label: '再来一局', act: 'practice' }, { label: '返回', act: 'title' }],
      });
    },
  });
}

/* ---------------- 点击分发 ---------------- */

function findCard(uid: string | undefined): Card | undefined {
  return run?.deck.find((c) => c.uid === uid);
}

document.addEventListener('click', (e) => {
  if (Date.now() < swallowClickUntil) { swallowClickUntil = 0; return; }
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t || (t as HTMLButtonElement).disabled) return;
  const act = t.dataset.act!;
  const v = t.dataset.v ?? '';
  if (act === 'noop') return;
  if (act === 'close-modal') return closeModal();
  if (act === 'detail-star') {
    if (detail) { detail.tier = Number(v) as Tier; redrawDetail(); }
    return;
  }
  if (act === 'detail-raw') {
    // 进入/退出「查看图鉴」都回到这张卡实际的星级
    if (detail) { detail.raw = !detail.raw; detail.tier = detail.card.tier; redrawDetail(); }
    return;
  }

  if (act === 'b-copy') {
    const code = deckCode(v);
    if (code) void copyText(code).then((ok) => { toast(ok ? '卡组代码已复制到剪贴板' : '复制失败'); });
    builderClick('b-menu-close', '');
    return renderBuilder();
  }
  if (act === 'b-import') {
    void readClipboard().then((text) => {
      if (text == null) return;
      toast(importDeck(text).toast);
      renderBuilder();
    });
    return;
  }
  if (act.startsWith('b-')) {
    const res = builderClick(act, v);
    if (res.exit) return renderTitle();
    if (res.toast) toast(res.toast);
    return renderBuilder();
  }

  const r = run;
  switch (act) {
    case 'new-run': {
      const b = builds.getSelected();
      if (!b || !builds.isValid(b)) return toast('先选一个完整的卡组');
      const name = loadName();
      run = newRun(name, b);
      save();
      return renderRun();
    }
    // 开始冒险：已有进行中的存档就先问要不要放弃（确认后选卡组、出战时才真正覆盖存档）
    case 'start':
      if (r && r.status === 'playing') {
        return showModal(`<div class="modal-bg" data-act="close-modal"><div class="modal new-menu" data-act="noop">
          <div class="d-name">放弃已有存档？</div>
          <p class="muted">你有一局进行中的冒险（${CLASS_ICON[r.cls]} 第 ${r.day} 天 · ★${r.stars}）。开始新冒险会覆盖它。</p>
          <div class="row">
            <button class="btn" data-act="close-modal">取消</button>
            <button class="btn danger" data-act="start-confirm">放弃并开始</button>
          </div>
        </div></div>`);
      }
      return renderSelect();
    case 'start-confirm': closeModal(); return renderSelect();
    case 'settings': return openSettings();
    case 'settings-save': {
      const name = document.querySelector<HTMLInputElement>('#set-name')?.value.trim().slice(0, 12);
      if (!name) return toast('名字不能为空');
      saveName(name);
      closeModal();
      toast('已保存');
      if (screen === 'title') renderTitle();
      return;
    }
    case 'sel-pick': builds.setSelected(v); return renderSelect();
    case 'continue': return renderRun();
    case 'title': closeModal(); return renderTitle();
    case 'builder': openBuilder(null); return renderBuilder();
    case 'practice': return startPractice();
    case 'card-info': return openDetail(makeCard(v, 'x'));
  }
  if (!r) return;
  switch (act) {
    case 'buy': {
      const res = buy(r, Number(t.dataset.i));
      if (!res) return toast('金币不够');
      if (res.merged) toast(`自动合成：${defOf(res.merged).name} 升到 ${TIER_NAMES[res.merged.tier]}！`);
      break;
    }
    case 'offer-info': {
      const c = r.shop?.offers[Number(t.dataset.i)];
      if (c) openDetail(c);
      return;
    }
    case 'enemy-info': {
      const c = r.battle?.enemy.find((x) => x.uid === t.dataset.uid);
      if (c) openDetail(c);
      return;
    }
    case 'reward-info':
      if (r.reward?.card) openDetail(r.reward.card);
      return;
    case 'deck-card': {
      const c = findCard(t.dataset.uid);
      if (!c) return;
      const m = r.deck.some((o) => canMerge(c, o));
      const canSell = r.status === 'playing';
      openDetail(c, `
        ${m ? `<button class="btn primary" data-act="merge" data-uid="${c.uid}">合成升级</button>` : ''}
        ${canSell ? `<button class="btn" data-act="sell" data-uid="${c.uid}">出售 +${sellPriceOf(c)} 金</button>` : ''}`);
      return;
    }
    case 'merge': {
      const m = mergeByUid(r, t.dataset.uid!);
      closeModal();
      if (m) toast(`合成成功：${defOf(m).name} 升级了！`);
      break;
    }
    case 'sell': {
      const c = findCard(t.dataset.uid);
      if (c && sell(r, c.uid)) toast(`卖掉了 ${defOf(c).name}`);
      closeModal();
      break;
    }
    case 'refresh':
      if (!refresh(r)) return toast('金币不够');
      break;
    case 'merge-all': mergeAllRun(r); toast('已全部合成'); break;
    case 'next': advance(r); break;
    case 'fight': return startBattle();
    case 'after-battle':
      if (!r.reward) advance(r);
      break;
    case 'reward-take': {
      const m = takeReward(r, true);
      if (m) toast(`自动合成：${defOf(m).name} 升到 ${TIER_NAMES[m.tier]}！`);
      advance(r);
      break;
    }
    case 'reward-skip': takeReward(r, false); advance(r); break;
    default: return;
  }
  save();
  renderRun();
});

if (run && run.status === 'playing' && new URLSearchParams(location.search).has('continue')) renderRun();
else renderTitle();

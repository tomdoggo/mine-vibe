/**
 * 构筑界面（布局参考 card-battle 的构筑页）：
 *   上方：卡盒架，点开一个卡盒后横向列出已选的卡（点一下 -1）+ 进度条
 *   中间：职业卡收藏册，点卡 +1（每种最多 4 张，正好 20 种）
 *   下方：搜索 + 品质筛选
 */
import { CONFIG } from '../game/config.ts';
import {
  cardsOfClass, CLASS_ICON, CLASS_NAMES, makeCard, QUALITY_NAMES, QUALITIES, defOf, cardTexts,
  type ClassId, type Quality,
} from '../game/cards.ts';
import { buildCopies, buildDistinct, buildProblems, type Build, type PlayClass } from '../game/build.ts';
import * as store from '../buildStore.ts';
import { cardHTML, esc } from './cardView.ts';

let openId: string | null = null;
/** 正在编辑的卡组副本：所有改动先改它，保存时才写回存档 */
let draft: Build | null = null;
let qFilter: Quality | 'all' = 'all';
let browseCls: ClassId = 'miner';
let query = '';
let menu: 'new' | 'unsaved' | 'invalid' | 'deck' | null = null;
/** 长按出来的卡组选单对应哪个卡组 */
let menuDeck: string | null = null;
let armDelete = false;

const openBuild = () => (openId ? draft : null);

/** 打开一个卡组进行编辑（拿一份副本） */
function startEdit(id: string | null) {
  const saved = store.getBuild(id);
  openId = saved ? saved.id : null;
  draft = saved ? structuredClone(saved) : null;
}
/** 副本和存档不一样 = 有未保存的修改 */
function isDirty(): boolean {
  const saved = store.getBuild(openId);
  return !!(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
}
function saveDraft() {
  const saved = store.getBuild(openId);
  if (draft && saved) { Object.assign(saved, structuredClone(draft)); store.updateBuild(saved); }
}
/** 回到收藏页（卡盒架） */
function closeEdit() { openId = null; draft = null; }

export function openBuilder(id: string | null = null) {
  startEdit(id);
  menu = null;
  armDelete = false;
}

/* ---------------- 上方 ---------------- */

/** 卡盒（收藏页、选卡组页共用）。on = 被选中 */
export function deckBoxHTML(b: Build, act = 'b-open', on = false): string {
  const ok = store.isValid(b);
  return `<button class="deckbox cls-${b.cls} ${on ? 'on' : ''}" data-act="${act}" data-v="${b.id}">
    <span class="lid"></span>
    <span class="cover">${CLASS_ICON[b.cls]}</span>
    <span class="bx-name">${esc(b.name)}</span>
    <span class="bx-state ${ok ? 'ok' : ''}">${ok ? '✓ 可出战' : `${buildDistinct(b)}/${CONFIG.buildDistinct} 种`}</span>
  </button>`;
}

function shelf(): string {
  const bs = store.getBuilds();
  return `<div class="shelf">
    ${bs.map((b) => deckBoxHTML(b)).join('')}
    ${bs.length < store.MAX_BUILDS ? '<button class="deckbox new" data-act="b-newmenu" aria-label="新建卡组"><span class="plus">＋</span></button>' : ''}
  </div>`;
}

function openBox(b: Build): string {
  const distinct = buildDistinct(b);
  const ok = buildProblems(b).length === 0;
  const entries = Object.entries(b.cards)
    .filter(([, n]) => n > 0); // 按加入顺序（对象键保留插入顺序）
  const strip = entries
    .map(([id, n]) => `<button class="mini" data-act="b-rem" data-v="${id}" aria-label="移出 1 张 ${esc(defOf(id).name)}">
        ${cardHTML(makeCard(id, 'x'))}
        ${n > 1 ? `<span class="qty">x${n}</span>` : ''}
        <span class="m-minus">−1</span>
      </button>`)
    .join('');
  return `<div class="open-box cls-${b.cls}">
    <div class="ob-head">
      <button class="btn small ghost" data-act="b-back" aria-label="返回">←</button>
      <button class="btn small" data-act="b-close">完成</button>
      <button class="ob-name" data-act="b-rename">${esc(b.name)} ✎</button>
      <button class="btn small ghost" data-act="b-clear" ${entries.length ? '' : 'disabled'}>清空</button>
      <button class="btn small ghost ${armDelete ? 'danger' : ''}" data-act="b-del">${armDelete ? '确认删除' : '删除'}</button>
    </div>
    <div class="deck-meter ${ok ? 'ok' : ''}"><i style="width:${Math.min(100, (distinct / CONFIG.buildDistinct) * 100)}%"></i></div>
    <div class="strip">${strip}${'<span class="slot-empty"></span>'.repeat(Math.max(0, CONFIG.buildDistinct - entries.length))}</div>
  </div>`;
}

/* ---------------- 中间收藏册 ---------------- */

function matches(id: string): boolean {
  const d = defOf(id);
  if (qFilter !== 'all' && d.q !== qFilter) return false;
  if (!query) return true;
  const hay = d.name + d.tags.join('') + cardTexts(makeCard(id, 'x')).join('');
  return hay.includes(query);
}

function listIds(): string[] {
  const b = openBuild();
  const cls: ClassId = b ? b.cls : browseCls;
  return cardsOfClass(cls).map((d) => d.id).filter(matches);
}

export function collectionHTML(): string {
  const b = openBuild();
  const ids = listIds();
  return `<div class="b-grid">${ids.map((id) => {
    const n = b?.cards[id] ?? 0;
    return `<button class="tile ${n ? 'in' : ''}" data-act="b-add" data-v="${id}">
      ${cardHTML(makeCard(id, 'x'))}${n > 1 ? `<span class="qty">x${n}</span>` : ''}
    </button>`;
  }).join('') || '<p class="muted">没有符合条件的卡。</p>'}</div>`;
}

const chip = (act: string, v: string, label: string, on: boolean) =>
  `<button class="chip ${on ? 'on' : ''}" data-act="${act}" data-v="${v}">${label}</button>`;

function dock(): string {
  const b = openBuild();
  return `<footer class="search-dock">
    ${b ? '' : `<div class="filter-group">${(['miner', 'hacker', 'neutral'] as ClassId[]).map((c) => chip('b-cls', c, `${CLASS_ICON[c]} ${CLASS_NAMES[c]}`, browseCls === c)).join('')}</div>`}
    <div class="filter-group">
      ${chip('b-q', 'all', '全部', qFilter === 'all')}
      ${QUALITIES.map((q) => chip('b-q', q, QUALITY_NAMES[q], qFilter === q)).join('')}
    </div>
    <div class="search-row">
      <input id="b-search" type="search" placeholder="搜卡名、效果、标签…" value="${esc(query)}" />
      <span class="hit-count">${listIds().length}</span>
    </div>
  </footer>`;
}

/** 有未保存的修改时返回：问保存还是放弃（点空白处 = 继续编辑） */
function unsavedMenu(): string {
  return `<div class="modal-bg" data-act="b-menu-close"><div class="modal new-menu" data-act="noop">
    <div class="d-name">保存修改？</div>
    <p class="muted">「${esc(draft?.name ?? '')}」有还没保存的修改。</p>
    <div class="row">
      <button class="btn" data-act="b-discard">放弃</button>
      <button class="btn primary" data-act="b-save">保存</button>
    </div>
  </div></div>`;
}

/** 保存时卡组不满足出战要求：提示一下，但玩家仍然可以保存 */
function invalidMenu(): string {
  const probs = draft ? buildProblems(draft) : [];
  return `<div class="modal-bg" data-act="b-menu-close"><div class="modal new-menu" data-act="noop">
    <div class="d-name">还不能出战</div>
    <ul class="muted">${probs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <div class="row">
      <button class="btn" data-act="b-menu-close">继续编辑</button>
      <button class="btn primary" data-act="b-force-save">仍然保存</button>
    </div>
  </div></div>`;
}

/* ---------------- 卡组代码（复制 / 导入） ---------------- */

const CODE_PREFIX = 'FD1:';

/** 卡组 → 代码：FD1: + base64(JSON)，可以直接贴到聊天里分享 */
export function deckCode(id: string): string | null {
  const b = store.getBuild(id);
  if (!b) return null;
  const json = JSON.stringify({ n: b.name, c: b.cls, k: b.cards });
  const bytes = new TextEncoder().encode(json);
  return CODE_PREFIX + btoa(String.fromCharCode(...bytes));
}

/** 代码 → 新卡组（校验职业、卡 id、张数）。成功后直接打开编辑 */
export function importDeck(text: string): { toast: string } {
  const code = text.trim();
  if (!code.startsWith(CODE_PREFIX)) return { toast: '剪贴板里不是卡组代码' };
  let data: { n?: unknown; c?: unknown; k?: unknown };
  try {
    const bin = atob(code.slice(CODE_PREFIX.length));
    data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return { toast: '卡组代码已损坏' };
  }
  const cls = data.c;
  if (cls !== 'miner' && cls !== 'hacker') return { toast: '卡组代码已损坏' };
  const cards: Record<string, number> = {};
  for (const [id, n] of Object.entries((data.k ?? {}) as Record<string, unknown>)) {
    const cnt = Math.floor(Number(n));
    if (!cardsOfClass(cls).some((d) => d.id === id) || !(cnt >= 1)) continue;
    cards[id] = Math.min(cnt, CONFIG.maxCopies);
  }
  const name = typeof data.n === 'string' && data.n.trim() ? data.n.trim().slice(0, 12) : undefined;
  const nb = store.createBuild(cls, name, cards);
  if (!nb) return { toast: `最多 ${store.MAX_BUILDS} 个卡组` };
  menu = null;
  startEdit(nb.id);
  store.setSelected(nb.id);
  return { toast: `已导入「${nb.name}」` };
}

/** 收藏页长按卡组：弹出选单 */
export function builderLongPress(id: string) {
  if (openId || !store.getBuild(id)) return;
  menu = 'deck';
  menuDeck = id;
  armDelete = false;
}

function deckMenu(): string {
  const b = store.getBuild(menuDeck);
  if (!b) return '';
  return `<div class="modal-bg" data-act="b-menu-close"><div class="modal new-menu deck-menu" data-act="noop">
    <div class="d-name">${CLASS_ICON[b.cls]} ${esc(b.name)}</div>
    <div class="row">
      <button class="btn" data-act="b-copy" data-v="${b.id}">复制</button>
      <button class="btn ${armDelete ? 'danger' : ''}" data-act="b-del-deck" data-v="${b.id}">${armDelete ? '确认删除' : '删除'}</button>
    </div>
  </div></div>`;
}

function newMenu(): string {
  return `<div class="modal-bg" data-act="b-menu-close"><div class="modal new-menu" data-act="noop">
    <div class="d-name">新建卡组</div>
    <p class="muted">每个卡组属于一个职业，只能放该职业的卡。中立卡每局会自动加入卡池。</p>
    ${(['miner', 'hacker'] as PlayClass[]).map((c) => `
      <div class="nm-row cls-${c}">
        <span class="nm-cls">${CLASS_ICON[c]} ${CLASS_NAMES[c]}</span>
        <button class="btn small primary" data-act="b-new" data-v="${c}">新建</button>
      </div>`).join('')}
      <div class="nm-row nm-import">
        <span class="nm-cls">📋 卡组代码</span>
        <button class="btn small" data-act="b-import">从剪贴板导入</button>
      </div>
    <div class="row"><button class="btn" data-act="b-menu-close">取消</button></div>
  </div></div>`;
}

export function builderHTML(): string {
  const b = openBuild();
  if (openId && !b) openId = null;
  return `<div class="builder">
    <header class="b-top">
      ${b ? '' : '<button class="btn small ghost" data-act="b-back" aria-label="返回">←</button>'}
      <section class="deckzone">${b ? openBox(b) : shelf()}</section>
    </header>
    <section class="collection">${collectionHTML()}</section>
    ${dock()}
    ${menu === 'new' ? newMenu() : menu === 'unsaved' ? unsavedMenu() : menu === 'invalid' ? invalidMenu() : menu === 'deck' ? deckMenu() : ''}
  </div>`;
}

/* ---------------- 交互 ---------------- */

/** toast = 提示文字；exit = 离开构筑界面回主页 */
export function builderClick(act: string, v: string): { toast?: string; exit?: boolean } {
  const b = openBuild();
  if (act !== 'b-del' && act !== 'b-del-deck') armDelete = false;
  switch (act) {
    case 'b-open': startEdit(v); store.setSelected(v); break;
    // ← ：编辑中先回收藏页（有修改就问），在收藏页才回主页
    case 'b-back':
      if (!openId) return { exit: true };
      if (isDirty()) menu = 'unsaved';
      else closeEdit();
      break;
    // 完成 / 保存：不满足出战要求时先提示（可以无视继续保存）
    case 'b-close':
    case 'b-save':
      if (draft && buildProblems(draft).length) { menu = 'invalid'; break; }
      saveDraft(); closeEdit(); menu = null;
      return { toast: '已保存' };
    case 'b-force-save': saveDraft(); closeEdit(); menu = null; return { toast: '已保存（还不能出战）' };
    case 'b-discard': closeEdit(); menu = null; break;
    case 'b-newmenu': menu = 'new'; break;
    case 'b-menu-close': menu = null; menuDeck = null; break;
    case 'b-del-deck':
      if (!armDelete) { armDelete = true; break; }
      store.deleteBuild(v);
      menu = null; menuDeck = null; armDelete = false;
      return { toast: '已删除' };
    case 'b-new': {
      const nb = store.createBuild(v as PlayClass);
      menu = null;
      if (!nb) return { toast: `最多 ${store.MAX_BUILDS} 个卡组` };
      startEdit(nb.id);
      store.setSelected(nb.id);
      break;
    }
    case 'b-rename': {
      if (!b) break;
      const name = prompt('卡组名字', b.name)?.trim();
      if (name) b.name = name.slice(0, 12);
      break;
    }
    case 'b-del':
      if (!b) break;
      if (!armDelete) { armDelete = true; break; }
      store.deleteBuild(b.id);
      closeEdit();
      armDelete = false;
      break;
    // 短按收藏卡 = 加入卡组（看详情用长按）
    case 'b-add': {
      if (!b) return { toast: '先在上方打开或新建一个卡组' };
      const n = b.cards[v] ?? 0;
      if (n >= CONFIG.maxCopies) return { toast: `每种最多 ${CONFIG.maxCopies} 张` };
      if (n === 0 && buildDistinct(b) >= CONFIG.buildDistinct) return { toast: `已经 ${CONFIG.buildDistinct} 种了，先在上面移出一种` };
      b.cards[v] = n + 1;
      break;
    }
    case 'b-rem': {
      if (!b) break;
      const n = (b.cards[v] ?? 0) - 1;
      if (n <= 0) delete b.cards[v];
      else b.cards[v] = n;
      break;
    }
    // 清空：只清空编辑中的副本，没保存前可以「放弃」找回
    case 'b-clear': if (b) b.cards = {}; break;
    case 'b-q': qFilter = v as Quality | 'all'; break;
    case 'b-cls': browseCls = v as ClassId; break;
  }
  return {};
}

/** 搜索框输入：只重画收藏册，保持输入框焦点 */
export function builderSearch(root: HTMLElement, value: string) {
  query = value.trim();
  root.querySelector('.collection')!.innerHTML = collectionHTML();
  root.querySelector('.hit-count')!.textContent = String(listIds().length);
}

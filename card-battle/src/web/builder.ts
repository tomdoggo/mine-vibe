/**
 * 构筑界面（上下两层，尽量把空间留给收藏册）：
 *  - 上方：卡盒架。卡盒只显示封面和卡组名；点卡盒进入编辑，长按（电脑右键）打开管理菜单
 *    （改名 / 主题色 / 封面卡 / 复制 / 清空 / 删除）。
 *    编辑模式下卡盒展开，横向列出卡组里的卡，点一张 = 移出 1 张。
 *  - 下方：收藏册（全部卡牌，可检索 / 筛选 / ★收藏）。平时点卡没反应；编辑模式下点卡 = 加入 1 张。
 */
import type { CardDef, EType } from '../types.ts';
import { ALL_CARDS, CARDS, DECKS, DECK_SIZE, MAX_COPIES } from '../cards.ts';
import { cardArt } from './art.ts';
import { esc, fullCard, typeClass } from './ui.ts';
import * as store from './decks.ts';

type Kind = 'all' | 'creature' | 'supporter' | 'item' | 'energy';
type Menu = { type: 'deck'; id: string } | { type: 'new' } | null;

let rerender: () => void = () => {};
export function initBuilder(r: () => void) {
  rerender = r;
}

let openId: string | null = null;
let query = '';
let kind: Kind = 'all';
let etype: EType | 'all' = 'all';
let favOnly = false;
let filtersOpen = false;
let menu: Menu = null;
let armDelete: string | null = null;
let backupOpen = false;
let importDraft = '';
let importMsg = '';
let toastMsg = '';
let toastTimer = 0;

function toast(msg: string) {
  toastMsg = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg = '';
    rerender();
  }, 1600);
}

const openDeck = () => (openId ? store.getDeck(openId) : null);
const ORDER = new Map(ALL_CARDS.map((c, i) => [c.name, i]));
const themeStyle = (d: store.SavedDeck) => {
  const t = store.deckTheme(d);
  return `--bx1:${t.a};--bx2:${t.b}`;
};

function matches(d: CardDef): boolean {
  if (kind !== 'all') {
    const k = d.kind === 'trainer' ? d.sub : d.kind;
    if (k !== kind) return false;
  }
  if (etype !== 'all') {
    const t = d.kind === 'creature' ? d.type : d.kind === 'energy' ? d.provides : null;
    if (t !== etype) return false;
  }
  if (favOnly && !store.isFav(d.name)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = [d.name];
  if (d.kind === 'creature') {
    if (d.ability) text.push(d.ability.name, d.ability.text);
    for (const a of d.attacks) text.push(a.name, a.text ?? '');
    if (d.evolvesFrom) text.push(d.evolvesFrom);
  } else if (d.kind === 'trainer') text.push(d.text);
  return text.join(' ').toLowerCase().includes(q);
}

function addProblem(name: string): string | null {
  const d = openDeck();
  if (!d) return '先点上方的卡盒';
  const def = CARDS[name];
  if (store.deckTotal(d) >= DECK_SIZE) return `已满 ${DECK_SIZE} 张`;
  if (def.kind !== 'energy' && (d.cards[name] ?? 0) >= MAX_COPIES) return `同名卡最多 ${MAX_COPIES} 张`;
  return null;
}

function change(name: string, delta: number) {
  const d = openDeck();
  if (!d) return;
  const n = Math.max(0, (d.cards[name] ?? 0) + delta);
  const cards = { ...d.cards };
  if (n) cards[name] = n;
  else delete cards[name];
  store.updateDeck({ ...d, cards });
}

// ---------- 上方：卡盒架 ----------

function deckBox(d: store.SavedDeck): string {
  const cover = store.deckCover(d);
  return `<button class="deckbox" style="${themeStyle(d)}" data-click="bopen:${d.id}" data-longpress="bmenu:${d.id}" title="长按：改名、主题色、封面">
    <span class="lid"></span>
    <span class="cover">${cover ? cardArt(CARDS[cover]) : ''}</span>
    <span class="bx-name">${esc(d.name)}</span>
  </button>`;
}

function shelf(): string {
  const decks = store.getDecks();
  const full = decks.length >= store.MAX_DECKS;
  return `<div class="shelf" data-scroll="shelf">
    ${decks.map(deckBox).join('')}
    ${full ? '' : `<button class="deckbox new" data-click="bnewmenu" aria-label="新建卡组"><span class="plus">＋</span></button>`}
  </div>`;
}

/** 编辑模式：卡盒展开，横向列出卡组里的卡 */
function openBox(): string {
  const d = openDeck()!;
  const total = store.deckTotal(d);
  const ok = store.deckProblems(d).length === 0;
  const entries = Object.entries(d.cards).sort((a, b) => ORDER.get(a[0])! - ORDER.get(b[0])!);
  const strip = entries
    .map(([name, n]) => {
      const def = CARDS[name];
      return `<button class="mini ${typeClass(def)}" data-click="brem:${esc(name)}" aria-label="移出 1 张 ${esc(name)}">
        ${n > 1 ? '<span class="stack s2"></span>' : ''}${n > 2 ? '<span class="stack s3"></span>' : ''}
        <span class="m-face"><span class="m-name">${esc(name)}</span><span class="m-art art">${cardArt(def)}</span></span>
        <span class="m-cnt">${n}</span>
        <span class="m-minus" aria-hidden="true">−1</span>
      </button>`;
    })
    .join('');
  return `<div class="open-box" style="${themeStyle(d)}">
    <div class="ob-head">
      <button class="ghost small" data-click="bclose">完成</button>
      <span class="ob-name" data-longpress="bmenu:${d.id}" data-click="bmenu:${d.id}" title="${total}/${DECK_SIZE} 张 · 点击或长按管理卡组">${esc(d.name)}</span>
    </div>
    <div class="deck-meter${ok ? ' ok' : ''}" title="${total}/${DECK_SIZE} 张"><i style="width:${Math.min(100, (total / DECK_SIZE) * 100)}%"></i></div>
    <div class="strip" data-scroll="strip">${strip}</div>
  </div>`;
}

// ---------- 下方：收藏册 ----------

const chip = (click: string, label: string, on: boolean) =>
  `<button class="chip${on ? ' on' : ''}" data-click="${click}">${label}</button>`;

function tile(d: CardDef, editing: boolean): string {
  const deck = openDeck();
  const n = deck?.cards[d.name] ?? 0;
  const fav = store.isFav(d.name);
  const face = editing
    ? `<button class="tile-card" data-click="badd:${esc(d.name)}" aria-label="加入 ${esc(d.name)}">${fullCard(d)}</button>`
    : `<div class="tile-card idle">${fullCard(d)}</div>`;
  return `<div class="tile${n ? ' in' : ''}">
    ${face}
    <button class="fav${fav ? ' on' : ''}" data-click="bfav:${esc(d.name)}" aria-label="${fav ? '取消收藏' : '收藏'}">★</button>
    ${n ? `<span class="cnt">${n}</span>` : ''}
  </div>`;
}

function collection(): string {
  const list = ALL_CARDS.filter(matches);
  const deck = openDeck();
  return `<section class="collection${deck ? ' editing' : ''}" data-scroll="collection">
    <div class="b-grid">${list.map((d) => tile(d, !!deck)).join('') || '<p class="muted">没有符合条件的卡。</p>'}</div>
  </section>`;
}

/** 底部固定的搜索栏：文字 + 筛选（类别 / 属性 / 收藏），收藏册怎么滑都在 */
function searchDock(): string {
  const filtered = kind !== 'all' || etype !== 'all' || favOnly;
  const n = ALL_CARDS.filter(matches).length;
  return `<footer class="search-dock">
    ${
      filtersOpen
        ? `<div class="filter-group"><span class="fg-label">类别</span><div class="chips">${chip('bkind:all', '全部', kind === 'all')}${chip('bkind:creature', '生物', kind === 'creature')}${chip('bkind:supporter', '支援者', kind === 'supporter')}${chip('bkind:item', '物品', kind === 'item')}${chip('bkind:energy', '能量', kind === 'energy')}</div></div>
           <div class="filter-group"><span class="fg-label">属性</span><div class="chips">${chip('btype:all', '全部', etype === 'all')}${chip('btype:fire', '火', etype === 'fire')}${chip('btype:water', '水', etype === 'water')}${chip('btype:grass', '草', etype === 'grass')}${chip('btype:lightning', '雷', etype === 'lightning')}${chip('btype:colorless', '无', etype === 'colorless')}</div></div>
           <div class="filter-group"><span class="fg-label">其他</span><div class="chips">${chip('bfavonly', '★ 只看收藏', favOnly)}</div></div>`
        : ''
    }
    <div class="search-row">
      <input id="b-search" type="search" placeholder="搜索卡名、招式、效果" value="${esc(query)}" autocomplete="off" aria-label="搜索卡名、招式或效果">
      <button class="chip filter-btn${filtersOpen ? ' on' : ''}${filtered ? ' dot' : ''}" data-click="bfilters" aria-expanded="${filtersOpen}">筛选</button>
      <button class="chip" data-click="bfilter-reset" ${filtered || query ? '' : 'disabled'}>重置</button>
      <span class="hit-count" aria-live="polite">${n}</span>
    </div>
  </footer>`;
}

// ---------- 弹出菜单 ----------

function deckMenu(id: string): string {
  const d = store.getDeck(id);
  if (!d) return '';
  const problems = store.deckProblems(d);
  const curTheme = d.theme ?? '';
  const swatches = [
    `<button class="swatch auto${curTheme ? '' : ' on'}" data-click="btheme:" aria-label="自动（按卡组属性）">自动</button>`,
    ...Object.entries(store.THEMES).map(
      ([k, t]) => `<button class="swatch${curTheme === k ? ' on' : ''}" style="--bx1:${t.a};--bx2:${t.b}" data-click="btheme:${k}" aria-label="${t.name}" title="${t.name}"></button>`,
    ),
  ].join('');
  const names = Object.keys(d.cards).sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
  const curCover = d.cover && d.cards[d.cover] ? d.cover : '';
  const covers = [
    `<button class="cover-opt auto${curCover ? '' : ' on'}" data-click="bcover:" aria-label="自动封面">自动</button>`,
    ...names.map(
      (n) => `<button class="cover-opt${curCover === n ? ' on' : ''}" data-click="bcover:${esc(n)}" title="${esc(n)}" aria-label="封面：${esc(n)}">${cardArt(CARDS[n])}</button>`,
    ),
  ].join('');
  return `<div class="modal-bg sheet-bg menu-bg" data-click="bmenu-close"><div class="modal deck-menu" data-click="noop">
    <div class="dm-top">
      ${deckBox(d).replace('data-click="bopen:', 'data-click="bmenu-open:').replace(/data-longpress="[^"]*"/, '')}
      <div class="dm-fields">
        <input id="b-rename" value="${esc(d.name)}" maxlength="30" autocomplete="off" aria-label="卡组名称">
        <span class="dm-count">${store.deckTotal(d)}/${DECK_SIZE}${problems.length ? ' · ' + problems.map(esc).join('；') : ' · 可以对战'}</span>
      </div>
    </div>
    <h4>主题色</h4>
    <div class="swatches">${swatches}</div>
    <h4>封面</h4>
    <div class="covers">${names.length ? covers : '<span class="muted small">卡组里还没有卡</span>'}</div>
    <div class="dm-actions">
      <button class="end" data-click="bmenu-open:${d.id}">编辑</button>
      <button class="ghost" data-click="bdup:${d.id}" ${store.getDecks().length >= store.MAX_DECKS ? 'disabled' : ''}>复制</button>
      <button class="ghost" data-click="bclear:${d.id}" ${names.length ? '' : 'disabled'}>清空</button>
      <button class="ghost danger" data-click="bdel:${d.id}">${armDelete === d.id ? '确认删除' : '删除'}</button>
    </div>
  </div></div>`;
}

function newMenu(): string {
  const presets = Object.entries(DECKS)
    .map(([k, d]) => `<button class="ghost" data-click="bcopy:${k}">${esc(d.name)}</button>`)
    .join('');
  return `<div class="modal-bg sheet-bg menu-bg" data-click="bmenu-close"><div class="modal deck-menu new-menu" data-click="noop">
    <button class="end" data-click="bnew">空白卡组</button>
    <h4>复制预设</h4>
    <div class="dm-presets">${presets}</div>
  </div></div>`;
}

function backupModal(): string {
  if (!backupOpen) return '';
  return `<div class="modal-bg" data-click="bbackup-close"><div class="modal backup" data-click="noop">
    <h3>备份卡组</h3>
    <p class="muted">卡组和收藏只保存在这个浏览器里。把下面的文字复制保存，换设备或清理浏览器后可以粘贴回来恢复。</p>
    <textarea id="b-export" readonly>${esc(store.exportText())}</textarea>
    <div class="row"><button class="end" data-click="bcopytext">复制备份文字</button></div>
    <h4>从备份导入</h4>
    <textarea id="b-import" placeholder="把备份文字粘贴到这里">${esc(importDraft)}</textarea>
    <div class="row"><button class="end" data-click="bimport" ${importDraft.trim() ? '' : 'disabled'}>导入</button><button class="ghost" data-click="bbackup-close">关闭</button></div>
    ${importMsg ? `<p>${esc(importMsg)}</p>` : ''}
  </div></div>`;
}

export function builderHTML(): string {
  if (openId && !openDeck()) openId = null;
  if (menu?.type === 'deck' && !store.getDeck(menu.id)) menu = null;
  return `<div class="builder">
    <header class="b-top">
      <button class="ghost small" data-click="go:home" aria-label="返回主页">←</button>
      <section class="deckzone${openId ? ' open' : ''}">${openId ? openBox() : shelf()}</section>
      ${openId ? '' : '<button class="ghost small" data-click="bbackup">备份</button>'}
    </header>
    ${collection()}
    ${searchDock()}
    ${toastMsg ? `<div class="toast" role="status">${esc(toastMsg)}</div>` : ''}
    ${menu?.type === 'deck' ? deckMenu(menu.id) : menu?.type === 'new' ? newMenu() : ''}
    ${backupModal()}
  </div>`;
}

// ---------- 事件 ----------

/** 处理构筑界面的点击，返回 true 表示已处理 */
export function builderClick(kind_: string, val: string): boolean {
  switch (kind_) {
    case 'bkind': kind = val as Kind; break;
    case 'btype': etype = val as EType | 'all'; break;
    case 'bfavonly': favOnly = !favOnly; break;
    case 'bfilters': filtersOpen = !filtersOpen; break;
    case 'bfilter-reset': kind = 'all'; etype = 'all'; favOnly = false; query = ''; break;
    case 'bfav': store.toggleFav(val); break;
    case 'badd': {
      const why = addProblem(val);
      if (why) toast(why);
      else change(val, 1);
      break;
    }
    case 'brem': change(val, -1); break;
    case 'bnewmenu': menu = { type: 'new' }; break;
    case 'bnew': {
      const d = store.createDeck(`卡组 ${store.getDecks().length + 1}`);
      menu = null;
      if (!d) toast(`最多 ${store.MAX_DECKS} 个卡组`);
      else openId = d.id;
      break;
    }
    case 'bcopy': {
      const d = store.createDeck(DECKS[val].name, store.presetCards(val));
      menu = null;
      if (!d) toast(`最多 ${store.MAX_DECKS} 个卡组`);
      else openId = d.id;
      break;
    }
    case 'bopen': openId = val; menu = null; break;
    case 'bclose': openId = null; break;
    case 'bmenu': menu = { type: 'deck', id: val }; armDelete = null; break;
    case 'bmenu-close': menu = null; armDelete = null; break;
    case 'bmenu-open': openId = val; menu = null; break;
    case 'btheme': {
      const d = menu?.type === 'deck' ? store.getDeck(menu.id) : null;
      if (d) {
        const next = { ...d };
        if (val) next.theme = val;
        else delete next.theme;
        store.updateDeck(next);
      }
      break;
    }
    case 'bcover': {
      const d = menu?.type === 'deck' ? store.getDeck(menu.id) : null;
      if (d) {
        const next = { ...d };
        if (val) next.cover = val;
        else delete next.cover;
        store.updateDeck(next);
      }
      break;
    }
    case 'bdup': {
      const d = store.duplicateDeck(val);
      menu = null;
      toast(d ? '已复制' : `最多 ${store.MAX_DECKS} 个卡组`);
      break;
    }
    case 'bclear': {
      const d = store.getDeck(val);
      if (d) store.updateDeck({ ...d, cards: {} });
      break;
    }
    case 'bdel':
      if (armDelete !== val) armDelete = val;
      else {
        store.deleteDeck(val);
        if (openId === val) openId = null;
        menu = null;
        armDelete = null;
        toast('已删除');
      }
      break;
    case 'bbackup': backupOpen = true; importMsg = ''; break;
    case 'bbackup-close': backupOpen = false; break;
    case 'bcopytext': {
      const ta = document.getElementById('b-export') as HTMLTextAreaElement | null;
      const text = store.exportText();
      const fallback = () => {
        ta?.select();
        toast('已选中，请手动复制');
      };
      try {
        navigator.clipboard.writeText(text).then(() => toast('已复制'), fallback);
      } catch {
        fallback();
      }
      return true;
    }
    case 'bimport':
      importMsg = store.importText(importDraft);
      if (importMsg.startsWith('导入了')) importDraft = '';
      break;
    default:
      return false;
  }
  rerender();
  return true;
}

/** 处理输入框；返回 true 表示需要重新渲染 */
export function builderInput(el: HTMLInputElement | HTMLTextAreaElement, kind_: 'input' | 'change'): boolean {
  if (el.id === 'b-search' && kind_ === 'input') {
    query = el.value;
    return true;
  }
  if (el.id === 'b-import' && kind_ === 'input') {
    const was = importDraft.trim() === '';
    importDraft = el.value;
    return was !== (importDraft.trim() === '');
  }
  if (el.id === 'b-rename' && kind_ === 'input') {
    // 边打边存，但不重绘：重绘会打断输入，也会吞掉紧接着的点击
    const d = menu?.type === 'deck' ? store.getDeck(menu.id) : null;
    if (d) store.updateDeck({ ...d, name: el.value.trim().slice(0, 30) || '未命名卡组' });
    return false;
  }
  return false;
}

/**
 * 选择出战卡组（点「开始冒险」后进入）。布局和收藏页一样：
 *   上方：卡盒架，点一个卡盒选中它
 *   中间：选中卡组里的所有卡（排列同收藏册），后面追加本局会加入卡池的中立卡
 *   下方：出战按钮
 */
import { CONFIG } from '../game/config.ts';
import { cardsOfClass, CLASS_NAMES, makeCard } from '../game/cards.ts';
import { buildProblems } from '../game/build.ts';
import * as store from '../buildStore.ts';
import { cardHTML, esc } from './cardView.ts';
import { deckBoxHTML } from './builder.ts';

/** 这里的卡只看不点：长按看详情 */
const tile = (id: string, n: number) => `<div class="tile">
    ${cardHTML(makeCard(id, 'x'))}${n > 1 ? `<span class="qty">x${n}</span>` : ''}
  </div>`;

export function deckSelectHTML(): string {
  const all = store.getBuilds();
  const sel = store.getSelected();
  const ok = !!sel && buildProblems(sel).length === 0;
  let body = '<p class="muted sel-empty">还没有卡组，先去「构筑卡组」组一套</p>';
  if (sel) {
    const mine = Object.entries(sel.cards)
      .filter(([, n]) => n > 0); // 按加入顺序
    const neutral = cardsOfClass('neutral');
    body = `
      <div class="b-grid">${mine.map(([id, n]) => tile(id, n)).join('')}</div>
      <div class="sel-sep">${CLASS_NAMES.neutral}卡 · 每局自动加入卡池</div>
      <div class="b-grid">${neutral.map((d) => tile(d.id, CONFIG.neutralCopies)).join('')}</div>`;
  }
  return `<div class="builder deck-select">
    <header class="b-top">
      <button class="btn small ghost" data-act="title" aria-label="返回">←</button>
      <section class="deckzone">
        <div class="sel-title">选择出战卡组</div>
        <div class="shelf">${all.map((b) => deckBoxHTML(b, 'sel-pick', sel?.id === b.id)).join('')}</div>
      </section>
    </header>
    <section class="collection">${body}</section>
    <footer class="search-dock">
      <button class="btn primary big" data-act="new-run" ${ok ? '' : 'disabled'}>${
        !sel ? '出战' : ok ? `出战：${esc(sel.name)}` : '这套卡组还不能出战'}</button>
    </footer>
  </div>`;
}

/** 对战界面和构筑界面共用的小工具：转义、能量圆点、完整卡面 */
import type { CardDef, EType } from '../types.ts';
import { TYPE_NAME } from '../engine.ts';
import { cardArt } from './art.ts';

export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const pip = (t: EType) => `<i class="pip e-${t}">${TYPE_NAME[t]}</i>`;

export const typeClass = (d: CardDef) =>
  d.kind === 'creature' ? `t-${d.type}` : d.kind === 'energy' ? `t-${d.provides}` : d.sub === 'supporter' ? 't-supporter' : 't-item';

export const kindLabel = (d: CardDef) =>
  d.kind === 'creature'
    ? d.stage === 0 ? '基础生物' : `${d.stage} 阶生物`
    : d.kind === 'trainer' ? (d.sub === 'supporter' ? '支援者' : '物品') : '基础能量';

/** 完整卡面：插画 + 全部文字，构筑界面用 */
export function fullCard(d: CardDef): string {
  let body = '';
  if (d.kind === 'creature') {
    body = `
      <div class="c-head"><span class="c-name">${esc(d.name)}</span><span class="c-hp"><small>HP</small>${d.hp}</span></div>
      <div class="c-sub">${kindLabel(d)}${d.evolvesFrom ? ` · 由${esc(d.evolvesFrom)}进化` : ''}</div>
      <div class="art">${cardArt(d)}</div>
      ${d.ability ? `<div class="fc-ab"><b>特性【${esc(d.ability.name)}】</b>${esc(d.ability.text)}</div>` : ''}
      ${d.attacks
        .map(
          (a) => `<div class="fc-atk"><div class="fc-atk-line"><span class="cost">${a.cost.map(pip).join('')}</span><b>${esc(a.name)}</b><span class="dmg">${a.damage || ''}</span></div>${
            a.text ? `<div class="fc-text">${esc(a.text)}</div>` : ''
          }</div>`,
        )
        .join('')}
      <div class="c-foot"><span>弱点 ${d.weakness ? TYPE_NAME[d.weakness] : '-'}</span><span>抗性 ${d.resistance ? TYPE_NAME[d.resistance] : '-'}</span><span>撤退 ${d.retreat}</span></div>`;
  } else if (d.kind === 'trainer') {
    body = `
      <div class="c-head"><span class="c-name">${esc(d.name)}</span></div>
      <div class="c-sub">${kindLabel(d)}${d.sub === 'supporter' ? ' · 每回合 1 张' : ''}</div>
      <div class="art">${cardArt(d)}</div>
      <div class="fc-text">${esc(d.text)}</div>`;
  } else {
    body = `
      <div class="c-head"><span class="c-name">${esc(d.name)}</span></div>
      <div class="c-sub">基础能量 · 张数不限</div>
      <div class="art">${cardArt(d)}</div>
      <div class="fc-text">每回合可以从手牌贴 1 张到自己的生物上。</div>`;
  }
  return `<div class="card full ${typeClass(d)}">${body}</div>`;
}

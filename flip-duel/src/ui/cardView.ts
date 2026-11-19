import {
  cardScore, cardTexts, CLASS_NAMES, defOf, TIER_NAMES, type Card, type Tier,
} from '../game/cards.ts';
import type { Side } from '../game/battle.ts';
import { artUrl, type BackKind } from './art.ts';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export interface CardOpts {
  side?: Side;
  score?: number;
  badge?: string;
  attrs?: string;
  extra?: string;
  /** 比较基准（默认 = 卡原本的点数）。对局里用翻开那一刻的点数 */
  ref?: number;
  /** 详情里：星星可以点，用来切换等级 */
  pickTier?: boolean;
}

/**
 * 卡面：卡画铺满整张卡；顶部一行 = 卡名 + 星星（星数 = 等级，颜色 = 品质）+ 职业（右上角，全称）；
 * 下方半透明效果框（第一行是标签，之后每条效果以「•」开头，左对齐）；右下角描边字 = 分数（临时高于原本点数为绿、低于为红）。
 * 卡比较小时（棋盘、卡组缩略图）自动隐藏效果框（见 style.css 的 @container）。
 */
export function cardHTML(c: Card, o: CardOpts = {}): string {
  const d = defOf(c);
  /** 卡原本的点数（底分 + 永久成长）；本轮临时加成后高于它显示绿色，低于它显示红色。点数不会是负数 */
  const ref = o.ref ?? cardScore(c);
  const score = Math.max(0, o.score ?? ref);
  const side = o.side === undefined ? '' : o.side === 0 ? 'me' : 'foe';
  const texts = cardTexts(c);
  // data-card：长按任何卡都能打开同一个详情组件（id:星级:永久成长:是否图鉴卡[:即时分:原本分]）
  const dataCard = `${c.id}:${c.tier}:${c.bonus}:${c.uid === 'x' ? 1 : 0}${o.score !== undefined ? `:${score}:${ref}` : ''}`;
  return `<div class="card q-${d.q} t${c.tier} cls-${d.cls} ${side} ${o.extra ?? ''}" data-card="${dataCard}" ${o.attrs ?? ''}>
    <span class="c-art"><img src="${artUrl(d.id)}" alt="" draggable="false"></span>
    <span class="c-head"><span class="c-name">${esc(d.name)}</span>${starsHTML(c.tier, o.pickTier)}${
      `<span class="c-tags"><i class="c-cls">${CLASS_NAMES[d.cls]}</i></span>`}</span>
    ${texts.length || d.tags.length ? `<span class="c-text">${
      d.tags.length ? `<span class="c-taglist">${d.tags.map((t) => `<i>${esc(t)}</i>`).join('')}</span>` : ''}${
      texts.map((t) => `<span>• ${esc(t)}</span>`).join('')}</span>` : ''}
    <span class="c-score ${score > ref ? 'up' : score < ref ? 'down' : ''}">${score}</span>
    ${o.badge ? `<span class="c-badge">${o.badge}</span>` : ''}
  </div>`;
}

/** 等级星星（跟在卡名后面，颜色 = 品质）。pick=true 时 3 颗都画出来，整块可点：1→2→3→1 星轮转 */
function starsHTML(tier: Tier, pick = false): string {
  if (!pick) return `<span class="c-stars">${'★'.repeat(tier + 1)}</span>`;
  return `<button class="c-stars pick" data-act="detail-star" data-v="${(tier + 1) % 3}" aria-label="${TIER_NAMES[tier]}，点击切换">${
    ([0, 1, 2] as Tier[]).map((t) => `<i class="${t <= tier ? 'on' : ''}">★</i>`).join('')}</button>`;
}

/** 卡背 */
export function backHTML(kind: BackKind): string {
  return `<div class="cardback back-${kind}"></div>`;
}

/** 对局中这张牌本轮的即时状态（已结算后才有） */
export interface LiveState { score: number; ref: number; notes: string[]; blocked: boolean }

/**
 * 卡牌详情弹窗：只显示卡本身（下面只有操作按钮，没有文字）。点卡上的星星在 1~3 星之间轮转。
 * 对局里点开时，卡面分数是本轮的即时得分（临时加成、削弱、倍率都算上）。
 * 右上角「查看图鉴」= 排除一切加成和成长的初始状态。点弹窗外的空白处关闭。
 */
export function cardDetailHTML(c: Card, actions = '', viewTier: Tier = c.tier, raw = false, live?: LiveState): string {
  const tier: Tier = viewTier;
  const cur = !raw && viewTier === c.tier;
  const shown: Card = { ...c, tier, bonus: cur ? c.bonus : 0 };
  const now = cur ? live : undefined;
  /** 从图鉴里点开的卡（uid 'x'）：本身就是图鉴状态，不需要「当前」标记和切换按钮 */
  const fromCodex = c.uid === 'x';
  // 卡固定在上方，「查看图鉴」按钮固定在卡的右上，切换时都不会移动
  return `<div class="modal-bg" data-act="close-modal"><div class="modal detail" data-act="noop">
    ${fromCodex ? '' : `<div class="d-bar"><button class="d-raw ${raw ? 'on' : ''}" data-act="detail-raw">查看图鉴</button></div>`}
    <div class="detail-card">${cardHTML(shown, { score: now?.score, ref: now?.ref, pickTier: true })}</div>
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </div></div>`;
}

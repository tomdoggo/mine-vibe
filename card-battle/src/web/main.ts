/**
 * 网页界面：规则引擎原样复用。
 * "你"是一个 Agent：引擎问你要动作时，界面把合法动作变成可点的卡/按钮，点了就把答案交回引擎。
 * 电脑用启发式 AI，每步前停顿一下，方便看清它在干什么。
 */
import './style.css';
import type { Action, Agent, Card, CardDef, ChoiceRequest, DeckList, InPlay, PlayerId, Slot } from '../types.ts';
import { Game, energyTypes, hpLeft, top, TYPE_NAME, type GameResult } from '../engine.ts';
import { CARDS, DECKS, DECK_SIZE } from '../cards.ts';
import { HeuristicAgent } from '../ai/heuristic.ts';
import { HELP_HTML } from './help.ts';
import { cardArt } from './art.ts';
import { esc, pip } from './ui.ts';
import { builderClick, builderHTML, builderInput, initBuilder } from './builder.ts';
import * as store from './decks.ts';

const app = document.getElementById('app')!;
const ME: PlayerId = 0;
const AI: PlayerId = 1;

type Pending =
  | { kind: 'action'; actions: Action[]; resolve: (a: Action) => void }
  | { kind: 'choice'; req: ChoiceRequest; resolve: (i: number) => void };
type Selected = { mode: 'card'; name: string } | { mode: 'retreat' } | null;

let game: Game | null = null;
let token = 0;
let pending: Pending | null = null;
let selected: Selected = null;
let result: GameResult | null = null;
let errorMsg = '';
let detailName: string | null = null;
let aiDelay = 600;
let showHelp = false;
/** 还能攻击时点"结束回合"，先进入确认状态 */
let confirmEnd = false;
/** 对局中点"退出"，先进入确认状态 */
let armQuit = false;
/** 手机竖屏：没有鼠标悬停，侧栏改成从底部弹出的面板 */
let sheet: 'log' | 'detail' | null = null;
const mq = window.matchMedia('(max-width: 760px)');
const isMobile = () => mq.matches;
// 旧版 Safari / 部分手机内置浏览器没有 addEventListener，只有老的 addListener
if (mq.addEventListener) mq.addEventListener('change', () => render());
else (mq as unknown as { addListener: (f: () => void) => void }).addListener(() => render());

const helpModal = () =>
  showHelp
    ? `<div class="modal-bg help-bg" data-click="closeHelp"><div class="modal help" data-click="noop">
        <button class="ghost close" data-click="closeHelp">关闭 ✕</button>${HELP_HTML}</div></div>`
    : '';
/** 没在对局时显示哪个页面 */
let screen: 'home' | 'setup' | 'builder' = 'home';
/** 卡组选择：'p:fire' = 预设卡组，'c:<id>' = 自建卡组，'random' = 随机预设 */
let myRef = 'p:fire';
let aiRef = 'random';
let lastSetup: { mine: DeckList; theirs: DeckList; seed: number } = { mine: DECKS.fire, theirs: DECKS.water, seed: 0 };

function resolveRef(ref: string): DeckList | null {
  if (ref === 'random') {
    const keys = Object.keys(DECKS);
    return DECKS[keys[Math.floor(Math.random() * keys.length)]];
  }
  if (ref.startsWith('p:')) return DECKS[ref.slice(2)] ?? null;
  const d = store.getDeck(ref.slice(2));
  return d && store.deckProblems(d).length === 0 ? store.toDeckList(d) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 0);
}

// ---------- 两个 Agent ----------

function makeHuman(myToken: number): Agent {
  const never = new Promise<never>(() => {});
  return {
    name: '你',
    chooseAction: (_g, _me, actions) => {
      if (myToken !== token) return never; // 旧对局，不再响应
      return new Promise<Action>((res) => {
        pending = { kind: 'action', actions, resolve: (a) => { pending = null; selected = null; confirmEnd = false; res(a); render(); } };
        render();
      });
    },
    choose: (_g, _me, req) => {
      if (myToken !== token) return never;
      return new Promise<number>((res) => {
        pending = { kind: 'choice', req, resolve: (i) => { pending = null; res(i); render(); } };
        render();
      });
    },
  };
}

function makeAI(myToken: number): Agent {
  const inner = new HeuristicAgent('电脑');
  const never = new Promise<never>(() => {});
  return {
    name: '电脑',
    chooseAction: async (g, me, actions) => {
      render();
      await sleep(aiDelay);
      if (myToken !== token) return never;
      return inner.chooseAction(g, me, actions);
    },
    choose: async (g, me, req) => {
      await sleep(aiDelay / 2);
      if (myToken !== token) return never;
      return inner.choose(g, me, req);
    },
  };
}

async function startGame(mine: DeckList, theirs: DeckList, seed: number) {
  const myToken = ++token;
  lastSetup = { mine, theirs, seed };
  pending = null;
  selected = null;
  result = null;
  errorMsg = '';
  const g = new Game([mine, theirs], [makeHuman(myToken), makeAI(myToken)], seed, () => {
    if (myToken === token) scheduleRender();
  });
  game = g;
  render();
  try {
    const r = await g.run();
    if (myToken === token) result = r;
  } catch (e) {
    console.error(e);
    if (myToken === token) errorMsg = String(e);
  }
  if (myToken === token) render();
}

// ---------- 动作查询 ----------

const acts = (): Action[] => (pending?.kind === 'action' ? pending.actions : []);
const handName = (uid: number) => game!.player(ME).hand.find((c) => c.uid === uid)?.def.name;
/** 引擎对同名手牌只给一个 uid，所以按卡名找动作 */
const cardActions = (name: string) => acts().filter((a) => 'uid' in a && handName(a.uid) === name);
const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

function submit(a: Action) {
  if (pending?.kind !== 'action') return;
  const found = pending.actions.find((x) => sameAction(x, a));
  if (found) pending.resolve(found);
}

function isTarget(slot: Slot): boolean {
  if (!selected) return false;
  if (selected.mode === 'retreat') return typeof slot === 'number' && acts().some((a) => a.type === 'retreat' && a.to === slot);
  return cardActions(selected.name).some((a) => (a.type === 'attach' || a.type === 'evolve') && a.target === slot);
}

function onHand(name: string) {
  const list = cardActions(name);
  if (!list.length) return;
  const direct = list.every((a) => a.type === 'playBasic' || a.type === 'trainer');
  if (selected?.mode === 'card' && selected.name === name) {
    // 手机上：再点一次同一张 = 确认打出
    if (isMobile() && direct) return submit(list[0]);
    selected = null;
    return render();
  }
  if (isMobile()) {
    // 手机没有悬停，第一次点只预览卡牌说明（要选目标的卡会同时点亮目标）
    detailName = name;
    selected = { mode: 'card', name };
    return render();
  }
  if (direct) return submit(list[0]);
  if (list.length === 1) return submit(list[0]);
  selected = { mode: 'card', name };
  render();
}

function onSlot(slot: Slot) {
  if (!selected) return;
  if (selected.mode === 'retreat') {
    if (typeof slot === 'number') submit({ type: 'retreat', to: slot });
    return;
  }
  const a = cardActions(selected.name).find((x) => (x.type === 'attach' || x.type === 'evolve') && x.target === slot);
  if (a) submit(a);
}

// ---------- 渲染：卡片 ----------


/** 实卡用的伤害指示物：面值 100 / 50 / 10，凑出总伤害 */
function damageCounters(dmg: number): string {
  if (dmg <= 0) return '';
  const tokens: string[] = [];
  let n = dmg;
  for (const v of [100, 50, 10]) {
    while (n >= v) {
      tokens.push(`<i class="dc d${v}">${v}</i>`);
      n -= v;
    }
  }
  return `<div class="counters">${tokens.join('')}</div>`;
}

/** 实卡里睡眠/麻痹/混乱是转动卡片表示的 */
const ROT_CAP: Record<string, string> = {
  asleep: '睡眠 · 卡片逆时针横置',
  paralyzed: '麻痹 · 卡片顺时针横置',
  confused: '混乱 · 卡片上下颠倒',
};

function creatureCard(ip: InPlay, q: PlayerId, slot: Slot): string {
  const d = top(ip);
  const big = slot === 'active';
  const mine = q === ME;
  const left = Math.max(0, hpLeft(ip));
  const targ = mine && isTarget(slot);
  const markers = [
    ip.poisoned && '<i class="mk poison" title="中毒标记：每回合结束受到 10 伤害">毒</i>',
    ip.burned && '<i class="mk burn" title="灼伤标记：每回合结束受到 20 伤害，掷硬币正面恢复">灼</i>',
  ].filter(Boolean).join('');
  const atkRows = d.attacks
    .map((atk, i) => {
      const can = mine && big && acts().some((a) => a.type === 'attack' && a.index === i);
      return `<div class="atk${can ? ' can' : ''}"${can ? ` data-click="attack:${i}"` : ''} title="${esc(atk.text ?? '')}">
        <span class="cost">${atk.cost.map(pip).join('')}</span><span class="an">${esc(atk.name)}</span><span class="dmg">${atk.damage || ''}</span></div>`;
    })
    .join('');
  const ab = d.ability;
  const canAb = mine && acts().some((a) => a.type === 'ability' && a.target === slot);
  const abRow = ab
    ? `<div class="ability${canAb ? ' can' : ''}"${canAb ? ` data-click="ability:${slot}"` : ''} title="${esc(ab.text)}">✦ ${esc(ab.name)}</div>`
    : '';
  const canRetreat = mine && big && acts().some((a) => a.type === 'retreat');
  const retreating = selected?.mode === 'retreat' && mine && big;
  return `<div class="card creature t-${d.type} ${big ? 'big' : 'small'}${targ ? ' target' : ''}${retreating ? ' selected' : ''}${
    ip.damage >= d.hp ? ' ko' : ''
  }" data-name="${esc(d.name)}" title="受到 ${ip.damage} 伤害 · 剩余 HP ${left}/${d.hp}"${targ ? ` data-click="slot:${slot}"` : ''}>
    ${markers ? `<div class="markers">${markers}</div>` : ''}
    <div class="c-head"><span class="c-name">${esc(d.name)}</span><span class="c-hp${ip.damage > 0 ? ' hurt' : ''}"><small>HP</small>${left}${ip.damage > 0 ? `<small class="of">/${d.hp}</small>` : ''}</span></div>
    <div class="c-sub">${d.stage === 0 ? '基础' : d.stage + ' 阶'}</div>
    <div class="art">${cardArt(d)}${damageCounters(ip.damage)}</div>
    <div class="c-energy">${energyTypes(ip).map(pip).join('') || '<span class="none">无能量</span>'}</div>
    ${abRow}
    <div class="atks">${atkRows}</div>
    ${
      big
        ? `<div class="c-foot"><span>弱点 ${d.weakness ? TYPE_NAME[d.weakness] : '-'} · 撤退 ${d.retreat}</span>${
            canRetreat ? `<button class="retreat${retreating ? ' on' : ''}" data-click="retreat">撤退</button>` : ''
          }</div>`
        : ''
    }
  </div>`;
}

function cardBody(d: CardDef): { cls: string; body: string } {
  if (d.kind === 'creature') {
    return {
      cls: `t-${d.type}`,
      body: `<div class="c-head"><span class="c-name">${esc(d.name)}</span><span class="c-hp">${d.hp}</span></div>
        <div class="c-sub">${d.stage === 0 ? '基础生物' : `${d.stage} 阶 · ${esc(d.evolvesFrom!)}进化`}</div>
        <div class="art">${cardArt(d)}</div>
        ${d.ability ? `<div class="ability">✦ ${esc(d.ability.name)}</div>` : ''}
        <div class="atks">${d.attacks
          .map((a) => `<div class="atk"><span class="cost">${a.cost.map(pip).join('')}</span><span class="an">${esc(a.name)}</span><span class="dmg">${a.damage || ''}</span></div>`)
          .join('')}</div>`,
    };
  }
  if (d.kind === 'trainer') {
    return {
      cls: d.sub === 'supporter' ? 't-supporter' : 't-item',
      body: `<div class="c-head"><span class="c-name">${esc(d.name)}</span></div>
        <div class="c-sub">${d.sub === 'supporter' ? '支援者' : '物品'}</div><div class="art">${cardArt(d)}</div><div class="c-text">${esc(d.text)}</div>`,
    };
  }
  return {
    cls: `t-${d.provides} energy`,
    body: `<div class="c-head"><span class="c-name">${esc(d.name)}</span></div><div class="art energy-art">${cardArt(d)}</div>`,
  };
}

const KIND_ORDER = { creature: 0, trainer: 1, energy: 2 };

function handCard(c: Card): string {
  const d = c.def;
  const can = cardActions(d.name).length > 0;
  const sel = selected?.mode === 'card' && selected.name === d.name;
  const { cls, body } = cardBody(d);
  return `<div class="card hand ${cls}${can ? ' playable' : ''}${sel ? ' selected' : ''}" data-name="${esc(d.name)}"${
    can ? ` data-click="hand:${esc(d.name)}"` : ''
  }>${body}</div>`;
}

function detailHTML(): string {
  const d = detailName ? CARDS[detailName] : null;
  if (!d) return '<div class="muted">把鼠标移到任意卡上查看详情</div>';
  if (d.kind === 'creature') {
    return `<h4 class="dt t-${d.type}">${esc(d.name)} <small>HP ${d.hp} · ${TYPE_NAME[d.type]}系</small></h4>
      <div class="muted">${d.stage === 0 ? '基础生物' : `${d.stage} 阶，由 ${esc(d.evolvesFrom!)} 进化`}</div>
      ${d.ability ? `<p><b>特性【${esc(d.ability.name)}】</b>${esc(d.ability.text)}</p>` : ''}
      ${d.attacks
        .map((a) => `<p>${a.cost.map(pip).join('')} <b>${esc(a.name)}</b> ${a.damage || ''}${a.text ? `<br><span class="muted">${esc(a.text)}</span>` : ''}</p>`)
        .join('')}
      <div class="muted">弱点 ${d.weakness ? TYPE_NAME[d.weakness] + '（×2）' : '无'} · 抗性 ${d.resistance ? TYPE_NAME[d.resistance] : '无'} · 撤退 ${d.retreat}</div>`;
  }
  if (d.kind === 'trainer') {
    return `<h4 class="dt t-${d.sub === 'supporter' ? 'supporter' : 'item'}">${esc(d.name)} <small>${d.sub === 'supporter' ? '支援者（每回合 1 张）' : '物品'}</small></h4><p>${esc(d.text)}</p>`;
  }
  return `<h4 class="dt t-${d.provides}">${esc(d.name)}</h4><p>基础能量，每回合可以贴 1 张。</p>`;
}

// ---------- 渲染：区域 ----------

function piles(g: Game, q: PlayerId): string {
  const P = g.player(q);
  const prizes = Array.from({ length: 6 }, (_, i) => `<i class="${i < P.prizes.length ? 'full' : ''}"></i>`).join('');
  const lastDiscard = P.discard[P.discard.length - 1];
  const flags =
    q === ME && g.s.current === ME
      ? `<div class="flags"><span class="${P.energyAttached ? 'used' : ''}">能量</span><span class="${P.supporterPlayed ? 'used' : ''}">支援者</span><span class="${P.retreated ? 'used' : ''}">撤退</span></div>`
      : '';
  return `<div class="piles">
    <div class="who">${q === ME ? '你' : '电脑'}<small>${esc(q === ME ? lastSetup.mine.name : lastSetup.theirs.name)}</small></div>
    <div class="prizes" title="奖赏卡：剩余 ${P.prizes.length} 张，拿完就赢">${prizes}</div>
    <div class="pile">牌库 <b>${P.deck.length}</b></div>
    <div class="pile"${lastDiscard ? ` data-name="${esc(lastDiscard.def.name)}"` : ''}>弃牌 <b>${P.discard.length}</b></div>
    ${q === AI ? `<div class="pile">手牌 <b>${P.hand.length}</b></div>` : ''}
    ${flags}
  </div>`;
}

function area(g: Game, q: PlayerId): string {
  const P = g.player(q);
  const bench = Array.from({ length: 5 }, (_, i) =>
    P.bench[i] ? creatureCard(P.bench[i], q, i) : `<div class="slot-empty">备战</div>`,
  ).join('');
  const rot = P.active?.rotation;
  const active = P.active
    ? `<div class="rotor${rot ? ' rot-' + rot : ''}">${creatureCard(P.active, q, 'active')}</div>${
        rot ? `<div class="rot-cap">${ROT_CAP[rot]}</div>` : ''
      }`
    : `<div class="slot-empty big">前场</div>`;
  const turnOn = g.s.current === q && !result;
  return `<section class="area ${q === ME ? 'mine' : 'theirs'}${turnOn ? ' on' : ''}">
    ${piles(g, q)}
    <div class="active-wrap">${active}</div>
    <div class="bench">${bench}</div>
  </section>`;
}

function hint(g: Game): string {
  if (result || errorMsg) return '';
  if (pending?.kind === 'choice') return pending.req.prompt;
  if (pending?.kind === 'action') {
    if (selected?.mode === 'card') {
      const direct = cardActions(selected.name).some((a) => a.type === 'playBasic' || a.type === 'trainer');
      return direct ? `确认打出「${selected.name}」？` : `选择「${selected.name}」的目标（发光的生物）`;
    }
    if (selected?.mode === 'retreat') return '选择要换上前场的备战生物';
    if (g.s.turn === 1) return '先攻第一回合：不能攻击、不能用支援者';
    return '点亮的手牌可以打出；点前场生物的招式攻击（攻击后回合结束）';
  }
  if (g.s.turn === 0) return '准备中…';
  return g.s.current === AI ? '电脑行动中…' : '';
}

function midbar(g: Game): string {
  const s = g.s;
  const who = s.turn === 0 ? '准备阶段' : s.current === ME ? '你的回合' : '电脑的回合';
  const btns = [
    selected && !isMobile() ? `<button class="ghost" data-click="cancel">取消</button>` : '',
    pending?.kind === 'action'
      ? `<button class="end${confirmEnd ? ' warn' : ''}" data-click="end">${confirmEnd ? '确定不攻击？再点一次' : '结束回合'}</button>`
      : '',
    `<button class="ghost mobile-only" data-click="sheet:log">记录</button>`,
  ].join('');
  return `<div class="midbar">
    <span class="turn">${s.turn > 0 ? `第 ${s.turn} 回合 · ` : ''}<b class="${s.current === ME ? 'me' : 'ai'}">${who}</b></span>
    <span class="hint">${esc(hint(g))}</span>
    <span class="btns">${btns}<button class="ghost" data-click="help">规则</button><button class="ghost${armQuit ? ' warn' : ''}" data-click="quit">${armQuit ? '确认退出？' : '退出'}</button></span>
  </div>`;
}

function handRow(g: Game): string {
  const hand = [...g.player(ME).hand].sort((a, b) => KIND_ORDER[a.def.kind] - KIND_ORDER[b.def.kind]);
  const backs = Math.min(g.player(AI).hand.length, 12);
  return `<div class="dock">${preview()}<div class="hand-row">${hand.map(handCard).join('') || '<span class="muted">没有手牌</span>'}</div></div>
    <div class="opp-hand" title="电脑的手牌">${'<i></i>'.repeat(backs)}</div>`;
}

/** 手机上选中手牌后，在手牌上方显示说明和确认按钮 */
function preview(): string {
  if (!isMobile() || selected?.mode !== 'card') return '';
  const list = cardActions(selected.name);
  const direct = list.find((a) => a.type === 'playBasic' || a.type === 'trainer');
  const btn = direct
    ? `<button class="end" data-click="play">${direct.type === 'playBasic' ? '放到备战区' : '使用'}</button>`
    : `<span class="muted">点发光的生物作为目标</span>`;
  return `<div class="preview"><div class="pv-detail">${detailHTML()}</div>
    <div class="pv-btns">${btn}<button class="ghost" data-click="cancel">取消</button></div></div>`;
}

/** 手机：底部弹出的面板（卡牌详情 / 对局记录） */
function sheetHTML(g: Game | null): string {
  if (!sheet || !isMobile()) return '';
  const body =
    sheet === 'detail'
      ? `<div class="detail">${detailHTML()}</div>`
      : `${actionList()}<div class="log">${g ? logHTML(g) : ''}</div>`;
  return `<div class="modal-bg sheet-bg" data-click="closeSheet"><div class="sheet" data-click="noop">
    <div class="sheet-head"><b>${sheet === 'detail' ? '卡牌详情' : '对局记录'}</b><button class="ghost" data-click="closeSheet">关闭</button></div>
    ${body}</div></div>`;
}

function logHTML(g: Game): string {
  return g.s.log
    .slice(-250)
    .map((m) => {
      const t = m.trim();
      const cls = t.startsWith('——') ? 'h' : t.startsWith('✖') ? 'ko' : t.startsWith('★') ? 'win' : t.startsWith('掷硬币') ? 'coin' : t.startsWith('→') ? 'sub' : '';
      return `<div class="${cls}">${esc(t)}</div>`;
    })
    .join('');
}

function actionList(): string {
  if (pending?.kind !== 'action' || !game) return '';
  const g = game;
  const items = pending.actions
    .map((a, i) => (a.type === 'end' ? '' : `<button data-click="act:${i}">${esc(g.describeAction(ME, a))}</button>`))
    .join('');
  return `<details class="actions"><summary>全部可执行操作（${pending.actions.length - 1}）</summary>${items}</details>`;
}

function choiceModal(g: Game): string {
  if (pending?.kind !== 'choice') return '';
  const r = pending.req;
  const owner: PlayerId = r.kind === 'oppBench' ? AI : ME;
  const opts = r.options
    .map((o, i) => {
      let inner = `<span class="ol">${esc(o.label)}</span>`;
      if (o.card) inner = `<div class="card hand ${cardBody(o.card.def).cls}">${cardBody(o.card.def).body}</div>`;
      else if (o.slot !== undefined) {
        const ip = g.getSlot(owner, o.slot);
        if (ip) inner = creatureCard(ip, AI, typeof o.slot === 'number' ? o.slot : 0) + `<span class="ol">${esc(o.label)}</span>`;
      }
      return `<button class="opt" data-click="opt:${i}">${inner}</button>`;
    })
    .join('');
  return `<div class="modal-bg"><div class="modal">
    <h3>${esc(r.prompt)}</h3>
    <div class="opts">${opts}</div>
    ${r.optional ? `<button class="ghost" data-click="skip">跳过 / 完成</button>` : ''}
  </div></div>`;
}

function overOverlay(g: Game): string {
  if (!result && !errorMsg) return '';
  const title = errorMsg ? '出错了' : result!.winner === 'draw' ? '平局' : result!.winner === ME ? '你赢了！' : '电脑赢了';
  const sub = errorMsg ? esc(errorMsg) : `${esc(result!.reason)} · ${result!.turns} 回合 · 种子 ${lastSetup.seed}`;
  return `<div class="modal-bg light"><div class="modal over ${result?.winner === ME ? 'won' : ''}">
    <h2>${title}</h2><p>${sub}</p>
    <div class="row"><button class="end" data-click="rematch">同一种子再来</button><button class="end" data-click="new">新的一局</button><button class="ghost" data-click="menu">返回菜单</button></div>
    <p class="muted">你剩余奖赏卡 ${g.player(ME).prizes.length} · 电脑剩余 ${g.player(AI).prizes.length}</p>
  </div></div>`;
}

// ---------- 主页 / 对战准备 ----------

function homeScreen(): string {
  const fan = ['炎翼龙', '潮汐蛟', '森冠龙', '霆翼鹰']
    .map((n, i) => `<div class="fan-card" style="--i:${i}">${cardArt(CARDS[n])}</div>`)
    .join('');
  return `<div class="home">
    <div class="fan" aria-hidden="true">${fan}</div>
    <h1>卡牌对战</h1>
    <p class="muted">一个人练牌的集换式卡牌对战。先拿完 6 张奖赏卡就赢。</p>
    <nav class="home-menu">
      <button class="menu-btn battle" data-click="go:setup"><b>对战</b><span>选好卡组，和电脑打一局</span></button>
      <button class="menu-btn build" data-click="go:builder"><b>构筑</b><span>浏览全部卡牌，组自己的卡组</span></button>
      <button class="menu-btn tut" data-click="help"><b>新手教程</b><span>对战规则和实卡操作</span></button>
    </nav>
  </div>`;
}

const PRESET_NOTE: Record<string, string> = {
  fire: '炎翼龙 150 爆发 · 怕水',
  water: '潮汐蛟回收能量 · 怕雷',
  grass: '森冠龙吸血回复 · 怕火',
  lightning: '霆翼鹰狙击备战区 · 怕草',
};

function deckOptions(group: 'mine' | 'ai'): string {
  const cur = group === 'mine' ? myRef : aiRef;
  const click = group === 'mine' ? 'pickMine' : 'pickAi';
  const opt = (ref: string, cls: string, name: string, note: string, disabled = false, style = '') =>
    `<button class="deck-opt ${cls}${cur === ref ? ' on' : ''}" data-click="${click}:${ref}" ${disabled ? 'disabled' : ''}${style ? ` style="${style}"` : ''}>
      <b>${esc(name)}</b><span>${esc(note)}</span></button>`;
  const presets = Object.entries(DECKS).map(([k, d]) => opt(`p:${k}`, `t-${k}`, d.name, PRESET_NOTE[k] ?? '预设卡组'));
  const mine = store.getDecks().map((d) => {
    const problems = store.deckProblems(d);
    const t = store.deckTheme(d);
    return opt(
      `c:${d.id}`, 'custom', d.name,
      problems.length ? `未完成 · ${store.deckTotal(d)}/${DECK_SIZE} 张` : '我的卡组',
      problems.length > 0, `background:linear-gradient(135deg, ${t.a}, ${t.b})`,
    );
  });
  const random = group === 'ai' ? [opt('random', 'random', '随机', '从预设卡组里随机选一套')] : [];
  return [...random, ...presets, ...mine].join('');
}

function setupScreen(): string {
  return `<div class="setup">
    <header class="b-top"><button class="ghost" data-click="go:home">← 主页</button><h2>对战</h2></header>
    <h3>你的卡组</h3>
    <div class="deck-pick">${deckOptions('mine')}</div>
    <h3>电脑的卡组</h3>
    <div class="deck-pick">${deckOptions('ai')}</div>
    <div class="opts-row">
      <label>电脑速度 <select id="speed"><option value="200">快</option><option value="600" ${aiDelay === 600 ? 'selected' : ''}>中</option><option value="1100" ${aiDelay === 1100 ? 'selected' : ''}>慢</option></select></label>
      <label>种子 <input id="seed" placeholder="留空 = 随机" inputmode="numeric" autocomplete="off"/></label>
    </div>
    <button class="end big" data-click="start">开始对战</button>
    <p class="muted small">自建卡组要在「构筑」里凑满 ${DECK_SIZE} 张、符合规则后才能选。</p>
  </div>`;
}

// ---------- 主渲染 ----------

function render() {
  if (!game) {
    // 重绘会替换掉输入框，记下焦点和光标位置，画完再还原
    const ae = document.activeElement as HTMLInputElement | null;
    const focusId = ae?.id;
    const selStart = ae?.selectionStart ?? null;
    const selEnd = ae?.selectionEnd ?? null;
    // 同样记下各滚动区域的位置（构筑页加卡时列表不能跳回顶部）
    const scrolls = [...app.querySelectorAll<HTMLElement>('[data-scroll]')].map((e) => [e.dataset.scroll, e.scrollTop, e.scrollLeft] as const);
    const body = screen === 'builder' ? builderHTML() : screen === 'setup' ? setupScreen() : homeScreen();
    app.innerHTML = body + helpModal();
    for (const [key, top, left] of scrolls) {
      const el = app.querySelector<HTMLElement>(`[data-scroll="${key}"]`);
      if (el) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
    }
    if (focusId) {
      const el = document.getElementById(focusId) as HTMLInputElement | null;
      if (el) {
        el.focus();
        if (selStart !== null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selEnd ?? selStart); } catch { /* type=search 等不支持时忽略 */ }
        }
      }
    }
    return;
  }
  const g = game;
  const oldLog = app.querySelector('.log');
  const stick = !oldLog || oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 40;
  const oldTop = oldLog?.scrollTop ?? 0;
  const actionsOpen = !!app.querySelector('details.actions[open]');
  app.innerHTML = `<div class="layout">
    <main class="board">
      ${area(g, AI)}
      ${midbar(g)}
      ${area(g, ME)}
      ${handRow(g)}
    </main>
    <aside class="side">
      <div class="detail">${detailHTML()}</div>
      ${actionList()}
      <div class="log">${logHTML(g)}</div>
    </aside>
  </div>
  ${choiceModal(g)}${overOverlay(g)}${sheetHTML(g)}${helpModal()}`;
  const log = app.querySelector('.log')!;
  log.scrollTop = stick ? log.scrollHeight : oldTop;
  if (actionsOpen) app.querySelector('details.actions')?.setAttribute('open', '');
}

// ---------- 长按（手机）/ 右键（电脑）：卡盒管理菜单 ----------
let lpTimer = 0;
let lpFired = false;
let lpStart: { x: number; y: number } | null = null;

function fireLongPress(el: HTMLElement) {
  const raw = el.dataset.longpress!;
  const k = raw.indexOf(':');
  builderClick(raw.slice(0, k), raw.slice(k + 1));
  try { navigator.vibrate?.(12); } catch { /* 不支持就算了 */ }
}

app.addEventListener('pointerdown', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-longpress]');
  lpFired = false;
  if (!el || e.button !== 0) return;
  lpStart = { x: e.clientX, y: e.clientY };
  clearTimeout(lpTimer);
  lpTimer = window.setTimeout(() => {
    lpFired = true;
    fireLongPress(el);
  }, 480);
});
app.addEventListener('pointermove', (e) => {
  if (lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) clearTimeout(lpTimer);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  app.addEventListener(ev, () => {
    clearTimeout(lpTimer);
    lpStart = null;
  });
}
app.addEventListener('contextmenu', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-longpress]');
  if (!el) return;
  e.preventDefault(); // 不弹浏览器自己的菜单
  if (!lpFired) {
    lpFired = true;
    fireLongPress(el);
  }
});

app.addEventListener('click', (e) => {
  if (lpFired) {
    // 长按之后松手产生的那次点击不算数
    lpFired = false;
    e.preventDefault();
    return;
  }
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-click]');
  if (!el) {
    // 手机：点一张不能操作的卡 = 查看详情
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-name]');
    if (card && isMobile()) {
      detailName = card.dataset.name!;
      sheet = 'detail';
      render();
    }
    return;
  }
  const raw = el.dataset.click!;
  const k = raw.indexOf(':');
  const kind = k < 0 ? raw : raw.slice(0, k);
  const val = k < 0 ? '' : raw.slice(k + 1);
  switch (kind) {
    case 'start': {
      aiDelay = Number((document.getElementById('speed') as HTMLSelectElement).value);
      const seedStr = (document.getElementById('seed') as HTMLInputElement).value.trim();
      const seed = seedStr ? Number(seedStr) || 1 : Math.floor(Math.random() * 1e9);
      const mine = resolveRef(myRef);
      const theirs = resolveRef(aiRef);
      if (!mine || !theirs) {
        // 选中的自建卡组被改得不合规了，退回预设
        if (!mine) myRef = 'p:fire';
        if (!theirs) aiRef = 'random';
        render();
        break;
      }
      void startGame(mine, theirs, seed);
      break;
    }
    case 'go':
      screen = val === 'setup' ? 'setup' : val === 'builder' ? 'builder' : 'home';
      if (screen === 'setup') {
        if (!resolveRef(myRef)) myRef = 'p:fire';
        if (aiRef !== 'random' && !resolveRef(aiRef)) aiRef = 'random';
      }
      render();
      break;
    case 'pickMine': myRef = val; render(); break;
    case 'pickAi': aiRef = val; render(); break;
    case 'quit':
      if (!armQuit) {
        armQuit = true;
        render();
        setTimeout(() => { armQuit = false; render(); }, 2500);
        break;
      }
      armQuit = false;
      token++; game = null; result = null; errorMsg = ''; pending = null; screen = 'setup'; render();
      break;
    case 'hand': onHand(val); break;
    case 'slot': onSlot(val === 'active' ? 'active' : Number(val)); break;
    case 'attack': submit({ type: 'attack', index: Number(val) }); break;
    case 'ability': submit({ type: 'ability', target: val === 'active' ? 'active' : Number(val) }); break;
    case 'retreat':
      selected = selected?.mode === 'retreat' ? null : { mode: 'retreat' };
      render();
      break;
    case 'end':
      // 还能攻击时要求再点一次确认（不用 confirm()：发布后的页面里它会被直接拒绝）
      if (acts().some((a) => a.type === 'attack') && !confirmEnd) {
        confirmEnd = true;
        render();
        break;
      }
      submit({ type: 'end' });
      break;
    case 'act': if (pending?.kind === 'action') pending.resolve(pending.actions[Number(val)]); break;
    case 'opt': if (pending?.kind === 'choice') pending.resolve(Number(val)); break;
    case 'skip': if (pending?.kind === 'choice') pending.resolve(-1); break;
    case 'cancel': selected = null; confirmEnd = false; render(); break;
    case 'play': {
      if (selected?.mode !== 'card') break;
      const a = cardActions(selected.name).find((x) => x.type === 'playBasic' || x.type === 'trainer');
      if (a) submit(a);
      break;
    }
    case 'sheet': sheet = val === 'detail' ? 'detail' : 'log'; render(); break;
    case 'closeSheet': sheet = null; render(); break;
    case 'rematch': void startGame(lastSetup.mine, lastSetup.theirs, lastSetup.seed); break;
    case 'new': void startGame(lastSetup.mine, lastSetup.theirs, Math.floor(Math.random() * 1e9)); break;
    case 'help': showHelp = true; render(); break;
    case 'closeHelp': showHelp = false; render(); break;
    case 'noop': break;
    case 'menu': token++; game = null; result = null; errorMsg = ''; pending = null; screen = 'home'; render(); break;
    default:
      builderClick(kind, val);
  }
});

// 构筑界面的输入框
app.addEventListener('input', (e) => {
  if (!game && builderInput(e.target as HTMLInputElement, 'input')) render();
});
app.addEventListener('change', (e) => {
  if (!game && builderInput(e.target as HTMLInputElement, 'change')) render();
});

app.addEventListener('mouseover', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-name]');
  if (!el || el.dataset.name === detailName) return;
  detailName = el.dataset.name!;
  const d = app.querySelector('.detail');
  if (d) d.innerHTML = detailHTML();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && showHelp) {
    showHelp = false;
    render();
  } else if (e.key === 'Escape' && selected) {
    selected = null;
    render();
  }
});

// 调试用：控制台里可以看 __game.s
Object.defineProperty(window, '__game', { get: () => game });
// 调试用：按手牌样式渲染任意一张卡，检查文字是否放得下
Object.defineProperty(window, '__handCard', { value: (name: string) => handCard({ uid: 0, def: CARDS[name] }) });
Object.defineProperty(window, '__cards', { value: CARDS });

initBuilder(() => {
  if (!game && screen === 'builder') render();
});
render();

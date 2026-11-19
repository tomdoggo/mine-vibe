/**
 * 规则引擎：负责"什么动作合法"和"执行动作的后果"，不负责"选哪个"——那是 Agent 的事。
 *
 * 已实现的规则：
 *  - 准备：掷硬币、赢家选先后攻 → 洗牌抽 7，没基础生物就重抽（对手每次可多抽 1）→ 放前场/备战区 → 6 张奖赏卡
 *  - 回合：抽 1（抽不到判负）；先攻第一回合不能攻击、不能用支援者；双方第一回合都不能进化
 *  - 每回合：贴能量 1 次、支援者 1 张、撤退 1 次；物品、放基础生物、进化不限
 *  - 本回合放上场/刚进化的生物不能再进化；进化与撤退会清除特殊状态
 *  - 攻击：能量需求（无色可用任意能量）、弱点 ×2、抗性 -30、混乱掷硬币（反面自伤 30）
 *  - 宝可梦检查：中毒 10、灼伤 20（正面恢复）、睡眠（正面醒来）、麻痹（自己回合结束时解除）
 *  - 昏厥：对手拿奖赏卡（prizes 字段，默认 1），前场空了从备战区补上
 *  - 胜负：拿完奖赏卡 / 对手场上没有生物 / 对手回合开始无牌可抽；同时达成算平局
 */
import type {
  Action,
  Agent,
  AttackDef,
  Card,
  CardDef,
  ChoiceRequest,
  CreatureDef,
  DeckList,
  EnergyDef,
  EType,
  GameState,
  InPlay,
  PlayerId,
  PlayerState,
  Rotation,
  Slot,
  TrainerDef,
} from './types.ts';
import { CARDS, validateDeck } from './cards.ts';
import { makeRng, shuffle } from './rng.ts';

export const MAX_TURNS = 150;

const ROT_NAME: Record<Rotation, string> = { asleep: '睡眠', paralyzed: '麻痹', confused: '混乱' };
export const TYPE_NAME: Record<EType, string> = {
  fire: '火', water: '水', grass: '草', lightning: '雷', colorless: '无',
};

// ---------- 纯函数工具（AI 也会用） ----------

export const isBasic = (d: CardDef) => d.kind === 'creature' && d.stage === 0;
export const top = (ip: InPlay) => ip.stack[ip.stack.length - 1].def as CreatureDef;
export const hpLeft = (ip: InPlay) => top(ip).hp - ip.damage;
export const energyTypes = (ip: InPlay): EType[] => ip.energy.map((c) => (c.def as EnergyDef).provides);

/** 还差几个能量才能支付 cost */
export function missingFor(have: EType[], cost: EType[]): number {
  const pool = [...have];
  let missing = 0;
  for (const t of cost) {
    if (t === 'colorless') continue;
    const i = pool.indexOf(t);
    if (i >= 0) pool.splice(i, 1);
    else missing++;
  }
  const colorless = cost.filter((t) => t === 'colorless').length;
  return missing + Math.max(0, colorless - pool.length);
}
export const canPay = (have: EType[], cost: EType[]) => missingFor(have, cost) === 0;

export function applyWR(dmg: number, attacker: InPlay, defender: InPlay): number {
  const t = top(attacker).type;
  const d = top(defender);
  if (d.weakness === t) dmg *= 2;
  if (d.resistance === t) dmg = Math.max(0, dmg - 30);
  return dmg;
}

/** 不掷硬币的期望伤害估算（给 AI 用） */
export function estimate(attacker: InPlay, atk: AttackDef, defender: InPlay | null): number {
  const base = atk.estimate ? atk.estimate(attacker) : atk.damage;
  return defender && base > 0 ? applyWR(base, attacker, defender) : base;
}

function uniqByName(cards: Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.def.name) ? false : (seen.add(c.def.name), true)));
}

export interface GameResult {
  winner: PlayerId | 'draw';
  turns: number;
  reason: string;
}

export class Game {
  s: GameState;
  rnd: () => number;
  agents: [Agent, Agent];
  onLog?: (msg: string) => void;
  private uidSeq = 1;

  constructor(decks: [DeckList, DeckList], agents: [Agent, Agent], seed: number, onLog?: (msg: string) => void) {
    this.rnd = makeRng(seed);
    this.agents = agents;
    this.onLog = onLog;
    const mk = (d: DeckList, name: string): PlayerState => ({
      name, deck: this.buildDeck(d), hand: [], discard: [], prizes: [], active: null, bench: [],
      energyAttached: false, supporterPlayed: false, retreated: false,
    });
    this.s = {
      players: [mk(decks[0], agents[0].name), mk(decks[1], agents[1].name)],
      current: 0, turn: 0, first: 0, winner: null, reason: '', log: [],
    };
  }

  private buildDeck(d: DeckList): Card[] {
    const problems = validateDeck(d.cards);
    if (problems.length) throw new Error(`${d.name} 不合规：${problems.join('；')}`);
    const cards: Card[] = [];
    for (const [name, n] of d.cards) {
      for (let i = 0; i < n; i++) cards.push({ uid: this.uidSeq++, def: CARDS[name] });
    }
    return cards;
  }

  // ---------- 查询 ----------

  player(p: PlayerId): PlayerState { return this.s.players[p]; }
  opp(p: PlayerId): PlayerId { return p === 0 ? 1 : 0; }

  slotsOf(p: PlayerId): Array<{ slot: Slot; ip: InPlay }> {
    const P = this.player(p);
    const out: Array<{ slot: Slot; ip: InPlay }> = [];
    if (P.active) out.push({ slot: 'active', ip: P.active });
    P.bench.forEach((ip, i) => out.push({ slot: i, ip }));
    return out;
  }

  getSlot(p: PlayerId, slot: Slot): InPlay | null {
    const P = this.player(p);
    return slot === 'active' ? P.active : P.bench[slot] ?? null;
  }

  slotName(p: PlayerId, slot: Slot): string {
    const ip = this.getSlot(p, slot);
    const n = ip ? top(ip).name : '?';
    return slot === 'active' ? `前场 ${n}` : `备战${slot + 1} ${n}`;
  }

  // ---------- 供卡牌效果调用的操作 ----------

  log(msg: string): void {
    this.s.log.push(msg);
    this.onLog?.(msg);
  }

  flip(label: string): boolean {
    const heads = this.rnd() < 0.5;
    this.log(`掷硬币（${label}）：${heads ? '正面' : '反面'}`);
    return heads;
  }

  async choose(p: PlayerId, req: ChoiceRequest): Promise<number> {
    if (req.options.length === 0) return -1;
    if (!req.optional && req.options.length === 1) return 0;
    const i = await this.agents[p].choose(this, p, req);
    if (i === -1 && req.optional) return -1;
    if (!Number.isInteger(i) || i < 0 || i >= req.options.length) {
      throw new Error(`${this.player(p).name} 的选择越界：${i}（${req.kind}）`);
    }
    return i;
  }

  takeFromHand(p: PlayerId, uid: number): Card {
    const P = this.player(p);
    const i = P.hand.findIndex((c) => c.uid === uid);
    if (i < 0) throw new Error(`手牌中没有 uid=${uid}`);
    return P.hand.splice(i, 1)[0];
  }

  drawCards(p: PlayerId, n: number): void {
    const P = this.player(p);
    const got = P.deck.splice(0, n);
    P.hand.push(...got);
    this.log(`${P.name} 抽了 ${got.length} 张牌`);
  }

  shuffleDeck(p: PlayerId): void { shuffle(this.player(p).deck, this.rnd); }

  async searchDeck(p: PlayerId, filter: (d: CardDef) => boolean, max: number, prompt: string): Promise<void> {
    const P = this.player(p);
    const found: string[] = [];
    for (let k = 0; k < max; k++) {
      const opts = uniqByName(P.deck.filter((c) => filter(c.def)));
      const i = await this.choose(p, {
        kind: 'search', prompt, optional: true,
        options: opts.map((c) => ({ label: c.def.name, card: c })),
      });
      if (i < 0) break;
      P.deck.splice(P.deck.indexOf(opts[i]), 1);
      P.hand.push(opts[i]);
      found.push(opts[i].def.name);
    }
    this.shuffleDeck(p);
    this.log(found.length ? `${P.name} 从牌库检索了 ${found.join('、')}` : `${P.name} 没有检索到卡`);
  }

  heal(ip: InPlay, n: number): void {
    const h = Math.min(n, ip.damage);
    ip.damage -= h;
    this.log(`→ ${top(ip).name} 回复 ${h} HP`);
  }

  damage(ip: InPlay, n: number): void { ip.damage += n; }

  setRotation(ip: InPlay, r: Rotation): void {
    ip.rotation = r;
    this.log(`→ ${top(ip).name} 陷入${ROT_NAME[r]}`);
  }
  burn(ip: InPlay): void { ip.burned = true; this.log(`→ ${top(ip).name} 灼伤了`); }
  poison(ip: InPlay): void { ip.poisoned = true; this.log(`→ ${top(ip).name} 中毒了`); }

  clearConditions(ip: InPlay): void {
    ip.rotation = null;
    ip.poisoned = false;
    ip.burned = false;
  }

  discardEnergy(p: PlayerId, ip: InPlay, t: EType, n: number): void {
    const P = this.player(p);
    for (let k = 0; k < n; k++) {
      const i = ip.energy.findIndex((c) => (c.def as EnergyDef).provides === t);
      if (i < 0) break;
      P.discard.push(...ip.energy.splice(i, 1));
    }
    this.log(`→ ${top(ip).name} 丢弃了 ${TYPE_NAME[t]}能量`);
  }

  switchActive(p: PlayerId, benchIdx: number): void {
    const P = this.player(p);
    const old = P.active!;
    P.active = P.bench[benchIdx];
    P.bench[benchIdx] = old;
    this.clearConditions(old);
    this.log(`${P.name} 的前场换成 ${top(P.active).name}`);
  }

  evolve(p: PlayerId, uid: number, slot: Slot): void {
    const ip = this.getSlot(p, slot)!;
    const from = top(ip).name;
    const c = this.takeFromHand(p, uid);
    ip.stack.push(c);
    ip.playedTurn = this.s.turn;
    this.clearConditions(ip);
    this.log(`${this.player(p).name} 将 ${from} 进化为 ${c.def.name}`);
  }

  private newInPlay(c: Card): InPlay {
    return {
      stack: [c], energy: [], damage: 0, rotation: null, poisoned: false, burned: false,
      playedTurn: this.s.turn, abilityTurn: -1,
    };
  }

  private immobile(ip: InPlay): boolean {
    return ip.rotation === 'asleep' || ip.rotation === 'paralyzed';
  }

  // ---------- 主流程 ----------

  async run(): Promise<GameResult> {
    await this.setup();
    while (this.s.winner === null) {
      if (this.s.turn > MAX_TURNS) {
        this.end('draw', '超过回合上限');
        break;
      }
      await this.playTurn();
    }
    return { winner: this.s.winner!, turns: this.s.turn, reason: this.s.reason };
  }

  private end(w: PlayerId | 'draw', reason: string): void {
    if (this.s.winner !== null) return;
    this.s.winner = w;
    this.s.reason = reason;
    this.log(`★ 对局结束：${w === 'draw' ? '平局' : this.player(w).name + ' 获胜'}（${reason}）`);
  }

  private async setup(): Promise<void> {
    // 标准顺序：先掷硬币，赢的一方选先攻/后攻，然后才抽起始手牌
    const flipWinner: PlayerId = this.flip(`${this.player(0).name} 猜正面`) ? 0 : 1;
    const pickFirst = await this.choose(flipWinner, {
      kind: 'goFirst', prompt: '你赢得了掷硬币，选择先攻还是后攻', optional: false,
      options: [{ label: '先攻（第一回合不能攻击、不能用支援者）' }, { label: '后攻（第一回合就能攻击）' }],
    });
    this.s.first = pickFirst === 0 ? flipWinner : this.opp(flipWinner);
    this.log(`${this.player(flipWinner).name} 赢得掷硬币，选择${pickFirst === 0 ? '先攻' : '后攻'}；${this.player(this.s.first).name} 先攻`);

    const mull = [0, 0];
    for (const q of [0, 1] as PlayerId[]) {
      const P = this.player(q);
      for (;;) {
        shuffle(P.deck, this.rnd);
        P.hand = P.deck.splice(0, 7);
        if (P.hand.some((c) => isBasic(c.def))) break;
        mull[q]++;
        this.log(`${P.name} 手牌没有基础生物，重抽（第 ${mull[q]} 次）`);
        P.deck.push(...P.hand);
        P.hand = [];
        if (mull[q] > 50) throw new Error(`${P.name} 的牌组里没有基础生物`);
      }
    }
    for (const q of [0, 1] as PlayerId[]) {
      const extra = mull[this.opp(q)];
      if (extra > 0) this.drawCards(q, extra);
    }
    for (const q of [0, 1] as PlayerId[]) {
      const P = this.player(q);
      const basics = () => P.hand.filter((c) => isBasic(c.def));
      let opts = basics();
      const i = await this.choose(q, {
        kind: 'setupActive', prompt: '选择放在前场的基础生物', optional: false,
        options: opts.map((c) => ({ label: c.def.name, card: c })),
      });
      P.active = this.newInPlay(this.takeFromHand(q, opts[i].uid));
      while (P.bench.length < 5) {
        opts = basics();
        const j = await this.choose(q, {
          kind: 'setupBench', prompt: '选择放到备战区的基础生物（0 = 不放了）', optional: true,
          options: opts.map((c) => ({ label: c.def.name, card: c })),
        });
        if (j < 0) break;
        P.bench.push(this.newInPlay(this.takeFromHand(q, opts[j].uid)));
      }
      P.prizes = P.deck.splice(0, 6);
      this.log(`${P.name} 前场：${top(P.active).name}，备战区 ${P.bench.length} 只`);
    }
    this.s.current = this.s.first;
    this.s.turn = 1;
  }

  private async playTurn(): Promise<void> {
    const s = this.s;
    const p = s.current;
    const P = this.player(p);
    P.energyAttached = P.supporterPlayed = P.retreated = false;
    this.log(`\n—— 第 ${s.turn} 回合：${P.name} ——`);
    if (P.deck.length === 0) {
      this.end(this.opp(p), `${P.name} 牌库耗尽，无法抽牌`);
      return;
    }
    this.drawCards(p, 1);

    for (let guard = 0; guard < 300; guard++) {
      const actions = this.legalActions(p);
      const a = await this.agents[p].chooseAction(this, p, actions);
      const key = JSON.stringify(a);
      if (!actions.some((x) => x === a || JSON.stringify(x) === key)) {
        throw new Error(`${P.name} 选择了非法动作 ${key}`);
      }
      if (a.type === 'end') break;
      await this.doAction(p, a);
      await this.checkKnockouts();
      if (s.winner !== null) return;
      if (a.type === 'attack') break;
    }

    this.checkup(p);
    await this.checkKnockouts();
    s.current = this.opp(p);
    s.turn++;
  }

  legalActions(p: PlayerId): Action[] {
    const s = this.s;
    const P = this.player(p);
    const acts: Action[] = [];
    const slots = this.slotsOf(p);

    for (const c of uniqByName(P.hand)) {
      const d = c.def;
      if (d.kind === 'creature') {
        if (d.stage === 0 && P.bench.length < 5) acts.push({ type: 'playBasic', uid: c.uid });
        if (d.stage > 0 && s.turn > 2) {
          for (const { slot, ip } of slots) {
            if (top(ip).name === d.evolvesFrom && ip.playedTurn < s.turn) {
              acts.push({ type: 'evolve', uid: c.uid, target: slot });
            }
          }
        }
      } else if (d.kind === 'energy') {
        if (!P.energyAttached) for (const { slot } of slots) acts.push({ type: 'attach', uid: c.uid, target: slot });
      } else {
        if (d.sub === 'supporter' && (P.supporterPlayed || s.turn === 1)) continue;
        if (d.canPlay && !d.canPlay({ g: this, me: p })) continue;
        acts.push({ type: 'trainer', uid: c.uid });
      }
    }

    for (const { slot, ip } of slots) {
      const ab = top(ip).ability;
      if (ab && ip.abilityTurn !== s.turn && ab.canUse({ g: this, me: p, self: ip })) {
        acts.push({ type: 'ability', target: slot });
      }
    }

    const A = P.active;
    if (A && !P.retreated && P.bench.length && !this.immobile(A) && A.energy.length >= top(A).retreat) {
      P.bench.forEach((_, i) => acts.push({ type: 'retreat', to: i }));
    }

    const D = this.player(this.opp(p)).active;
    if (A && D && s.turn !== 1 && !this.immobile(A)) {
      top(A).attacks.forEach((atk, i) => {
        if (canPay(energyTypes(A), atk.cost)) acts.push({ type: 'attack', index: i });
      });
    }

    acts.push({ type: 'end' });
    return acts;
  }

  private async doAction(p: PlayerId, a: Action): Promise<void> {
    const P = this.player(p);
    switch (a.type) {
      case 'playBasic': {
        const c = this.takeFromHand(p, a.uid);
        P.bench.push(this.newInPlay(c));
        this.log(`${P.name} 将 ${c.def.name} 放到备战区`);
        break;
      }
      case 'evolve':
        this.evolve(p, a.uid, a.target);
        break;
      case 'attach': {
        const c = this.takeFromHand(p, a.uid);
        this.getSlot(p, a.target)!.energy.push(c);
        P.energyAttached = true;
        this.log(`${P.name} 给 ${this.slotName(p, a.target)} 贴了 ${c.def.name}`);
        break;
      }
      case 'trainer': {
        const c = this.takeFromHand(p, a.uid);
        const d = c.def as TrainerDef;
        if (d.sub === 'supporter') P.supporterPlayed = true;
        this.log(`${P.name} 使用了 ${d.name}`);
        await d.play({ g: this, me: p });
        P.discard.push(c);
        break;
      }
      case 'ability': {
        const ip = this.getSlot(p, a.target)!;
        ip.abilityTurn = this.s.turn;
        const ab = top(ip).ability!;
        this.log(`${top(ip).name} 发动特性【${ab.name}】`);
        await ab.use({ g: this, me: p, self: ip });
        break;
      }
      case 'retreat': {
        const A = P.active!;
        const cost = top(A).retreat;
        const paid: Card[] = [];
        for (let k = 0; k < cost; k++) {
          // 身上能量都是同一种时选哪个都一样，不打扰玩家
          const kinds = uniqByName(A.energy);
          let idx = A.energy.length - 1;
          if (kinds.length > 1) {
            const i = await this.choose(p, {
              kind: 'retreatEnergy', prompt: `选择撤退要丢弃的能量（还要丢 ${cost - k} 个）`, optional: false,
              options: kinds.map((c) => ({ label: c.def.name, card: c })),
            });
            idx = A.energy.indexOf(kinds[i]);
          }
          paid.push(...A.energy.splice(idx, 1));
        }
        P.discard.push(...paid);
        this.log(`${top(A).name} 撤退（丢弃 ${paid.map((c) => c.def.name).join('、') || '无'}）`);
        this.switchActive(p, a.to);
        P.retreated = true;
        break;
      }
      case 'attack':
        await this.attack(p, a.index);
        break;
      case 'end':
        break;
    }
  }

  private async attack(p: PlayerId, idx: number): Promise<void> {
    const A = this.player(p).active!;
    const D = this.player(this.opp(p)).active!;
    const atk = top(A).attacks[idx];
    this.log(`${top(A).name} 使用【${atk.name}】`);
    if (A.rotation === 'confused' && !this.flip('混乱判定')) {
      A.damage += 30;
      this.log(`→ 混乱中攻击失败，自己受到 30 伤害`);
      return;
    }
    const ctx = { g: this, me: p, attacker: A, defender: D };
    const base = atk.damageFn ? await atk.damageFn(ctx) : atk.damage;
    if (base > 0) {
      const dmg = applyWR(base, A, D);
      D.damage += dmg;
      const note = dmg > base ? '（弱点 ×2）' : dmg < base ? '（抗性 -30）' : '';
      this.log(`→ 对 ${top(D).name} 造成 ${dmg} 伤害${note}，剩余 HP ${Math.max(0, hpLeft(D))}`);
    }
    if (atk.effect) await atk.effect(ctx);
  }

  /** 宝可梦检查：每个回合结束时对双方前场结算 */
  private checkup(p: PlayerId): void {
    for (const q of [p, this.opp(p)]) {
      const a = this.player(q).active;
      if (!a) continue;
      const n = top(a).name;
      if (a.poisoned) {
        a.damage += 10;
        this.log(`${n} 受到中毒伤害 10`);
      }
      if (a.burned) {
        a.damage += 20;
        this.log(`${n} 受到灼伤伤害 20`);
        if (this.flip(`${n} 灼伤恢复`)) {
          a.burned = false;
          this.log(`${n} 的灼伤恢复了`);
        }
      }
      if (a.rotation === 'asleep' && this.flip(`${n} 睡眠恢复`)) {
        a.rotation = null;
        this.log(`${n} 醒过来了`);
      }
      // 麻痹在"被麻痹那方"自己的回合结束时解除
      if (a.rotation === 'paralyzed' && q === p) {
        a.rotation = null;
        this.log(`${n} 的麻痹解除了`);
      }
    }
  }

  private async checkKnockouts(): Promise<void> {
    if (this.s.winner !== null) return;
    for (const q of [0, 1] as PlayerId[]) {
      for (const { ip } of this.slotsOf(q)) {
        if (ip.damage >= top(ip).hp) this.knockOut(q, ip);
      }
    }
    const wins = [false, false];
    for (const q of [0, 1] as PlayerId[]) {
      const P = this.player(q);
      if (P.prizes.length === 0) wins[q] = true;
      if (!P.active && P.bench.length === 0) wins[this.opp(q)] = true;
    }
    if (wins[0] && wins[1]) return this.end('draw', '双方同时达成胜利条件');
    if (wins[0] || wins[1]) {
      const w: PlayerId = wins[0] ? 0 : 1;
      const L = this.player(this.opp(w));
      return this.end(w, L.active || L.bench.length ? '拿完全部奖赏卡' : `${L.name} 场上没有生物了`);
    }
    for (const q of [0, 1] as PlayerId[]) {
      const P = this.player(q);
      if (P.active) continue;
      const i = await this.choose(q, {
        kind: 'promote', prompt: '前场生物昏厥了，选择换上前场的生物', optional: false,
        options: P.bench.map((_, j) => ({ label: this.slotName(q, j), slot: j })),
      });
      P.active = P.bench.splice(i, 1)[0];
      this.log(`${P.name} 换上 ${top(P.active).name}`);
    }
  }

  private knockOut(q: PlayerId, ip: InPlay): void {
    const P = this.player(q);
    const def = top(ip);
    if (P.active === ip) P.active = null;
    else P.bench.splice(P.bench.indexOf(ip), 1);
    P.discard.push(...ip.stack, ...ip.energy);
    const o = this.opp(q);
    const O = this.player(o);
    const n = Math.min(def.prizes ?? 1, O.prizes.length);
    O.hand.push(...O.prizes.splice(0, n));
    this.log(`✖ ${P.name} 的 ${def.name} 昏厥了！${O.name} 拿取 ${n} 张奖赏卡（剩余 ${O.prizes.length}）`);
  }

  // ---------- 给人类看的文字 ----------

  describeAction(p: PlayerId, a: Action): string {
    const P = this.player(p);
    const card = (uid: number) => P.hand.find((c) => c.uid === uid)?.def;
    switch (a.type) {
      case 'playBasic':
        return `放置 ${card(a.uid)?.name} 到备战区`;
      case 'evolve':
        return `进化：${this.slotName(p, a.target)} → ${card(a.uid)?.name}`;
      case 'attach':
        return `贴 ${card(a.uid)?.name} 给 ${this.slotName(p, a.target)}`;
      case 'trainer': {
        const d = card(a.uid) as TrainerDef;
        return `${d.sub === 'supporter' ? '支援者' : '物品'}：${d.name}（${d.text}）`;
      }
      case 'ability': {
        const ab = top(this.getSlot(p, a.target)!).ability!;
        return `特性：${this.slotName(p, a.target)}【${ab.name}】（${ab.text}）`;
      }
      case 'retreat':
        return `撤退（丢弃 ${top(P.active!).retreat} 个能量），换上 ${this.slotName(p, a.to)}`;
      case 'attack': {
        const atk = top(P.active!).attacks[a.index];
        return `攻击【${atk.name}】${atk.damage ? ` ${atk.damage} 伤害` : ''}${atk.text ? ` — ${atk.text}` : ''}`;
      }
      case 'end':
        return '结束回合';
    }
  }

  render(viewer: PlayerId): string {
    const fmt = (ip: InPlay) => {
      const d = top(ip);
      const conds = [ip.rotation && ROT_NAME[ip.rotation], ip.poisoned && '中毒', ip.burned && '灼伤'].filter(Boolean);
      const en = energyTypes(ip).map((t) => TYPE_NAME[t]).join('') || '-';
      const atks = d.attacks.map((x) => `${x.name}[${x.cost.map((t) => TYPE_NAME[t]).join('')}]${x.damage || ''}`).join(' / ');
      return `${d.name} HP ${hpLeft(ip)}/${d.hp} 能量:${en}${conds.length ? ' 〔' + conds.join('、') + '〕' : ''}  ${atks}`;
    };
    const lines: string[] = [];
    for (const q of [this.opp(viewer), viewer]) {
      const P = this.player(q);
      const mine = q === viewer;
      lines.push(
        `${mine ? '【你】' : '【对手】'}${P.name}  奖赏卡 ${P.prizes.length}｜牌库 ${P.deck.length}｜手牌 ${P.hand.length}｜弃牌 ${P.discard.length}`,
      );
      lines.push(`  前场：${P.active ? fmt(P.active) : '（空）'}`);
      P.bench.forEach((b, i) => lines.push(`  备战${i + 1}：${fmt(b)}`));
      if (mine) lines.push(`  手牌：${P.hand.map((c) => c.def.name).join('、') || '（无）'}`);
    }
    return lines.join('\n');
  }
}

/**
 * 启发式 AI：手写的出牌优先级规则，不训练、不搜索。
 * 每次被问"做什么"，按下面的顺序找到第一个值得做的动作；攻击放最后（攻击会结束回合）。
 */
import type { Action, Agent, ChoiceRequest, CreatureDef, EType, InPlay, PlayerId } from '../types.ts';
import type { Game } from '../engine.ts';
import { energyTypes, estimate, hpLeft, missingFor, top, canPay } from '../engine.ts';
import { hasEvolution } from '../cards.ts';

/** 这只生物现在（按已贴能量）能打出的最高伤害 */
function readyDamage(ip: InPlay, defender: InPlay | null): number {
  let best = 0;
  for (const atk of top(ip).attacks) {
    if (canPay(energyTypes(ip), atk.cost)) best = Math.max(best, estimate(ip, atk, defender));
  }
  return best;
}

/** 给 ip 贴一个 t 能量有多大价值 */
function attachScore(ip: InPlay, t: EType, isActive: boolean): number {
  const have = energyTypes(ip);
  let best = 0;
  for (const atk of top(ip).attacks) {
    const before = missingFor(have, atk.cost);
    if (before === 0) continue;
    const after = missingFor([...have, t], atk.cost);
    if (after < before) best = Math.max(best, 40 - after * 10 + atk.damage / 10);
  }
  // 已经够用了：仍然可以为将来的进化形态预贴
  if (best === 0) best = 2 + (hasEvolution(top(ip).name) ? 6 : 0);
  return best + (isActive ? 8 : 0) + top(ip).stage * 3;
}

export class HeuristicAgent implements Agent {
  name: string;
  constructor(name = '启发式AI') {
    this.name = name;
  }

  chooseAction(g: Game, me: PlayerId, actions: Action[]): Action {
    const P = g.player(me);
    const O = g.player(g.opp(me));
    const of = <T extends Action['type']>(t: T) => actions.filter((a) => a.type === t) as Extract<Action, { type: T }>[];
    const handDef = (uid: number) => P.hand.find((c) => c.uid === uid)?.def;
    const trainer = (name: string) => of('trainer').find((a) => handDef(a.uid)?.name === name);
    const attacks = of('attack');

    // 1. 铺场：基础生物先上备战区
    const pb = of('playBasic')[0];
    if (pb) return pb;

    // 2. 进化（阶数高的优先），跃进种子，特性
    const evo = of('evolve').sort(
      (a, b) => (handDef(b.uid) as CreatureDef).stage - (handDef(a.uid) as CreatureDef).stage,
    )[0];
    if (evo) return evo;
    const leap = trainer('跃进种子');
    if (leap) return leap;
    const ab = of('ability')[0];
    if (ab) return ab;

    // 3. 物品
    const hasBasicInHand = P.hand.some((c) => c.def.kind === 'creature' && c.def.stage === 0);
    const ball = trainer('基础球');
    if (ball && !hasBasicInHand && P.bench.length < 5) return ball;
    const noEnergyInHand = !P.hand.some((c) => c.def.kind === 'energy');
    const finder = trainer('能量搜索器');
    if (finder && !P.energyAttached && noEnergyInHand) return finder;
    const retr = trainer('能量回收');
    if (retr && !P.energyAttached && noEnergyInHand) return retr;
    const spray = trainer('急救喷雾');
    if (spray && P.active && (P.active.rotation || P.active.poisoned || P.active.burned || P.active.damage >= 30)) return spray;
    const potion = trainer('伤药');
    if (potion && g.slotsOf(me).some((s) => s.ip.damage >= 30)) return potion;
    const sw = trainer('替换');
    if (sw && attacks.length === 0 && P.bench.some((b) => readyDamage(b, O.active) > 0)) return sw;

    // 4. 支援者
    const canKoActive = !!O.active && attacks.some((a) => estimate(P.active!, top(P.active!).attacks[a.index], O.active) >= hpLeft(O.active!));
    const cc = trainer('挑战呼唤');
    if (cc && P.active && !canKoActive && O.bench.some((b) => readyDamage(P.active!, b) >= hpLeft(b))) return cc;
    const prof = trainer('博士笔记');
    if (prof && P.hand.length <= 4) return prof;
    const aid = trainer('训练家援助');
    if (aid && P.hand.length <= 3) return aid;
    const helper = trainer('研究助手');
    if (helper && P.hand.length <= 5) return helper;
    const scout = trainer('侦察员');
    if (scout && P.bench.length < 4) return scout;

    // 5. 贴能量
    const att = of('attach');
    if (att.length) {
      let best = att[0];
      let bs = -Infinity;
      for (const a of att) {
        const ip = g.getSlot(me, a.target)!;
        const t = (handDef(a.uid) as { provides: EType }).provides;
        const sc = attachScore(ip, t, a.target === 'active');
        if (sc > bs) {
          bs = sc;
          best = a;
        }
      }
      return best;
    }

    // 6. 前场打不了就撤退给能打的
    if (attacks.length === 0) {
      let best: Action | null = null;
      let bs = 0;
      for (const r of of('retreat')) {
        const d = readyDamage(P.bench[r.to], O.active);
        if (d > bs) {
          bs = d;
          best = r;
        }
      }
      if (best) return best;
    }

    // 7. 攻击：能击倒就打，否则挑期望伤害最高的
    if (attacks.length && P.active && O.active) {
      const A = P.active;
      const D = O.active;
      const score = (i: number) => {
        const atk = top(A).attacks[i];
        const dmg = estimate(A, atk, D);
        const ko = dmg >= hpLeft(D);
        // 能击倒时选消耗最小的（例如不用丢能量的那招）
        return ko ? 1000 - atk.cost.length : dmg + (atk.effect ? 5 : 0);
      };
      return attacks.reduce((a, b) => (score(b.index) > score(a.index) ? b : a));
    }

    return { type: 'end' };
  }

  choose(g: Game, me: PlayerId, req: ChoiceRequest): number {
    const P = g.player(me);
    const O = g.player(g.opp(me));
    const opts = req.options;
    const argmax = (f: (i: number) => number) => {
      let bi = 0;
      let bs = -Infinity;
      opts.forEach((_, i) => {
        const s = f(i);
        if (s > bs) {
          bs = s;
          bi = i;
        }
      });
      return bi;
    };
    const slotIp = (i: number) => g.getSlot(me, opts[i].slot!)!;

    switch (req.kind) {
      case 'setupActive':
        // 前场放能独当一面的；进化线的起点留在备战区慢慢养
        return argmax((i) => {
          const d = opts[i].card!.def as CreatureDef;
          return d.hp - (hasEvolution(d.name) ? 40 : 0);
        });
      case 'setupBench':
        return 0;
      case 'promote':
      case 'switchTo':
        return argmax((i) => {
          const ip = slotIp(i);
          return readyDamage(ip, O.active) * 10 + hpLeft(ip) + top(ip).stage * 20;
        });
      case 'search':
        return argmax((i) => {
          const any = opts[i].card!.def;
          if (any.kind === 'energy') {
            // 能量：选场上生物最需要的属性
            return g.slotsOf(me).filter((s) => top(s.ip).type === any.provides).length;
          }
          if (any.kind !== 'creature') return 0;
          const d = any;
          const names = g.slotsOf(me).map((s) => top(s.ip).name);
          const inHand = P.hand.map((c) => c.def.name);
          const dup = inHand.filter((n) => n === d.name).length * 45; // 手里已有同名就别再拿
          if (d.evolvesFrom && names.includes(d.evolvesFrom)) return 100 + d.stage - dup;
          if (d.evolvesFrom && inHand.includes(d.evolvesFrom)) return 60 - dup;
          if (d.stage === 0 && P.bench.length < 5) return 50 + (hasEvolution(d.name) ? 5 : 0) - dup / 3;
          return 10 - d.stage - dup;
        });
      case 'retreatEnergy':
        // 丢掉之后对自己招式影响最小的那个
        return argmax((i) => {
          const A = P.active!;
          const have = energyTypes(A);
          have.splice(have.indexOf((opts[i].card!.def as { provides: EType }).provides), 1);
          return Math.max(-99, ...top(A).attacks.map((atk) => (missingFor(have, atk.cost) === 0 ? atk.damage : -missingFor(have, atk.cost))));
        });
      case 'heal':
        return argmax((i) => slotIp(i).damage + (opts[i].slot === 'active' ? 5 : 0));
      case 'attachTarget':
        return argmax((i) => attachScore(slotIp(i), req.etype ?? 'colorless', opts[i].slot === 'active'));
      case 'oppBench':
        return argmax((i) => {
          const ip = g.getSlot(g.opp(me), opts[i].slot!)!;
          const dmg = req.amount ?? (P.active ? readyDamage(P.active, ip) : 0);
          const ko = dmg >= hpLeft(ip);
          return (ko ? 1000 : 0) + top(ip).stage * 50 - hpLeft(ip);
        });
      case 'retrieve':
      case 'leapSeed':
      default:
        return 0;
    }
  }
}

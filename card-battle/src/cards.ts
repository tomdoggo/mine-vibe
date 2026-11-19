/**
 * 卡表（原创示例卡）。加新卡：在 LIST 里加一条定义，然后放进 DECKS 的卡组即可。
 * 效果是代码：通过 ctx.g（Game）上的辅助方法操作对局。
 */
import type {
  AttackCtx,
  Card,
  CardDef,
  CreatureDef,
  DeckList,
  EnergyDef,
  InPlay,
  PlayerId,
  Slot,
  TrainerDef,
} from './types.ts';
import type { Game } from './engine.ts';

const F = 'fire' as const;
const W = 'water' as const;
const G = 'grass' as const;
const L = 'lightning' as const;
const C = 'colorless' as const;

const creature = (d: Omit<CreatureDef, 'kind'>): CreatureDef => ({ kind: 'creature', ...d });
const item = (d: Omit<TrainerDef, 'kind' | 'sub'>): TrainerDef => ({ kind: 'trainer', sub: 'item', ...d });
const supporter = (d: Omit<TrainerDef, 'kind' | 'sub'>): TrainerDef => ({
  kind: 'trainer',
  sub: 'supporter',
  ...d,
});
const energy = (name: string, provides: EnergyDef['provides']): EnergyDef => ({ kind: 'energy', name, provides });

const topDef = (ip: InPlay) => ip.stack[ip.stack.length - 1].def as CreatureDef;
const isWaterEnergy = (c: Card) => c.def.kind === 'energy' && c.def.provides === 'water';

// ---- 常用效果 ----
const paralyzeOnHeads = (c: AttackCtx) => {
  if (c.g.flip('麻痹判定')) c.g.setRotation(c.defender, 'paralyzed');
};
const burn = (c: AttackCtx) => c.g.burn(c.defender);
const poison = (c: AttackCtx) => c.g.poison(c.defender);
const asleep = (c: AttackCtx) => c.g.setRotation(c.defender, 'asleep');
const isEnergyOf = (t: EnergyDef['provides']) => (c: Card) => c.def.kind === 'energy' && c.def.provides === t;
/** 对对手 1 只备战生物造成 n 伤害（不计弱点抗性） */
const snipe = (n: number) => async (c: AttackCtx) => {
  const o = c.g.opp(c.me);
  const bench = c.g.player(o).bench;
  if (!bench.length) return;
  const i = await c.g.choose(c.me, {
    kind: 'oppBench', prompt: `选择受到 ${n} 伤害的对手备战生物`, optional: false, amount: n,
    options: bench.map((_, j) => ({ label: c.g.slotName(o, j), slot: j })),
  });
  c.g.damage(bench[i], n);
  c.g.log(`→ 对 ${c.g.slotName(o, i)} 造成 ${n} 伤害`);
};
const selfDamage = (n: number) => (c: AttackCtx) => {
  c.g.damage(c.attacker, n);
  c.g.log(`→ ${topDef(c.attacker).name} 自己受到 ${n} 伤害`);
};
/** 超出攻击消耗的能量数（用于"多贴多打"类攻击） */
const extraEnergy = (ip: InPlay, costLen: number, cap: number) =>
  Math.min(cap, Math.max(0, ip.energy.length - costLen));

const LIST: CardDef[] = [
  // ===== 火系 =====
  creature({
    name: '焰尾猫崽', stage: 0, hp: 60, type: F, weakness: W, retreat: 1,
    attacks: [{ name: '火花', cost: [F], damage: 20 }],
  }),
  creature({
    name: '烬爪山猫', stage: 1, evolvesFrom: '焰尾猫崽', hp: 90, type: F, weakness: W, retreat: 1,
    attacks: [
      { name: '火牙', cost: [F], damage: 20, text: '使对手前场生物灼伤', effect: burn },
      { name: '烈焰爪', cost: [F, C], damage: 50 },
    ],
  }),
  creature({
    name: '炎翼龙', stage: 2, evolvesFrom: '烬爪山猫', hp: 160, type: F, weakness: W, retreat: 2,
    attacks: [
      { name: '热浪', cost: [F, C], damage: 60, text: '使对手前场生物灼伤', effect: burn },
      {
        name: '爆炎冲击', cost: [F, F, C], damage: 150, text: '丢弃自身 2 个火能量',
        effect: (c) => c.g.discardEnergy(c.me, c.attacker, F, 2),
      },
    ],
  }),
  creature({
    name: '熔岩鼹', stage: 0, hp: 100, type: F, weakness: W, retreat: 2,
    attacks: [
      { name: '泰山压顶', cost: [C, C], damage: 30, text: '掷硬币，正面则对手前场生物麻痹', effect: paralyzeOnHeads },
      { name: '熔岩拳', cost: [F, F, C], damage: 90 },
    ],
  }),

  // ===== 水系 =====
  creature({
    name: '涟漪鱼', stage: 0, hp: 60, type: W, weakness: 'lightning', retreat: 1,
    attacks: [{ name: '泼溅', cost: [W], damage: 20 }],
  }),
  creature({
    name: '激流尾', stage: 1, evolvesFrom: '涟漪鱼', hp: 100, type: W, weakness: 'lightning', retreat: 1,
    attacks: [
      {
        name: '水枪', cost: [W, C], damage: 40, text: '超出攻击消耗的每个能量 +20 伤害（最多 +40）',
        damageFn: (c) => 40 + 20 * extraEnergy(c.attacker, 2, 2),
        estimate: (ip) => 40 + 20 * extraEnergy(ip, 2, 2),
      },
    ],
  }),
  creature({
    name: '潮汐蛟', stage: 2, evolvesFrom: '激流尾', hp: 150, type: W, weakness: 'lightning', retreat: 2,
    ability: {
      name: '潮汐呼唤',
      text: '每回合一次：从弃牌区选 1 个水能量，贴到自己的 1 只生物上',
      canUse: (c) => c.g.player(c.me).discard.some(isWaterEnergy),
      use: async (c) => {
        const P = c.g.player(c.me);
        const e = P.discard.find(isWaterEnergy)!;
        const slots = c.g.slotsOf(c.me);
        const i = await c.g.choose(c.me, {
          kind: 'attachTarget', prompt: '选择要贴水能量的生物', optional: false, etype: W,
          options: slots.map((s) => ({ label: c.g.slotName(c.me, s.slot), slot: s.slot })),
        });
        P.discard.splice(P.discard.indexOf(e), 1);
        slots[i].ip.energy.push(e);
        c.g.log(`→ 从弃牌区贴水能量给 ${c.g.slotName(c.me, slots[i].slot)}`);
      },
    },
    attacks: [{ name: '怒涛冲撞', cost: [W, W, C], damage: 120 }],
  }),
  creature({
    name: '霜息兽', stage: 0, hp: 80, type: W, weakness: 'lightning', retreat: 1,
    attacks: [
      { name: '冰冻吐息', cost: [W, C], damage: 30, text: '掷硬币，正面则对手前场生物麻痹', effect: paralyzeOnHeads },
    ],
  }),

  // ===== 无色 =====
  creature({
    name: '绒球鸮', stage: 0, hp: 60, type: C, weakness: 'lightning', retreat: 1,
    attacks: [
      { name: '催眠曲', cost: [C], damage: 0, text: '使对手前场生物睡眠', effect: (c) => c.g.setRotation(c.defender, 'asleep') },
      { name: '啄击', cost: [C, C], damage: 30 },
    ],
  }),

  // ===== 草系（怕火） =====
  creature({
    name: '芽叶蜥', stage: 0, hp: 70, type: G, weakness: F, retreat: 1,
    attacks: [{ name: '藤鞭', cost: [G], damage: 20 }],
  }),
  creature({
    name: '棘藤蜥', stage: 1, evolvesFrom: '芽叶蜥', hp: 100, type: G, weakness: F, retreat: 2,
    attacks: [
      { name: '毒刺', cost: [G], damage: 20, text: '使对手前场生物中毒', effect: poison },
      { name: '藤蔓抽打', cost: [G, C], damage: 50 },
    ],
  }),
  creature({
    name: '森冠龙', stage: 2, evolvesFrom: '棘藤蜥', hp: 170, type: G, weakness: F, retreat: 3,
    attacks: [
      { name: '光合吸取', cost: [G, G, C], damage: 110, text: '回复自身 30 HP', effect: (c) => c.g.heal(c.attacker, 30) },
    ],
  }),
  creature({
    name: '孢子菇', stage: 0, hp: 60, type: G, weakness: F, retreat: 1,
    attacks: [
      { name: '毒雾', cost: [G], damage: 10, text: '使对手前场生物中毒', effect: poison },
      { name: '催眠孢子', cost: [G, C], damage: 20, text: '使对手前场生物睡眠', effect: asleep },
    ],
  }),
  creature({
    name: '苔甲龟', stage: 0, hp: 100, type: G, weakness: F, retreat: 2,
    ability: {
      name: '森林馈赠',
      text: '每回合一次：从牌库检索 1 张草能量，贴到自己的 1 只备战生物上',
      canUse: (c) => c.g.player(c.me).bench.length > 0 && c.g.player(c.me).deck.some(isEnergyOf(G)),
      use: async (c) => {
        const P = c.g.player(c.me);
        const i = await c.g.choose(c.me, {
          kind: 'attachTarget', prompt: '选择要贴草能量的备战生物', optional: false, etype: G,
          options: P.bench.map((_, j) => ({ label: c.g.slotName(c.me, j), slot: j })),
        });
        const e = P.deck.find(isEnergyOf(G))!;
        P.deck.splice(P.deck.indexOf(e), 1);
        P.bench[i].energy.push(e);
        c.g.shuffleDeck(c.me);
        c.g.log(`→ 从牌库检索草能量，贴给 ${c.g.slotName(c.me, i)}`);
      },
    },
    attacks: [{ name: '硬壳撞击', cost: [G, C, C], damage: 60 }],
  }),

  // ===== 雷系（怕草） =====
  creature({
    name: '电绒鼠', stage: 0, hp: 60, type: L, weakness: G, retreat: 1,
    attacks: [{ name: '静电', cost: [L], damage: 10, text: '掷硬币，正面则对手前场生物麻痹', effect: paralyzeOnHeads }],
  }),
  creature({
    name: '雷尾鼬', stage: 1, evolvesFrom: '电绒鼠', hp: 90, type: L, weakness: G, retreat: 1,
    attacks: [{ name: '雷电冲', cost: [L, C], damage: 70, text: '自己也受到 10 伤害', effect: selfDamage(10) }],
  }),
  creature({
    name: '霆翼鹰', stage: 2, evolvesFrom: '雷尾鼬', hp: 150, type: L, weakness: G, retreat: 1,
    attacks: [
      { name: '连锁闪电', cost: [L, C], damage: 50, text: '另外对对手 1 只备战生物造成 30 伤害', effect: snipe(30) },
      {
        name: '雷鸣风暴', cost: [L, L, C], damage: 140, text: '丢弃自身 2 个雷能量',
        effect: (c) => c.g.discardEnergy(c.me, c.attacker, L, 2),
      },
    ],
  }),
  creature({
    name: '雷霆兽', stage: 0, hp: 110, type: L, weakness: G, retreat: 2,
    attacks: [
      { name: '头锤', cost: [C, C], damage: 30 },
      {
        name: '落雷', cost: [L, L, C], damage: 100, text: '掷硬币，反面则自己受到 30 伤害',
        effect: (c) => {
          if (!c.g.flip('落雷反噬')) selfDamage(30)(c);
        },
      },
    ],
  }),
  creature({
    name: '磁石虫', stage: 0, hp: 50, type: L, weakness: G, retreat: 1,
    ability: {
      name: '充电',
      text: '每回合一次：从手牌选 1 张雷能量，贴到自己的 1 只生物上（不占每回合贴能量的次数）',
      canUse: (c) => c.g.player(c.me).hand.some(isEnergyOf(L)),
      use: async (c) => {
        const P = c.g.player(c.me);
        const slots = c.g.slotsOf(c.me);
        const i = await c.g.choose(c.me, {
          kind: 'attachTarget', prompt: '选择要贴雷能量的生物', optional: false, etype: L,
          options: slots.map((s) => ({ label: c.g.slotName(c.me, s.slot), slot: s.slot })),
        });
        const e = P.hand.find(isEnergyOf(L))!;
        P.hand.splice(P.hand.indexOf(e), 1);
        slots[i].ip.energy.push(e);
        c.g.log(`→ 从手牌贴雷能量给 ${c.g.slotName(c.me, slots[i].slot)}`);
      },
    },
    attacks: [{ name: '撞击', cost: [C], damage: 10 }],
  }),

  // ===== 物品 =====
  item({
    name: '伤药', text: '回复自己 1 只生物 30 HP',
    canPlay: (c) => c.g.slotsOf(c.me).some((s) => s.ip.damage > 0),
    play: async (c) => {
      const opts = c.g.slotsOf(c.me).filter((s) => s.ip.damage > 0);
      const i = await c.g.choose(c.me, {
        kind: 'heal', prompt: '选择要回复的生物', optional: false,
        options: opts.map((s) => ({ label: `${c.g.slotName(c.me, s.slot)}（已受 ${s.ip.damage} 伤害）`, slot: s.slot })),
      });
      c.g.heal(opts[i].ip, 30);
    },
  }),
  item({
    name: '基础球', text: '从牌库检索 1 张基础生物加入手牌',
    canPlay: (c) => c.g.player(c.me).deck.length > 0,
    play: (c) => c.g.searchDeck(c.me, (d) => d.kind === 'creature' && d.stage === 0, 1, '选择要检索的基础生物'),
  }),
  item({
    name: '替换', text: '将自己的前场生物与 1 只备战生物互换',
    canPlay: (c) => c.g.player(c.me).bench.length > 0,
    play: async (c) => {
      const P = c.g.player(c.me);
      const i = await c.g.choose(c.me, {
        kind: 'switchTo', prompt: '选择要换上前场的生物', optional: false,
        options: P.bench.map((_, j) => ({ label: c.g.slotName(c.me, j), slot: j })),
      });
      c.g.switchActive(c.me, i);
    },
  }),
  item({
    name: '能量回收', text: '从弃牌区将最多 2 张基础能量加入手牌',
    canPlay: (c) => c.g.player(c.me).discard.some((x) => x.def.kind === 'energy'),
    play: async (c) => {
      const P = c.g.player(c.me);
      for (let k = 0; k < 2; k++) {
        const es = P.discard.filter((x) => x.def.kind === 'energy');
        if (!es.length) break;
        const i = await c.g.choose(c.me, {
          kind: 'retrieve', prompt: '选择要回收的能量', optional: k > 0,
          options: es.map((x) => ({ label: x.def.name, card: x })),
        });
        if (i < 0) break;
        P.discard.splice(P.discard.indexOf(es[i]), 1);
        P.hand.push(es[i]);
        c.g.log(`→ 回收了 ${es[i].def.name}`);
      }
    },
  }),
  item({
    name: '跃进种子', text: '选择场上 1 只基础生物（本回合放上场的除外），直接进化为手牌中对应的 2 阶生物',
    canPlay: (c) => c.g.s.turn > 2 && leapPairs(c.g, c.me).length > 0,
    play: async (c) => {
      const opts = leapPairs(c.g, c.me);
      const i = await c.g.choose(c.me, { kind: 'leapSeed', prompt: '选择跃进进化的组合', optional: false, options: opts });
      c.g.evolve(c.me, opts[i].card!.uid, opts[i].slot!);
    },
  }),

  // ===== 支援者（每回合 1 张，先攻第一回合不能用） =====
  supporter({
    name: '博士笔记', text: '丢弃全部手牌，抽 7 张',
    canPlay: (c) => c.g.player(c.me).deck.length > 0,
    play: (c) => {
      const P = c.g.player(c.me);
      P.discard.push(...P.hand.splice(0));
      c.g.drawCards(c.me, 7);
    },
  }),
  supporter({
    name: '侦察员', text: '从牌库检索最多 2 张生物卡加入手牌',
    canPlay: (c) => c.g.player(c.me).deck.length > 0,
    play: (c) => c.g.searchDeck(c.me, (d) => d.kind === 'creature', 2, '选择要检索的生物（可跳过）'),
  }),
  supporter({
    name: '训练家援助', text: '将手牌洗回牌库，抽 6 张',
    play: (c) => {
      const P = c.g.player(c.me);
      P.deck.push(...P.hand.splice(0));
      c.g.shuffleDeck(c.me);
      c.g.drawCards(c.me, 6);
    },
  }),
  supporter({
    name: '挑战呼唤', text: '将对手的 1 只备战生物与其前场生物互换',
    canPlay: (c) => c.g.player(c.g.opp(c.me)).bench.length > 0,
    play: async (c) => {
      const o = c.g.opp(c.me);
      const i = await c.g.choose(c.me, {
        kind: 'oppBench', prompt: '选择要拉到前场的对手生物', optional: false,
        options: c.g.player(o).bench.map((_, j) => ({ label: c.g.slotName(o, j), slot: j })),
      });
      c.g.switchActive(o, i);
    },
  }),

  item({
    name: '能量搜索器', text: '从牌库检索 1 张基础能量加入手牌',
    canPlay: (c) => c.g.player(c.me).deck.some((x) => x.def.kind === 'energy'),
    play: (c) => c.g.searchDeck(c.me, (d) => d.kind === 'energy', 1, '选择要检索的能量'),
  }),
  item({
    name: '急救喷雾', text: '回复自己前场生物 20 HP，并清除它的所有特殊状态',
    canPlay: (c) => {
      const a = c.g.player(c.me).active;
      return !!a && (a.damage > 0 || !!a.rotation || a.poisoned || a.burned);
    },
    play: (c) => {
      const a = c.g.player(c.me).active!;
      if (a.damage > 0) c.g.heal(a, 20);
      c.g.clearConditions(a);
      c.g.log(`→ ${topDef(a).name} 的特殊状态清除了`);
    },
  }),
  supporter({
    name: '研究助手', text: '抽 4 张牌',
    canPlay: (c) => c.g.player(c.me).deck.length > 0,
    play: (c) => c.g.drawCards(c.me, 4),
  }),

  // ===== 基础能量 =====
  energy('火能量', F),
  energy('水能量', W),
  energy('草能量', G),
  energy('雷能量', L),
];

function leapPairs(g: Game, me: PlayerId): Array<{ label: string; card: Card; slot: Slot }> {
  const out: Array<{ label: string; card: Card; slot: Slot }> = [];
  for (const c of g.player(me).hand) {
    const d = c.def;
    if (d.kind !== 'creature' || d.stage !== 2 || !d.evolvesFrom) continue;
    const s1 = CARDS[d.evolvesFrom];
    if (!s1 || s1.kind !== 'creature') continue;
    for (const s of g.slotsOf(me)) {
      const t = topDef(s.ip);
      if (t.stage === 0 && t.name === s1.evolvesFrom && s.ip.playedTurn < g.s.turn) {
        out.push({ label: `${g.slotName(me, s.slot)} → ${d.name}`, card: c, slot: s.slot });
      }
    }
  }
  return out;
}

export const CARDS: Record<string, CardDef> = Object.fromEntries(LIST.map((d) => [d.name, d]));
/** 卡表顺序（构筑界面按这个顺序展示） */
export const ALL_CARDS: readonly CardDef[] = LIST;

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;

/** 检查卡组是否合法，返回问题列表（空 = 合法） */
export function validateDeck(cards: Array<[string, number]>): string[] {
  const problems: string[] = [];
  let total = 0;
  let basics = 0;
  for (const [name, n] of cards) {
    const d = CARDS[name];
    if (!d) {
      problems.push(`未知卡牌：${name}`);
      continue;
    }
    total += n;
    if (d.kind !== 'energy' && n > MAX_COPIES) problems.push(`「${name}」超过 ${MAX_COPIES} 张`);
    if (d.kind === 'creature' && d.stage === 0) basics += n;
  }
  if (total !== DECK_SIZE) problems.push(`需要正好 ${DECK_SIZE} 张（现在 ${total} 张）`);
  if (basics === 0) problems.push('至少要有 1 张基础生物');
  return problems;
}

/** 某个名字是否有可以进化成的卡 */
export const hasEvolution = (name: string) =>
  LIST.some((d) => d.kind === 'creature' && d.evolvesFrom === name);

const TRAINERS: Array<[string, number]> = [
  ['伤药', 2], ['基础球', 4], ['替换', 2], ['能量回收', 2], ['跃进种子', 3],
  ['博士笔记', 4], ['侦察员', 3], ['训练家援助', 2], ['挑战呼唤', 2],
];

export const DECKS: Record<string, DeckList> = {
  fire: {
    name: '火焰卡组',
    cards: [['焰尾猫崽', 4], ['烬爪山猫', 3], ['炎翼龙', 2], ['熔岩鼹', 3], ['绒球鸮', 2], ...TRAINERS, ['火能量', 22]],
  },
  water: {
    name: '激流卡组',
    cards: [['涟漪鱼', 4], ['激流尾', 3], ['潮汐蛟', 2], ['霜息兽', 3], ['绒球鸮', 2], ...TRAINERS, ['水能量', 22]],
  },
  grass: {
    name: '森林卡组',
    cards: [['芽叶蜥', 4], ['棘藤蜥', 3], ['森冠龙', 2], ['孢子菇', 2], ['苔甲龟', 2], ['绒球鸮', 1], ...TRAINERS, ['草能量', 22]],
  },
  lightning: {
    name: '雷霆卡组',
    cards: [['电绒鼠', 4], ['雷尾鼬', 3], ['霆翼鹰', 2], ['雷霆兽', 2], ['磁石虫', 2], ['绒球鸮', 1], ...TRAINERS, ['雷能量', 22]],
  },
};

import type { UnitKind } from './units';

/**
 * 对战流程参数。流程：弓兵齐射 → 步兵冲锋 → 骑兵冲锋 → 结算。
 * 所有时间单位毫秒，速度单位 像素/秒。
 */
export const RULES = {
  /** 阶段之间的停顿 */
  phaseGap: 900,
  /** 开战后多久进入第一阶段 */
  openingDelay: 800,

  volley: {
    /** 双方弓兵固定瞄准的敌方方阵 */
    target: 'melee' as UnitKind,
    /** 齐射轮数 */
    count: 2,
    /** 两轮之间的最小间隔；后一轮还要等前一轮的箭全部落地 */
    interval: 1200,
    /** 每支箭偏移到指定目标相邻方阵的概率 */
    driftChance: 0.1,
    /** 每支箭直接 miss（落空，不命中任何人）的概率 */
    missChance: 0.05,
    /** miss 的箭在散布之外再偏离多远（像素），保证落空 */
    missOffset: 26,
    /** 落点随机散布（像素） */
    scatterX: 10,
    scatterY: 6,
    /** 落地后在这个半径内找最近的敌人命中 */
    hitRadius: 10,
    /** 箭矢飞行速度 */
    arrowSpeed: 230,
    /** 箭矢抛物线重力 */
    arrowGravity: 400,
  },

  infantry: {
    /** 起步速度、最高速度、加速度（像素/秒²）：和骑兵一样逐渐加速，但上限低得多 */
    startSpeed: 20,
    maxSpeed: 80,
    accel: 40,
    /** 对撞这么多次后折返 */
    maxClashes: 3,
  },

  cavalry: {
    /** 起步速度、最高速度、加速度（像素/秒²） */
    startSpeed: 30,
    maxSpeed: 170,
    accel: 60,
    /** 对撞这么多次后折返 */
    maxClashes: 5,
  },

  /**
   * 回撤：所有单位大约这么多毫秒内撤回原位。
   * 和骑兵冲锋一样逐渐加速：从 returnStartSpeed 起步，前 returnAccelRatio 的时间匀加速到峰值，之后匀速；
   * 峰值速度按离原位的距离反推，保证总用时不变。
   */
  returnDuration: 1500,
  returnStartSpeed: 30,
  returnAccelRatio: 0.5,
  /** 回撤平均速度下限，离原位很近时也别慢吞吞地挪 */
  minReturnSpeed: 40,

  /** 溃逃：一次攻击把对方 hp 打到低于 hpBelow，攻击方按击杀计分；对方以 speed 往本方后方跑，fadeMs 内淡出消失，边跑边每 sweatInterval 毫秒冒一滴汗 */
  flee: { hpBelow: 5, speed: 120, fadeMs: 1000, sweatInterval: 220 },

  /** 每次攻击的伤害浮动：atk × [1 - atkVariance, 1 + atkVariance]，结果向上取整 */
  atkVariance: 0.2,

  /** 换线时纵向移动的速度，占当前冲锋速度的比例；横向始终全速直冲 */
  laneSteerRatio: 0.6,
  /** 冲锋中途换到另一条线时速度掉到原来的这个比例（不低于起步速度），然后重新加速 */
  laneChangeSpeedKeep: 0.4,
  /** 冲锋最长持续时间（毫秒）：追着最近的敌人跑，撞不满次数也到点折返，保证阶段能结束 */
  maxChargeMs: 6000,

  /** 同一对单位两次对撞之间的最小间隔，避免重叠的每一帧都算一次 */
  clashCooldown: 700,
  /** 冲到敌阵最尾端之外多远算“到头” */
  rearMargin: 16,

  /** 计分：伤害分 = 造成的 hp 伤害总和；击杀分 = 按被击杀单位的兵种累加；总分定胜负 */
  killScore: { melee: 10, ranged: 10, cavalry: 20 } as Record<UnitKind, number>,
} as const;

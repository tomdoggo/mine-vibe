import Phaser from 'phaser';
import { TEAMS, type Attributes, type TeamDef, type TeamId } from '../data/players';
import { assignSpots, ovr } from './lineup';
import { Ball, type BallSnapshot, type BallState } from './Ball';
import { Player, emptyPlayerStats, type PlayerSnapshot, type PlayerStats } from './Player';
import { minuteSeed, randomSeed, rng, seedRng } from './rng';
import { think } from './ai';
import { clamp, expected, roll, rollHalfFloor } from './attrs';
import { chooseLineup, planMinutes } from './coach';
import { ACTION_COST, DRAIN_BASE, DRAIN_PER_M, RECOVER_BENCH, RECOVER_HALFTIME, type Action } from './fatigue';
import { INJURY_LABEL, injuryChance, rollInjury, worseInjury } from './injury';
import {
  ATTACK_DIR,
  HOOP_INSET,
  KEY_LENGTH,
  KEY_WIDTH,
  PX_PER_M,
  attackHoop,
  defendHoop,
  clampToCourt,
  COURT,
  COURT_BOTTOM,
  defenseHomeSpot,
  dist,
  inboundReceiveSpot,
  inboundSpot,
  isThree,
  metersTo,
  offenseSpot,
  type Vec,
  type SpotVariant,
} from './court';

export type Phase = 'inbound' | 'play' | 'freeThrow' | 'scored' | 'halfBreak' | 'finished';

export interface MatchEvent {
  text: string;
  /** 浮动提示（例如 +2）及其位置 */
  float?: { text: string; pos: Vec; color: string };
}

/** 某一分钟开始时的完整比赛状态：恢复它并用该分钟的种子重算，就能原样回放这一分钟 */
export interface MatchSnapshot {
  minute: number;
  phase: Phase;
  half: number;
  clock: number;
  shotClock: number;
  possession: TeamId;
  elapsed: number;
  tick: number;
  frontcourtAt: number | null;
  phaseTimer: number;
  lastPasser: number;
  lastPassAt: number;
  shootingFoulOn: TeamId | null;
  ft: { shooter: number; remaining: number; total: number } | null;
  lastShooter: number;
  log: string[];
  players: PlayerSnapshot[];
  ball: BallSnapshot;
}

/** 上下半场，每半场 20 分钟比赛时间；默认 4 倍速播放，约 5 分钟现实时间一个半场 */
export const HALVES = 2;
export const HALF_SEC = 20 * 60;
export const SHOT_CLOCK = 24;
/** 整场的比赛分钟数：回放快照与种子链都按分钟分段 */
export const MINUTES = HALVES * (HALF_SEC / 60);
/** 加时：常规时间打平就加时 5 分钟，直到分出胜负（half = 3 是第一个加时） */
export const OT_SEC = 5 * 60;
/** 模拟固定步长（秒）：步长必须固定，同一种子才能复现 */
export const STEP = 1 / 60;
/** 助攻加成持续时间（秒） */
const ASSIST_WINDOW = 3;
/** 投篮受干扰的半径（米）与折损系数 */
const CONTEST_M = 2.0;
/** 最近防守人超过这个距离的跳投记为“空位”（约 4 英尺） */
const OPEN_M = 1.2;
const CONTEST_K = 3.7;
/** 有效值等于该数时命中率正好等于各区域基础值 */
const SHOT_CENTER = 82;

type ShotKey = 'inside' | 'mid' | 'three';

/**
 * 比赛：规则与裁决。
 * 球员每帧自己 think()，想投/想传时调用这里的 shoot()/pass()，由这里决定结果并推进状态。
 * 所有涉及能力值的结算都经过 attrs.roll()（稳定性随机）。
 */
export interface MatchOptions {
  /** 体力系统：默认开 */
  fatigue?: boolean;
  /** 伤病：默认开 */
  injuries?: boolean;
}

export class Match {
  /** 两队全部球员（含替补），顺序固定：快照、统计、回放都按它的下标 */
  readonly roster: Player[] = [];
  /** 当前在场上的十人（roster 的子集，按 roster 顺序）；换人时重建 */
  players: Player[] = [];
  readonly teams: Record<TeamId, TeamDef>;
  readonly fatigue: boolean;
  readonly injuries: boolean;
  readonly ball: Ball;
  log: string[] = [];
  /** 总种子：每分钟的种子由它派生 */
  readonly seed: number;
  /** 当前比赛分钟（0 ~ MINUTES-1） */
  minute = 0;

  phase: Phase = 'inbound';
  half = 1;
  /** 本半场剩余秒 */
  clock = HALF_SEC;
  shotClock = SHOT_CLOCK;
  possession: TeamId = 'blue';
  /** 比赛累计秒 */
  elapsed = 0;
  /** 本帧处理球员的顺序：每帧交替先蓝后红 / 先红后蓝，免得固定顺序让蓝队总是先出手、先抢断 */
  private order: Player[] = [];
  private tick = 0;
  /** 本回合持球人第一次进入前场的时刻（null = 还在后场推进） */
  private frontcourtAt: number | null = null;
  private phaseTimer = 0;
  /** 上一个传球者（助攻判定） */
  private lastPasser: Player | null = null;
  private lastPassAt = 0;
  /** 投篮时被吹了防守犯规：不中罚 2/3 次，中了加罚 1 次 */
  private shootingFoulOn: TeamId | null = null;
  /** 进行中的罚球 */
  private ft: { shooter: Player; remaining: number; total: number } | null = null;

  onEvent: (e: MatchEvent) => void = () => {};
  /** 进入新的一分钟时触发（已切换到该分钟的种子）：回放系统在这里存快照 */
  onMinuteStart: (minute: number) => void = () => {};

  /**
   * @param teams 两队（id 必须是 'blue' / 'red'，蓝队主场）；名单前 5 人首发，最多 10 人。默认用 data/players.ts 的两队
   */
  constructor(scene: Phaser.Scene, seed: number = randomSeed(), teams: Record<TeamId, TeamDef> = TEAMS, opts: MatchOptions = {}) {
    this.seed = seed;
    this.teams = { ...teams };
    this.fatigue = opts.fatigue ?? true;
    this.injuries = opts.injuries ?? true;
    // 开场布置（状态下限、首次发球）用一个独立种子；之后第 0 分钟从干净的种子开始
    seedRng(minuteSeed(seed, -1));
    for (const teamId of ['blue', 'red'] as const) {
      // 名单按综合能力（伤员减半）从高到低排，前 5 首发；名单上的位置只是装饰
      const sorted = teams[teamId].players
        .map((d, i) => ({ d, i, r: ovr(d.attrs) * (d.injured ? 0.5 : 1) }))
        .sort((a, b) => b.r - a.r || a.i - b.i)
        .map((x) => x.d);
      const team = { ...teams[teamId], players: sorted };
      this.teams[teamId] = team;
      // 站位（场上的五个点位）按场上五人的能力值分配
      const starters = team.players.slice(0, 5);
      const spots = assignSpots(starters);
      const targets = planMinutes(team.players.map((d) => ({ attrs: d.attrs, injured: d.injured })));
      team.players.forEach((def, i) => {
        const spot = i < 5 ? spots[i] : 'SF';
        const p = new Player(scene, def, team, spot, defenseHomeSpot(teamId, spot));
        p.targetSec = targets[i];
        p.starter = i < 5;
        p.setOnCourt(i < 5);
        this.roster.push(p);
      });
    }
    this.players = this.roster.filter((p) => p.onCourt);
    this.ball = new Ball(scene, { x: 300, y: 240 });
    this.rollHalfFloors();
    this.startInbound('blue', true);
    seedRng(minuteSeed(seed, 0));
  }

  /** 本节总长（秒）：两个半场 20 分钟，加时 5 分钟 */
  periodSec(half = this.half): number {
    return half <= HALVES ? HALF_SEC : OT_SEC;
  }

  /** 当前所处的比赛分钟：钟停着时不变（加时接在第 40 分钟之后） */
  minuteIndex(): number {
    const len = this.periodSec();
    const start = this.half <= HALVES ? (this.half - 1) * (HALF_SEC / 60) : MINUTES + (this.half - HALVES - 1) * (OT_SEC / 60);
    return start + Math.min(len / 60 - 1, Math.floor((len - this.clock) / 60));
  }

  /** 已进行的比赛时间（秒，只算钟走的时间；常规时间终场 = MINUTES × 60，加时往后加） */
  gameTime(): number {
    const ot = Math.max(0, this.half - HALVES);
    if (this.phase === 'finished') return MINUTES * 60 + ot * OT_SEC;
    if (this.half <= HALVES) return (this.half - 1) * HALF_SEC + (HALF_SEC - this.clock);
    return MINUTES * 60 + (ot - 1) * OT_SEC + (OT_SEC - this.clock);
  }

  /** 第几个加时（0 = 常规时间） */
  get overtime(): number {
    return Math.max(0, this.half - HALVES);
  }

  // ---------- 查询 ----------
  teamPlayers(team: TeamId): Player[] {
    return this.players.filter((p) => p.teamId === team);
  }

  opponents(team: TeamId): Player[] {
    return this.players.filter((p) => p.teamId !== team);
  }

  /** 某队全部球员（含替补） */
  teamRoster(team: TeamId): Player[] {
    return this.roster.filter((p) => p.teamId === team);
  }

  /** 全队数据 = 全部球员之和 */
  teamStats(team: TeamId): PlayerStats {
    const sum = emptyPlayerStats();
    for (const p of this.teamRoster(team)) {
      for (const k of Object.keys(sum) as (keyof PlayerStats)[]) sum[k] += p.stats[k];
    }
    return sum;
  }

  /** 本回合到前场之后过了多久（秒）：用来决定“先传导还是出手”，后场推进不算 */
  setTime(): number {
    return this.frontcourtAt === null ? 0 : this.elapsed - this.frontcourtAt;
  }

  score(team: TeamId): number {
    return this.teamRoster(team).reduce((s, p) => s + p.stats.pts, 0);
  }

  /** 场上传球（助攻）最好的人，可排除一个；负责接发球、后场接应 */
  bestHandler(team: TeamId, except?: Player): Player {
    const ps = this.teamPlayers(team).filter((p) => p !== except);
    return ps.reduce((a, b) => (b.eff.assist > a.eff.assist ? b : a));
  }

  /** 对位：同一站位序号（站位按能力值分配） */
  markOf(p: Player): Player {
    const opps = this.opponents(p.teamId);
    return opps.find((o) => o.slot === p.slot) ?? opps[0];
  }

  nearestOpponent(p: Player, pos: Vec): Player | null {
    let best: Player | null = null;
    let bd = Infinity;
    for (const o of this.opponents(p.teamId)) {
      const d = dist(o.pos, pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  nearestOpponentDist(p: Player, pos: Vec): number {
    const o = this.nearestOpponent(p, pos);
    return o ? dist(o.pos, pos) : Infinity;
  }

  /**
   * 防守一次出手时用的防守值：按出手点离篮筐的距离在两项防守之间线性混合。
   * 2.75m 以内全看禁区防守，三分线（6.75m）及以外全看外线防守，中间按距离线性过渡（中距离站位 4.7m 处各占一半）。
   * 这样进攻方没法靠挪一步换区域来完全躲开某一项防守。
   */
  private shotDefVal(defender: Player, shotM: number, mode: 'expect' | 'roll'): number {
    const w = clamp((6.75 - shotM) / 4.0, 0, 1); // 禁区防守的权重
    if (w >= 1) return this.val(defender, 'insideDef', mode);
    if (w <= 0) return this.val(defender, 'outsideDef', mode);
    return w * this.val(defender, 'insideDef', mode) + (1 - w) * this.val(defender, 'outsideDef', mode);
  }

  /** 截断传球用的防守值：两项防守各占一半 */
  private stealDefVal(defender: Player): number {
    return (roll(defender, 'insideDef') + roll(defender, 'outsideDef')) / 2;
  }

  private shotKey(dM: number, three: boolean): ShotKey {
    return dM < 2.2 ? 'inside' : three ? 'three' : 'mid';
  }

  /** 能力值取值：评估时用期望，结算时真随机 */
  private val(p: Player, key: Exclude<keyof Attributes, 'stability'>, mode: 'expect' | 'roll'): number {
    return mode === 'roll' ? roll(p, key) : expected(p, key);
  }

  /**
   * 投篮命中率：
   * 由出手区域对应的投篮能力（含助攻加成）减去防守人的对应防守能力 × 贴近程度，再映射成概率。
   * 能力值加上本半场的随机浮动后典型值在 80~115，再加助攻加成；有效值 97 对应：篮下 66%、中距离 47%、三分 36%。
   */
  shotChance(shooter: Player, pos: Vec, moving: boolean, mode: 'expect' | 'roll'): number {
    const hoop = attackHoop(shooter.teamId);
    const dM = metersTo(pos, hoop);
    const three = isThree(pos, hoop);
    const key = this.shotKey(dM, three);
    let v = this.val(shooter, key, mode);
    // 防守干扰（单位：防守点）：防守值超过 50 的部分 × 贴近程度 × CONTEST_K。
    // 防守值按出手距离在禁区防守和外线防守之间混合（见 shotDefVal）
    let defPts = 0;
    const defender = this.nearestOpponent(shooter, pos);
    if (defender) {
      const defM = dist(defender.pos, pos) / PX_PER_M;
      if (defM < CONTEST_M) {
        const contest = (CONTEST_M - defM) / CONTEST_M;
        // 篮下出手受干扰只算 75%：护框的另一部分价值在封盖上（封盖不计入进攻方的出手预期，躲不开）
        const kMul = key === 'inside' ? 0.75 : 1;
        defPts = Math.max(0, this.shotDefVal(defender, dM, mode) - 50) * contest * CONTEST_K * kMul;
      }
    }
    // 移动中出手：三分 -8，中投只 -3（干拔 / 急停是中距离的看家本领）
    if (moving && key === 'three') v -= 8;
    else if (moving && key === 'mid') v -= 2;
    const base = key === 'inside' ? 0.79 : key === 'mid' ? 0.56 : 0.368;
    // 进攻每点命中率：篮下 0.5%、中投 0.12%、三分 0.25%；防守每个防守点扣：篮下 0.5%、中投 0.15%、三分 0.21%。
    // 进攻和防守的斜率分开设：调某项投篮能力的价值时不会连带改变防守干扰的强度。
    // 三分的基础命中率故意定得低：能力 70 的人投三分不划算，被防守逼到只能投三分时进攻方要付出代价
    const offSlope = key === 'mid' ? 0.0012 : key === 'three' ? 0.0025 : 0.005;
    const defSlope = key === 'mid' ? 0.0015 : key === 'three' ? 0.0021 : 0.005;
    let prob = base + (v - SHOT_CENTER) * offSlope - defPts * defSlope;
    // 助攻加成：接到传球后几秒内命中率直接加一个百分比（和出手类型无关）
    if (this.elapsed < shooter.boostUntil) prob += shooter.boostAmount;
    if (dM > 8.5) prob -= (dM - 8.5) * 0.07;
    return clamp(prob, 0.03, 0.95);
  }

  // ---------- 动作 ----------
  shoot(p: Player): void {
    if (this.ball.holder !== p || this.phase !== 'play') return;
    const hoop = attackHoop(p.teamId);
    const dM = metersTo(p.pos, hoop);
    const three = isThree(p.pos, hoop);
    const pts: 2 | 3 = three ? 3 : 2;
    const driving = p.driveTimer > 0 || p.isMoving();
    const prob = this.shotChance(p, p.pos, p.isMoving(), 'roll');
    const kind = dM < 2.2 ? (driving ? '上篮' : '篮下出手') : three ? '三分出手' : '中投';

    p.setPose('shoot', 0.45);
    p.face(hoop);
    p.target = null;
    p.vel = { x: 0, y: 0 };
    p.driveTimer = 0;
    this.tire(p, 'shoot');
    p.stats.fga++;
    if (three) p.stats.tpa++;

    // 最近的防守人：起跳干扰，可能盖帽，也可能打手犯规
    const defender = this.nearestOpponent(p, p.pos);
    const defM = defender ? dist(defender.pos, p.pos) / PX_PER_M : Infinity;
    // 最近防守人在 1.2m（约 4 英尺）以外的中投 / 三分记为空位出手
    const open = defM >= OPEN_M && dM >= 2.2;
    this.emit(`${this.who(p)} ${open ? '空位' : ''}${kind}`);
    this.shootingFoulOn = null;
    if (defender && defM < 1.6) {
      for (const o of this.opponents(p.teamId)) {
        if (dist(o.pos, p.pos) < 1.6 * PX_PER_M) {
          o.setPose('jump', 0.45);
          o.face(p.pos);
          this.tire(o, 'block');
        }
      }
      // 篮下出手时护框人 1.5m 内都有机会封盖（越远机会越小），跳投只有 1.1m 内的贴防人能封
      const blockReach = dM < 2.2 ? 1.5 : 1.1;
      if (defM < blockReach) {
        const defVal = this.shotDefVal(defender, dM, 'roll');
        const shootVal = roll(p, this.shotKey(dM, three));
        // 篮下封盖对双方能力差更敏感（差 25 点 ≈ ±29%），跳投封盖概率低得多
        let blockChance = dM < 2.2 ? clamp(0.085 + (defVal - shootVal) / 85, 0.02, 0.5) : clamp(0.1 + (defVal - shootVal) / 150, 0.01, 0.4) * 0.45;
        if (defM > 1.1) blockChance *= 1 - ((defM - 1.1) / 0.4) * 0.6;
        if (rng() < blockChance) {
          defender.stats.blk++;
          this.emit(`${this.who(defender)} 盖帽！`, { text: '盖帽!', pos: defender.pos, color: '#7ee0ff' });
          const ang = Math.atan2(p.pos.y - hoop.y, p.pos.x - hoop.x) + (rng() - 0.5) * 1.6;
          const sp = 60 + rng() * 60;
          this.ball.state = { kind: 'loose', vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp }, grace: 0.3 };
          this.ball.height = 10;
          return;
        }
        if (rng() < 0.2) {
          defender.stats.pf++;
          this.shootingFoulOn = defender.teamId;
          this.emit(`${this.who(defender)} 投篮犯规`, { text: '犯规', pos: defender.pos, color: '#ffb4a2' });
        }
      }
    }

    const willScore = rng() < prob;
    const end = willScore
      ? { ...hoop }
      : { x: hoop.x + (rng() - 0.5) * 8, y: hoop.y + (rng() - 0.5) * 8 };
    this.ball.state = {
      kind: 'shot',
      shooter: p,
      start: { ...this.ball.pos },
      end,
      t: 0,
      duration: 0.7 + dM / 11,
      peak: 18 + dM * 3,
      willScore,
      points: pts,
    };
  }

  pass(from: Player, to: Player): void {
    if (this.ball.holder !== from || this.phase !== 'play') return;
    // 传球线路上的对手有机会截断：外线/禁区防守 vs 传球人的助攻（传球）能力
    // 传球人助攻越低，能被伸手碰到的半径越大（助攻 50 → 0.55m，100 → 0.33m）；线路附近人越多，每个人的机会也越大
    this.tire(from, 'pass');
    const assist = from.eff.assist;
    const reach = (0.55 - ((assist - 50) / 50) * 0.22) * PX_PER_M;
    const vx = to.pos.x - from.pos.x;
    const vy = to.pos.y - from.pos.y;
    const len2 = vx * vx + vy * vy || 1;
    const near: { o: Player; d: number }[] = [];
    let crowd = 0;
    for (const o of this.opponents(from.teamId)) {
      const t = ((o.pos.x - from.pos.x) * vx + (o.pos.y - from.pos.y) * vy) / len2;
      if (t < 0.12 || t > 0.92) continue;
      const d = Math.hypot(o.pos.x - (from.pos.x + vx * t), o.pos.y - (from.pos.y + vy * t));
      if (d < 1.5 * PX_PER_M) crowd++;
      if (d < reach) near.push({ o, d });
    }
    let interceptor: Player | null = null;
    for (const { o, d } of near) {
      const defVal = this.stealDefVal(o);
      const passVal = roll(from, 'assist');
      let chance = clamp(0.18 + (defVal - passVal) / 200 + Math.max(0, crowd - 1) * 0.03, 0.04, 0.7);
      chance *= 1 - (d / reach) * 0.5; // 正好挡在线上的最容易断到
      if (rng() < chance) {
        interceptor = o;
        break;
      }
    }
    const target = interceptor ?? to;
    const d = dist(from.pos, target.pos);
    const duration = Math.max(0.22, d / 260);
    // 提前量：接球人还在移动
    const lead = interceptor ? 0 : 0.5;
    const end = { x: target.pos.x + target.vel.x * duration * lead, y: target.pos.y + target.vel.y * duration * lead };
    from.face(end);
    from.target = null;
    from.driveTimer = 0;
    this.ball.state = {
      kind: 'pass',
      from,
      to: target,
      start: { ...this.ball.pos },
      end,
      t: 0,
      duration,
      peak: 4 + d / 40,
    };
    this.lastPasser = from;
    this.lastPassAt = this.elapsed;
    this.emit(`${this.who(from)} 传给 ${to.def.name}`);
  }

  attemptSteal(defender: Player, handler: Player): void {
    if (this.ball.holder !== handler || this.phase !== 'play') return;
    this.tire(defender, 'steal');
    // 持球抢断看防守人所在的区域：离本方篮筐 4.5m 内（低位、突到篮下）用禁区防守，其余用外线防守
    const inPaint = metersTo(defender.pos, defendHoop(defender.teamId)) < 4.5;
    const defVal = roll(defender, inPaint ? 'insideDef' : 'outsideDef');
    const handleVal = roll(handler, 'assist');
    // 指数形式：双方能力相当时 0.32%，防守每高 25 点约 2.2 倍；差距很大时不会像线性那样爆炸
    const chance = clamp(0.0032 * Math.exp((defVal - handleVal) / 32), 0.0005, 0.02);
    const r = rng();
    if (r < chance) {
      this.giveBall(defender);
      defender.stats.stl++;
      handler.stats.tov++;
      this.emit(`${this.who(defender)} 抢断成功！`, { text: '抢断!', pos: defender.pos, color: '#ffd166' });
    } else if (r < chance + 0.005) {
      // 伸手犯规（普通犯规）：不罚球，被犯规一方重新发球
      defender.stats.pf++;
      this.emit(`${this.who(defender)} 打手犯规`, { text: '犯规', pos: defender.pos, color: '#ffb4a2' });
      this.ball.state = { kind: 'dead' };
      this.phase = 'scored';
      this.phaseTimer = 0.9;
      this.possession = handler.teamId;
    }
  }

  // ---------- 主循环 ----------
  update(dtSec: number): void {
    if (dtSec <= 0) return;
    const k = this.minuteIndex();
    if (k !== this.minute) {
      this.minute = k;
      seedRng(minuteSeed(this.seed, k));
      this.onMinuteStart(k);
    }
    this.elapsed += dtSec;
    this.order = this.tick++ & 1 ? [...this.players].reverse() : this.players;
    switch (this.phase) {
      case 'inbound':
        this.phaseTimer -= dtSec;
        if (this.phaseTimer <= 0) {
          const holder = this.ball.holder;
          const pg = this.bestHandler(this.possession);
          this.phase = 'play';
          if (holder && holder !== pg) this.pass(holder, pg);
        }
        break;
      case 'play':
        this.clock -= dtSec;
        this.shotClock -= dtSec;
        for (const p of this.players) p.stats.sec += dtSec;
        if (this.frontcourtAt === null) {
          const h = this.ball.holder;
          if (h && metersTo(h.pos, attackHoop(h.teamId)) < 14) this.frontcourtAt = this.elapsed;
        }
        if (this.shotClock <= 0) this.shotClockViolation();
        if (this.clock <= 0) this.endHalf();
        break;
      case 'freeThrow':
        // 罚球时停表；等一下再出手，球到篮筐后结算
        this.phaseTimer -= dtSec;
        if (this.ball.state.kind === 'held' && this.phaseTimer <= 0) this.shootFreeThrow();
        else if (this.ball.state.kind === 'shot' && this.ball.state.t >= 1) this.resolveFreeThrow(this.ball.state.willScore);
        break;
      case 'scored':
      case 'halfBreak':
        this.phaseTimer -= dtSec;
        if (this.phaseTimer <= 0) {
          if (this.phase === 'halfBreak') this.beginHalf();
          else this.startInbound(this.possession, false);
        }
        break;
      case 'finished':
        break;
    }

    // 本帧中途可能换了人（发球前教练换人）：按换人后的场上名单处理
    if (this.order.length !== this.players.length || this.order.some((p) => !p.onCourt)) {
      this.order = this.tick & 1 ? [...this.players] : [...this.players].reverse();
    }
    if (this.phase === 'play' || this.phase === 'inbound') {
      for (const p of this.order) think(p, this, dtSec);
    }
    for (const p of this.order) p.update(dtSec, this.players);
    this.updateStamina(dtSec);
    this.ball.update(dtSec);
    if (this.phase === 'play') this.resolveBall();
  }

  private resolveBall(): void {
    const s = this.ball.state;
    if (s.kind === 'pass' && s.t >= 1) {
      const receiver = s.to;
      const wasOpp = receiver.teamId !== s.from.teamId;
      this.giveBall(receiver);
      if (wasOpp) {
        receiver.stats.stl++;
        s.from.stats.tov++;
        this.emit(`${this.who(receiver)} 截断传球！`, { text: '抢断!', pos: receiver.pos, color: '#ffd166' });
      } else {
        receiver.lastPassFrom = s.from;
        // 助攻加成：传球人的助攻能力越高，接球人接下来几秒投篮越准（助攻期望每高 10 点 +0.8% 命中率）
        receiver.boostAmount = Math.max(0, expected(s.from, 'assist') - 50) * 0.0008;
        receiver.boostUntil = this.elapsed + ASSIST_WINDOW;
        // 接球瞬间立刻判断：空位就直接出手
        receiver.decideTimer = 0.03;
      }
      return;
    }
    if (s.kind === 'shot' && s.t >= 1) {
      const team = s.shooter.teamId;
      if (s.willScore) {
        s.shooter.stats.fgm++;
        s.shooter.stats.pts += s.points;
        if (s.points === 3) s.shooter.stats.tpm++;
        // 助攻：出手前短时间内接到队友传球
        if (this.lastPasser && this.lastPasser.teamId === team && this.elapsed - this.lastPassAt < ASSIST_WINDOW) {
          this.lastPasser.stats.ast++;
        }
        this.emit(`${this.who(s.shooter)} 命中！+${s.points}`, {
          text: `+${s.points}`,
          pos: s.end,
          color: s.shooter.team.colorCss,
        });
        this.ball.state = { kind: 'dead' };
        this.ball.height = 0;
        if (this.shootingFoulOn) {
          // 打成 2+1 / 3+1
          this.emit(`${this.who(s.shooter)} 加罚 1 次`);
          this.startFreeThrows(s.shooter, 1);
        } else {
          this.phase = 'scored';
          this.phaseTimer = 1.1;
          this.possession = team === 'blue' ? 'red' : 'blue';
        }
      } else if (this.shootingFoulOn) {
        // 被犯规且不中：罚 2 或 3 次
        this.emit(`${this.who(s.shooter)} 不中，罚球 ${s.points} 次`);
        this.startFreeThrows(s.shooter, s.points);
      } else {
        this.emit(`${this.who(s.shooter)} 不中`);
        this.startRebound(s.shooter);
      }
      this.shootingFoulOn = null;
      return;
    }
    if (s.kind === 'loose' && s.pending && s.grace <= 0) {
      this.decideRebound(s);
      return;
    }
    if (s.kind === 'loose' && s.grace <= 0 && this.ball.height < 12) {
      // 谁先碰到谁拿；篮板对抗的赢家有一段独占时间
      let catcher: Player | null = null;
      let bd = Infinity;
      const claimActive = s.claimant && this.elapsed < (s.claimUntil ?? 0);
      if (claimActive && s.claimant) {
        // 球持续朝赢家滚过去（抽象“他抢到了这个篮板”）
        const dx = s.claimant.pos.x - this.ball.pos.x;
        const dy = s.claimant.pos.y - this.ball.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = Math.max(40, d / 0.4);
        s.vel = { x: (dx / d) * sp, y: (dy / d) * sp };
      }
      for (const p of this.order) {
        if (!p.canMove()) continue;
        if (claimActive && p !== s.claimant) continue;
        const reach = claimActive ? 12 : 6 + ((p.eff.rebound - 50) / 50) * 4;
        const d = dist(p.pos, this.ball.pos);
        if (d < reach && d < bd) {
          bd = d;
          catcher = p;
        }
      }
      if (catcher) {
        const prev = this.possession;
        const afterShot = s.rebound === true;
        this.giveBall(catcher);
        if (afterShot) {
          catcher.stats.reb++;
          this.emit(`${this.who(catcher)} 抢下${catcher.teamId === prev ? '进攻' : '防守'}篮板`);
          if (catcher.teamId === prev) this.shotClock = Math.max(this.shotClock, 14);
        }
      }
    }
  }

  /**
   * 篮板对抗：篮筐附近的球员各自掷一次篮板能力值（出手者减半、离得近略占优），
   * 赢家获得球的优先权——球朝他弹过去，并在短时间内只有他能拿到。
   */
  // ---------- 罚球 ----------
  /** 罚球命中率：用不受干扰的中距离能力，有效值等于 SHOT_CENTER 时 75% */
  freeThrowChance(p: Player, mode: 'expect' | 'roll'): number {
    return clamp(0.75 + (this.val(p, 'mid', mode) - SHOT_CENTER) * 0.004, 0.3, 0.98);
  }

  /** 所有人站到罚球位：罚球人在罚球线，内线沿禁区两侧排开，后卫退到三分线外 */
  private startFreeThrows(shooter: Player, count: number): void {
    this.phase = 'freeThrow';
    this.shootingFoulOn = null;
    this.ft = { shooter, remaining: count, total: count };
    this.lastPasser = null;
    const team = shooter.teamId;
    const hoop = attackHoop(team);
    const dir = ATTACK_DIR[team];
    const line = hoop.x - dir * (KEY_LENGTH - HOOP_INSET);
    const side = KEY_WIDTH / 2 + 0.35 * PX_PER_M;
    const slot = (depthM: number, s: 1 | -1): Vec => ({ x: hoop.x - dir * depthM * PX_PER_M, y: hoop.y + s * side });
    const back = (dy: number): Vec => ({ x: line - dir * 2.2 * PX_PER_M, y: hoop.y + dy * PX_PER_M });
    const oppSpots = [slot(1.0, 1), slot(1.0, -1), slot(2.8, 1), back(-2.6), back(2.6)];
    const mateSpots = [slot(1.9, 1), slot(1.9, -1), slot(2.8, -1), back(4.2)];
    const place = (p: Player, spot: Vec, intent: string) => {
      p.teleport(clampToCourt(spot));
      p.setPose('normal', 0);
      p.driveTimer = 0;
      p.cutting = false;
      p.intent = intent;
    };
    place(shooter, { x: line, y: hoop.y }, '罚球');
    shooter.face(hoop);
    this.teamPlayers(team)
      .filter((p) => p !== shooter)
      .forEach((p, i) => place(p, mateSpots[i], '等待'));
    this.opponents(team).forEach((p, i) => place(p, oppSpots[i], '等待'));
    this.ball.state = { kind: 'held', holder: shooter };
    this.ball.height = 4;
    this.phaseTimer = 1.3;
  }

  private shootFreeThrow(): void {
    const ft = this.ft;
    if (!ft) return;
    const p = ft.shooter;
    const hoop = attackHoop(p.teamId);
    const prob = this.freeThrowChance(p, 'roll');
    const willScore = rng() < prob;
    p.setPose('shoot', 0.45);
    p.face(hoop);
    this.tire(p, 'freeThrow');
    p.stats.fta++;
    const end = willScore ? { ...hoop } : { x: hoop.x + (rng() - 0.5) * 8, y: hoop.y + (rng() - 0.5) * 8 };
    this.ball.state = {
      kind: 'shot',
      shooter: p,
      start: { ...this.ball.pos },
      end,
      t: 0,
      duration: 0.9,
      peak: 24,
      willScore,
      points: 1,
    };
  }

  private resolveFreeThrow(made: boolean): void {
    const ft = this.ft;
    if (!ft) return;
    const p = ft.shooter;
    const idx = ft.total - ft.remaining + 1;
    if (made) {
      p.stats.ftm++;
      p.stats.pts++;
      this.emit(`${this.who(p)} 罚球命中（${idx}/${ft.total}）`, { text: '+1', pos: attackHoop(p.teamId), color: p.team.colorCss });
    } else {
      this.emit(`${this.who(p)} 罚球不中（${idx}/${ft.total}）`);
    }
    ft.remaining--;
    if (ft.remaining > 0) {
      this.ball.state = { kind: 'held', holder: p };
      this.ball.height = 4;
      this.phaseTimer = 1.2;
      return;
    }
    this.ft = null;
    if (made) {
      // 最后一罚命中：对方发球
      this.ball.state = { kind: 'dead' };
      this.ball.height = 0;
      this.phase = 'scored';
      this.phaseTimer = 0.9;
      this.possession = p.teamId === 'blue' ? 'red' : 'blue';
    } else {
      // 最后一罚不中：活球，争抢篮板
      this.phase = 'play';
      this.shotClock = SHOT_CLOCK;
      this.startRebound(p);
    }
  }

  private startRebound(shooter: Player): void {
    // 先在篮筐上弹一下（0.4 秒），落下来的瞬间再判定谁抢到，给外线球员冲回来的时间
    const ang = rng() * Math.PI * 2;
    const sp = 30 + rng() * 40;
    this.ball.state = {
      kind: 'loose',
      vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp },
      grace: 0.4,
      rebound: true,
      pending: true,
    };
    this.ball.height = 14;
    this.lastShooter = shooter;
  }

  private lastShooter: Player | null = null;

  /** 篮板对抗：球附近的人各掷一次，能力值占三成多、位置和运气占大头；赢家获得独占权，球朝他弹去 */
  private decideRebound(s: Extract<BallState, { kind: 'loose' }>): void {
    s.pending = false;
    const ballPos = this.ball.pos;
    const shooter = this.lastShooter;
    const offense = this.possession;
    let winner: Player | null = null;
    let best = -Infinity;
    for (const p of this.players) {
      const dM = dist(p.pos, ballPos) / PX_PER_M;
      if (dM > 4.5) continue;
      this.tire(p, 'rebound');
      let v = roll(p, 'rebound') * 0.078;
      if (p === shooter) v *= 0.5;
      v += (4.5 - dM) * 2.0;
      v += rng() * 50;
      if (p.teamId !== offense) v += 6; // 防守方占据内侧位置
      if (v > best) {
        best = v;
        winner = p;
      }
    }
    if (!winner) return;
    const dx = winner.pos.x - ballPos.x;
    const dy = winner.pos.y - ballPos.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = Math.max(30, d / 0.5);
    const ang = Math.atan2(dy, dx) + (rng() - 0.5) * 0.4;
    s.vel = { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp };
    s.claimant = winner;
    s.claimUntil = this.elapsed + 2;
  }

  /** 把球交到某人手上并更新球权 */
  private giveBall(p: Player): void {
    this.ball.state = { kind: 'held', holder: p };
    this.ball.height = 4;
    p.holdTime = 0;
    p.lastPassFrom = null;
    p.decideTimer = 0.15;
    if (p.teamId !== this.possession) {
      this.possession = p.teamId;
      this.shotClock = SHOT_CLOCK;
      this.lastPasser = null;
      this.frontcourtAt = null;
      this.rerollSpots(p.teamId);
    }
  }

  /** 每次球权变化：外线球员决定本回合站三分线外还是中距离，内线决定要不要拉出三分线 */
  private rerollSpots(team: TeamId): void {
    for (const p of this.teamPlayers(team)) p.spotVariant = this.rollSpotVariant(p);
  }

  /** 按能力值随机一个站位变体（球权变化和无球换位时都用这一套概率，保持三分 / 中投比例不变） */
  rollSpotVariant(p: Player): SpotVariant {
    const a = p.eff;
    if (p.spot === 'PF' || p.spot === 'C') {
      // 三分 50 的内线约 9% 的回合站到线外，70 约 25%，最多 30%
      return rng() < clamp((a.three - 38) / 130, 0, 0.3) ? 'three' : 'base';
    }
    // 中投比三分好的人更常站中距离，反之更常留在三分线外
    return rng() < clamp(0.7 + (a.mid - a.three) / 80, 0.15, 0.8) ? 'mid' : 'base';
  }

  private shotClockViolation(): void {
    const prev = this.possession;
    const holder = this.ball.holder;
    (holder && holder.teamId === prev ? holder : this.teamPlayers(prev)[0]).stats.tov++;
    this.emit(`${this.teams[prev].name} 24 秒违例`);
    this.possession = prev === 'blue' ? 'red' : 'blue';
    this.startInbound(this.possession, false);
  }

  private endHalf(): void {
    this.clock = 0;
    this.ball.state = { kind: 'dead' };
    const sc = `${this.teams.blue.name} ${this.score('blue')} : ${this.score('red')} ${this.teams.red.name}`;
    if (this.half >= HALVES && this.score('blue') !== this.score('red')) {
      this.phase = 'finished';
      this.emit(`比赛结束${this.overtime ? `（${this.overtime} 个加时）` : ''} ${sc}`);
      return;
    }
    this.phase = 'halfBreak';
    this.phaseTimer = 3;
    this.emit(this.half === 1 ? `上半场结束 ${sc}` : `${this.half === HALVES ? '常规时间' : `加时 ${this.overtime}`}战平 ${sc}，进入加时`);
  }

  private beginHalf(): void {
    this.half++;
    this.clock = this.periodSec();
    // 中场休息：全员恢复体力（加时前只歇一小会儿）
    if (this.fatigue) for (const p of this.roster) p.setStamina(p.stamina + (this.half === 2 ? RECOVER_HALFTIME : RECOVER_HALFTIME / 4));
    this.rollHalfFloors();
    // 每节换另一队先攻
    this.possession = this.half % 2 === 0 ? 'red' : 'blue';
    this.startInbound(this.possession, true);
  }

  /** 每半场开始：按稳定性为每名球员掷本半场的随机下限 */
  private rollHalfFloors(): void {
    for (const p of this.roster) p.floor = rollHalfFloor(p.eff.stability);
    const desc = (team: TeamId) =>
      this.teamPlayers(team)
        .map((p) => `${p.def.name} ${Math.round(p.floor)}`)
        .join('，');
    const name = this.periodName();
    this.emit(`${name}状态下限  ${this.teams.blue.name}：${desc('blue')}`);
    this.emit(`${name}状态下限  ${this.teams.red.name}：${desc('red')}`);
  }

  /** 底线发球：中锋在底线外持球，其他人跑到各自站位，1.2 秒后传给控卫 */
  private startInbound(team: TeamId, resetPositions: boolean): void {
    this.phase = 'inbound';
    this.phaseTimer = 1.2;
    this.possession = team;
    this.shotClock = SHOT_CLOCK;
    this.lastPasser = null;
    this.shootingFoulOn = null;
    this.ft = null;
    this.frontcourtAt = null;
    // 死球：两队教练都可以换人
    this.substitute('blue', resetPositions);
    this.substitute('red', resetPositions);
    this.rerollSpots(team);
    const mates = this.teamPlayers(team);
    const opps = this.opponents(team);
    // 传球最差的人发球，传球最好的人接应
    const inbounder = mates.reduce((a, b) => (b.eff.assist < a.eff.assist ? b : a));
    const receiver = this.bestHandler(team, inbounder);
    inbounder.teleport(inboundSpot(team));
    inbounder.setPose('normal', 0);
    this.ball.state = { kind: 'held', holder: inbounder };
    this.ball.height = 4;
    for (const p of mates) {
      p.driveTimer = 0;
      p.cutting = false;
      if (p === inbounder) continue;
      const spot = p === receiver ? inboundReceiveSpot(team) : offenseSpot(team, p.spot, p.spotVariant);
      if (resetPositions) p.teleport(spot);
      p.target = spot;
      p.intent = '跑位';
    }
    for (const p of opps) {
      const spot = defenseHomeSpot(p.teamId, p.spot);
      if (resetPositions) p.teleport(spot);
      p.target = spot;
      p.intent = '退防';
    }
  }

  // ---------- 体力与换人 ----------
  /** 做动作的体力消耗 */
  tire(p: Player, action: Action): void {
    if (this.fatigue) p.setStamina(p.stamina - ACTION_COST[action]);
    if (this.injuries && !p.newInjury && rng() < injuryChance(p.eff.stability)) this.injure(p);
  }

  /** 受伤：能力值减半；轻伤继续打但剩余上场时间砍掉六成，重伤 / 报销在下一个死球换下 */
  private injure(p: Player): void {
    const inj = rollInjury(rng(), rng());
    p.newInjury = inj;
    const wasOut = p.out;
    p.injury = worseInjury(p.injury, inj.kind);
    p.setStamina(p.stamina);
    if (inj.kind === 'light') p.targetSec = p.stats.sec + Math.max(0, p.targetSec - p.stats.sec) * 0.4;
    if (!wasOut) {
      const games = inj.kind === 'season' ? '赛季报销' : `${INJURY_LABEL[inj.kind]}，预计影响 ${inj.games} 场`;
      this.emit(`${this.who(p)} 受伤！${games}`, { text: inj.kind === 'light' ? '受伤' : '重伤!', pos: p.pos, color: '#ff6b6b' });
    }
  }

  /** 每步：场上的人按时间和跑动距离消耗，场下的人恢复 */
  private updateStamina(dtSec: number): void {
    if (!this.fatigue || this.phase === 'finished') return;
    const resting = this.phase === 'halfBreak';
    for (const p of this.roster) {
      if (p.onCourt && !resting) {
        const movedM = (Math.hypot(p.vel.x, p.vel.y) * dtSec) / PX_PER_M;
        p.setStamina(p.stamina - DRAIN_BASE * dtSec - movedM * DRAIN_PER_M);
      } else if (p.stamina < 100) {
        p.setStamina(p.stamina + RECOVER_BENCH * dtSec);
      }
    }
  }

  /** 教练在死球时换人：挑出新的五人，重新分配站位，上场的人从技术台边进场 */
  private substitute(team: TeamId, quiet: boolean): void {
    const roster = this.teamRoster(team);
    if (roster.length <= 5) return;
    const other: TeamId = team === 'blue' ? 'red' : 'blue';
    const five = chooseLineup(roster, {
      gameTime: this.gameTime(),
      half: this.half,
      clock: this.clock,
      margin: this.score(team) - this.score(other),
    });
    const ins = five.filter((p) => !p.onCourt);
    if (ins.length === 0) return;
    const outs = roster.filter((p) => p.onCourt && !five.includes(p));
    for (const p of outs) p.setOnCourt(false);
    const table = { x: COURT.left + COURT.width / 2, y: COURT_BOTTOM - 4 };
    for (const p of ins) {
      p.setOnCourt(true);
      p.enteredAt = this.gameTime();
      p.teleport(table);
      p.setPose('normal', 0);
      p.spotVariant = 'base';
    }
    const spots = assignSpots(five.map((p) => p.def));
    five.forEach((p, i) => p.setSpot(spots[i]));
    this.players = this.roster.filter((p) => p.onCourt);
    if (!quiet || this.gameTime() > 0) {
      this.emit(`${this.teams[team].name} 换人：${ins.map((p) => p.def.name).join('、')} 上，${outs.map((p) => p.def.name).join('、')} 下`);
    }
  }

  private who(p: Player): string {
    return `${p.team.name} #${p.def.number} ${p.def.name}`;
  }

  private emit(text: string, float?: MatchEvent['float']): void {
    this.log.push(text);
    if (this.log.length > 80) this.log.shift();
    this.onEvent({ text, float });
  }

  // ---------- 回放快照 ----------
  snapshot(): MatchSnapshot {
    const indexOf = (p: Player | null) => (p ? this.roster.indexOf(p) : -1);
    return {
      minute: this.minute,
      phase: this.phase,
      half: this.half,
      clock: this.clock,
      shotClock: this.shotClock,
      possession: this.possession,
      elapsed: this.elapsed,
      tick: this.tick,
      frontcourtAt: this.frontcourtAt,
      phaseTimer: this.phaseTimer,
      lastPasser: indexOf(this.lastPasser),
      lastPassAt: this.lastPassAt,
      shootingFoulOn: this.shootingFoulOn,
      ft: this.ft ? { shooter: indexOf(this.ft.shooter), remaining: this.ft.remaining, total: this.ft.total } : null,
      lastShooter: indexOf(this.lastShooter),
      log: [...this.log],
      players: this.roster.map((p) => p.snapshot(indexOf)),
      ball: this.ball.snapshot(indexOf),
    };
  }

  /** 恢复到某分钟开始时的状态，并切回该分钟的种子，之后 update() 会原样重算 */
  restore(s: MatchSnapshot): void {
    const at = (i: number) => (i < 0 ? null : this.roster[i]);
    this.minute = s.minute;
    this.phase = s.phase;
    this.half = s.half;
    this.clock = s.clock;
    this.shotClock = s.shotClock;
    this.possession = s.possession;
    this.elapsed = s.elapsed;
    this.tick = s.tick;
    this.frontcourtAt = s.frontcourtAt;
    this.phaseTimer = s.phaseTimer;
    this.lastPasser = at(s.lastPasser);
    this.lastPassAt = s.lastPassAt;
    this.shootingFoulOn = s.shootingFoulOn;
    this.ft = s.ft ? { shooter: this.roster[s.ft.shooter], remaining: s.ft.remaining, total: s.ft.total } : null;
    this.lastShooter = at(s.lastShooter);
    this.log = [...s.log];
    s.players.forEach((ps, i) => this.roster[i].restore(ps, this.roster));
    this.players = this.roster.filter((p) => p.onCourt);
    this.ball.restore(s.ball, this.roster);
    seedRng(minuteSeed(this.seed, s.minute));
  }

  clockText(): string {
    const s = Math.max(0, Math.ceil(this.clock));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${this.periodName()} ${mm}:${ss.toString().padStart(2, '0')}`;
  }

  periodName(): string {
    return this.half === 1 ? '上半场' : this.half === 2 ? '下半场' : `加时${this.half - HALVES > 1 ? this.half - HALVES : ''}`;
  }
}

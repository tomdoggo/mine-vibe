import Phaser from 'phaser';
import { ROLE_ORDER, TEAMS, type TeamId } from '../data/players';
import { Ball } from './Ball';
import { Player } from './Player';
import { think } from './ai';
import {
  PX_PER_M,
  attackHoop,
  defenseHomeSpot,
  dist,
  inboundReceiveSpot,
  inboundSpot,
  isThree,
  metersTo,
  offenseSpot,
  type Vec,
} from './court';

export type Phase = 'inbound' | 'play' | 'scored' | 'quarterBreak' | 'finished';

export interface TeamStats {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  reb: number;
  stl: number;
  tov: number;
  ast: number;
}

export interface MatchEvent {
  text: string;
  /** 浮动提示（例如 +2）及其位置 */
  float?: { text: string; pos: Vec; color: string };
}

export const QUARTERS = 4;
export const QUARTER_SEC = 150;
export const SHOT_CLOCK = 24;

const emptyStats = (): TeamStats => ({ pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, stl: 0, tov: 0, ast: 0 });

/**
 * 比赛：规则与裁决。
 * 球员每帧自己 think()，想投/想传时调用这里的 shoot()/pass()，由这里决定结果并推进状态。
 */
export class Match {
  readonly players: Player[] = [];
  readonly ball: Ball;
  readonly stats: Record<TeamId, TeamStats> = { blue: emptyStats(), red: emptyStats() };
  readonly log: string[] = [];

  phase: Phase = 'inbound';
  quarter = 1;
  /** 本节剩余秒 */
  clock = QUARTER_SEC;
  shotClock = SHOT_CLOCK;
  possession: TeamId = 'blue';
  private phaseTimer = 0;
  /** 上一个传球者（用于助攻判定） */
  private lastPasser: Player | null = null;
  private lastPassAt = 0;
  private elapsed = 0;

  onEvent: (e: MatchEvent) => void = () => {};

  constructor(scene: Phaser.Scene) {
    for (const teamId of ['blue', 'red'] as const) {
      const team = TEAMS[teamId];
      team.players.forEach((def, i) => {
        this.players.push(new Player(scene, def, team, i, defenseHomeSpot(teamId, def.role)));
      });
    }
    this.ball = new Ball(scene, { x: 320, y: 200 });
    this.startInbound('blue', true);
  }

  // ---------- 查询 ----------
  teamPlayers(team: TeamId): Player[] {
    return this.players.filter((p) => p.teamId === team);
  }

  opponents(team: TeamId): Player[] {
    return this.players.filter((p) => p.teamId !== team);
  }

  /** 对位：同一位置序号 */
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
   * 投篮命中率模型：距离决定基础值，能力值加成，最近防守人越近扣得越多，移动中出手略降。
   * @param defM 最近对手距离（米）
   */
  shotProbability(shooter: Player, pos: Vec, defM: number, moving: boolean): number {
    const hoop = attackHoop(shooter.teamId);
    const dM = metersTo(pos, hoop);
    const a = shooter.def.attrs;
    let base: number;
    if (dM < 2.2) base = 0.5 + a.inside * 0.32;
    else if (!isThree(pos, hoop)) base = 0.28 + a.mid * 0.3;
    else {
      base = 0.17 + a.three * 0.3;
      if (dM > 8.5) base -= (dM - 8.5) * 0.07;
    }
    if (defM < 1.6) {
      const defender = this.nearestOpponent(shooter, pos);
      const defSkill = defender ? defender.def.attrs.defense : 0.5;
      base -= ((1.6 - defM) / 1.6) * 0.28 * (0.6 + defSkill * 0.6);
    }
    if (moving && dM >= 2.2) base -= 0.06;
    return Math.max(0.03, Math.min(0.92, base));
  }

  // ---------- 动作 ----------
  shoot(p: Player): void {
    if (this.ball.holder !== p || this.phase !== 'play') return;
    const hoop = attackHoop(p.teamId);
    const dM = metersTo(p.pos, hoop);
    const three = isThree(p.pos, hoop);
    const pts: 2 | 3 = three ? 3 : 2;
    const defM = this.nearestOpponentDist(p, p.pos) / PX_PER_M;
    const prob = this.shotProbability(p, p.pos, defM, p.isMoving());
    const willScore = Math.random() < prob;
    const driving = p.driveTimer > 0 || p.isMoving();
    p.setPose('shoot', 0.45);
    p.face(hoop);
    p.target = null;
    p.vel = { x: 0, y: 0 };
    p.driveTimer = 0;
    // 防守人起跳干扰
    for (const o of this.opponents(p.teamId)) {
      if (dist(o.pos, p.pos) < 1.6 * PX_PER_M) {
        o.setPose('jump', 0.45);
        o.face(p.pos);
      }
    }
    const end = willScore
      ? { ...hoop }
      : { x: hoop.x + (Math.random() - 0.5) * 8, y: hoop.y + (Math.random() - 0.5) * 8 };
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
    const st = this.stats[p.teamId];
    st.fga++;
    if (three) st.tpa++;
    const kind = dM < 2.2 ? (driving ? '上篮' : '篮下出手') : three ? '三分出手' : '中投';
    this.emit(`${this.who(p)} ${kind}`);
  }

  pass(from: Player, to: Player): void {
    if (this.ball.holder !== from || this.phase !== 'play') return;
    // 传球线路上的对手有机会截断
    let interceptor: Player | null = null;
    for (const o of this.opponents(from.teamId)) {
      const vx = to.pos.x - from.pos.x;
      const vy = to.pos.y - from.pos.y;
      const len2 = vx * vx + vy * vy || 1;
      const t = ((o.pos.x - from.pos.x) * vx + (o.pos.y - from.pos.y) * vy) / len2;
      if (t < 0.12 || t > 0.92) continue;
      const px = from.pos.x + vx * t;
      const py = from.pos.y + vy * t;
      const d = Math.hypot(o.pos.x - px, o.pos.y - py);
      if (d < 0.5 * PX_PER_M) {
        const chance = Math.min(0.8, 0.45 * (0.5 + o.def.attrs.defense) * (1.3 - from.def.attrs.passing * 0.7));
        if (Math.random() < chance) {
          interceptor = o;
          break;
        }
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
    const chance = 0.02 * (0.5 + defender.def.attrs.defense) * (1.3 - handler.def.attrs.passing * 0.6);
    if (Math.random() < chance) {
      this.giveBall(defender);
      this.stats[defender.teamId].stl++;
      this.stats[handler.teamId].tov++;
      this.emit(`${this.who(defender)} 抢断成功！`, { text: '抢断!', pos: defender.pos, color: '#ffd166' });
    }
  }

  // ---------- 主循环 ----------
  update(dtSec: number): void {
    if (dtSec <= 0) return;
    this.elapsed += dtSec;
    switch (this.phase) {
      case 'inbound':
        this.phaseTimer -= dtSec;
        if (this.phaseTimer <= 0) {
          const holder = this.ball.holder;
          const pg = this.teamPlayers(this.possession)[0];
          this.phase = 'play';
          if (holder && holder !== pg) this.pass(holder, pg);
        }
        break;
      case 'play':
        this.clock -= dtSec;
        this.shotClock -= dtSec;
        if (this.shotClock <= 0) this.shotClockViolation();
        if (this.clock <= 0) this.endQuarter();
        break;
      case 'scored':
      case 'quarterBreak':
        this.phaseTimer -= dtSec;
        if (this.phaseTimer <= 0) {
          if (this.phase === 'quarterBreak') this.beginQuarter();
          else this.startInbound(this.possession, false);
        }
        break;
      case 'finished':
        break;
    }

    if (this.phase === 'play' || this.phase === 'inbound') {
      for (const p of this.players) think(p, this, dtSec);
    }
    for (const p of this.players) p.update(dtSec, this.players);
    this.ball.update(dtSec);
    if (this.phase === 'play') this.resolveBall();
  }

  private resolveBall(): void {
    const s = this.ball.state;
    if (s.kind === 'pass' && s.t >= 1) {
      const receiver = s.to;
      const wasOpp = receiver.teamId !== s.from.teamId;
      this.giveBall(receiver);
      receiver.lastPassFrom = wasOpp ? null : s.from;
      // 接球瞬间立刻判断：空位就直接出手
      receiver.decideTimer = 0.03;
      if (wasOpp) {
        this.stats[receiver.teamId].stl++;
        this.stats[s.from.teamId].tov++;
        this.emit(`${this.who(receiver)} 截断传球！`, { text: '抢断!', pos: receiver.pos, color: '#ffd166' });
      }
      return;
    }
    if (s.kind === 'shot' && s.t >= 1) {
      const team = s.shooter.teamId;
      const st = this.stats[team];
      if (s.willScore) {
        st.fgm++;
        st.pts += s.points;
        if (s.points === 3) st.tpm++;
        // 助攻：出手前 2.5 秒内接到队友传球
        if (this.lastPasser && this.lastPasser.teamId === team && this.elapsed - this.lastPassAt < 2.5) st.ast++;
        this.emit(`${this.who(s.shooter)} 命中！+${s.points}`, {
          text: `+${s.points}`,
          pos: s.end,
          color: s.shooter.team.colorCss,
        });
        this.ball.state = { kind: 'dead' };
        this.ball.height = 0;
        this.phase = 'scored';
        this.phaseTimer = 1.1;
        this.possession = team === 'blue' ? 'red' : 'blue';
      } else {
        this.emit(`${this.who(s.shooter)} 不中`);
        const ang = Math.random() * Math.PI * 2;
        const sp = 45 + Math.random() * 60;
        this.ball.state = { kind: 'loose', vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp }, grace: 0.35 };
        this.ball.height = 14;
      }
      return;
    }
    if (s.kind === 'loose' && s.grace <= 0 && this.ball.height < 12) {
      // 谁先碰到谁拿；篮板能力好的人“手长”一点
      let catcher: Player | null = null;
      let bd = Infinity;
      for (const p of this.players) {
        if (!p.canMove()) continue;
        const reach = 6 + p.def.attrs.rebound * 4;
        const d = dist(p.pos, this.ball.pos);
        if (d < reach && d < bd) {
          bd = d;
          catcher = p;
        }
      }
      if (catcher) {
        const prev = this.possession;
        this.giveBall(catcher);
        this.stats[catcher.teamId].reb++;
        this.emit(`${this.who(catcher)} 抢下${catcher.teamId === prev ? '进攻' : '防守'}篮板`);
        if (catcher.teamId === prev) this.shotClock = Math.max(this.shotClock, 14);
      }
    }
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
    }
  }

  private shotClockViolation(): void {
    const prev = this.possession;
    this.stats[prev].tov++;
    this.emit(`${TEAMS[prev].name} 24 秒违例`);
    this.possession = prev === 'blue' ? 'red' : 'blue';
    this.startInbound(this.possession, false);
  }

  private endQuarter(): void {
    this.clock = 0;
    this.ball.state = { kind: 'dead' };
    if (this.quarter >= QUARTERS) {
      this.phase = 'finished';
      const b = this.stats.blue.pts;
      const r = this.stats.red.pts;
      this.emit(`比赛结束 ${TEAMS.blue.name} ${b} : ${r} ${TEAMS.red.name}`);
      return;
    }
    this.phase = 'quarterBreak';
    this.phaseTimer = 2.2;
    this.emit(`第 ${this.quarter} 节结束`);
  }

  private beginQuarter(): void {
    this.quarter++;
    this.clock = QUARTER_SEC;
    // 每节交替球权
    this.possession = this.quarter % 2 === 0 ? 'red' : 'blue';
    this.startInbound(this.possession, true);
  }

  /** 底线发球：中锋在底线外持球，其他人跑到各自站位，1.2 秒后传给控卫 */
  private startInbound(team: TeamId, resetPositions: boolean): void {
    this.phase = 'inbound';
    this.phaseTimer = 1.2;
    this.possession = team;
    this.shotClock = SHOT_CLOCK;
    this.lastPasser = null;
    const mates = this.teamPlayers(team);
    const opps = this.opponents(team);
    const inbounder = mates[ROLE_ORDER.indexOf('C')];
    inbounder.teleport(inboundSpot(team));
    inbounder.setPose('normal', 0);
    this.ball.state = { kind: 'held', holder: inbounder };
    this.ball.height = 4;
    for (const p of mates) {
      p.driveTimer = 0;
      p.cutting = false;
      if (p === inbounder) continue;
      const spot = p.slot === 0 ? inboundReceiveSpot(team) : offenseSpot(team, p.role);
      if (resetPositions) p.teleport(spot);
      p.target = spot;
      p.intent = '跑位';
    }
    for (const p of opps) {
      const spot = defenseHomeSpot(p.teamId, p.role);
      if (resetPositions) p.teleport(spot);
      p.target = spot;
      p.intent = '退防';
    }
  }

  private who(p: Player): string {
    return `${p.team.name} #${p.def.number} ${p.def.name}`;
  }

  private emit(text: string, float?: MatchEvent['float']): void {
    this.log.push(text);
    if (this.log.length > 60) this.log.shift();
    this.onEvent({ text, float });
  }

  clockText(): string {
    const s = Math.max(0, Math.ceil(this.clock));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `第${this.quarter}节 ${mm}:${ss.toString().padStart(2, '0')}`;
  }
}

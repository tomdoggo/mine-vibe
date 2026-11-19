import { MINUTES, type Match, type MatchSnapshot } from '../sim/Match';
import type { PlayerStats } from '../sim/Player';

/**
 * 回放时间线：每个比赛分钟开始时存一份完整快照（见 Match.snapshot）。
 * 模拟是可复现的（种子链 + 固定步长），所以“恢复第 k 分钟的快照再往前算”就能原样重放，
 * 不需要录任何帧。顺带把每分钟开始时的个人统计留下来，给折线图用。
 */
export class Timeline {
  readonly snapshots: (MatchSnapshot | null)[] = new Array(MINUTES).fill(null);
  /** 第 m 分钟开始时每名球员的统计（m = MINUTES 是终场），与 match.roster 同序 */
  readonly samples: (PlayerStats[] | null)[] = new Array(MINUTES + 1).fill(null);
  /** 每次新增样本 +1，折线图据此判断要不要重画 */
  version = 0;
  private readonly match: Match;

  constructor(match: Match) {
    this.match = match;
    match.onMinuteStart = (k) => this.record(k);
    // 第 0 分钟：构造完成的那一刻就是起点
    this.record(0);
  }

  /** 已经存了快照的分钟数（从 0 连续数） */
  get recordedMinutes(): number {
    let n = 0;
    while (n < MINUTES && this.snapshots[n]) n++;
    return n;
  }

  private record(k: number): void {
    // 回放重算时会再次经过同一个分钟边界：模拟可复现，快照一样，保留第一份即可
    if (this.snapshots[k]) return;
    const s = this.match.snapshot();
    this.snapshots[k] = s;
    // 折线图只画常规时间 40 分钟；加时的分钟只存快照（回放用），终场样本含加时
    if (k < MINUTES) this.samples[k] = s.players.map((p) => ({ ...p.stats }));
    this.version++;
  }

  /** 终场：补上最后一个样本点 */
  recordFinal(): void {
    if (this.samples[MINUTES]) return;
    this.samples[MINUTES] = this.match.roster.map((p) => ({ ...p.stats }));
    this.version++;
  }

  /**
   * 把比赛恢复到能覆盖比赛时间 t（秒）的最近一个分钟起点；之后由场景按固定步长快算到 t。
   * 返回 false 表示那一段还没播到、没有快照。
   */
  restoreFor(t: number): boolean {
    let k = Math.min(this.snapshots.length - 1, Math.max(0, Math.floor(t / 60)));
    while (k >= 0 && !this.snapshots[k]) k--;
    if (k < 0) return false;
    this.match.restore(this.snapshots[k]!);
    return true;
  }
}

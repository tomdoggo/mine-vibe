import { simulateGame, type Game, type GameResult } from './Season';

/**
 * 后台模拟：优先用多个 Web Worker 并行跑（每场比赛互相独立，结果只由种子决定），
 * 不支持 Worker 时退回主线程分帧跑。
 */
export class SimPool {
  private workers: Worker[] = [];
  private cancelled = false;

  constructor() {
    try {
      const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) {
        this.workers.push(new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }));
      }
    } catch {
      this.workers = [];
    }
  }

  get threads(): number {
    return Math.max(1, this.workers.length);
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 模拟一批比赛。nextBatch 每次返回当前可以开打的比赛（季后赛要等上一场结果才知道下一场），
   * 没有了就结束。每出一个结果调用 onResult。
   */
  async run(nextBatch: () => Game[], onResult: (g: Game, r: GameResult) => void): Promise<void> {
    this.cancelled = false;
    const running = new Set<number>();
    if (this.workers.length === 0) {
      for (let batch = nextBatch(); batch.length && !this.cancelled; batch = nextBatch()) {
        const g = batch[0];
        onResult(g, await this.mainThread(g));
      }
      return;
    }
    await new Promise<void>((resolve) => {
      const idle = [...this.workers];
      const pump = () => {
        if (this.cancelled) {
          if (running.size === 0) resolve();
          return;
        }
        const batch = nextBatch().filter((g) => !running.has(g.id));
        while (idle.length && batch.length) {
          const g = batch.shift()!;
          const w = idle.pop()!;
          running.add(g.id);
          w.onmessage = (e: MessageEvent<{ id: number; result: GameResult }>) => {
            running.delete(g.id);
            idle.push(w);
            if (!this.cancelled) onResult(g, e.data.result);
            pump();
          };
          w.postMessage({ game: g });
        }
        if (running.size === 0) resolve();
      };
      pump();
    });
  }

  /** 主线程分帧跑（每帧 30 毫秒） */
  private mainThread(g: Game): Promise<GameResult> {
    return new Promise((resolve) => {
      const it = simulateGame(g);
      it.next();
      const step = () => {
        const r = it.next(30);
        if (r.done) resolve(r.value);
        else setTimeout(step, 0);
      };
      step();
    });
  }
}

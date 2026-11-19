/// <reference lib="webworker" />
import { runGame, type Game, type GameResult } from './Season';

/** 后台模拟线程：收到一场比赛就跑到终场，把结果发回去。每个线程有自己的随机数状态，互不干扰 */
self.onmessage = (e: MessageEvent<{ game: Game }>) => {
  const result: GameResult = runGame(e.data.game);
  (self as unknown as Worker).postMessage({ id: e.data.game.id, result });
};

import type { GameResult } from './Season';

/** 比赛画面（Phaser）和赛季总览（HTML）之间的回调 */
export const seasonBridge = {
  /** 观看的比赛打完了 */
  report: (_gameId: number, _result: GameResult): void => {},
  /** 素材加载完成 */
  booted: (): void => {},
  /** 离开比赛画面 */
  exit: (): void => {},
};

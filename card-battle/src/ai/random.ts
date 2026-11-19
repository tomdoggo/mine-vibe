/** 随机 AI：当基线，用来验证启发式 AI 确实有用 */
import type { Action, Agent, ChoiceRequest, PlayerId } from '../types.ts';
import type { Game } from '../engine.ts';
import { makeRng } from '../rng.ts';

export class RandomAgent implements Agent {
  name: string;
  private rnd: () => number;
  constructor(name = '随机AI', seed = 1) {
    this.name = name;
    this.rnd = makeRng(seed);
  }

  chooseAction(_g: Game, _me: PlayerId, actions: Action[]): Action {
    const rest = actions.filter((a) => a.type !== 'end');
    if (!rest.length || this.rnd() < 0.15) return { type: 'end' };
    return rest[Math.floor(this.rnd() * rest.length)];
  }

  choose(_g: Game, _me: PlayerId, req: ChoiceRequest): number {
    return Math.floor(this.rnd() * req.options.length);
  }
}

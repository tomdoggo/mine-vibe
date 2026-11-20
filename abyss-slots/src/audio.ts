/** 全部音效用 WebAudio 现场合成，不需要音频文件 */
import { load, save } from './storage.ts';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = load('abyss-slots:muted') === '1';
let lastCoin = 0;

export const isMuted = () => muted;

export function setMuted(m: boolean) {
  muted = m;
  save('abyss-slots:muted', m ? '1' : '0');
  if (master) master.gain.value = m ? 0 : 0.5;
}

/** 浏览器要求必须在用户手势里启动音频，所以第一次点击时调用 */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  click: () => tone(520, 0.05, 'square', 0.08),
  spin: () => tone(140, 0.35, 'sawtooth', 0.12, 0, 420),
  reelStop: (col: number) => {
    tone(110 - col * 8, 0.12, 'square', 0.22, 0, 55);
    tone(900, 0.03, 'triangle', 0.1);
  },
  /** 金币叮当声：限流，避免上百枚同时落地时爆音 */
  coin: () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastCoin < 0.035) return;
    lastCoin = now;
    const f = 2400 + Math.random() * 1600;
    tone(f, 0.09, 'sine', 0.11);
    tone(f * 1.5, 0.06, 'sine', 0.05, 0.01);
  },
  insert: () => tone(1300, 0.05, 'triangle', 0.1, 0, 700),
  win: (big: boolean) => {
    const notes = big ? [523, 659, 784, 1047, 1319, 1568, 2093] : [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.085));
    if (big) tone(65, 0.9, 'sawtooth', 0.2, 0, 40);
  },
  lose: () => tone(160, 0.5, 'sawtooth', 0.14, 0, 60),
};

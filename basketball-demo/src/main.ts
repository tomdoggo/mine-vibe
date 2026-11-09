import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './config';
import { BootScene } from './scenes/BootScene';
import { MatchScene } from './scenes/MatchScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  // 不开 pixelArt：画布缩放时平滑，文字不锯齿；像素贴图单独设 NEAREST（BootScene）
  pixelArt: false,
  antialias: true,
  roundPixels: true,
  backgroundColor: '#141414',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MatchScene],
};

const game = new Phaser.Game(config);

if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

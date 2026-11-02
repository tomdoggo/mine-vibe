import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './config';
import { BootScene } from './scenes/BootScene';
import { BattleScene } from './scenes/BattleScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  // 画布按 RENDER_SCALE 倍分辨率渲染，相机再放大回逻辑坐标（见 ui/view.ts）
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  // 不开 pixelArt：最终画布缩放到窗口时用平滑插值，文字边缘才不会锯齿；
  // 像素画贴图单独设成 NEAREST（BootScene 加载完成后统一设置）
  pixelArt: false,
  antialias: true,
  roundPixels: true,
  backgroundColor: '#1a1a1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, BattleScene],
};

const game = new Phaser.Game(config);

// 开发模式下暴露实例，方便在控制台调试 / 手动步进
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

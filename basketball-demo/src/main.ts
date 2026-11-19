import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, SCENE } from './config';
import { BootScene } from './scenes/BootScene';
import { MatchScene } from './scenes/MatchScene';
import { seasonBridge } from './season/bridge';
import { SeasonView } from './ui/season/SeasonView';

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

// 赛季总览（HTML）盖在画布上；观看比赛时隐藏，回来再显示
const season = new SeasonView();
season.hide();
seasonBridge.booted = () => season.show();
seasonBridge.report = (id, r) => season.report(id, r);
seasonBridge.exit = () => season.show();
season.onWatch = (g) => {
  season.hide();
  game.scene.start(SCENE.MATCH, { game: g });
};

if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game; __season: SeasonView }).__game = game;
  (window as unknown as { __season: SeasonView }).__season = season;
}

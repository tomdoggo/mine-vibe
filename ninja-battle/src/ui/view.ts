import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';

/**
 * 画布是 RENDER_SCALE 倍分辨率，把场景主相机放大同样的倍数并对准逻辑画面中心，
 * 场景里的代码仍然按 GAME_WIDTH × GAME_HEIGHT 的逻辑坐标摆东西。每个场景 create 时调用一次。
 */
export function applyLogicalView(scene: Phaser.Scene): void {
  scene.cameras.main.setZoom(RENDER_SCALE).centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
}

/** 像素画贴图放大时保持硬边：所有已加载贴图改成最近邻采样（文字贴图是之后单独创建的，不受影响） */
export function usePixelArtFilters(scene: Phaser.Scene): void {
  scene.textures.each((t: Phaser.Textures.Texture) => t.setFilter(Phaser.Textures.FilterMode.NEAREST), scene);
}

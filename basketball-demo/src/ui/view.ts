import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';

/** 画布是 RENDER_SCALE 倍分辨率，把主相机放大同样倍数并对准逻辑画面中心 */
export function applyLogicalView(scene: Phaser.Scene): void {
  scene.cameras.main.setZoom(RENDER_SCALE).centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
}

/** 像素画贴图放大时保持硬边 */
export function usePixelArtFilters(scene: Phaser.Scene): void {
  scene.textures.each((t: Phaser.Textures.Texture) => t.setFilter(Phaser.Textures.FilterMode.NEAREST), scene);
}

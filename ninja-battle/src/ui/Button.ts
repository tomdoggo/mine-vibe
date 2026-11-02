import Phaser from 'phaser';
import { FONT, RENDER_SCALE } from '../config';

export interface UIButton {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  setEnabled(enabled: boolean): void;
}

const NORMAL = 0x3b3b4f;
const HOVER = 0x55557a;
const DISABLED = 0x2a2a30;

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onClick: () => void,
  fontSize = 12,
): UIButton {
  const bg = scene.add.rectangle(0, 0, w, h, NORMAL).setStrokeStyle(1, 0xdddddd);
  const label = scene.add
    .text(0, 0, text, textStyle(fontSize))
    .setOrigin(0.5);
  const container = scene.add.container(x, y, [bg, label]);

  let enabled = true;
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => enabled && bg.setFillStyle(HOVER));
  bg.on('pointerout', () => enabled && bg.setFillStyle(NORMAL));
  bg.on('pointerdown', () => enabled && onClick());

  return {
    container,
    bg,
    label,
    setEnabled(v: boolean) {
      enabled = v;
      bg.setFillStyle(v ? NORMAL : DISABLED);
      label.setAlpha(v ? 1 : 0.4);
    },
  };
}

/** 统一文字样式：resolution 跟渲染倍率一致，文字贴图按实际像素绘制，放大后不糊 */
export function textStyle(
  fontSize: number,
  color = '#ffffff',
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${fontSize}px`, color, resolution: RENDER_SCALE };
}

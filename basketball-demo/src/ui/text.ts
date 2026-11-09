import Phaser from 'phaser';
import { FONT, RENDER_SCALE } from '../config';

/** 统一文字样式：resolution 跟渲染倍率一致，放大后不糊 */
export function textStyle(fontSize: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${fontSize}px`, color, resolution: RENDER_SCALE };
}

export interface UIButton {
  container: Phaser.GameObjects.Container;
  setLabel(text: string): void;
  setActive(active: boolean): void;
}

const NORMAL = 0x3b3b4f;
const HOVER = 0x55557a;
const ACTIVE = 0x6a6aa0;

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onClick: () => void,
  fontSize = 10,
): UIButton {
  const bg = scene.add.rectangle(0, 0, w, h, NORMAL).setStrokeStyle(1, 0xdddddd);
  const label = scene.add.text(0, 0, text, textStyle(fontSize)).setOrigin(0.5);
  const container = scene.add.container(x, y, [bg, label]);
  let active = false;
  const base = () => (active ? ACTIVE : NORMAL);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setFillStyle(HOVER));
  bg.on('pointerout', () => bg.setFillStyle(base()));
  bg.on('pointerdown', () => onClick());
  return {
    container,
    setLabel: (t) => label.setText(t),
    setActive: (v) => {
      active = v;
      bg.setFillStyle(base());
    },
  };
}

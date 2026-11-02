import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SCENE } from '../config';
import { defaultBattleConfig } from '../data/units';
import {
  ANIM,
  ASSET_ROOT,
  CHARACTERS,
  CHAR_FRAME,
  FX_FRAMES,
  HORSES,
  HORSE_FRAME,
  TEX,
  WALK_FRAMES_RIGHT,
  WEAPONS,
} from '../data/sprites';
import { textStyle } from '../ui/Button';
import { applyLogicalView, usePixelArtFilters } from '../ui/view';

/**
 * 启动场景：加载 Ninja Adventure 素材并注册动画。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.BOOT);
  }

  preload(): void {
    applyLogicalView(this);
    const label = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '加载素材中 0%', textStyle(14, '#ffe9a8'))
      .setOrigin(0.5);
    this.load.on('progress', (v: number) => label.setText(`加载素材中 ${Math.round(v * 100)}%`));

    this.load.setPath(ASSET_ROOT);
    const charFrame = { frameWidth: CHAR_FRAME, frameHeight: CHAR_FRAME };
    for (const c of CHARACTERS) {
      this.load.spritesheet(TEX.walk(c), `chars/${c}/Walk.png`, charFrame);
      this.load.spritesheet(TEX.attack(c), `chars/${c}/Attack.png`, charFrame);
      this.load.image(TEX.dead(c), `chars/${c}/Dead.png`);
    }
    for (const h of HORSES) {
      this.load.spritesheet(TEX.horse(h), `horse/${h}.png`, {
        frameWidth: HORSE_FRAME.width,
        frameHeight: HORSE_FRAME.height,
      });
    }
    for (const w of WEAPONS) {
      this.load.image(TEX.weapon(w), `weapons/${w}.png`);
    }
    this.load.image(TEX.arrow, 'fx/arrow.png');
    this.load.spritesheet(TEX.slash, 'fx/slash.png', {
      frameWidth: FX_FRAMES.slash.width,
      frameHeight: FX_FRAMES.slash.height,
    });
    this.load.spritesheet(TEX.explosion, 'fx/explosion.png', {
      frameWidth: FX_FRAMES.explosion.width,
      frameHeight: FX_FRAMES.explosion.height,
    });
    this.load.spritesheet(TEX.heal, 'fx/heal.png', {
      frameWidth: FX_FRAMES.heal.width,
      frameHeight: FX_FRAMES.heal.height,
    });
    this.load.spritesheet(TEX.smoke, 'fx/smoke.png', {
      frameWidth: FX_FRAMES.smoke.width,
      frameHeight: FX_FRAMES.smoke.height,
    });
  }

  create(): void {
    usePixelArtFilters(this);
    for (const c of CHARACTERS) {
      this.anims.create({
        key: ANIM.walk(c),
        frames: this.anims.generateFrameNumbers(TEX.walk(c), { frames: WALK_FRAMES_RIGHT }),
        frameRate: 8,
        repeat: -1,
      });
    }
    for (const h of HORSES) {
      this.anims.create({
        key: ANIM.horseRun(h),
        frames: this.anims.generateFrameNumbers(TEX.horse(h), { start: 0, end: 1 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    const fx = [
      [ANIM.slash, TEX.slash, FX_FRAMES.slash],
      [ANIM.explosion, TEX.explosion, FX_FRAMES.explosion],
      [ANIM.heal, TEX.heal, FX_FRAMES.heal],
      [ANIM.smoke, TEX.smoke, FX_FRAMES.smoke],
    ] as const;
    for (const [key, tex, spec] of fx) {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(tex, { start: 0, end: spec.count - 1 }),
        frameRate: spec.rate,
        repeat: 0,
      });
    }

    this.scene.start(SCENE.BATTLE, defaultBattleConfig());
  }
}

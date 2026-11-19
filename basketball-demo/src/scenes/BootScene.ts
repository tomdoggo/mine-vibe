import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SCENE } from '../config';
import { TEAMS } from '../data/players';
import { PLAYERS } from '../season/db';
import { seasonBridge } from '../season/bridge';
import { ANIM, ASSET_ROOT, CHAR_FRAME, FACING_COL, TEX, WALK_ROWS, type Facing } from '../data/sprites';
import { textStyle } from '../ui/text';
import { applyLogicalView, usePixelArtFilters } from '../ui/view';

const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];

/** 启动场景：加载角色与篮球贴图，注册四方向行走动画 */
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
    for (const id of this.spriteIds()) {
      this.load.spritesheet(TEX.char(id), `chars/${id}.png`, { frameWidth: CHAR_FRAME, frameHeight: CHAR_FRAME });
    }
    this.load.image(TEX.ball, 'ball/basketball.png');
  }

  create(): void {
    this.children.removeAll(true);
    usePixelArtFilters(this);
    for (const id of this.spriteIds()) {
      for (const f of FACINGS) {
        this.anims.create({
          key: ANIM.walk(id, f),
          frames: WALK_ROWS.map((row) => ({ key: TEX.char(id), frame: row * 4 + FACING_COL[f] })),
          frameRate: 9,
          repeat: -1,
        });
      }
    }
    // 素材就绪：显示赛季总览（比赛画面由总览里的「观看」启动）
    seasonBridge.booted();
  }

  private spriteIds(): number[] {
    return Array.from(new Set([...Object.values(TEAMS).flatMap((t) => t.players.map((p) => p.sprite)), ...PLAYERS.map((p) => p.sprite)]));
  }
}

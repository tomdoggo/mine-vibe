import * as THREE from 'three';
import { CONFIG, type DollId } from '../game/config.ts';
import { dollCanvas } from './dollArt.ts';
import { TRAY } from './coins.ts';

const PER_SIDE = CONFIG.dollSlotsPerSide;
const SIZE = 0.66;
/** 台阶：越靠近机器越高，这样 5 个玩偶从正面看不会互相挡住 */
const STEP_H = 0.46;
const STEP_D = 0.7;
const BASE_H = 0.5;

interface Slot {
  pos: THREE.Vector3;
  sprite: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  doll: DollId | null;
  /** 触发 / 刚买时的跳动计时 */
  hop: number;
  seed: number;
}

/** 币盘两侧的玩偶台阶：左右各 5 个位置 */
export class Dolls {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private textures = new Map<DollId, THREE.Texture>();
  private time = 0;

  constructor() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x1c151b, metalness: 0.6, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x9a6a22, metalness: 1, roughness: 0.35 });
    const plane = new THREE.PlaneGeometry(SIZE, SIZE);
    // 摆放顺序：左右交替，从靠近玩家的最低一级往上摆
    for (let i = 0; i < PER_SIDE * 2; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const h = BASE_H + k * STEP_H;
      const x = side * (TRAY.x1 + 0.42);
      const z = TRAY.z1 - 0.3 - k * STEP_D;
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.72, h, STEP_D), stone);
      block.position.set(x, h / 2, z);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.05, STEP_D + 0.02), trim);
      cap.position.set(x, h, z);
      this.group.add(block, cap);

      const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const sprite = new THREE.Mesh(plane, mat);
      sprite.visible = false;
      const pos = new THREE.Vector3(x, h + 0.03 + SIZE / 2, z);
      sprite.position.copy(pos);
      // 左边的玩偶镜像一下，都朝向机器
      if (side < 0) sprite.scale.x = -1;
      this.group.add(sprite);
      this.slots.push({ pos, sprite, mat, doll: null, hop: 0, seed: i * 1.7 });
    }
  }

  private texture(id: DollId) {
    let t = this.textures.get(id);
    if (!t) {
      t = new THREE.CanvasTexture(dollCanvas(id));
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      this.textures.set(id, t);
    }
    return t;
  }

  /** 第 index 个位置的世界坐标（买玩偶时金币往这儿飞） */
  slotPos(index: number) {
    return this.slots[Math.min(index, this.slots.length - 1)].pos;
  }

  /** 按购买顺序把玩偶摆上去 */
  set(dolls: readonly DollId[]) {
    this.slots.forEach((s, i) => {
      const id = dolls[i] ?? null;
      if (id && s.doll !== id) {
        s.mat.map = this.texture(id);
        s.mat.needsUpdate = true;
        s.hop = 1;
      }
      s.doll = id;
      s.sprite.visible = id !== null;
    });
  }

  /** 玩偶效果触发：跳一下、闪一下 */
  trigger(id: DollId) {
    const s = this.slots.find((x) => x.doll === id);
    if (s) s.hop = 1;
  }

  update(dt: number) {
    this.time += dt;
    for (const s of this.slots) {
      if (!s.doll) continue;
      s.hop = Math.max(0, s.hop - dt * 1.6);
      const idle = Math.sin(this.time * 2.2 + s.seed) * 0.02;
      const jump = Math.abs(Math.sin(s.hop * Math.PI * 3)) * s.hop * 0.45;
      s.sprite.position.y = s.pos.y + idle + jump;
      s.mat.color.setScalar(1 + s.hop * 1.6);
    }
  }
}

import * as THREE from 'three';
import { CONFIG, type DollId } from '../game/config.ts';
import { dollGeometry, type DollGeometry } from './dollMesh.ts';
import { TRAY } from './coins.ts';

const PER_SIDE = CONFIG.dollSlotsPerSide;
const SIZE = 0.82;
/** 台阶：越靠近机器越高，这样 5 个玩偶从正面看不会互相挡住 */
const STEP_H = 0.72;
const STEP_D = 0.7;
const BASE_H = 0.5;
const STEP_W = 0.85;

interface Slot {
  /** 脚底的位置 */
  pos: THREE.Vector3;
  side: number;
  holder: THREE.Group;
  body: THREE.Mesh;
  outline: THREE.Mesh;
  doll: DollId | null;
  /** 触发 / 刚拿到时的跳动计时 */
  hop: number;
  seed: number;
}

/** 币盘两侧的玩偶台阶：左右各 5 个位置，玩偶是体素模型 */
export class Dolls {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private geometries = new Map<string, DollGeometry>();
  private time = 0;

  /** layer：玩偶画在哪一层（高清层，体素的棱角才锐利） */
  constructor(layer: number) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x1c151b, metalness: 0.6, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x9a6a22, metalness: 1, roughness: 0.35 });
    const bodyMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
    const outlineMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false, side: THREE.BackSide });
    const empty = new THREE.BufferGeometry();
    // 摆放顺序：左右交替，从靠近玩家的最低一级往上摆
    for (let i = 0; i < PER_SIDE * 2; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const h = BASE_H + k * STEP_H;
      const x = side * (TRAY.x1 + 0.03 + STEP_W / 2);
      const z = TRAY.z1 - 0.3 - k * STEP_D;
      const block = new THREE.Mesh(new THREE.BoxGeometry(STEP_W, h, STEP_D), stone);
      block.position.set(x, h / 2, z);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(STEP_W + 0.04, 0.05, STEP_D + 0.02), trim);
      cap.position.set(x, h, z);
      this.group.add(block, cap);

      const holder = new THREE.Group();
      const body = new THREE.Mesh(empty, bodyMat);
      const outline = new THREE.Mesh(empty, outlineMat);
      body.layers.set(layer);
      outline.layers.set(layer);
      holder.add(outline, body);
      holder.visible = false;
      const pos = new THREE.Vector3(x, h + 0.04, z);
      holder.position.copy(pos);
      holder.scale.setScalar(SIZE);
      this.group.add(holder);
      this.slots.push({ pos, side, holder, body, outline, doll: null, hop: 0, seed: i * 1.7 });
    }
  }

  private geometry(id: DollId, mirror: boolean) {
    const k = `${id}:${mirror}`;
    let g = this.geometries.get(k);
    if (!g) this.geometries.set(k, (g = dollGeometry(id, mirror)));
    return g;
  }

  /** 第 index 个位置的世界坐标 */
  slotPos(index: number) {
    return this.slots[Math.min(index, this.slots.length - 1)].pos;
  }

  /** 按拿到的顺序把玩偶摆上去 */
  set(dolls: readonly DollId[]) {
    this.slots.forEach((s, i) => {
      const id = dolls[i] ?? null;
      if (id && s.doll !== id) {
        // 像素画默认朝右，右边台阶上的要镜像过来，都面朝机器
        const g = this.geometry(id, s.side > 0);
        s.body.geometry = g.body;
        s.outline.geometry = g.outline;
        s.hop = 1;
      }
      s.doll = id;
      s.holder.visible = id !== null;
    });
  }

  /** 射线点中了哪个玩偶 */
  pick(ray: THREE.Raycaster): DollId | null {
    const hit = ray.intersectObjects(this.slots.filter((s) => s.doll).map((s) => s.body))[0];
    return hit ? this.slots.find((s) => s.body === hit.object)!.doll : null;
  }

  /** 玩偶效果触发：跳一下、转一圈 */
  trigger(id: DollId) {
    const s = this.slots.find((x) => x.doll === id);
    if (s) s.hop = 1;
  }

  update(dt: number) {
    this.time += dt;
    for (const s of this.slots) {
      if (!s.doll) continue;
      s.hop = Math.max(0, s.hop - dt * 1.6);
      const jump = Math.abs(Math.sin(s.hop * Math.PI * 3)) * s.hop * 0.45;
      s.holder.position.y = s.pos.y + jump;
      // 平时微微侧身朝向机器并左右晃，看得出是立体的；触发时原地转一圈
      s.holder.rotation.y = -s.side * 0.45 + Math.sin(this.time * 1.3 + s.seed) * 0.22 + s.hop * s.hop * Math.PI * 2;
      s.holder.scale.setScalar(SIZE * (1 + s.hop * 0.25));
    }
  }
}

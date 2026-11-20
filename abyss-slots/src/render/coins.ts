import * as THREE from 'three';
import { coinFaceTexture } from './symbols.ts';

/**
 * 金币系统：喷出 → 抛物线飞行 → 弹跳 → 落进币盘堆成山。
 *
 * 没有用通用物理引擎：几千枚圆柱体互相碰撞在手机上扛不住。
 * 飞行阶段是简单的抛物线，落地后按“沙堆模型”找位置——
 * 币盘划成网格，每格记一摞金币，哪格比邻居高太多就往低处滑，自然堆出一座山。
 */
const RADIUS = 0.17;
const THICK = 0.05;
const GRAVITY = -15;

/** 币盘范围（世界坐标） */
export const TRAY = { x0: -1.95, x1: 1.95, z0: 0.45, z1: 3.85 };
const NX = 13;
const NZ = 11;
const CX = (TRAY.x1 - TRAY.x0) / NX;
const CZ = (TRAY.z1 - TRAY.z0) / NZ;
/** 相邻两格最多差几枚，决定山有多陡 */
const SLOPE = 5;

/** 币盘里最多堆多少枚（再多只涨数字，不再加模型） */
const PILE_CAP = 2600;
const FLY_CAP = 700;
const TOTAL = PILE_CAP + FLY_CAP;

const FLY = 0, SETTLE = 1, SUCK = 2;

interface Mover {
  id: number;
  mode: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  bounces: number;
  value: number;
  t: number;
  dur: number;
  delay: number;
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  toPos: THREE.Vector3;
  toQuat: THREE.Quaternion;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _up = new THREE.Vector3(0, 1, 0);

export class CoinPile {
  readonly mesh: THREE.InstancedMesh;
  /** 一枚金币落进币盘时触发（value = 它代表多少金币） */
  onLand: (value: number) => void = () => {};
  /** 一枚金币被投进机器时触发 */
  onInsert: () => void = () => {};

  private cells: number[][] = Array.from({ length: NX * NZ }, () => []);
  private free: number[] = [];
  private movers: Mover[] = [];
  private queue: { at: number; run: () => void }[] = [];
  private clock = 0;
  private piled = 0;
  /** 已落定金币的位置 / 朝向，取走时要用 */
  private restPos = new Float32Array(TOTAL * 3);
  private restQuat = new Float32Array(TOTAL * 4);

  constructor() {
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, THICK, 18, 1);
    const face = coinFaceTexture();
    const gold = { color: 0xffbf3a, metalness: 1, roughness: 0.28, envMapIntensity: 1.5 };
    const side = new THREE.MeshStandardMaterial({ ...gold, color: 0xd9962a });
    const cap = new THREE.MeshStandardMaterial({ ...gold, map: face });
    this.mesh = new THREE.InstancedMesh(geo, [side, cap, cap], TOTAL);
    this.mesh.frustumCulled = false;
    this.reset();
  }

  /** 币盘里（含正在落定的）金币模型数 */
  get count() {
    return this.piled;
  }

  /** 还有金币在天上飞 / 排队等着喷吗 */
  get busy() {
    return this.queue.length > 0 || this.movers.some((m) => m.mode !== SETTLE);
  }

  reset() {
    this.cells.forEach((c) => (c.length = 0));
    this.movers.length = 0;
    this.queue.length = 0;
    this.piled = 0;
    this.free = Array.from({ length: TOTAL }, (_, i) => TOTAL - 1 - i);
    for (let i = 0; i < TOTAL; i++) this.mesh.setMatrixAt(i, _zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 延迟执行（跟着金币系统自己的时钟走，暂停 / 掉帧时不会乱） */
  later(delay: number, run: () => void) {
    this.queue.push({ at: this.clock + delay, run });
  }

  /** 立刻抛出一枚金币 */
  launch(pos: THREE.Vector3, vel: THREE.Vector3, value: number) {
    const id = this.free.pop();
    if (id === undefined) {
      this.onLand(value); // 模型用完了：数字照涨
      return;
    }
    this.movers.push({
      id, mode: FLY, pos: pos.clone(), vel: vel.clone(),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))),
      axis: new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize(),
      spin: rand(8, 20), bounces: 0, value, t: 0, dur: 0, delay: 0,
      fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(),
      toPos: new THREE.Vector3(), toQuat: new THREE.Quaternion(),
    });
  }

  /**
   * 从出币口喷 n 枚金币，在 duration 秒内喷完。
   * values[i] 是第 i 枚代表的金币数（大奖时一枚模型可能代表好几枚）。
   */
  fountain(mouth: THREE.Vector3, values: number[], duration: number, power = 1) {
    values.forEach((value, i) => {
      this.later((i / Math.max(1, values.length)) * duration, () => {
        _v.set(mouth.x + rand(-0.55, 0.55), mouth.y + rand(-0.05, 0.05), mouth.z);
        this.launch(_v, new THREE.Vector3(rand(-1.5, 1.5), rand(3, 6.2) * power, rand(1.0, 3.6)), value);
      });
    });
  }

  /** 从天上往币盘里下金币雨 */
  rain(values: number[], duration: number) {
    values.forEach((value, i) => {
      this.later((i / Math.max(1, values.length)) * duration, () => {
        _v.set(rand(TRAY.x0 + 0.3, TRAY.x1 - 0.3), rand(8, 10), rand(TRAY.z0 + 0.3, TRAY.z1 - 0.4));
        this.launch(_v, new THREE.Vector3(rand(-0.4, 0.4), rand(-3, 0), rand(-0.3, 0.3)), value);
      });
    });
  }

  /** 从金币山顶上拿走 n 枚，飞进机器的投币口 */
  take(n: number, slot: THREE.Vector3) {
    for (let k = 0; k < n; k++) {
      // 从最高的几摞里随机挑一摞，取最上面那枚
      let best = -1, bestH = 0;
      for (let i = 0; i < this.cells.length; i++) {
        const h = this.cells[i].length + Math.random() * 1.5;
        if (this.cells[i].length > 0 && h > bestH) { bestH = h; best = i; }
      }
      if (best < 0) return;
      const id = this.cells[best].pop()!;
      this.piled--;
      // 这枚可能还在“落定”动画里，先把它从动画列表摘掉
      const i = this.movers.findIndex((m) => m.id === id);
      if (i >= 0) this.movers.splice(i, 1);
      const from = new THREE.Vector3().fromArray(this.restPos, id * 3);
      const fromQuat = new THREE.Quaternion().fromArray(this.restQuat, id * 4);
      this.movers.push({
        id, mode: SUCK, pos: from.clone(), vel: new THREE.Vector3(), quat: fromQuat.clone(),
        axis: new THREE.Vector3(1, 0, 0), spin: 14, bounces: 0, value: 0,
        t: 0, dur: 0.42, delay: k * 0.05,
        fromPos: from, fromQuat, toPos: slot.clone(),
        toQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 2)),
      });
    }
  }

  private cellAt(x: number, z: number) {
    const ix = Math.max(0, Math.min(NX - 1, Math.floor((x - TRAY.x0) / CX)));
    const iz = Math.max(0, Math.min(NZ - 1, Math.floor((z - TRAY.z0) / CZ)));
    return iz * NX + ix;
  }

  private heightAt(x: number, z: number) {
    return this.cells[this.cellAt(x, z)].length * THICK;
  }

  /** 沙堆规则：比某个邻居高出太多，就往最低的邻居那边滑 */
  private relax(cell: number) {
    for (let guard = 0; guard < 24; guard++) {
      const ix = cell % NX, iz = Math.floor(cell / NX);
      const h = this.cells[cell].length;
      let low = -1, lowH = h - SLOPE + 1;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jx >= NX || jz < 0 || jz >= NZ) continue;
          const n = jz * NX + jx;
          const nh = this.cells[n].length + Math.random() * 0.9;
          if (nh < lowH) { lowH = nh; low = n; }
        }
      }
      if (low < 0) return cell;
      cell = low;
    }
    return cell;
  }

  private settle(m: Mover) {
    this.onLand(m.value);
    if (this.piled >= PILE_CAP) {
      // 币盘满了：这枚直接沉进金币山里
      this.release(m.id);
      return false;
    }
    const cell = this.relax(this.cellAt(m.pos.x, m.pos.z));
    const stack = this.cells[cell];
    stack.push(m.id);
    this.piled++;
    const ix = cell % NX, iz = Math.floor(cell / NX);
    m.toPos.set(
      TRAY.x0 + (ix + 0.5) * CX + rand(-0.1, 0.1),
      (stack.length - 0.5) * THICK + 0.01,
      TRAY.z0 + (iz + 0.5) * CZ + rand(-0.1, 0.1),
    );
    m.toQuat.setFromEuler(new THREE.Euler(rand(-0.22, 0.22), rand(0, Math.PI * 2), rand(-0.22, 0.22)));
    m.toPos.toArray(this.restPos, m.id * 3);
    m.toQuat.toArray(this.restQuat, m.id * 4);
    m.fromPos.copy(m.pos);
    m.fromQuat.copy(m.quat);
    m.mode = SETTLE;
    m.t = 0;
    m.dur = 0.16;
    // 大奖时一枚模型代表好几枚金币：多出来的直接垒在落点附近，金币山的规模才跟得上数字
    for (let k = 1; k < m.value && this.piled < PILE_CAP; k++) {
      const id = this.free.pop();
      if (id === undefined) break;
      this.place(id, this.relax(cell));
    }
    return true;
  }

  /** 不播动画，直接把一枚金币放到某一摞的最上面 */
  private place(id: number, cell: number) {
    const stack = this.cells[cell];
    stack.push(id);
    this.piled++;
    _v.set(
      TRAY.x0 + ((cell % NX) + 0.5) * CX + rand(-0.1, 0.1),
      (stack.length - 0.5) * THICK + 0.01,
      TRAY.z0 + (Math.floor(cell / NX) + 0.5) * CZ + rand(-0.1, 0.1),
    );
    _q.setFromEuler(new THREE.Euler(rand(-0.22, 0.22), rand(0, Math.PI * 2), rand(-0.22, 0.22)));
    _v.toArray(this.restPos, id * 3);
    _q.toArray(this.restQuat, id * 4);
    this.mesh.setMatrixAt(id, _m.compose(_v, _q, _one));
  }

  private release(id: number) {
    this.mesh.setMatrixAt(id, _zero);
    this.free.push(id);
  }

  update(dt: number) {
    this.clock += dt;
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= this.clock);
      if (due.length) {
        this.queue = this.queue.filter((q) => q.at > this.clock);
        for (const q of due) q.run();
      }
    }
    if (!this.movers.length) return;

    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      let alive = true;
      if (m.mode === FLY) {
        m.vel.y += GRAVITY * dt;
        m.pos.addScaledVector(m.vel, dt);
        // 币盘四壁
        if (m.pos.x < TRAY.x0 + RADIUS) { m.pos.x = TRAY.x0 + RADIUS; m.vel.x = Math.abs(m.vel.x) * 0.4; }
        if (m.pos.x > TRAY.x1 - RADIUS) { m.pos.x = TRAY.x1 - RADIUS; m.vel.x = -Math.abs(m.vel.x) * 0.4; }
        if (m.pos.z < TRAY.z0 + RADIUS) { m.pos.z = TRAY.z0 + RADIUS; m.vel.z = Math.abs(m.vel.z) * 0.4; }
        if (m.pos.z > TRAY.z1 - RADIUS) { m.pos.z = TRAY.z1 - RADIUS; m.vel.z = -Math.abs(m.vel.z) * 0.4; }
        _q.setFromAxisAngle(m.axis, m.spin * dt);
        m.quat.premultiply(_q);
        const ground = this.heightAt(m.pos.x, m.pos.z) + RADIUS * 0.5;
        if (m.pos.y <= ground && m.vel.y < 0) {
          m.pos.y = ground;
          if (m.bounces < 2 && m.vel.y < -3) {
            // 弹一下，顺便往旁边溅开
            m.bounces++;
            m.vel.y *= -rand(0.28, 0.42);
            m.vel.x = m.vel.x * 0.5 + rand(-0.9, 0.9);
            m.vel.z = m.vel.z * 0.5 + rand(-0.9, 0.9);
            m.spin *= 0.7;
          } else {
            alive = this.settle(m);
          }
        }
      } else if (m.mode === SETTLE) {
        m.t += dt;
        const k = Math.min(1, m.t / m.dur);
        m.pos.lerpVectors(m.fromPos, m.toPos, k);
        m.quat.slerpQuaternions(m.fromQuat, m.toQuat, k);
        if (k >= 1) {
          this.movers.splice(i, 1);
          alive = false;
          this.mesh.setMatrixAt(m.id, _m.compose(m.pos, m.quat, _one));
        }
      } else {
        // SUCK：沿一条拱起来的弧线飞进投币口
        if (m.delay > 0) {
          m.delay -= dt;
        } else {
          m.t += dt;
          const k = Math.min(1, m.t / m.dur);
          const e = k * k;
          m.pos.lerpVectors(m.fromPos, m.toPos, e);
          m.pos.y += Math.sin(k * Math.PI) * 1.4;
          m.quat.slerpQuaternions(m.fromQuat, m.toQuat, k);
          _q.setFromAxisAngle(_up, m.spin * m.t);
          m.quat.multiply(_q);
          if (k >= 1) {
            this.movers.splice(i, 1);
            this.release(m.id);
            this.onInsert();
            alive = false;
          }
        }
      }
      if (alive) this.mesh.setMatrixAt(m.id, _m.compose(m.pos, m.quat, _one));
      else if (m.mode === FLY) this.movers.splice(i, 1);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

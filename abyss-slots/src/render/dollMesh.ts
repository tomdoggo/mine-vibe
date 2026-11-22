import * as THREE from 'three';
import type { DollId } from '../game/config.ts';
import { ART_SIZE, dollPixels } from './dollArt.ts';

/**
 * 把 12×12 的像素画挤成体素模型：
 * 越靠近轮廓中心的像素挤得越厚（边缘 2 格、往里 4 格、最里 6 格），所以身体是鼓的、四肢是细的，
 * 而不是一块等厚的饼干。光照直接烘进顶点颜色（顶面亮、侧面暗），不依赖场景里昏暗的灯。
 */

const MAX_DEPTH = 3;
const OUTLINE = new THREE.Color('#f4efe0');

/** 六个面：法线方向、四个角（逆时针，朝外）、明暗系数 */
const FACES: { n: [number, number, number]; c: [number, number, number][]; shade: number }[] = [
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 1 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.5 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.18 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.78 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.66 },
];

type Voxels = Map<string, THREE.Color>;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** 每个像素离轮廓边缘有几格（1 = 就在边上） */
function edgeDistance(solid: boolean[][]): number[][] {
  const dist: number[][] = solid.map((row) => row.map((s) => (s ? MAX_DEPTH : 0)));
  const at = (x: number, y: number) => (solid[y]?.[x] ? dist[y][x] : 0);
  for (let pass = 1; pass < MAX_DEPTH; pass++) {
    for (let y = 0; y < ART_SIZE; y++) {
      for (let x = 0; x < ART_SIZE; x++) {
        if (!solid[y][x]) continue;
        dist[y][x] = Math.min(dist[y][x], Math.min(at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)) + 1);
      }
    }
  }
  return dist;
}

function toGeometry(vox: Voxels): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (const [k, color] of vox) {
    const [x, y, z] = k.split(',').map(Number);
    for (const f of FACES) {
      if (vox.has(key(x + f.n[0], y + f.n[1], z + f.n[2]))) continue;
      const base = pos.length / 3;
      for (const [dx, dy, dz] of f.c) {
        pos.push(x + dx, y + dy, z + dz);
        c.copy(color).multiplyScalar(f.shade);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  // 原点挪到脚底中心，一个体素缩成 1/12，整只玩偶高度正好是 1
  geo.translate(-ART_SIZE / 2, 0, 0);
  geo.scale(1 / ART_SIZE, 1 / ART_SIZE, 1 / ART_SIZE);
  return geo;
}

export interface DollGeometry {
  body: THREE.BufferGeometry;
  /** 往外胖一圈的壳，只画背面，就成了一圈描边 */
  outline: THREE.BufferGeometry;
}

/** mirror：左右镜像（左边台阶上的玩偶要面朝机器） */
export function dollGeometry(id: DollId, mirror: boolean): DollGeometry {
  const pixels = dollPixels(id).map((row) => (mirror ? [...row].reverse() : row));
  const solid = pixels.map((row) => row.map((p) => p !== null));
  const dist = edgeDistance(solid);
  const body: Voxels = new Map();
  const shell: Voxels = new Map();
  for (let py = 0; py < ART_SIZE; py++) {
    for (let x = 0; x < ART_SIZE; x++) {
      const color = pixels[py][x];
      if (!color) continue;
      const y = ART_SIZE - 1 - py;
      const d = dist[py][x];
      const c = new THREE.Color(color);
      for (let z = -d; z < d; z++) {
        body.set(key(x, y, z), c);
        // 描边壳：上下左右前后各胖一格
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          shell.set(key(x + dx, y + dy, z + dz), OUTLINE);
        }
      }
    }
  }
  return { body: toGeometry(body), outline: toGeometry(shell) };
}

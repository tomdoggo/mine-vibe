import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CoinPile, TRAY } from './coins.ts';
import { REEL_GAP, Reels } from './reels.ts';
import { signTexture, windowShadeTexture } from './symbols.ts';

/** 滚轮窗口中心的高度 */
const WIN_Y = 3.4;
const WIN_HALF_W = REEL_GAP * 1.5;
const WIN_HALF_H = 1.4;
const BODY_HALF_W = 2.35;
const BODY_DEPTH = 4.3;
const FRONT_Z = 0.3;

/** 出币口 / 投币口（世界坐标） */
export const MOUTH = new THREE.Vector3(0, 1.05, 0.5);
export const SLOT = new THREE.Vector3(2.03, WIN_Y, 0.4);

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  readonly reels: Reels;
  readonly coins = new CoinPile();

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private candles: { light: THREE.PointLight; flame: THREE.Mesh; seed: number }[] = [];
  private mouthGlow: THREE.MeshBasicMaterial;
  private mouthLight: THREE.PointLight;
  private gem: THREE.Mesh;
  private embers: THREE.Points;
  private time = 0;
  private shake = 0;
  private flash = 0;
  private camBase = new THREE.Vector3();

  private readonly host: HTMLElement;

  constructor(host: HTMLElement, onReelStop: (col: number) => void) {
    this.host = host;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = this.scene;
    scene.background = new THREE.Color(0x050308);
    scene.fog = new THREE.FogExp2(0x0a0410, 0.035);
    // 金属材质必须有环境反射才不会一片死黑
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;

    this.reels = new Reels(onReelStop);
    this.reels.group.position.set(0, WIN_Y, 0);
    scene.add(this.reels.group);
    scene.add(this.coins.mesh);

    const iron = new THREE.MeshStandardMaterial({ color: 0x1c151b, metalness: 0.85, roughness: 0.5 });
    const ironDark = new THREE.MeshStandardMaterial({ color: 0x0c090c, metalness: 0.6, roughness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x9a6a22, metalness: 1, roughness: 0.32 });
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      scene.add(m);
      return m;
    };

    /* ---------- 机身：围着滚轮窗口拼一圈 ---------- */
    const midZ = FRONT_Z - BODY_DEPTH / 2;
    const pillarW = BODY_HALF_W - WIN_HALF_W;
    const winTop = WIN_Y + WIN_HALF_H, winBot = WIN_Y - WIN_HALF_H;
    for (const s of [-1, 1]) {
      box(pillarW, WIN_HALF_H * 2, BODY_DEPTH, iron, s * (WIN_HALF_W + pillarW / 2), WIN_Y, midZ);
      // 窗口两侧的铜包边
      box(0.07, WIN_HALF_H * 2, 0.1, brass, s * (WIN_HALF_W + 0.035), WIN_Y, FRONT_Z + 0.02);
      // 滚轮之间的隔条
      box(0.14, WIN_HALF_H * 2, 0.2, ironDark, s * REEL_GAP * 0.5, WIN_Y, 0.12);
    }
    box(BODY_HALF_W * 2, 1.0, BODY_DEPTH, iron, 0, winTop + 0.5, midZ);
    box(BODY_HALF_W * 2, winBot, BODY_DEPTH, iron, 0, winBot / 2, midZ);
    box(WIN_HALF_W * 2 + 0.14, 0.07, 0.1, brass, 0, winTop + 0.035, FRONT_Z + 0.02);
    box(WIN_HALF_W * 2 + 0.14, 0.07, 0.1, brass, 0, winBot - 0.035, FRONT_Z + 0.02);
    box(BODY_HALF_W * 2 + 0.2, 0.12, BODY_DEPTH + 0.2, brass, 0, winTop + 1.06, midZ);

    // 窗口上的曲面暗角
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(WIN_HALF_W * 2, WIN_HALF_H * 2),
      new THREE.MeshBasicMaterial({ map: windowShadeTexture(), transparent: true, depthWrite: false }),
    );
    shade.position.set(0, WIN_Y, 0.06);
    scene.add(shade);

    // 招牌
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.68),
      new THREE.MeshBasicMaterial({ map: signTexture(), color: new THREE.Color(1.5, 1.5, 1.5) }),
    );
    sign.position.set(0, winTop + 0.5, FRONT_Z + 0.01);
    scene.add(sign);

    // 顶上的拱形山花 + 血宝石
    const arch = new THREE.Shape();
    arch.moveTo(-BODY_HALF_W, 0);
    arch.lineTo(BODY_HALF_W, 0);
    arch.absellipse(0, 0, BODY_HALF_W, 1.0, 0, Math.PI, false);
    const pediment = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 1.2, bevelEnabled: false }), iron);
    pediment.position.set(0, winTop + 1.12, FRONT_Z - 1.2);
    scene.add(pediment);
    this.gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshStandardMaterial({
        color: 0x5a0008, emissive: 0xff0a1e, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.15,
      }),
    );
    this.gem.position.set(0, winTop + 1.6, FRONT_Z + 0.12);
    this.gem.scale.set(1, 1.35, 0.6);
    scene.add(this.gem);

    // 投币口（右侧立柱上一道发红的缝）
    box(0.34, 0.62, 0.08, brass, SLOT.x, SLOT.y, FRONT_Z + 0.02);
    box(0.07, 0.4, 0.1, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.25, 0.1) }), SLOT.x, SLOT.y, FRONT_Z + 0.03);

    // 出币口
    box(2.5, 0.62, 0.1, brass, 0, MOUTH.y, FRONT_Z + 0.02);
    this.mouthGlow = new THREE.MeshBasicMaterial({ color: 0x000000 });
    box(2.3, 0.42, 0.12, this.mouthGlow, 0, MOUTH.y, FRONT_Z + 0.03);
    this.mouthLight = new THREE.PointLight(0xff8a2a, 0, 7, 1.6);
    this.mouthLight.position.set(0, MOUTH.y + 0.1, MOUTH.z + 0.5);
    scene.add(this.mouthLight);

    /* ---------- 币盘 ---------- */
    const trayW = TRAY.x1 - TRAY.x0, trayD = TRAY.z1 - FRONT_Z;
    const felt = new THREE.MeshStandardMaterial({ color: 0x1a0509, metalness: 0, roughness: 0.95 });
    box(trayW + 0.3, 0.1, trayD + 0.15, felt, 0, -0.05, FRONT_Z + trayD / 2);
    for (const s of [-1, 1]) {
      box(0.15, 0.5, trayD + 0.15, iron, s * (TRAY.x1 + 0.075), 0.2, FRONT_Z + trayD / 2);
      box(0.19, 0.06, trayD + 0.19, brass, s * (TRAY.x1 + 0.075), 0.47, FRONT_Z + trayD / 2);
    }
    box(trayW + 0.3, 0.3, 0.15, iron, 0, 0.1, TRAY.z1 + 0.075);
    box(trayW + 0.34, 0.06, 0.19, brass, 0, 0.27, TRAY.z1 + 0.075);

    // 地面
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 48),
      new THREE.MeshStandardMaterial({ color: 0x0b070c, metalness: 0.2, roughness: 0.75 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    scene.add(ground);

    /* ---------- 灯光 ---------- */
    scene.add(new THREE.HemisphereLight(0x5a3a7a, 0x120608, 0.55));
    const key = new THREE.SpotLight(0xffd9a0, 90, 22, 0.62, 0.7, 1.6);
    key.position.set(1.5, 9, 6.5);
    key.target.position.set(0, 0.6, 2);
    scene.add(key, key.target);
    const rim = new THREE.PointLight(0x7a1aff, 26, 16, 1.6);
    rim.position.set(-4.5, 5, 2);
    scene.add(rim);
    const blood = new THREE.PointLight(0xff1a2a, 18, 14, 1.6);
    blood.position.set(4.5, 2.5, 3);
    scene.add(blood);

    // 机顶两支蜡烛
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8cdb0, roughness: 0.7, emissive: 0x3a1c08 });
    for (const s of [-1, 1]) {
      const x = s * 1.85, y = winTop + 1.12, z = FRONT_Z - 0.35;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.7, 12), wax);
      stick.position.set(x, y + 0.35, z);
      scene.add(stick);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5) }),
      );
      flame.scale.set(1, 1.9, 1);
      flame.position.set(x, y + 0.86, z);
      scene.add(flame);
      const light = new THREE.PointLight(0xff8a30, 7, 9, 1.8);
      light.position.set(x, y + 1.0, z + 0.5);
      scene.add(light);
      this.candles.push({ light, flame, seed: s * 3.1 });
    }

    // 空中飘的余烬
    const N = 90;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8 + 1;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(
      emberGeo,
      new THREE.PointsMaterial({
        color: new THREE.Color(2.4, 0.8, 0.2), size: 0.05, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    scene.add(this.embers);

    /* ---------- 后期：泛光 ---------- */
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const cam = this.camera;
    cam.aspect = w / h;
    // 竖屏为主：保证机器的宽度永远塞得进屏幕，屏幕越窄相机拉得越远
    const target = new THREE.Vector3(0, 2.75, 1.2);
    // 底部约 170px 被操作面板盖住，算高度时要把这部分刨掉（矮屏幕 / 横屏时由高度决定距离）
    const halfW = 2.7, halfH = 4.3 / Math.max(0.5, (h - 170) / h);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.max(halfW / (tanV * cam.aspect), halfH / tanV);
    const dir = new THREE.Vector3(0, 0.3, 1).normalize();
    this.camBase.copy(target).addScaledVector(dir, dist);
    cam.position.copy(this.camBase);
    cam.lookAt(target);
    // 把画面整体往上挪一点，给操作面板让位
    cam.setViewOffset(w, h, 0, 62, w, h);
    cam.updateProjectionMatrix();
  }

  /** 震屏 + 机器闪光（大奖用） */
  punch(shake: number, flash: number) {
    this.shake = Math.max(this.shake, shake);
    this.flash = Math.max(this.flash, flash);
  }

  /** 出币口亮起（正在吐币时保持调用） */
  glowMouth(v: number) {
    this.flash = Math.max(this.flash, v);
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    this.reels.update(dt);
    this.coins.update(dt);

    for (const c of this.candles) {
      const f = 0.8 + 0.2 * Math.sin(t * 11 + c.seed) * Math.sin(t * 7.3 + c.seed * 2) + 0.08 * Math.sin(t * 31 + c.seed);
      c.light.intensity = 7 * f;
      c.flame.scale.set(1, 1.9 * (0.9 + 0.2 * f), 1);
    }
    this.gem.rotation.y = t * 0.8;
    (this.gem.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8 + Math.sin(t * 2) * 0.5 + this.flash * 4;

    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.mouthGlow.color.setRGB(2.6 * this.flash, 1.1 * this.flash, 0.2 * this.flash);
    this.mouthLight.intensity = this.flash * 22;
    this.bloom.strength = 0.55 + this.flash * 0.3;

    const p = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + dt * (0.25 + (i % 5) * 0.06);
      if (y > 10) y = 0;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(t * 0.7 + i) * dt * 0.12);
    }
    p.needsUpdate = true;

    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake * 0.22;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 61) * s,
      this.camBase.y + Math.sin(t * 47 + 1) * s,
      this.camBase.z,
    );
    this.composer.render();
  }
}

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { DollId, SymbolId } from '../game/config.ts';
import { CoinPile, TRAY } from './coins.ts';
import { Dolls } from './dolls.ts';
import { DISPLAY_WIDTH, Displays } from './displays.ts';
import { REEL_GAP, Reels } from './reels.ts';
import { windowShadeTexture } from './symbols.ts';

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

/**
 * 像素风：机器和场景只渲染这么多行像素，再用最近邻放大到屏幕。
 * 金币例外——它们在放大后的画面上按屏幕原生分辨率再画一遍（靠低清那一遍的深度图做遮挡），
 * 所以金币是高清的，其余是像素块。
 */
const PIXEL_ROWS = 400;
/** 高清层：金币、玩偶、机台上的显示屏 */
const COIN_LAYER = 1;
/** 滚轮窗口上方那块面板的高度（放状态栏和赔率表） */
const TOP_H = 2.4;

export type Pick = { kind: 'doll'; id: DollId } | { kind: 'symbol'; id: SymbolId };

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  readonly reels: Reels;
  readonly coins = new CoinPile();
  readonly dolls = new Dolls(COIN_LAYER);
  readonly displays = new Displays(COIN_LAYER);

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private depthTarget: THREE.WebGLRenderTarget;
  private blit: FullScreenQuad;
  private insets = { top: 0, bottom: 170 };
  private bloodLight!: THREE.PointLight;
  private abyss = 1;
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
    this.coins.mesh.layers.set(COIN_LAYER);
    scene.add(this.coins.mesh);
    scene.add(this.dolls.group);

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
    box(BODY_HALF_W * 2, TOP_H, BODY_DEPTH, iron, 0, winTop + TOP_H / 2, midZ);
    box(BODY_HALF_W * 2, winBot, BODY_DEPTH, iron, 0, winBot / 2, midZ);
    box(WIN_HALF_W * 2 + 0.14, 0.07, 0.1, brass, 0, winTop + 0.035, FRONT_Z + 0.02);
    box(WIN_HALF_W * 2 + 0.14, 0.07, 0.1, brass, 0, winBot - 0.035, FRONT_Z + 0.02);
    box(BODY_HALF_W * 2 + 0.2, 0.12, BODY_DEPTH + 0.2, brass, 0, winTop + TOP_H + 0.06, midZ);

    // 窗口上的曲面暗角
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(WIN_HALF_W * 2, WIN_HALF_H * 2),
      new THREE.MeshBasicMaterial({ map: windowShadeTexture(), transparent: true, depthWrite: false }),
    );
    shade.position.set(0, WIN_Y, 0.06);
    scene.add(shade);

    // 窗口上方：状态栏 + 赔率表两块显示屏（像实体机那样把信息印在机台上）
    this.displays.group.position.set(0, winTop + 0.14 + this.displays.statusHeight / 2, FRONT_Z + 0.07);
    scene.add(this.displays.group);
    box(DISPLAY_WIDTH + 0.12, 0.05, 0.1, brass, 0, winTop + TOP_H - 0.02, FRONT_Z + 0.02);

    // 顶上的拱形山花 + 血宝石
    const arch = new THREE.Shape();
    arch.moveTo(-BODY_HALF_W, 0);
    arch.lineTo(BODY_HALF_W, 0);
    arch.absellipse(0, 0, BODY_HALF_W, 0.7, 0, Math.PI, false);
    const pediment = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 1.2, bevelEnabled: false }), iron);
    pediment.position.set(0, winTop + TOP_H + 0.12, FRONT_Z - 1.2);
    scene.add(pediment);
    this.gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24),
      new THREE.MeshStandardMaterial({
        color: 0x5a0008, emissive: 0xff0a1e, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.15,
      }),
    );
    this.gem.position.set(0, winTop + TOP_H + 0.5, FRONT_Z + 0.12);
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
    this.bloodLight = blood;

    // 机顶两支蜡烛
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8cdb0, roughness: 0.7, emissive: 0x3a1c08 });
    for (const s of [-1, 1]) {
      const x = s * 1.85, y = winTop + TOP_H + 0.12, z = FRONT_Z - 0.35;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.4, 12), wax);
      stick.position.set(x, y + 0.2, z);
      scene.add(stick);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5) }),
      );
      flame.scale.set(1, 1.9, 1);
      flame.position.set(x, y + 0.56, z);
      scene.add(flame);
      const light = new THREE.PointLight(0xff8a30, 7, 9, 1.8);
      light.position.set(x, y + 0.7, z + 0.5);
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
    // 不直接上屏：先留在低清缓冲里，下面再用最近邻放大
    this.composer.renderToScreen = false;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.texture.magFilter = rt.texture.minFilter = THREE.NearestFilter;
    }
    this.depthTarget = new THREE.WebGLRenderTarget(4, 4, {
      depthTexture: new THREE.DepthTexture(4, 4), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.blit = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // 颜色原样贴上去，同时把低清那一遍的深度写进深度缓冲，后面画金币时才会被机器 / 币盘正确挡住
      fragmentShader: `uniform sampler2D tColor; uniform sampler2D tDepth; varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tColor, vUv); gl_FragDepth = texture2D(tDepth, vUv).r; }`,
      depthFunc: THREE.AlwaysDepth,
      toneMapped: false,
    }));
    // 金币单独一层，灯光要两层都照
    scene.traverse((o) => { if ((o as THREE.Light).isLight) o.layers.enableAll(); });

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    const lowW = Math.max(1, Math.round((w / h) * PIXEL_ROWS));
    this.composer.setPixelRatio(1);
    this.composer.setSize(lowW, PIXEL_ROWS);
    this.depthTarget.setSize(lowW, PIXEL_ROWS);
    const cam = this.camera;
    cam.aspect = w / h;
    // 竖屏为主：保证机器的宽度永远塞得进屏幕，屏幕越窄相机拉得越远
    const target = new THREE.Vector3(0, 3.6, 1.2);
    // 顶部状态栏和底部操作面板会盖住画面，机器必须完整落在两者之间（矮屏幕 / 横屏时由高度决定距离）
    const { top, bottom } = this.insets;
    const halfW = 3.15, halfH = 5.0 / Math.max(0.4, (h - top - bottom) / h);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.max(halfW / (tanV * cam.aspect), halfH / tanV);
    const dir = new THREE.Vector3(0, 0.3, 1).normalize();
    this.camBase.copy(target).addScaledVector(dir, dist);
    cam.position.copy(this.camBase);
    cam.lookAt(target);
    // 把画面中心挪到两条界面之间的正中
    cam.setViewOffset(w, h, 0, (bottom - top) / 2, w, h);
    cam.updateProjectionMatrix();
  }

  /** 顶部 / 底部被界面盖住多少像素，镜头据此避让 */
  setInsets(top: number, bottom: number) {
    if (top === this.insets.top && bottom === this.insets.bottom) return;
    this.insets = { top, bottom };
    this.resize();
  }

  /** 深渊越深，红光越重 */
  setAbyss(level: number) {
    this.abyss = level;
    this.bloodLight.intensity = 18 + (level - 1) * 5;
  }

  /** 屏幕上这个点点中了什么（玩偶优先，其次是盘面上的符号） */
  pick(clientX: number, clientY: number): Pick | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.layers.enableAll();
    this.camera.layers.set(0);
    this.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, this.camera);
    const doll = this.dolls.pick(ray);
    if (doll) return { kind: 'doll', id: doll };
    const sym = this.reels.pick(ray);
    return sym ? { kind: 'symbol', id: sym } : null;
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
    this.dolls.update(dt);

    for (const c of this.candles) {
      const f = 0.8 + 0.2 * Math.sin(t * 11 + c.seed) * Math.sin(t * 7.3 + c.seed * 2) + 0.08 * Math.sin(t * 31 + c.seed);
      c.light.intensity = 7 * f;
      c.flame.scale.set(1, 1.9 * (0.9 + 0.2 * f), 1);
    }
    this.gem.rotation.y = t * 0.8;
    (this.gem.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + this.abyss * 0.25 + Math.sin(t * 2) * 0.5 + this.flash * 4;

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
    const r = this.renderer, cam = this.camera;
    // 1) 低清：场景（不含金币）的深度
    cam.layers.set(0);
    r.setRenderTarget(this.depthTarget);
    r.render(this.scene, cam);
    // 2) 低清：场景颜色 + 泛光
    this.composer.render();
    // 3) 上屏：最近邻放大，同时写入深度
    r.setRenderTarget(null);
    r.clear();
    const u = (this.blit.material as THREE.ShaderMaterial).uniforms;
    u.tColor.value = this.composer.readBuffer.texture;
    u.tDepth.value = this.depthTarget.depthTexture;
    this.blit.render(r);
    // 4) 原生分辨率：只画金币
    const bg = this.scene.background;
    this.scene.background = null;
    cam.layers.set(COIN_LAYER);
    r.autoClear = false;
    r.render(this.scene, cam);
    r.autoClear = true;
    this.scene.background = bg;
    cam.layers.set(0);
  }
}

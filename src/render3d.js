// Three.js renderer: reads the (2D, pixel-space) simulation in game.js and presents it as a 3D scene.
// World units: 1 unit = 1 tile. Game pixel (x, y) maps to world (x / TILE - COLS/2, *, y / TILE - ROWS/2).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { makeVfxTextures, ParticleSystem, BeamKit } from './vfx.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { TILE, COLS, ROWS, TOWERS, ENEMIES, ABILITIES, MODS, VET, HERO, HERO_RULES, computeStats, variantOf, targetsOf } from './config.js';
import { ENEMY_VIS, recolorMaterial } from './assets3d.js';
import { seededRandom, footprintAnchor, segmentBlock, coverageMap, pathPoint } from './game.js';

const HW = COLS / 2, HH = ROWS / 2;
const wx = (px) => px / TILE - HW;
const wz = (py) => py / TILE - HH;
const PAD_Y = 0.1;
const SIGHT_Y = 0.13;
// Flyers come out of the gate low, climb to cruise above the towers and the low-rise blocks (sky lanes keep clear of
// the tall ones) and dive down into the core over the last stretch. `dist` / `remaining`: px along the lane.
// The sky lane guide runs through the middle of the drone's body.
const CRUISE_Y = 1.9;
const DIVE_TILES = 1.8;
const LANE_LIFT = 0.18;
// Height the orbital strike's satellite lance comes down from.
const ORBIT_Y = 30;
// How far an anti-air variant tilts its turret head up (radians).
const AA_PITCH = 0.6;
const flightAlt = (dist, remaining, hover) => hover + (CRUISE_Y - hover)
  * THREE.MathUtils.smoothstep(dist / TILE, 1.2, 3.2) * THREE.MathUtils.smoothstep(remaining / TILE, 0, DIVE_TILES);
// Model scale per footprint: 2x2 heavies read as big installations, not scaled-up 1x1 towers.
const towerScale = (size, level = 0) => (size > 1 ? 1.95 : 1.15) + level * 0.035 * size;
// Add-on kit per tower per upgrade path (tiers 1-4; tier 5 swaps the model).
const TAU = Math.PI * 2;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const colorCache = new Map();
const col = (hex) => {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
};
const SLOW_TINT = new THREE.Color(0.55, 0.8, 1.35);
const CLOAK_TINT = new THREE.Color(0.75, 0.45, 1.5);
const FROZEN_TINT = new THREE.Color(0.7, 1.1, 1.9);
const NO_TINT = new THREE.Color(1, 1, 1);
const WHITE = new THREE.Color(1, 1, 1);
const FIRE_LIT = new THREE.Color(1.05, 0.52, 0.26); // smoke lit from inside by the fireball
const RAMP_A = new THREE.Color();
const EMBER_HOT = new THREE.Color(3.4, 1.4, 0.4);
const EMBER_COOL = new THREE.Color(0.6, 0.08, 0.02);
const RAMP_B = new THREE.Color();
const yawOf = (a) => Math.atan2(Math.cos(a), Math.sin(a));
const lerpAngle = (a, b, k) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * k;
};
const wrapAngle = (d) => ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
// Hero war bot: model scale (about a tile across) and the ground speed (tiles/s) its run cycle covers at 1x, so the
// clip can be sped up to match how fast it walks (the run clip's stride is 0.32 model units per 16-frame cycle).
const HERO_SCALE = 1.1;
const HERO_RUN_SPEED = (0.32 * HERO_SCALE) / (16 / 24);
const HERO_ONCE = new Set(['hit', 'death', 'activate']);

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const glowTexture = canvasTexture(128, 128, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, w);
}, false);

const sparkTexture = canvasTexture(64, 64, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, w);
}, false);

// Bright at the bottom, gone at the top: light shafts fade out instead of ending in a hard rim.
const fadeUpTexture = canvasTexture(4, 128, (g, w, h) => {
  const grd = g.createLinearGradient(0, h, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}, false);

// ------------------------------------------------------------------------------------------ renderer
export class Renderer3D {
  constructor(canvas, overlay, assets) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.assets = assets;
    this.time = 0;
    this.towerViews = new Map();
    this.enemyViews = new Map();
    this.shellViews = new Map();
    this.fxItems = [];
    this.texts = [];
    this.lightPool = [];
    this.shakeT = 0;
    this.packetViews = new Map();
    this.heroView = null;
    this.trapViews = new Map();
    this.cine = null; // boss intro camera
    // Player settings: shake 0..1, floating texts, placement heat map.
    this.settings = { shake: 1, texts: true, heatmap: true };

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.dpr = this.maxDpr;
    this.perf = { t: 0, frames: 0, stable: 0 };
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Shadow casters are mostly static towers; refresh the map at ~20 Hz instead of every frame.
    r.shadowMap.autoUpdate = false;
    this.shadowTimer = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#07040f');
    this.scene.fog = new THREE.FogExp2('#0b0618', 0.016);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(this.neonEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.85;

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
    this.camDir = new THREE.Vector3(0, 1.2, 0.95).normalize();
    this.target = new THREE.Vector3(0, 0, 0.5);
    this.camera.position.copy(this.target).addScaledVector(this.camDir, 22);
    this.controls = new OrbitControls(this.camera, canvas);
    // RTS camera: right-drag pans across the board, middle-drag (or shift + right-drag) rotates, the wheel zooms
    // toward the cursor. Left button stays free for building and selecting.
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.1, enablePan: true, screenSpacePanning: false, panSpeed: 1.0,
      rotateSpeed: 0.5, zoomSpeed: 1.0, zoomToCursor: true, minPolarAngle: 0.3, maxPolarAngle: 1.15,
    });
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.target.copy(this.target);
    this.panKeys = new Set();
    this.turnLeft = 0; // radians of a Z/X turn still to animate
    this.camReset = null;

    this.setupLights();
    this.setupWorld();
    this.setupPost();
    this.setupHelpers();

    // Streaking additive sparks and soft alpha-blended smoke (src/vfx.js).
    this.tex = makeVfxTextures();
    this.sparks = new ParticleSystem(5000, this.tex.spark, { renderOrder: 11 });
    this.smoke = new ParticleSystem(900, this.tex.smoke, { blending: THREE.NormalBlending, renderOrder: 8 });
    this.scene.add(this.smoke.mesh, this.sparks.mesh);
    this.beamKit = new BeamKit();
    this.ringPlane = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.scorchCount = 0;
    this.flareCount = 0;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  // A dark room lit by neon strips: gives metal surfaces cyberpunk-colored reflections.
  neonEnvironment() {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 24, 40), new THREE.MeshBasicMaterial({ color: '#07050d', side: THREE.BackSide })));
    const panel = (w, h, color, k, pos, look) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(...look);
      env.add(m);
    };
    panel(22, 14, '#b9b0d8', 0.55, [0, 11, 0], [0, 0, 0]);       // soft overhead fill
    panel(3, 16, '#00f0ff', 1.5, [-15, 3, -4], [0, 2, 0]);        // cyan neon, left
    panel(3, 16, '#ff2bd6', 1.4, [15, 3, -6], [0, 2, 0]);         // magenta neon, right
    panel(18, 2.5, '#ffc98a', 1.2, [0, 5, -16], [0, 2, 0]);       // warm sign strip, back
    panel(16, 2, '#8a5cff', 0.9, [0, 1, 16], [0, 2, 0]);        // violet low front
    panel(2.5, 8, '#39ff14', 0.6, [9, 2, 14], [0, 2, 0]);       // small green accent
    return env;
  }

  // -------------------------------------------------------------------------------- scene setup
  setupLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#8a6bff', '#0a0418', 0.9));
    const key = this.keyLight = new THREE.DirectionalLight('#ffe3f4', 3.2);
    key.position.set(9, 18, 11);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -15, right: 15, top: 11, bottom: -11, near: 1, far: 60 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight('#00e1ff', 1.1);
    rim.position.set(-12, 7, -14);
    s.add(rim);
    const rim2 = new THREE.DirectionalLight('#ff2bd6', 0.45);
    rim2.position.set(14, 5, -10);
    s.add(rim2);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 4, 2);
      l.userData.life = 0;
      s.add(l);
      this.lightPool.push(l);
    }
  }

  setupWorld() {
    const s = this.scene;
    const rnd = seededRandom(4242);

    // Neon grid "void" far below the floating board.
    const gridMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, colA: { value: new THREE.Color('#ff2bd6') }, colB: { value: new THREE.Color('#00f0ff') } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec3 vW; uniform float time; uniform vec3 colA; uniform vec3 colB;
        float line(float v, float w){ float f = abs(fract(v) - 0.5); return 1.0 - smoothstep(0.0, w, 0.5 - f); }
        void main(){
          vec2 p = vW.xz * 0.25 + vec2(0.0, time * 0.15);
          float g = max(line(p.x, 0.03), line(p.y, 0.03));
          float d = length(vW.xz);
          float fade = exp(-d * 0.028);
          vec3 c = mix(colA, colB, 0.5 + 0.5 * sin(d * 0.05 - time * 0.3));
          gl_FragColor = vec4(c * g * fade * 2.2 + vec3(0.03, 0.0, 0.06) * fade, 1.0);
        }`,
      fog: false,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -14;
    s.add(grid);
    this.gridMat = gridMat;

    // Megacity: instanced towers with lit windows around the board.
    const winTex = canvasTexture(256, 1024, (g, w, h) => {
      g.fillStyle = '#05040b'; g.fillRect(0, 0, w, h);
      const hues = ['#ffd9a3', '#7ff6ff', '#ff7ae0', '#fff1c1', '#a58bff'];
      for (let y = 8; y < h; y += 14) {
        for (let x = 6; x < w; x += 12) {
          if (rnd() < 0.34) {
            g.fillStyle = hues[Math.floor(rnd() * hues.length)];
            g.globalAlpha = 0.35 + rnd() * 0.65;
            g.fillRect(x, y, 7, 8);
          }
        }
      }
      g.globalAlpha = 1;
    });
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    // Unlit: the skyline fills most of the screen, and its look comes entirely from the window texture.
    const bMat = new THREE.MeshBasicMaterial({ map: winTex, color: new THREE.Color(1.25, 1.25, 1.25), fog: true });
    const N = 260;
    const city = new THREE.InstancedMesh(bGeo, bMat, N);
    const m4 = new THREE.Matrix4();
    let k = 0;
    while (k < N) {
      const a = rnd() * TAU;
      const rad = 17 + Math.pow(rnd(), 0.7) * 48;
      const x = Math.cos(a) * rad * 1.25, z = Math.sin(a) * rad;
      if (z > 6 && Math.abs(x) < 26) continue; // keep the camera side open
      const w = 1.5 + rnd() * 4, d = 1.5 + rnd() * 4;
      const top = -4 + rnd() * 16 + (rad > 40 ? 8 : 0);
      const bottom = -40;
      m4.compose(new THREE.Vector3(x, bottom, z), new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 0.3), new THREE.Vector3(w, top - bottom, d));
      city.setMatrixAt(k++, m4);
    }
    s.add(city);

    // Neon sign strips on the skyline.
    const signGeo = new THREE.BoxGeometry(1, 1, 1);
    const signMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: true });
    const signs = new THREE.InstancedMesh(signGeo, signMat, 70);
    const palette = ['#ff2bd6', '#00f0ff', '#ffe600', '#a855ff', '#ff3355', '#39ff14'];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * TAU, rad = 18 + rnd() * 40;
      const x = Math.cos(a) * rad * 1.25, z = Math.sin(a) * rad;
      if (z > 6 && Math.abs(x) < 26) { i--; continue; }
      const vertical = rnd() < 0.5;
      m4.compose(new THREE.Vector3(x, -3 + rnd() * 12, z), new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-x, -z)),
        vertical ? new THREE.Vector3(0.25, 2 + rnd() * 4, 0.25) : new THREE.Vector3(1.5 + rnd() * 3, 0.25, 0.25));
      signs.setMatrixAt(i, m4);
      signs.setColorAt(i, col(palette[i % palette.length]).clone().multiplyScalar(2.5));
    }
    s.add(signs);

    // Flying traffic.
    const carGeo = new THREE.BoxGeometry(0.5, 0.12, 0.2);
    this.cars = [];
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(carGeo, new THREE.MeshBasicMaterial({ color: col(i % 3 ? '#ff3355' : '#9ff8ff').clone().multiplyScalar(3), toneMapped: false }));
      c.userData = { lane: 14 + rnd() * 28, h: -2 + rnd() * 12, speed: (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 5), t: rnd() * 200 };
      s.add(c);
      this.cars.push(c);
    }

    // Rain.
    const RN = 1400;
    const rainPos = new Float32Array(RN * 6);
    this.rain = { n: RN, pos: rainPos, speed: new Float32Array(RN) };
    for (let i = 0; i < RN; i++) this.resetDrop(i, true);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#8fb8ff', transparent: true, opacity: 0.22, fog: true }));
    this.rainLines.frustumCulled = false;
    s.add(this.rainLines);

    this.boardGroup = new THREE.Group();
    s.add(this.boardGroup);
    this.dynGroup = new THREE.Group();
    s.add(this.dynGroup);
  }

  resetDrop(i, anywhere) {
    const p = this.rain.pos;
    const x = (Math.random() - 0.5) * 40, z = (Math.random() - 0.5) * 30;
    const y = anywhere ? Math.random() * 16 - 2 : 14;
    const len = 0.35 + Math.random() * 0.35;
    p.set([x, y, z, x + 0.06, y + len, z + 0.02], i * 6);
    this.rain.speed[i] = 14 + Math.random() * 8;
  }

  setupPost() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finalPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, hit: { value: 0 }, aberration: { value: 0.0012 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float time; uniform float hit; uniform float aberration; varying vec2 vUv;
        float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
        void main(){
          vec2 d = vUv - 0.5;
          float ab = aberration * (1.0 + hit * 6.0) * dot(d, d) * 4.0;
          vec3 c;
          c.r = texture2D(tDiffuse, vUv + d * ab).r;
          c.g = texture2D(tDiffuse, vUv).g;
          c.b = texture2D(tDiffuse, vUv - d * ab).b;
          float vig = 1.0 - smoothstep(0.35, 0.95, length(d * vec2(1.1, 1.0)));
          c *= mix(0.55, 1.0, vig);
          c += (rnd(vUv * 800.0) - 0.5) * 0.025;
          c = mix(c, c * vec3(1.6, 0.35, 0.45), hit * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.composer.addPass(this.finalPass);
  }

  setupHelpers() {
    const border = canvasTexture(128, 128, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, w - 10);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(8, 8, w - 16, w - 16);
    }, false);
    this.tileMarker = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98),
      new THREE.MeshBasicMaterial({ map: border, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.tileMarker.rotation.x = -Math.PI / 2;
    this.tileMarker.renderOrder = 5;
    this.scene.add(this.tileMarker);

    // Placement heat map: one tinted pad per tile, colored by how much road a tower placed there would cover.
    const heatTex = canvasTexture(64, 64, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.fillStyle = 'rgba(255,255,255,0.32)'; g.fillRect(6, 6, w - 12, w - 12);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, w - 12);
    }, false);
    this.heatMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.86, 0.86).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), COLS * ROWS);
    const hm = new THREE.Matrix4();
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      this.heatMesh.setMatrixAt(ty * COLS + tx, hm.makeTranslation(tx - HW + 0.5, 0.112, ty - HH + 0.5));
      this.heatMesh.setColorAt(ty * COLS + tx, new THREE.Color(0, 0, 0));
    }
    this.heatMesh.renderOrder = 4;
    this.heatMesh.visible = false;
    this.heatMesh.frustumCulled = false;
    this.scene.add(this.heatMesh);
    this.heat = { key: '', data: null, max: 1 };

    // Data packets (carried by couriers, or drifting home): a small faceted crystal like the core's.
    this.packetGeo = new THREE.IcosahedronGeometry(0.13, 0);
    this.packetMat = new THREE.MeshStandardMaterial({ color: '#06302a', emissive: '#3dffc5', emissiveIntensity: 1.8, metalness: 0.2, roughness: 0.15, flatShading: true });

    // Range outline: a plain, static ring.
    this.rangeRing = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const ringGeo = new THREE.RingGeometry(0.985, 1, 128, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.rangeRingLine = new THREE.Mesh(ringGeo, ringMat);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.rangeRing.add(this.rangeRingLine, disk);
    this.rangeDisk = disk;
    this.rangeRing.position.y = 0.13;
    this.rangeRing.renderOrder = 6;
    this.scene.add(this.rangeRing);

    // Instanced blob shadows under regular enemies (only bosses cast real shadows).
    const blobTex = canvasTexture(64, 64, (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.85)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    }, false);
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.8 }), 512);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 2;
    this.scene.add(this.blobs);

    // Selection ring that follows an inspected enemy.
    this.enemyRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.enemyRing.renderOrder = 6;
    this.enemyRing.visible = false;
    this.scene.add(this.enemyRing);

    // Ability reticle.
    this.reticle = this.rangeRing.clone(true);
    this.reticle.children.forEach((c) => { c.material = c.material.clone(); });
    this.scene.add(this.reticle);
    // Tower sight: the area a tower can actually see, as a polygon (light fill + outline). Rays from the tower stop
    // at buildings, so the outline follows the range arc where the view is clear and cuts in along shadow edges.
    this.sightFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.sightLineMat = new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, depthWrite: false, toneMapped: false });
    this.sightLine = new Line2(new LineGeometry(), this.sightLineMat);
    for (const o of [this.sightFill, this.sightLine]) { o.frustumCulled = false; o.renderOrder = 6; o.visible = false; this.scene.add(o); }
    this.sightKey = '';
    this.sightRects = [];

    // Sky lanes (built per map in setGame): a dashed guide at cruise height over a faint trace on the ground.
    this.laneMat = new LineMaterial({ color: col(ENEMIES.drone.color).clone().multiplyScalar(1.4), linewidth: 1.6, dashed: true, dashSize: 0.34, gapSize: 0.22, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
    this.laneGroundMat = new LineMaterial({ color: col(ENEMIES.drone.color).clone().multiplyScalar(1.1), linewidth: 1.2, dashed: true, dashSize: 0.12, gapSize: 0.3, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false });
    this.skyLanes = [];
    this.laneK = 0;
    // The stretch of sky lane an anti-air tower being placed or inspected can hit, in its color.
    this.airCoverMat = new LineMaterial({ color: 0xffffff, linewidth: 3, transparent: true, depthWrite: false, toneMapped: false });
    this.airCover = new LineSegments2(new LineSegmentsGeometry(), this.airCoverMat);
    this.airCoverKey = '';
    // Manual aim: the Mortar's target spot (a ring the size of its blast) and the Railgun's firing line, solid up to
    // the first building and dashed where only a slug at a flyer carries on over the low roofs.
    this.aimRing = this.rangeRing.clone(true);
    this.aimRing.children.forEach((c) => { c.material = c.material.clone(); });
    this.aimLineMat = new LineMaterial({ color: 0xffffff, linewidth: 2.5, transparent: true, depthWrite: false, toneMapped: false });
    this.aimFarMat = new LineMaterial({ color: 0xffffff, linewidth: 1.6, dashed: true, dashSize: 0.16, gapSize: 0.14, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    this.aimLine = new Line2(new LineGeometry(), this.aimLineMat);
    this.aimFar = new Line2(new LineGeometry(), this.aimFarMat);
    for (const o of [this.airCover, this.aimRing, this.aimLine, this.aimFar]) { o.frustumCulled = false; o.renderOrder = 7; o.visible = false; this.scene.add(o); }
    // The hero's move orders: its route as a dashed line on the ground and a ring where it's headed.
    this.routeMat = new LineMaterial({ color: col(HERO.color).clone().multiplyScalar(1.8), linewidth: 2, dashed: true, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.routeLine = new Line2(new LineGeometry(), this.routeMat);
    this.routeKey = '';
    this.destRing = this.rangeRing.clone(true);
    this.destRing.children.forEach((c) => { c.material = c.material.clone(); });
    for (const o of [this.routeLine, this.destRing]) { o.frustumCulled = false; o.renderOrder = 7; o.visible = false; this.scene.add(o); }
    // Hero traps: a small puck with a blinking light, shared across traps.
    this.trapGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.06, 10);
    this.trapMat = new THREE.MeshStandardMaterial({ color: '#23242c', metalness: 0.8, roughness: 0.4 });
    this.trapRingGeo = new THREE.TorusGeometry(0.1, 0.014, 6, 20).rotateX(Math.PI / 2);
    this.trapRingMats = { mine: new THREE.MeshBasicMaterial({ color: col(HERO_RULES.trapColor).clone().multiplyScalar(2.2), toneMapped: false }), emp: new THREE.MeshBasicMaterial({ color: col('#00f0ff').clone().multiplyScalar(2.2), toneMapped: false }) };
    this.uiLineMats = [this.laneMat, this.laneGroundMat, this.airCoverMat, this.aimLineMat, this.aimFarMat, this.routeMat];

    // Shared geometries/materials for pooled effects.
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.beamGeo.rotateX(Math.PI / 2); // along +Z, from 0 to 1
    this.shockGeo = new THREE.RingGeometry(0.82, 1, 64).rotateX(-Math.PI / 2);
    this.sphereGeo = new THREE.SphereGeometry(1, 24, 16);
    this.shieldMatBase = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#5aa0ff') }, opacity: { value: 0.6 }, time: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 2.2);
          float hex = 0.5 + 0.5 * sin(vP.y * 40.0 + time * 4.0) * sin(atan(vP.z, vP.x) * 12.0);
          gl_FragColor = vec4(color * 2.5, (f * 0.9 + hex * 0.08) * opacity); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lineMats = new Map();

    // Blender-rendered flipbooks (tools/blender/render_vfx.py).
    const loader = new THREE.TextureLoader();
    const sheet = (url, cols, rows, frames) => {
      const tex = loader.load(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      return { tex, grid: new THREE.Vector2(cols, rows), frames };
    };
    this.flipbooks = {
      explosion: sheet('assets/vfx/explosion_5x5_24.png', 5, 5, 24),
      burst: sheet('assets/vfx/burst_4x4_16.png', 4, 4, 16),
    };
    this.flipGeo = new THREE.PlaneGeometry(1, 1);
    this.flipShader = {
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `
        uniform sampler2D map; uniform float frame; uniform vec2 grid; uniform vec3 color; uniform float opacity; varying vec2 vUv;
        void main(){
          float f = floor(frame);
          vec2 cell = vec2(mod(f, grid.x), grid.y - 1.0 - floor(f / grid.x));
          vec4 t = texture2D(map, (cell + vUv) / grid);
          gl_FragColor = vec4(t.rgb * color, t.a * opacity);
        }`,
    };
  }

  flipbook(pos, kind, size, life, color = '#ffffff', intensity = 2, additive = false, first = 0, last = null) {
    const fb = this.flipbooks[kind];
    const end = last ?? fb.frames;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: fb.tex }, frame: { value: 0 }, grid: { value: fb.grid }, color: { value: col(color).clone().multiplyScalar(intensity) }, opacity: { value: 1 } },
      ...this.flipShader, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const m = new THREE.Mesh(this.flipGeo, mat);
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.renderOrder = 8;
    m.rotation.z = Math.random() * TAU;
    const spin = m.rotation.z;
    this.addFx(m, life, (k) => {
      mat.uniforms.frame.value = Math.min(end - 1, first + (1 - k) * (end - first));
      m.quaternion.copy(this.camera.quaternion);
      m.rotateZ(spin);
    });
  }

  lineMat(color) {
    let m = this.lineMats.get(color);
    if (!m) {
      m = new LineMaterial({ color: col(color).clone().multiplyScalar(3), linewidth: 3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      m.resolution.set(this.width || 1280, this.height || 720);
      this.lineMats.set(color, m);
    }
    return m;
  }

  // -------------------------------------------------------------------------------- layout
  resize(w, h) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const dpr = this.renderer.getPixelRatio();
    this.overlay.width = w * dpr;
    this.overlay.height = h * dpr;
    this.overlay.style.width = `${w}px`;
    this.overlay.style.height = `${h}px`;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.bloom.resolution.set(size.x, size.y);
    for (const m of this.lineMats.values()) m.resolution.set(w, h);
    this.sightLineMat?.resolution.set(w, h);
    for (const m of this.uiLineMats || []) m.resolution.set(w, h);
    this.fitCamera();
  }

  // Distance at which the default view frames the whole board; zoom limits and the reset view derive from it.
  // Measured from the default framing so panning or turning before a resize doesn't skew it.
  fitCamera() {
    const cam = this.camera, c = this.controls;
    const zoom = this.fitDist ? cam.position.distanceTo(c.target) / this.fitDist : 1;
    const saved = cam.position.clone();
    const corners = [];
    for (const x of [-HW - 0.4, HW + 0.4]) for (const z of [-HH - 0.4, HH + 0.4]) for (const y of [0, 1.2]) corners.push(new THREE.Vector3(x, y, z));
    let lo = 5, hi = 120;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      cam.position.copy(this.target).addScaledVector(this.camDir, d);
      cam.lookAt(this.target);
      cam.updateMatrixWorld();
      const ok = corners.every((p) => { tmpV.copy(p).project(cam); return Math.abs(tmpV.x) < 0.97 && Math.abs(tmpV.y) < 0.9 && tmpV.z < 1; });
      if (ok) hi = d; else lo = d;
    }
    this.fitDist = hi;
    c.minDistance = hi * 0.28;
    c.maxDistance = hi * 1.15;
    const dir = saved.sub(c.target).normalize();
    cam.position.copy(c.target).addScaledVector(dir, hi * THREE.MathUtils.clamp(zoom, 0.28, 1.15));
    c.update();
  }

  // Jump straight to the default framing (new map).
  homeView() {
    this.camReset = null;
    this.turnLeft = 0;
    this.panKeys.clear();
    this.controls.target.copy(this.target);
    this.camera.position.copy(this.target).addScaledVector(this.camDir, this.fitDist || 22);
    this.controls.update();
  }

  // ------------------------------------------------------------------ RTS camera keys
  // Arrow keys pan while held (see updateCamera); returns true when the key was a camera key.
  cameraKey(key, down) {
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return false;
    if (down) this.panKeys.add(key); else this.panKeys.delete(key);
    return true;
  }

  turnView(steps) { this.turnLeft += steps * Math.PI / 4; this.camReset = null; }

  resetView() {
    const dist = this.fitDist || 22;
    this.turnLeft = 0;
    this.camReset = {
      t: 0,
      fromT: this.controls.target.clone(), fromP: this.camera.position.clone(),
      toT: this.target.clone(), toP: this.target.clone().addScaledVector(this.camDir, dist),
    };
  }

  // Glide the view over to game pixel (px, py), keeping the current zoom and angle (centering on the hero).
  focusOn(px, py) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const toT = new THREE.Vector3(wx(px), 0, wz(py));
    this.turnLeft = 0;
    this.camReset = { t: 0, fromT: this.controls.target.clone(), fromP: this.camera.position.clone(), toT, toP: toT.clone().add(off) };
  }

  // ------------------------------------------------------------------ boss intro camera
  // Fly in low in front of the boss, follow it while the name card shows, then return to the player's view.
  startCinematic(enemy, dur = 3.2) {
    if (this.cine) this.endCinematic(true);
    this.cine = {
      enemy, t: 0, dur, out: 0.9,
      fromP: this.camera.position.clone(), fromT: this.controls.target.clone(),
      pos: this.camera.position.clone(), look: this.controls.target.clone(),
      hidden: new Set(), // buildings and towers pulled out of the shot so the boss stays in view
    };
    this.controls.enabled = false;
  }

  // Hide whatever stands between the camera and the boss (or around the camera itself); it stays hidden for the
  // rest of the intro and comes back when the camera has returned.
  clearShot(c, center, height) {
    const cam = this.camera.position;
    const targets = [center, center.clone().add(tmpV2.set(0, height * 0.45, 0)), center.clone().add(tmpV2.set(0, -height * 0.4, 0))];
    const ray = this.shotRay || (this.shotRay = new THREE.Ray());
    const blocks = (box) => {
      if (box.containsPoint(cam) || box.distanceToPoint(cam) < 0.6) return true;
      for (const p of targets) {
        const d = cam.distanceTo(p);
        ray.origin.copy(cam);
        ray.direction.copy(p).sub(cam).normalize();
        const hit = ray.intersectBox(box, tmpV);
        if (hit && cam.distanceTo(hit) < d - 0.3) return true;
      }
      return false;
    };
    for (const b of this.buildingViews || []) {
      if (!c.hidden.has(b) && blocks(b.userData.box)) { b.visible = false; c.hidden.add(b); }
    }
    const box = this.towerBox || (this.towerBox = new THREE.Box3());
    for (const v of this.towerViews.values()) {
      if (c.hidden.has(v.root)) continue;
      box.setFromObject(v.root).expandByScalar(0.05);
      if (blocks(box)) { v.root.visible = false; c.hidden.add(v.root); }
    }
  }

  skipCinematic() { if (this.cine && this.cine.t < this.cine.dur) this.cine.t = this.cine.dur; }

  endCinematic(snap = false) {
    const c = this.cine;
    if (!c) return;
    this.cine = null;
    this.controls.enabled = true;
    for (const o of c.hidden) o.visible = true;
    if (snap) { this.camera.position.copy(c.fromP); this.controls.target.copy(c.fromT); this.camera.lookAt(c.fromT); }
  }

  get cinematic() { return !!this.cine && this.cine.t < this.cine.dur; }

  updateCinematic(dt) {
    const c = this.cine;
    c.t += dt;
    const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
    const v = this.enemyViews.get(c.enemy.id);
    if (c.t < c.dur && v) {
      const center = this.enemyCenter(v, new THREE.Vector3());
      const a = c.enemy.angle;
      const size = Math.max(1.5, v.height);
      // Ahead of the boss and a little to its side, at about its chest height.
      const fwd = tmpV.set(Math.cos(a), 0, Math.sin(a));
      const want = center.clone().addScaledVector(fwd, size * 2.1).add(tmpV2.set(-fwd.z * size * 0.9, size * 0.45, fwd.x * size * 0.9));
      const look = center.clone().add(tmpV2.set(0, size * 0.1, 0));
      const k = ease(c.t / 0.8);
      c.pos.lerpVectors(c.fromP, want, k);
      c.look.lerpVectors(c.fromT, look, k);
      c.lastP = c.pos.clone(); c.lastL = c.look.clone();
    } else {
      if (!c.lastP) { this.endCinematic(true); return; }
      if (c.t < c.dur) c.t = c.dur; // boss vanished mid-intro
      const k = ease((c.t - c.dur) / c.out);
      c.pos.lerpVectors(c.lastP, c.fromP, k);
      c.look.lerpVectors(c.lastL, c.fromT, k);
      if (k >= 1) { this.endCinematic(true); return; }
    }
    this.camera.position.copy(c.pos);
    this.camera.lookAt(c.look);
    if (v) this.clearShot(c, this.enemyCenter(v, new THREE.Vector3()), v.height);
  }

  updateCamera(dt) {
    const c = this.controls, cam = this.camera;
    if (this.camReset) {
      const r = this.camReset;
      r.t = Math.min(1, r.t + dt * 2.5);
      const k = 1 - (1 - r.t) ** 3;
      c.target.lerpVectors(r.fromT, r.toT, k);
      cam.position.lerpVectors(r.fromP, r.toP, k);
      if (r.t >= 1) this.camReset = null;
      return;
    }
    if (Math.abs(this.turnLeft) > 1e-4) {
      const step = Math.abs(this.turnLeft) < 0.002 ? this.turnLeft : this.turnLeft * Math.min(1, dt * 9);
      this.turnLeft -= step;
      tmpV.copy(cam.position).sub(c.target).applyAxisAngle(UP, step);
      cam.position.copy(c.target).add(tmpV);
    }
    if (this.panKeys.size) {
      const fwd = tmpV.copy(c.target).sub(cam.position).setY(0).normalize();
      const k = this.panKeys;
      const dx = (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0);
      const dz = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
      const speed = cam.position.distanceTo(c.target) * 0.45 * dt;
      const move = tmpV2.set(-fwd.z * dx + fwd.x * dz, 0, fwd.x * dx + fwd.z * dz).multiplyScalar(speed);
      c.target.add(move);
      cam.position.add(move);
    }
    // Keep the focus point over the board so the view can't drift off into the city.
    const cx = THREE.MathUtils.clamp(c.target.x, -HW, HW), cz = THREE.MathUtils.clamp(c.target.z, -HH, HH);
    if (cx !== c.target.x || cz !== c.target.z || c.target.y !== 0) {
      tmpV.set(cx - c.target.x, -c.target.y, cz - c.target.z);
      c.target.add(tmpV);
      cam.position.add(tmpV);
    }
  }

  // Screen-space hit test so tall and hovering enemies are easy to click.
  pickEnemy(clientX, clientY, game) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best = null, bd = Infinity;
    for (const e of game.enemies) {
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const c = this.enemyCenter(v, new THREE.Vector3());
      const p = this.project(c.x, c.y, c.z);
      if (p.behind) continue;
      const top = this.project(c.x, c.y + v.height * 0.6, c.z);
      const rad = Math.max(16, Math.abs(p.sy - top.sy) * 1.2);
      const d = Math.hypot(p.sx - mx, p.sy - my);
      if (d < rad && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, tmpV);
    if (!hit) return null;
    const x = (hit.x + HW) * TILE, y = (hit.z + HH) * TILE;
    return { x, y, tx: Math.floor(hit.x + HW), ty: Math.floor(hit.z + HH) };
  }

  project(x, y, z) {
    tmpV.set(x, y, z).project(this.camera);
    return { sx: (tmpV.x * 0.5 + 0.5) * this.width, sy: (-tmpV.y * 0.5 + 0.5) * this.height, behind: tmpV.z > 1 };
  }

  // -------------------------------------------------------------------------------- board
  setGame(game) {
    this.game = game;
    this.clearDynamic();
    this.setSightBlockers(game.blocked);
    const g = this.boardGroup;
    while (g.children.length) g.remove(g.children[0]);
    const theme = game.map.theme;
    const pathCol = col(theme.path), accent = col(theme.accent);
    const rnd = seededRandom(game.map.seed * 131);

    // Slab.
    const slab = new THREE.Mesh(new RoundedBoxGeometry(COLS + 0.9, 0.7, ROWS + 0.9, 4, 0.18),
      new THREE.MeshStandardMaterial({ color: '#0d0c18', metalness: 0.75, roughness: 0.42 }));
    slab.position.y = -0.35;
    slab.receiveShadow = true;
    g.add(slab);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(3, 1.2, 6, 6), new THREE.MeshStandardMaterial({ color: '#0b0a14', metalness: 0.8, roughness: 0.5 }));
    under.position.y = -3.6;
    g.add(under);
    // Rim neon.
    const rimMat = new THREE.MeshBasicMaterial({ color: pathCol.clone().multiplyScalar(1.6), toneMapped: false });
    const rims = [
      [COLS + 0.9, 0.05, 0.05, 0, 0.01, (ROWS + 0.9) / 2], [COLS + 0.9, 0.05, 0.05, 0, 0.01, -(ROWS + 0.9) / 2],
      [0.05, 0.05, ROWS + 0.9, (COLS + 0.9) / 2, 0.01, 0], [0.05, 0.05, ROWS + 0.9, -(COLS + 0.9) / 2, 0.01, 0],
      [COLS + 0.9, 0.04, 0.04, 0, -0.55, (ROWS + 0.9) / 2 + 0.02], [COLS + 0.9, 0.04, 0.04, 0, -0.55, -(ROWS + 0.9) / 2 - 0.02],
    ];
    for (const [w, h, d, x, y, z] of rims) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat);
      m.position.set(x, y, z);
      g.add(m);
    }

    // Floor texture: dark plating with faint circuit traces and grid.
    const floorTex = canvasTexture(2048, Math.round(2048 * ROWS / COLS), (c, w, h) => {
      const t = w / COLS;
      c.fillStyle = '#0a0913'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        c.fillStyle = `rgba(255,255,255,${0.01 + rnd() * 0.02})`;
        c.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
      }
      c.strokeStyle = theme.accent; c.globalAlpha = 0.18; c.lineWidth = 2;
      for (let i = 0; i < 160; i++) {
        let x = Math.floor(rnd() * COLS * 4) * t / 4, y = Math.floor(rnd() * ROWS * 4) * t / 4;
        c.beginPath(); c.moveTo(x, y);
        for (let k = 0; k < 3; k++) { if (rnd() < 0.5) x += (rnd() - 0.5) * t * 2; else y += (rnd() - 0.5) * t * 2; c.lineTo(x, y); }
        c.stroke();
      }
      c.globalAlpha = 0.12; c.lineWidth = 1.5;
      for (let x = 0; x <= COLS; x++) { c.beginPath(); c.moveTo(x * t, 0); c.lineTo(x * t, h); c.stroke(); }
      for (let y = 0; y <= ROWS; y++) { c.beginPath(); c.moveTo(0, y * t); c.lineTo(w, y * t); c.stroke(); }
      c.globalAlpha = 1;
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(COLS, ROWS),
      new THREE.MeshStandardMaterial({ map: floorTex, emissive: '#ffffff', emissiveMap: floorTex, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    g.add(floor);

    // Raised build pads (instanced) with glowing bevel edges.
    const padTex = canvasTexture(256, 256, (c, w) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, w);
      c.strokeStyle = '#fff'; c.lineWidth = 5; c.globalAlpha = 0.9; c.strokeRect(12, 12, w - 24, w - 24);
      c.globalAlpha = 0.35; c.lineWidth = 2; c.strokeRect(34, 34, w - 68, w - 68);
      c.globalAlpha = 0.9; c.fillStyle = '#fff';
      for (const [x, y] of [[12, 12], [w - 36, 12], [12, w - 36], [w - 36, w - 36]]) c.fillRect(x, y, 24, 6);
    }, false);
    const buildable = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (game.grid[y][x] === 0 || game.grid[y][x] === 3) buildable.push([x, y]);
    const padGeo = new RoundedBoxGeometry(0.9, 0.1, 0.9, 2, 0.025);
    const padMat = new THREE.MeshStandardMaterial({ color: '#1a1930', metalness: 0.7, roughness: 0.5, emissive: accent.clone(), emissiveMap: padTex, emissiveIntensity: 0.3 });
    const pads = new THREE.InstancedMesh(padGeo, padMat, buildable.length);
    const m4 = new THREE.Matrix4();
    buildable.forEach(([x, y], i) => { m4.makeTranslation(x - HW + 0.5, 0.05, y - HH + 0.5); pads.setMatrixAt(i, m4); });
    pads.receiveShadow = true;
    g.add(pads);

    // Streets: a ribbon following each (corner-rounded) path, textured as wet asphalt with painted lane markings
    // that pick up a neon tint, and neon curbs along both edges.
    const roadTex = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#17141f'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const l = rnd();
        c.fillStyle = l < 0.5 ? `rgba(0,0,0,${0.12 + rnd() * 0.2})` : `rgba(190,180,220,${0.03 + rnd() * 0.05})`;
        c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      for (let i = 0; i < 5; i++) { // patched asphalt
        c.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.12})`;
        c.beginPath(); c.ellipse(rnd() * w, h * (0.2 + rnd() * 0.6), 12 + rnd() * 30, 6 + rnd() * 14, rnd() * 3, 0, TAU); c.fill();
      }
    });
    roadTex.wrapS = THREE.RepeatWrapping;
    const markTex = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff';
      c.fillRect(w * 0.08, h * 0.49, w * 0.5, h * 0.02); // centre dash
    }, false);
    markTex.wrapS = THREE.RepeatWrapping;
    this.roadMat = new THREE.MeshStandardMaterial({
      map: roadTex, emissiveMap: markTex, emissive: pathCol.clone().lerp(new THREE.Color(1, 1, 1), 0.35), emissiveIntensity: 0.9,
      roughness: 0.42, metalness: 0.25, envMapIntensity: 0.9,
    });
    const pathsWorld = game.paths.map((p) => p.pts.map((q) => new THREE.Vector2(wx(q.x), wz(q.y))));
    const distToPath = (v, pw) => {
      let best = Infinity;
      for (let i = 0; i < pw.length - 1; i++) {
        const a = pw[i], d = tmpV2.set(pw[i + 1].x - a.x, 0, pw[i + 1].y - a.y);
        const L2 = d.x * d.x + d.z * d.z;
        const t = Math.max(0, Math.min(1, ((v.x - a.x) * d.x + (v.y - a.y) * d.z) / L2));
        best = Math.min(best, Math.hypot(a.x + d.x * t - v.x, a.y + d.z * t - v.y));
      }
      return best;
    };
    const ribbon = (pw, half, y, uScale) => {
      const n = pw.length;
      const pos = [], uv = [], idx = [];
      let u = -0.5;
      for (let i = 0; i < n; i++) {
        const prev = pw[Math.max(0, i - 1)], next = pw[Math.min(n - 1, i + 1)];
        const tx = next.x - prev.x, tz = next.y - prev.y, tl = Math.hypot(tx, tz) || 1;
        const nx = -tz / tl, nz = tx / tl;
        // Stretch the ends half a tile so the road runs into the portal and under the core.
        const ext = i === 0 ? -0.5 : i === n - 1 ? 0.5 : 0;
        const cx = pw[i].x + (tx / tl) * ext, cz = pw[i].y + (tz / tl) * ext;
        if (i > 0) u += Math.hypot(pw[i].x - pw[i - 1].x, pw[i].y - pw[i - 1].y) + (i === n - 1 ? 0.5 : 0);
        pos.push(cx + nx * half, y, cz + nz * half, cx - nx * half, y, cz - nz * half);
        uv.push(u * uScale, 1, u * uScale, 0);
        if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };
    const curbMat = new THREE.MeshBasicMaterial({ color: pathCol.clone().multiplyScalar(1.5), toneMapped: false });
    pathsWorld.forEach((pw, pi) => {
      const others = pathsWorld.filter((_, k) => k !== pi);
      const road = new THREE.Mesh(ribbon(pw, 0.5, 0.006 + pi * 0.002, 1), this.roadMat);
      road.receiveShadow = true;
      g.add(road);
      // Curbs: thin strips along both edges, skipped where they'd cut across another path's road (merges).
      for (const side of [1, -1]) {
        let run = [];
        const flush = () => { if (run.length > 1) g.add(new THREE.Mesh(ribbon(run, 0.02, 0.03, 1), curbMat)); run = []; };
        for (let i = 0; i < pw.length; i++) {
          const prev = pw[Math.max(0, i - 1)], next = pw[Math.min(pw.length - 1, i + 1)];
          const tx = next.x - prev.x, tz = next.y - prev.y, tl = Math.hypot(tx, tz) || 1;
          const e = new THREE.Vector2(pw[i].x - (tz / tl) * 0.49 * side, pw[i].y + (tx / tl) * 0.49 * side);
          if (others.some((o) => distToPath(e, o) < 0.47)) flush(); else run.push(e);
        }
        flush();
      }
    });

    // Sky lanes: the drones' flight routes out of each gate. The guide line follows their climb, cruise height and dive
    // into the core; the ground trace (kept on the board) shows where on the grid it runs.
    this.skyLanes = [];
    this.laneWave = '';
    const droneHover = ENEMY_VIS.drone.hover;
    const inBoard = (q) => q.x >= 0 && q.y >= 0 && q.x <= COLS * TILE && q.y <= ROWS * TILE;
    // Where two roads merge their lanes do too: the shared stretch is drawn once.
    const drawn = [];
    const addLine = (pos, mat) => {
      if (pos.length < 6) return;
      const geo = new LineGeometry();
      geo.setPositions(pos);
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      line.renderOrder = 3;
      g.add(line);
      this.skyLanes.push(line);
    };
    for (const p of game.airPaths) {
      let air = [], ground = [];
      const flush = () => { addLine(air, this.laneMat); addLine(ground, this.laneGroundMat); air = []; ground = []; };
      const mine = [];
      for (let d = 0; ; d = Math.min(p.length, d + TILE * 0.2)) {
        const q = pathPoint(p, d);
        mine.push(q);
        if (drawn.some((o) => (o.x - q.x) ** 2 + (o.y - q.y) ** 2 < (TILE * 0.15) ** 2)) flush();
        else {
          air.push(wx(q.x), flightAlt(d, p.length - d, droneHover) + LANE_LIFT, wz(q.y));
          if (inBoard(q)) ground.push(wx(q.x), 0.118, wz(q.y));
        }
        if (d >= p.length) break;
      }
      flush();
      drawn.push(...mine);
    }

    // Buildings on blocked tiles.
    const bTpl = this.assets.get('env_building');
    this.buildingViews = [];
    for (const [x, y, size = 1] of game.blocked) {
      const b = bTpl ? bTpl.scene.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.2, 0.85), padMat);
      b.position.set(x - HW + size / 2, 0, y - HH + size / 2);
      b.rotation.y = Math.floor(rnd() * 4) * Math.PI / 2;
      // 2x2 lots get a tall tower block; singles vary in height.
      b.scale.set(size * 1.05, size > 1 ? 2.6 + rnd() * 1.4 : 0.75 + rnd() * 0.9, size * 1.05);
      g.add(b);
      b.updateMatrixWorld(true);
      b.userData.box = new THREE.Box3().setFromObject(b).expandByScalar(0.08);
      this.buildingViews.push(b);
    }

    // Spawn portals.
    this.portals = [];
    const pTpl = this.assets.get('env_portal');
    game.paths.forEach((p) => {
      const a = p.pts[0], b = p.pts[1];
      const dx = Math.sign(b.x - a.x), dz = Math.sign(b.y - a.y);
      const ex = Math.max(-HW + 0.3, Math.min(HW - 0.3, wx(a.x) + dx * 0.9));
      const ez = Math.max(-HH + 0.3, Math.min(HH - 0.3, wz(a.y) + dz * 0.9));
      const holder = new THREE.Group();
      holder.position.set(ex - dx * 0.25, 0, ez - dz * 0.25);
      holder.rotation.y = Math.atan2(dx, dz);
      if (pTpl) {
        const portal = pTpl.scene.clone(true);
        portal.scale.setScalar(1.9); // tall enough for bosses to march through
        holder.add(portal);
      }
      const light = new THREE.PointLight('#ff2a4a', 7, 6, 2);
      light.position.set(0, 1.2, 0.6);
      holder.add(light);
      g.add(holder);
      this.portals.push({ holder, light });
    });

    // Data core.
    const c = game.core;
    this.core = new THREE.Group();
    this.core.position.set(wx(c.x), 0, wz(c.y));
    const cTpl = this.assets.get('env_core');
    if (cTpl) {
      const cm = cTpl.scene.clone(true);
      cm.rotation.y = -Math.PI / 2;
      cm.scale.setScalar(1.4);
      this.core.add(cm);
    }
    const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({ color: '#0a2a33', emissive: accent.clone(), emissiveIntensity: 3.5, metalness: 0.2, roughness: 0.1, flatShading: true }));
    crystal.position.y = 2.3;
    this.core.add(crystal);
    this.coreCrystal = crystal;
    this.coreLight = new THREE.PointLight(accent.clone(), 9, 6, 1.6);
    this.coreLight.position.y = 1.2;
    this.core.add(this.coreLight);
    g.add(this.core);
    this.coreAccent = accent.clone();
    this.renderer.shadowMap.needsUpdate = true;
    this.warmup();
  }

  // Compile every material the match can use up front (models, effects), so the first appearance of an
  // enemy type or effect doesn't hitch the frame. Uses the current light setup, which shapes the programs.
  warmup() {
    const grp = new THREE.Group();
    for (const name of Object.keys(this.assets.models)) {
      const m = this.assets.get(name);
      if (!m.scene.children.length) continue;
      const c = m.animations.length ? SkeletonUtils.clone(m.scene) : m.scene.clone(true);
      // Path-recolor materials must stay shared: clone() drops their shader hook.
      c.traverse((o) => { if (o.isMesh && !o.material.userData?.pathRecolor) o.material = o.material.clone(); });
      grp.add(c);
    }
    // Recolored enemies (new threats, variants) use the path-recolor program, skinned and static.
    for (const name of new Set(Object.values(ENEMY_VIS).map((v) => v.model))) {
      const m = this.assets.get(name);
      if (!m) continue;
      const c = m.animations.length ? SkeletonUtils.clone(m.scene) : m.scene.clone(true);
      c.traverse((o) => { if (o.isMesh) o.material = recolorMaterial(o.material, '#ff2a6a', 0.4); });
      grp.add(c);
    }
    grp.add(new THREE.Mesh(this.packetGeo, this.packetMat));
    this.dynGroup.add(grp);
    const before = this.fxItems.length;
    const p = new THREE.Vector3(0, -30, 0);
    this.flipbook(p, 'explosion', 1, 0.01);
    this.flipbook(p, 'explosion', 1, 0.01, '#ffffff', 2, true);
    this.flipbook(p, 'burst', 1, 0.01, '#ffffff', 2, true);
    this.beam(p, p.clone().add(new THREE.Vector3(0, 1, 0)), '#ffffff', 0.1, 0.01);
    this.shockwave(0, 0, 0.1, 0.2, '#ffffff', 0.01);
    this.lightning([p, p.clone().add(new THREE.Vector3(1, 0, 0))], '#ffe600', 0.01, { forks: false });
    const puff = this.fxItems.length;
    this.glowPuff(p, '#ffffff', 1, 0.01);
    this.flare(p.x, p.y, p.z, '#ffffff', 1, 0.01);
    this.scorch(0, 0, 0.01, 0.01);
    // Upload effect textures now too; the 1280px flipbook sheets otherwise hitch the first blast of a match.
    for (const t of [...Object.values(this.flipbooks).map((f) => f.tex), ...Object.values(this.tex), glowTexture, fadeUpTexture]) {
      if (t.image && (t.image.complete ?? true)) this.renderer.initTexture(t);
    }
    const done = () => { this.dynGroup.remove(grp); };
    (this.renderer.compileAsync ? this.renderer.compileAsync(this.scene, this.camera) : Promise.resolve(this.renderer.compile(this.scene, this.camera)))
      .then(done, done);
    return before + puff;
  }

  clearDynamic() {
    for (const v of this.towerViews.values()) this.dynGroup.remove(v.root);
    for (const v of this.enemyViews.values()) this.dynGroup.remove(v.root);
    for (const v of this.shellViews.values()) this.dynGroup.remove(v);
    for (const v of this.packetViews.values()) this.dynGroup.remove(v);
    for (const f of this.fxItems) this.dynGroup.remove(f.obj);
    if (this.heroView) { this.dynGroup.remove(this.heroView.root); this.heroView = null; }
    for (const v of this.trapViews.values()) this.dynGroup.remove(v);
    this.trapViews.clear();
    this.towerViews.clear(); this.enemyViews.clear(); this.shellViews.clear(); this.packetViews.clear();
    this.endCinematic(true);
    this.heat.key = '';
    this.fxItems = []; this.texts = [];
    this.sparks.clear();
    this.smoke.clear();
    this.scorchCount = 0;
    this.flareCount = 0;
    this.ghosts = this.ghosts || {};
  }

  // -------------------------------------------------------------------------------- towers
  // ---- tower views: evolve with upgrades -------------------------------------------------------------
  // Towers evolve with their leading path: tier 3-4 wear the path's colors, tier 5 becomes the path's capstone
  // (the flagship path has its own model, the other two are path-colored variants of it).
  modelNameFor(t) {
    const p = t.mainPath, tier = p >= 0 ? t.tiers[p] : 0;
    let name = null;
    if (tier >= 5) name = t.def.paths[p].flagship ? `tower_${t.type}_t5` : `tower_${t.type}_p${p}_t5`;
    else if (tier >= 3) name = `tower_${t.type}_p${p}_t3`;
    return name && this.assets.has(name) ? name : `tower_${t.type}`;
  }

  makeTowerView(t) {
    const root = new THREE.Group();
    root.position.set(wx(t.x), PAD_Y, wz(t.y));
    const size = t.size || 1;
    const c = col(t.def.color);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4 * size, 0.44 * size, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }));
    ring.position.y = 0.005;
    root.add(ring);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: c.clone().multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
    const v = { root, ring, flash, size, tierKey: '', modelName: '', yaw: yawOf(t.angle), pitch: t.variantDef?.hits === 'air' ? AA_PITCH : 0, recoil: 0, modules: null, anims: [] };
    this.setTowerModel(v, t);
    this.dynGroup.add(root);
    return v;
  }

  setTowerModel(v, t) {
    const name = this.modelNameFor(t);
    if (v.modelName === name) return;
    v.modelName = name;
    if (v.model) v.root.remove(v.model);
    if (v.orb) { v.root.remove(v.orb); v.orb = null; }
    if (v.light) { v.root.remove(v.light); v.light = null; }
    const tpl = this.assets.get(name);
    let model, head = null, muzzle = new THREE.Vector3(0, 0.6, 0.4);
    if (tpl) {
      model = tpl.scene.clone(true);
      head = model.getObjectByName('head');
      if (head) {
        const hb = new THREE.Box3().setFromObject(head);
        muzzle = new THREE.Vector3(0, (hb.min.y + hb.max.y) / 2 - head.position.y, hb.max.z - head.position.z - 0.02);
      }
    } else {
      model = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.8, 8), new THREE.MeshStandardMaterial({ color: t.def.color }));
      model.position.y = 0.4;
    }
    model.scale.setScalar(towerScale(v.size, t.level));
    v.root.add(model);
    v.model = model;
    v.head = head;
    v.muzzle = muzzle;
    // Rotary cannons (Photon Storm) have their barrel cluster as a separate node that spins while it fires.
    v.barrels = model.getObjectByName('barrels') || null;
    v.spin = 0;
    v.lastShot = -9;
    v.topY = (tpl ? tpl.size.y : 0.9) * towerScale(v.size, t.level) * 0.92;
    (head || v.root).add(v.flash);
    v.flash.position.copy(head ? muzzle : new THREE.Vector3(0, v.topY, 0));
    if (head) {
      head.userData.bx = head.position.x; head.userData.bz = head.position.z;
      head.rotation.order = 'YXZ'; // yaw, then pitch (anti-air variants tilt up)
      head.rotation.set(-(v.pitch || 0), v.yaw, 0);
    }
    const c = col(t.def.color);
    if (t.type === 'tesla') {
      v.light = new THREE.PointLight(c.clone(), 0, 3 * v.size, 2);
      v.light.position.y = v.topY;
      v.root.add(v.light);
      v.orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: c.clone().multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      v.orb.position.y = v.topY;
      v.orb.userData.base = 0.28 * v.size;
      v.root.add(v.orb);
    }
  }

  // Tier-5 towers get a faint light column in the capstone path's color.
  rebuildModules(v, t) {
    for (const m of v.modules || []) m.parent.remove(m.group);
    v.modules = [];
    const p = t.tiers.indexOf(5);
    if (p < 0) return;
    const color = t.def.paths[p].color;
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * v.size, 0.5 * v.size, v.topY * 1.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: col(color).clone().multiplyScalar(1.2), map: fadeUpTexture, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    shaft.position.y = v.topY * 0.8;
    g.add(shaft);
    v.root.add(g);
    v.modules.push({ group: g, parent: v.root, anim: [() => { shaft.material.opacity = 0.035 + Math.sin(this.time * 2) * 0.01; }] });
  }

  muzzleWorld(view, out) {
    if (view.head) {
      view.head.updateWorldMatrix(true, false);
      return out.copy(view.muzzle).applyMatrix4(view.head.matrixWorld);
    }
    return out.copy(view.root.position).add(tmpV2.set(0, view.topY, 0));
  }

  syncTowers(game, dt, ui) {
    const seen = new Set();
    for (const t of game.towers) {
      seen.add(t.id);
      let v = this.towerViews.get(t.id);
      if (!v) { v = this.makeTowerView(t); this.towerViews.set(t.id, v); }
      const key = t.tiers.join('');
      if (v.tierKey !== key) {
        v.tierKey = key;
        this.setTowerModel(v, t);
        v.model.scale.setScalar(towerScale(v.size, t.level));
        this.rebuildModules(v, t);
        const mp = t.mainPath;
        v.ringColor = col(mp >= 0 ? t.def.paths[mp].color : t.def.color);
        v.ring.material.opacity = 0.45 + t.level * 0.1;
      }
      for (const m of v.modules) for (const a of m.anim) a(dt);
      // Hologram build-in.
      const b = t.built;
      v.root.scale.set(1, 0.15 + 0.85 * (1 - (1 - b) ** 3), 1);
      if (v.head) {
        if (t.type === 'cryo') v.head.rotation.y += dt * (0.8 + t.fireFlash * 8);
        else if (t.type === 'uplink') v.head.rotation.y += dt * 1.6;
        else {
          // Anti-air variant: head tilted skyward; with nothing to shoot at, it sweeps the sky around its last bearing.
          const aa = t.variantDef?.hits === 'air';
          const scan = aa && !t.engaged;
          const want = yawOf(t.angle) + (scan ? Math.sin(this.time * 0.7 + t.id * 1.7) * 1.2 : 0);
          v.yaw = lerpAngle(v.yaw, want, Math.min(1, dt * (scan ? 3 : 14)));
          v.pitch += ((aa ? AA_PITCH : 0) - v.pitch) * Math.min(1, dt * 3);
          v.head.rotation.set(-v.pitch, v.yaw, 0);
          v.recoil = Math.max(0, v.recoil - dt * 6);
          const back = v.recoil * 0.07;
          v.head.position.x = v.head.userData.bx - Math.sin(v.yaw) * back;
          v.head.position.z = v.head.userData.bz - Math.cos(v.yaw) * back;
        }
      }
      if (v.barrels) {
        // Spin up as soon as there's a target (before the first round), wind down slowly after the last shot; the
        // muzzle flash strobes while it's shooting.
        const firing = this.time - v.lastShot < 0.25 && t.jamT <= 0;
        const spinning = firing || t.engaged;
        v.spin += ((spinning ? 30 : 0) - v.spin) * Math.min(1, dt * (spinning ? 5 : 1.2));
        v.barrels.rotation.z += v.spin * dt;
        v.flash.material.opacity = firing ? (Math.random() < 0.5 ? 0.8 : 0.3) : 0;
        v.flash.scale.setScalar((firing ? 0.2 + Math.random() * 0.15 : 0.15) * v.size);
      } else {
        // Slow weapons show their load building at the muzzle (and holding there when loaded and waiting).
        const load = t.engaged && t.stats.rate < 2 ? THREE.MathUtils.smoothstep(t.charge, 0.3, 1) * 0.45 : 0;
        v.flash.material.opacity = Math.max(load, Math.min(1, t.fireFlash * 8));
        v.flash.scale.setScalar((0.35 + t.fireFlash * 3 + load * 0.4) * v.size);
      }
      if (v.light) v.light.intensity = t.fireFlash > 0 ? 2.5 + Math.random() * 2.5 : 0.6;
      if (v.orb) v.orb.scale.setScalar(v.orb.userData.base + Math.sin(this.time * 9 + t.id) * 0.04 + t.fireFlash * 0.8 * v.size);
      const sel = ui.selected === t;
      // Offline (jammed / EMP'd / hijacked): crackling static, the tesla orb gutters, the base ring turns warning red.
      const jammed = t.jamT > 0;
      const jamCol = t.jamKind === 'hijack' ? '#ffe600' : '#ff2a6a';
      if (jammed) {
        if (Math.random() < dt * 16 && !this.fxBusy) {
          const a = Math.random() * TAU, r = 0.25 * v.size;
          this.sparkBurst(v.root.position.x + Math.cos(a) * r, v.topY * (0.5 + Math.random() * 0.5), v.root.position.z + Math.sin(a) * r, jamCol, 2, 1.6, { life: 0.18, size: 0.025, grav: 0, up: 0.1 });
        }
        if (v.orb) v.orb.scale.setScalar(v.orb.userData.base * (Math.random() < 0.3 ? 0.2 : 0.6));
        if (v.light) v.light.intensity = Math.random() < 0.2 ? 1.5 : 0;
      }
      const ringCol = jammed ? col(jamCol) : t.firewalled > 0 ? col('#39ff14') : (v.ringColor || col(t.def.color));
      v.ring.material.color.copy(ringCol).multiplyScalar(jammed ? 2.5 + Math.random() * 1.5 : sel ? 4 : 2);
    }
    for (const [id, v] of this.towerViews) {
      if (!seen.has(id)) {
        this.dynGroup.remove(v.root);
        this.towerViews.delete(id);
        const q = v.root.position;
        this.sparkBurst(q.x, 0.4, q.z, '#ffffff', 24, 3.5, { life: 0.6, size: 0.04, up: 0.8 });
        this.smokePuff(q.x, 0.3, q.z, 4, { size: 0.35 * v.size, grow: 2.2, spread: 0.3 * v.size, rise: 0.4, life: 1.2, alpha: 0.35 });
      }
    }
  }

  ghost(type) {
    this.ghosts = this.ghosts || {};
    if (this.ghosts[type]) return this.ghosts[type];
    const tpl = this.assets.get('tower_' + type);
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: col(TOWERS[type].color).clone().multiplyScalar(1.4), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    if (tpl) {
      const m = tpl.scene.clone(true);
      m.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
      m.scale.setScalar(towerScale(TOWERS[type].size || 1));
      g.add(m);
      g.userData.head = m.getObjectByName('head');
      if (g.userData.head) g.userData.head.rotation.order = 'YXZ';
    }
    g.userData.mat = mat;
    this.scene.add(g);
    this.ghosts[type] = g;
    return g;
  }

  // -------------------------------------------------------------------------------- enemies
  makeEnemyView(e) {
    const vis = ENEMY_VIS[e.type];
    const tpl = this.assets.get(vis.model) || this.assets.get('enemy_runner');
    let obj, mixer = null, action = null;
    const rigged = tpl && tpl.animations.length > 0;
    if (rigged) {
      obj = SkeletonUtils.clone(tpl.scene);
      mixer = new THREE.AnimationMixer(obj);
      let clip = this.assets.clip(vis.model, vis.clip);
      if (vis.clip === 'walk' && vis.model === 'enemy_runner') clip = this.assets.clip('enemy_runner_walk', 'walk') || clip;
      if (clip) {
        action = mixer.clipAction(clip);
        action.play();
        action.time = Math.random() * clip.duration;
      }
    } else if (tpl) {
      obj = tpl.scene.clone(true);
    } else {
      obj = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshStandardMaterial({ color: e.def.color }));
    }
    const mats = [];
    // A variant wears its color on its neon (hue-shifted like the tower paths); new threats have their own hue.
    const variant = e.mods.find((m) => m !== 'ghosted');
    const recolor = variant ? MODS[variant].color : vis.recolor;
    const tint = variant ? (variant === 'mirror' ? 0.5 : 0.38) : vis.tint;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !!e.def.boss;
      o.material = recolor ? recolorMaterial(o.material, recolor, tint) : o.material.clone();
      if (variant === 'mirror') { o.material.metalness = 1; o.material.roughness = 0.16; }
      else if (vis.darken && !variant) o.material.color.multiplyScalar(vis.darken); // gunmetal instead of white armor
      mats.push(o.material);
      o.material.userData.baseEmissive = o.material.emissiveIntensity;
      o.material.userData.baseEmissiveColor = o.material.emissive.clone();
      o.material.userData.baseColor = o.material.color.clone();
    });
    const inner = new THREE.Group();
    inner.add(obj);
    obj.scale.setScalar(vis.height && tpl ? vis.height / tpl.size.y : vis.scale || 1);
    const root = new THREE.Group();
    root.add(inner);
    const height = vis.height || (tpl ? tpl.size.y * (vis.scale || 1) : 0.5);
    let shield = null;
    const shieldSize = vis.shield || (e.maxShield > 0 ? Math.max(0.45, height * 0.62) : 0); // Warded variants
    if (shieldSize) {
      shield = new THREE.Mesh(this.sphereGeo, this.shieldMatBase.clone());
      shield.scale.setScalar(shieldSize);
      shield.position.y = (vis.hover || 0) + (vis.shield ? shieldSize * 0.55 : height * 0.5);
      root.add(shield);
    }
    // Courier's stolen packet, riding above its head.
    let packet = null;
    if (e.def.courier) {
      packet = new THREE.Mesh(this.packetGeo, this.packetMat);
      packet.position.y = height + 0.28;
      packet.visible = false;
      root.add(packet);
    }
    // Jammer field: a faint disc on the road showing the area it knocks out.
    let jamDisc = null;
    if (e.def.jam) {
      jamDisc = new THREE.Mesh(this.ringPlane, new THREE.MeshBasicMaterial({ map: this.tex.ring, color: col(e.def.color).clone().multiplyScalar(0.9), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      jamDisc.scale.setScalar(e.def.jam.radius);
      jamDisc.renderOrder = 5;
      root.add(jamDisc);
    }
    // Spawn-in glitch: start scaled down.
    root.scale.setScalar(0.01);
    this.dynGroup.add(root);
    return { root, inner, obj, mixer, action, mats, vis, shield, shieldSize, packet, jamDisc, height, yaw: yawOf(e.angle), cloaked: false, slowed: false, age: 0, healT: Math.random(), jamPulse: Math.random() };
  }

  // Hijacked by the hero: the enemy's neon and armor take the hack color for the rest of its short life.
  hackView(v) {
    v.hacked = true;
    v.mats.length = 0;
    v.obj.traverse((o) => {
      if (!o.isMesh) return;
      const m = recolorMaterial(o.material, HERO_RULES.hackColor, 0.55);
      m.userData.baseEmissive = o.material.userData.baseEmissive ?? o.material.emissiveIntensity;
      m.userData.baseEmissiveColor = o.material.emissive.clone();
      m.userData.baseColor = o.material.userData.baseColor ?? o.material.color.clone();
      m.transparent = false; m.opacity = 1; m.depthWrite = true;
      o.material = m;
      v.mats.push(m);
    });
    v.cloaked = false;
    v.chill = 0;
  }

  // Middle of the model: the root already sits at the enemy's hover / flight height.
  enemyCenter(v, out) {
    return out.copy(v.root.position).add(tmpV2.set(0, v.height * 0.5, 0));
  }

  syncEnemies(game, dt) {
    const seen = new Set();
    for (const e of game.enemies) {
      seen.add(e.id);
      let v = this.enemyViews.get(e.id);
      if (!v) { v = this.makeEnemyView(e); this.enemyViews.set(e.id, v); }
      if (e.converted && !v.hacked) this.hackView(v);
      v.age += dt;
      const sp = Math.min(1, v.age * 3);
      v.root.scale.setScalar(sp < 1 ? 0.3 + sp * 0.7 : 1);
      const hover = v.vis.hover || 0;
      const bob = hover ? Math.sin(this.time * 3 + e.id) * 0.05 : v.vis.crawl ? Math.abs(Math.sin(this.time * 14 + e.id)) * 0.02 : 0;
      let y = hover;
      if (e.flying) {
        // Up from the gate to cruise height, diving into the core; escorts launched from a boss on the road climb too.
        const want = flightAlt(e.dist, e.remaining, hover);
        if (v.alt == null) v.alt = e.air ? want : hover;
        v.alt += (want - v.alt) * Math.min(1, dt * 2.5);
        y = v.alt;
      }
      v.root.position.set(wx(e.x), y + bob, wz(e.y));
      v.yaw = lerpAngle(v.yaw, yawOf(e.angle), Math.min(1, dt * 10));
      v.inner.rotation.y = v.vis.spin ? v.inner.rotation.y + dt * 0.4 : v.yaw;
      if (v.vis.tilt) v.inner.rotation.x = e.stunT > 0 ? 0 : 0.22;
      if (v.mixer) {
        const moving = e.stunT <= 0;
        const slow = e.slowT > 0 ? 1 - e.slowAmt * (e.def.boss ? 0.5 : 1) : 1;
        v.mixer.update(moving ? dt * v.vis.animRate * e.speed * slow : 0);
      }
      // Cloak: a flickering violet hologram, readable but clearly "not targetable".
      const cloaked = !e.revealed;
      if (cloaked !== v.cloaked) {
        v.cloaked = cloaked;
        for (const m of v.mats) {
          m.transparent = cloaked; m.opacity = 1; m.depthWrite = !cloaked; m.needsUpdate = true;
          m.color.copy(m.userData.baseColor).multiply(cloaked ? CLOAK_TINT : NO_TINT);
        }
        v.slowed = false;
      }
      if (cloaked) {
        const glitch = Math.sin(this.time * 23 + e.id * 3) > 0.92 ? 0.1 : 0;
        const o = 0.42 + 0.1 * Math.sin(this.time * 9 + e.id) - glitch;
        for (const m of v.mats) m.opacity = o;
      }
      // Hit flash / slow tint.
      const slowed = e.slowT > 0;
      const flashing = e.flash > 0;
      if (flashing || v.flashing) {
        for (const m of v.mats) {
          m.emissiveIntensity = (m.userData.baseEmissive || 0) + e.flash * 12;
          if (!m.emissiveMap) m.emissive.copy(flashing ? NO_TINT : m.userData.baseEmissiveColor);
        }
        v.flashing = flashing;
      }
      const chill = e.frozenT > 0 ? 2 : slowed ? 1 : 0;
      if (chill !== v.chill && !cloaked) for (const m of v.mats) m.color.copy(m.userData.baseColor).multiply(chill === 2 ? FROZEN_TINT : chill ? SLOW_TINT : NO_TINT);
      v.chill = chill;
      v.slowed = slowed;
      if (e.burnT > 0 && Math.random() < dt * 14 && !this.fxBusy) {
        this.enemyCenter(v, tmpV);
        this.sparks.add(tmpV.x + (Math.random() - 0.5) * 0.25, tmpV.y, tmpV.z + (Math.random() - 0.5) * 0.25, {
          vel: [(Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3], color: EMBER_HOT, end: EMBER_COOL,
          size: 0.04, endSize: 0.02, life: 0.5, stretch: 0.7, grav: 0.8, drag: 1.2,
        });
        if (Math.random() < 0.15) this.smokePuff(tmpV.x, tmpV.y + 0.1, tmpV.z, 1, { size: 0.15, grow: 2.5, spread: 0.1, rise: 0.7, life: 0.9, alpha: 0.3, warm: 0.4 });
      }
      // A ward gained mid-fight (a boss adapting) gets its bubble the first time it shows up.
      if (!v.shield && e.maxShield > 0) {
        v.shieldSize = Math.max(0.45, v.height * 0.62);
        v.shield = new THREE.Mesh(this.sphereGeo, this.shieldMatBase.clone());
        v.shield.scale.setScalar(v.shieldSize);
        v.shield.position.y = v.height * 0.5;
        v.root.add(v.shield);
      }
      if (v.shield) {
        const k = e.maxShield ? e.shield / e.maxShield : 0;
        v.shield.visible = (k > 0.01 && !cloaked) || e.phaseT > 0;
        v.shieldPulse = Math.max(0, (v.shieldPulse || 0) - dt * 6);
        v.shield.material.uniforms.opacity.value = 0.25 + k * 0.75 + v.shieldPulse * 1.2 + (e.phaseT > 0 ? 0.8 : 0);
        v.shield.scale.setScalar(v.shieldSize * (1 + v.shieldPulse * 0.06));
        v.shield.material.uniforms.time.value = this.time;
      }
      // Boss phase transition: untouchable, flickering white-hot.
      if (e.phaseT > 0) {
        const f = 0.5 + 0.5 * Math.sin(this.time * 40);
        for (const m of v.mats) m.emissiveIntensity = (m.userData.baseEmissive || 0) + 4 * f;
        v.phasing = true;
      } else if (v.phasing) {
        for (const m of v.mats) m.emissiveIntensity = m.userData.baseEmissive || 0;
        v.phasing = false;
      }
      if (e.surgeT > 0 && Math.random() < dt * 25 && !this.fxBusy) {
        this.sparkBurst(v.root.position.x, 0.15, v.root.position.z, e.def.color, 3, 2, { life: 0.4, size: 0.04, up: 0.2, grav: -2 });
      }
      if (v.packet) {
        v.packet.visible = e.carrying;
        if (e.carrying) {
          v.packet.rotation.y += dt * 3;
          v.packet.rotation.x += dt * 1.3;
          v.packet.position.y = v.height + 0.28 + Math.sin(this.time * 5 + e.id) * 0.04;
        }
      }
      if (v.jamDisc) {
        // The field is down while the jammer is stunned.
        const live = e.stunT <= 0;
        v.jamDisc.visible = live;
        v.jamDisc.position.y = 0.13 - v.root.position.y;
        v.jamDisc.material.opacity = 0.12 + 0.05 * Math.sin(this.time * 7 + e.id);
        v.jamPulse -= dt;
        if (live && v.jamPulse <= 0) {
          v.jamPulse = 1.3;
          this.shockwave(v.root.position.x, v.root.position.z, 0.3, e.def.jam.radius, e.def.color, 1.0, 0.45);
        }
      }
      if (e.stunT > 0 && Math.random() < dt * 20) {
        this.enemyCenter(v, tmpV);
        this.sparkBurst(tmpV.x, tmpV.y, tmpV.z, '#00f0ff', 2, 2.5, { life: 0.22, size: 0.03, grav: 0 });
      }
      if (e.def.heal) {
        v.healT -= dt;
        if (v.healT <= 0) {
          v.healT = 1.1;
          this.shockwave(v.root.position.x, v.root.position.z, 0.2, e.def.heal.radius, '#39ff14', 0.8, 0.6);
        }
      }
    }
    for (const [id, v] of this.enemyViews) {
      if (!seen.has(id)) {
        this.dynGroup.remove(v.root);
        this.enemyViews.delete(id);
      }
    }
    let n = 0;
    const m4 = this.blobMatrix || (this.blobMatrix = new THREE.Matrix4());
    for (const e of game.enemies) {
      if (e.def.boss || n >= 512) continue;
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const s = e.radius / TILE * (v.vis.hover ? 2.2 : 2.8) * v.root.scale.x;
      m4.makeScale(s, 1, s).setPosition(v.root.position.x, 0.02, v.root.position.z);
      this.blobs.setMatrixAt(n++, m4);
    }
    this.blobs.count = n;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  syncShells(game) {
    const seen = new Set();
    for (const p of game.projectiles) {
      seen.add(p.id);
      let m = this.shellViews.get(p.id);
      if (!m) {
        m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: col(p.color).clone().multiplyScalar(5), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        m.scale.setScalar(0.38);
        const tv = this.towerViews.get(p.tower?.id);
        m.userData.start = tv ? this.muzzleWorld(tv, new THREE.Vector3()) : new THREE.Vector3(wx(p.x0), p.kind === 'missile' ? 0.95 : 0.8, wz(p.y0));
        if (p.kind === 'missile') m.scale.setScalar(0.22);
        this.dynGroup.add(m);
        this.shellViews.set(p.id, m);
      }
      const k = Math.min(1, p.t / p.dur);
      const s = m.userData.start;
      const tx = wx(p.tx), tz = wz(p.ty);
      m.position.set(s.x + (tx - s.x) * k, s.y + (0.15 - s.y) * k + Math.sin(k * Math.PI) * (1.2 + p.dur), s.z + (tz - s.z) * k);
      RAMP_A.copy(col(p.color)).lerp(WHITE, 0.5).multiplyScalar(3.5);
      RAMP_B.copy(col(p.color)).multiplyScalar(0.3);
      this.sparks.add(m.position.x, m.position.y, m.position.z, {
        vel: [(Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4],
        color: RAMP_A, end: RAMP_B, size: 0.14, endSize: 0.03, life: 0.3, drag: 3,
      });
      if (Math.random() < 0.35) this.smokePuff(m.position.x, m.position.y, m.position.z, 1, { size: 0.1, grow: 3, spread: 0.02, rise: 0.15, life: 0.9, alpha: 0.28, warm: 0.5 });
    }
    for (const [id, m] of this.shellViews) {
      if (!seen.has(id)) { this.dynGroup.remove(m); this.shellViews.delete(id); }
    }
  }

  // Dropped data packets drifting back to the core along the road.
  syncPackets(game, dt) {
    const seen = new Set();
    for (const pk of game.packets) {
      seen.add(pk.id);
      let m = this.packetViews.get(pk.id);
      if (!m) {
        m = new THREE.Group();
        m.add(new THREE.Mesh(this.packetGeo, this.packetMat));
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: col('#3dffc5').clone().multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        glow.scale.setScalar(0.55);
        m.add(glow);
        m.scale.setScalar(1.3);
        this.dynGroup.add(m);
        this.packetViews.set(pk.id, m);
      }
      m.position.set(wx(pk.x), 0.45 + Math.sin(this.time * 4 + pk.id) * 0.06, wz(pk.y));
      m.children[0].rotation.y += dt * 2.5;
      m.children[0].rotation.x += dt;
      if (Math.random() < dt * 8 && !this.fxBusy) this.sparkBurst(m.position.x, m.position.y, m.position.z, '#3dffc5', 1, 0.8, { life: 0.5, size: 0.03, grav: 0.5, up: 0.5 });
    }
    for (const [id, m] of this.packetViews) {
      if (!seen.has(id)) { this.dynGroup.remove(m); this.packetViews.delete(id); }
    }
  }

  // -------------------------------------------------------------------------------- effects
  // -------------------------------------------------------------------------------- hero
  // Position and size of a tower's view, or the hero's (for effects shared by both: upgrades, rank-ups, jams).
  unitView(t) {
    if (t?.isHero) return this.heroView ? { root: this.heroView.root, size: 1, topY: 0.95 } : null;
    return this.towerViews.get(t?.id);
  }

  makeHeroView(h) {
    const tpl = this.assets.get('hero_warbot');
    const actions = {};
    let obj, mixer = null;
    if (tpl) {
      obj = SkeletonUtils.clone(tpl.scene);
      mixer = new THREE.AnimationMixer(obj);
      for (const clip of tpl.animations) {
        const a = mixer.clipAction(clip);
        if (HERO_ONCE.has(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        actions[clip.name] = a;
      }
    } else {
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: HERO.color }));
      obj.position.y = 0.3;
    }
    obj.scale.setScalar(HERO_SCALE);
    const mats = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      o.material.userData.baseEmissive = o.material.emissiveIntensity;
      mats.push(o.material);
    });
    const inner = new THREE.Group();
    inner.add(obj);
    const root = new THREE.Group();
    root.add(inner);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.51, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col(HERO.color).clone().multiplyScalar(2), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }));
    ring.position.y = 0.02;
    root.add(ring);
    const bone = (n) => obj.getObjectByName(n) || null;
    this.dynGroup.add(root);
    return {
      root, inner, obj, mixer, actions, mats, ring, state: null, current: null, yaw: yawOf(h.heading), yawRate: 0, twist: 0,
      spine: bone('Spine'), barrels: [bone('Barrel_L'), bone('Barrel_R')], recoil: [0, 0], lastHp: h.hp, loss: 0, hitT: 0, hurt: 0,
    };
  }

  // Cross-fade the hero to clip `want` (a one-shot clip restarts when asked again).
  heroAnim(v, want, fade = 0.2) {
    if (v.state === want || !v.actions[want]) return;
    const next = v.actions[want];
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (v.current && v.current !== next) v.current.crossFadeTo(next, fade, false);
    v.current = next;
    v.state = want;
  }

  // Muzzle of cannon `side` (0 = left) in world space.
  heroMuzzle(v, side, out) {
    const b = v.barrels[side];
    if (!b) return out.copy(v.root.position).add(tmpV2.set(0, 0.9, 0));
    return b.localToWorld(out.set(0, 0.14, 0));
  }

  syncHero(game, dt, ui) {
    const h = game.hero;
    if (!h) {
      if (this.heroView) { this.dynGroup.remove(this.heroView.root); this.heroView = null; }
      return;
    }
    const v = this.heroView || (this.heroView = this.makeHeroView(h));
    v.root.position.set(wx(h.x), 0, wz(h.y));
    const prev = v.yaw;
    v.yaw = lerpAngle(v.yaw, yawOf(h.heading), Math.min(1, dt * 12));
    v.yawRate += ((dt > 0 ? wrapAngle(v.yaw - prev) / dt : 0) - v.yawRate) * Math.min(1, dt * 8);
    v.inner.rotation.y = v.yaw;
    // A hard knock (a big chunk of hull gone at once) staggers it when it's standing still.
    v.loss = Math.max(0, v.loss - dt * h.maxHp * 0.1) + Math.max(0, v.lastHp - h.hp);
    v.lastHp = h.hp;
    v.hitT = Math.max(0, v.hitT - dt);
    if (v.loss > h.maxHp * 0.05 && h.online && !h.moving) { v.loss = 0; v.hitT = 0.55; v.state = null; }
    let want;
    if (h.downT > 0) want = 'death';
    else if (h.rebootT > 0) want = 'activate';
    else if (v.hitT > 0) want = 'hit';
    else if (h.moving) want = 'run';
    else if (Math.abs(v.yawRate) > 0.9) want = v.yawRate > 0 ? 'turn_left' : 'turn_right';
    else if (h.engaged) want = 'fire';
    else want = 'idle';
    this.heroAnim(v, want, want === 'death' || want === 'hit' ? 0.1 : 0.2);
    if (v.mixer) {
      // The run cycle matches its stride to the ground speed; offline, the collapse plays out and holds.
      if (v.current) v.current.timeScale = want === 'run' ? h.stats.speed / HERO_RUN_SPEED : want.startsWith('turn') ? 1.3 : 1;
      v.mixer.update(dt);
    }
    // The torso twists the cannons onto the target (the legs keep walking), and each shot kicks its barrel back.
    const aim = h.engaged && h.online ? THREE.MathUtils.clamp(wrapAngle(yawOf(h.angle) - v.yaw), -1.1, 1.1) : 0;
    v.twist += (aim - v.twist) * Math.min(1, dt * 8);
    if (v.spine && Math.abs(v.twist) > 1e-3) v.spine.rotateY(v.twist);
    for (let i = 0; i < 2; i++) {
      v.recoil[i] = Math.max(0, v.recoil[i] - dt * 7);
      if (v.barrels[i] && v.recoil[i] > 0 && v.state !== 'fire') v.barrels[i].position.y -= 0.05 * v.recoil[i];
    }
    // Hull damage flashes the neon; offline it gutters and sparks.
    v.hurt = Math.max(h.hurtT > 0 ? 1 : 0, v.hurt - dt * 5);
    const down = h.downT > 0;
    for (const m of v.mats) m.emissiveIntensity = (m.userData.baseEmissive || 0) * (down ? (Math.random() < 0.15 ? 0.6 : 0.05) : 1 + v.hurt * 2);
    const jammed = h.jamT > 0;
    if ((down || jammed) && Math.random() < dt * 14 && !this.fxBusy) {
      const a = Math.random() * TAU;
      this.sparkBurst(v.root.position.x + Math.cos(a) * 0.3, 0.3 + Math.random() * 0.5, v.root.position.z + Math.sin(a) * 0.3, jammed ? '#ff2a6a' : '#ffb000', 2, 1.6, { life: 0.2, size: 0.025, grav: -4, up: 0.2 });
    }
    const sel = ui.selected === h;
    const rc = down ? col('#ff3355') : jammed ? col('#ff2a6a') : col(HERO.color);
    v.ring.material.color.copy(rc).multiplyScalar(down ? 1 + Math.sin(this.time * 6) : sel ? 3.5 + Math.sin(this.time * 5) * 0.8 : 1.8);
  }

  // Translucent hero model following the cursor while it's being deployed.
  heroGhost() {
    if (this.heroGhostObj) return this.heroGhostObj;
    const tpl = this.assets.get('hero_warbot');
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: col(HERO.color).clone().multiplyScalar(1.4), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    if (tpl) {
      const m = SkeletonUtils.clone(tpl.scene);
      m.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
      m.scale.setScalar(HERO_SCALE);
      g.add(m);
    }
    g.userData.mat = mat;
    this.scene.add(g);
    this.heroGhostObj = g;
    return g;
  }

  // Screen-space hit test on the hero (it's tall, so clicks near its body count).
  pickHero(clientX, clientY, game) {
    const h = game.hero, v = this.heroView;
    if (!h || !v) return null;
    const rect = this.canvas.getBoundingClientRect();
    const c = v.root.position;
    const p = this.project(c.x, 0.45, c.z), top = this.project(c.x, 1.0, c.z);
    if (p.behind) return null;
    const rad = Math.max(22, Math.abs(p.sy - top.sy) * 1.1);
    return Math.hypot(p.sx - (clientX - rect.left), p.sy - (clientY - rect.top)) < rad ? h : null;
  }

  // The route the selected hero is walking, and a ring where it's headed.
  showRoute(h) {
    const pts = [[h.x, h.y], ...h.route];
    const key = pts.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join('|');
    if (key !== this.routeKey) {
      this.routeKey = key;
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap(([x, y]) => [wx(x), SIGHT_Y + 0.02, wz(y)]));
      this.routeLine.geometry.dispose();
      this.routeLine.geometry = geo;
      this.routeLine.computeLineDistances();
    }
    this.routeMat.dashOffset -= 0.02;
    this.routeLine.visible = pts.length > 1;
    const d = h.dest;
    this.destRing.visible = !!d;
    if (d) {
      this.destRing.position.set(wx(d.x), 0.14, wz(d.y));
      this.destRing.scale.setScalar(0.35 + Math.sin(this.time * 6) * 0.04);
      this.destRing.children[0].material.color.copy(col(HERO.color)).multiplyScalar(2.5);
      this.destRing.children[1].material.color.copy(col(HERO.color)).multiplyScalar(0.8);
    }
  }

  // Traps: thrown from the hero in an arc, then armed with a blinking light (yellow mine, cyan EMP).
  syncTraps(game, dt) {
    const seen = new Set();
    for (const tr of game.traps) {
      seen.add(tr.id);
      let m = this.trapViews.get(tr.id);
      if (!m) {
        m = new THREE.Group();
        m.add(new THREE.Mesh(this.trapGeo, this.trapMat));
        const ring = new THREE.Mesh(this.trapRingGeo, this.trapRingMats[tr.emp ? 'emp' : 'mine']);
        ring.position.y = 0.035;
        m.add(ring);
        const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: col(tr.emp ? '#00f0ff' : HERO_RULES.trapColor).clone().multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        light.scale.setScalar(0.3);
        light.position.y = 0.08;
        m.add(light);
        m.userData.light = light;
        const hv = this.heroView;
        m.userData.from = hv ? hv.root.position.clone().add(new THREE.Vector3(0, 0.7, 0)) : new THREE.Vector3(wx(tr.x), 0.7, wz(tr.y));
        this.dynGroup.add(m);
        this.trapViews.set(tr.id, m);
      }
      const k = Math.min(1, tr.age / 0.5), s = m.userData.from, tx = wx(tr.x), tz = wz(tr.y);
      m.position.set(s.x + (tx - s.x) * k, s.y + (0.03 - s.y) * k + Math.sin(k * Math.PI) * 0.5, s.z + (tz - s.z) * k);
      if (k < 1) m.rotation.y += dt * 12;
      const armed = tr.armT <= 0;
      m.userData.light.material.opacity = armed ? (Math.sin(this.time * 6 + tr.id) > 0.5 ? 1 : 0.25) : 0.1;
    }
    for (const [id, m] of this.trapViews) {
      if (!seen.has(id)) { this.dynGroup.remove(m); this.trapViews.delete(id); }
    }
  }

  addFx(obj, life, update, end) {
    this.dynGroup.add(obj);
    this.fxItems.push({ obj, life, max: life, update, end });
  }

  flashLight(x, y, z, color, intensity, dist, life) {
    const l = this.lightPool.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.set(x, y, z);
    l.color.copy(col(color));
    l.distance = dist;
    l.userData = { life, max: life, peak: intensity };
    l.intensity = intensity;
  }

  // Ground shock ring: crisp rim with a soft inner wash, easing out.
  shockwave(x, z, r0, r1, color, life, opacity = 1, y = 0.14) {
    const m = new THREE.Mesh(this.ringPlane, new THREE.MeshBasicMaterial({ map: this.tex.ring, color: col(color).clone().multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.renderOrder = 7;
    this.addFx(m, life, (k) => {
      const e = 1 - k ** 3;
      m.scale.setScalar(Math.max(0.01, r0 + (r1 - r0) * e));
      m.material.opacity = Math.min(1, k * 1.8) * opacity;
    });
  }

  // Energy beam (shader ribbon). `dissolve` erases it from the muzzle end forward as it fades.
  beam(from, to, color, width, life, { core = 1, dissolve = false, intensity = 2.2 } = {}) {
    const m = this.beamKit.make(from, to, color, width, intensity);
    const u = m.material.uniforms;
    u.uCore.value = core;
    u.uTime.value = this.time;
    this.addFx(m, life, (k) => {
      u.uTime.value = this.time;
      u.uFade.value = Math.min(1, k * 1.8);
      u.uWidth.value = width * (0.3 + 0.7 * Math.sqrt(k));
      if (dissolve) u.uCut.value = -0.15 + (1 - k) * 1.25;
    });
    return m;
  }

  // Rotary cannon round: a white-hot tracer streaking from the barrel currently at the firing position (the cluster
  // spins, so shots walk around the ring), a spray of heat from the side vents, and a spark where it lands.
  tracer(tv, to, color) {
    tv.lastShot = this.time;
    tv.recoil = Math.max(tv.recoil, 0.25 + Math.random() * 0.2); // vibration rather than a single kick
    const b = tv.barrels;
    b.updateWorldMatrix(true, false);
    const a = (tv.shotN = (tv.shotN || 0) + 1) * (Math.PI / 3) + b.rotation.z;
    const from = new THREE.Vector3(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.86).applyMatrix4(b.matrixWorld);
    const dir = tmpV.copy(to).sub(from);
    const dist = dir.length();
    dir.normalize();
    // A little spray, like any rotary gun.
    dir.x += (Math.random() - 0.5) * 0.03; dir.y += (Math.random() - 0.5) * 0.02; dir.z += (Math.random() - 0.5) * 0.03;
    dir.normalize();
    const speed = 20;
    RAMP_A.copy(col(color)).lerp(WHITE, 0.75).multiplyScalar(5);
    RAMP_B.copy(col(color)).multiplyScalar(2.2);
    this.sparks.add(from.x, from.y, from.z, {
      vel: [dir.x * speed, dir.y * speed, dir.z * speed], color: RAMP_A, end: RAMP_B,
      size: 0.055, endSize: 0.05, life: Math.max(0.05, dist / speed), stretch: 0.32, drag: 0, grav: 0,
    });
    if (Math.random() < 0.45) this.flare(from.x, from.y, from.z, color, 0.35, 0.05, 2.5);
    if (Math.random() < 0.35) this.sparkBurst(to.x, to.y, to.z, color, 3, 2.5, { life: 0.2, size: 0.025, grav: -4 });
    if (Math.random() < 0.2 && !this.fxBusy) {
      // Heat vented sideways out of the housing.
      const head = tv.head;
      const side = tmpV2.set(Math.cos(head.rotation.y), 0, -Math.sin(head.rotation.y)).multiplyScalar(0.25 * tv.size);
      const p = tv.root.position;
      this.sparks.add(p.x + side.x, tv.topY * 0.85, p.z + side.z, {
        vel: [side.x * 6 + (Math.random() - 0.5), 1 + Math.random() * 1.2, side.z * 6 + (Math.random() - 0.5)],
        color: EMBER_HOT, end: EMBER_COOL, size: 0.03, endSize: 0.02, life: 0.5, grav: -6, drag: 1.5, stretch: 0.4,
      });
    }
  }

  // Optional eye-candy yields when many effects are alive (keeps 3x-speed hordes smooth).
  get fxBusy() { return this.fxItems.length > 140; }

  glowPuff(pos, color, size, life, intensity = 4) {
    if (this.fxBusy) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: col(color).clone().multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.position.copy(pos);
    this.addFx(s, life, (k) => { s.material.opacity = k; s.scale.setScalar(size * (1.4 - 0.4 * k)); });
  }

  // Sharp lens flare (hot core + anamorphic streak), nudged toward the camera so it isn't buried in the model.
  flare(x, y, z, color, size, life, intensity = 3) {
    // Budget: stacked additive flares from a chain of kills would white out the screen.
    if (this.flareCount >= 14 || (this.fxBusy && size < 0.8)) return;
    if (this.flareCount >= 8) intensity *= 0.5;
    this.flareCount = (this.flareCount || 0) + 1;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flare, color: col(color).clone().multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.position.set(x, y, z).add(tmpV2.copy(this.camera.position).sub(s.position).normalize().multiplyScalar(0.3));
    s.renderOrder = 12;
    s.material.rotation = (Math.random() - 0.5) * 0.12;
    this.addFx(s, life, (k) => { s.material.opacity = k * k; s.scale.setScalar(size * (1.25 - 0.25 * k)); }, () => { this.flareCount--; });
  }

  // Streaking sparks: born white-hot, cooling to the effect color as they fly and slow down.
  sparkBurst(x, y, z, color, n, speed, { life = 0.45, size = 0.045, up = 0.45, grav = -9, drag = 2.2, stretch = 1.0, heat = 0.6, glow = 4 } = {}) {
    if (this.fxBusy) n = Math.ceil(n / 3);
    RAMP_A.copy(col(color)).lerp(WHITE, heat).multiplyScalar(glow);
    RAMP_B.copy(col(color)).multiplyScalar(0.6);
    this.sparks.burst(x, y, z, n, speed, { color: RAMP_A, end: RAMP_B, size, endSize: size * 0.6, life, up, grav, drag, stretch });
  }

  // Rolling smoke. `warm` puffs start lit by the fire and cool to grey; `tint` makes colored mist (frost, toxins).
  smokePuff(x, y, z, n, { size = 0.4, grow = 2.6, spread = 0.2, rise = 0.6, life = 1.6, alpha = 0.5, warm = 0, tint = null } = {}) {
    if (this.fxBusy) n = Math.min(n, 1);
    if (tint) { RAMP_A.copy(col(tint)); RAMP_B.copy(col(tint)).multiplyScalar(0.4); }
    else { RAMP_A.setRGB(0.3, 0.28, 0.34).lerp(FIRE_LIT, warm); RAMP_B.setRGB(0.06, 0.055, 0.075); }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = Math.random() * spread;
      const sz = size * (0.7 + Math.random() * 0.6);
      this.smoke.add(x + Math.cos(a) * r, y + Math.random() * spread * 0.5, z + Math.sin(a) * r, {
        vel: [Math.cos(a) * (0.15 + r), rise * (0.6 + Math.random() * 0.8), Math.sin(a) * (0.15 + r)],
        color: RAMP_A, end: RAMP_B, size: sz, endSize: sz * grow, life: life * (0.7 + Math.random() * 0.6),
        grav: 0.1, drag: 1.3, alpha, fadeIn: 0.08, spin: (Math.random() - 0.5) * 1.4,
      });
    }
  }

  // Scorch mark left on the ground, with a short ember glow.
  scorch(x, z, size, life = 7) {
    if (this.scorchCount >= 40) return;
    this.scorchCount++;
    const m = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: this.tex.scorch, transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, 0.03, z);
    m.rotation.y = Math.random() * TAU;
    m.scale.setScalar(size);
    m.renderOrder = 3;
    this.addFx(m, life, (k) => { m.material.opacity = Math.min(1, k * 4) * 0.8; }, () => { this.scorchCount--; });
    const ember = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: glowTexture, color: new THREE.Color(2.2, 0.7, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    ember.position.set(x, 0.04, z);
    ember.scale.setScalar(size * 0.7);
    ember.renderOrder = 4;
    this.addFx(ember, 0.9, (k) => { ember.material.opacity = k * k * 0.8; });
  }

  // Forked lightning that re-strikes (new jag) every few frames while it lives.
  lightning(points, color, life, { width = 3.0, forks = true } = {}) {
    const jagOf = (pts, amp, n) => {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        for (let k = 0; k < n; k++) {
          const t = k / n, j = k === 0 ? 0 : amp;
          out.push(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j);
        }
      }
      const last = pts[pts.length - 1];
      out.push(last.x, last.y, last.z);
      return out;
    };
    // Segment pairs (a, b, b, c, ...) are what Line2 stores; write them in place on re-strike.
    const toSegs = (flat, dst) => {
      for (let i = 0, o = 0; i < flat.length - 3; i += 3, o += 6) {
        dst[o] = flat[i]; dst[o + 1] = flat[i + 1]; dst[o + 2] = flat[i + 2];
        dst[o + 3] = flat[i + 3]; dst[o + 4] = flat[i + 4]; dst[o + 5] = flat[i + 5];
      }
    };
    const strands = [{ pts: points, amp: 0.16, n: 7, w: width }];
    if (forks && !this.fxBusy) {
      for (let i = 0; i < points.length - 1; i++) {
        if (Math.random() < 0.6) {
          const a = points[i], b = points[i + 1], t = 0.3 + Math.random() * 0.4;
          const o = new THREE.Vector3().lerpVectors(a, b, t);
          const end = o.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.5, (Math.random() - 0.5) * 0.9));
          strands.push({ pts: [o, end], amp: 0.12, n: 4, w: width * 0.45 });
        }
      }
    }
    const grp = new THREE.Group();
    const lines = strands.map((st) => {
      const geo = new LineGeometry();
      geo.setPositions(jagOf(st.pts, st.amp, st.n));
      const mat = this.lineMat(color).clone();
      mat.resolution.set(this.width, this.height);
      mat.linewidth = st.w;
      const glowLine = new Line2(geo, mat);
      const coreMat = mat.clone();
      coreMat.color = new THREE.Color(5, 5, 5);
      coreMat.linewidth = Math.max(1, st.w * 0.35);
      const coreLine = new Line2(geo, coreMat);
      for (const l of [glowLine, coreLine]) { l.frustumCulled = false; l.renderOrder = 9; grp.add(l); }
      return { st, geo, mat, coreMat };
    });
    let next = this.time + 0.045;
    this.addFx(grp, life, (k) => {
      for (const L of lines) { L.mat.opacity = k; L.coreMat.opacity = k * (0.6 + Math.random() * 0.4); }
      if (this.time < next) return;
      next = this.time + 0.045;
      for (const L of lines) {
        const buf = L.geo.attributes.instanceStart.data;
        toSegs(jagOf(L.st.pts, L.st.amp, L.st.n), buf.array);
        buf.needsUpdate = true;
      }
    });
  }

  // Fireball flash, streaking debris and embers, rolling smoke, a shock ring and a scorch mark.
  explosion(x, y, z, color, size) {
    size = Math.min(size, 1.8);
    this.flare(x, y + 0.1, z, '#ffffff', 0.5 + size * 1.1, 0.1, 3);
    this.flare(x, y + 0.1, z, color, 0.8 + size * 1.5, 0.22, 2);
    this.flipbook(tmpV.set(x, y + size * 0.3, z), 'explosion', 0.45 + size * 2.2, 0.3 + size * 0.25, '#ffffff', 0.85 + Math.min(0.5, size * 0.5), true, 3, 15);
    this.sparkBurst(x, y, z, color, Math.min(44, 8 + size * 32), 4 + size * 6, { life: 0.5, size: 0.04 + size * 0.02, up: 0.55 });
    this.sparkBurst(x, y, z, '#ffb070', Math.min(16, 3 + size * 10), 1.6 + size * 2.4, { life: 1.1, size: 0.045 + size * 0.025, up: 0.85, grav: -2.5, drag: 2, stretch: 0.5, heat: 0.4, glow: 3 });
    this.smokePuff(x, y + 0.05, z, Math.round(1 + size * 5), { size: 0.25 + size * 0.6, grow: 2.4, spread: 0.08 + size * 0.45, rise: 0.4 + size * 0.5, life: 1.2 + size, alpha: 0.5, warm: 0.9 });
    this.shockwave(x, z, 0.05, 0.35 + size * 2, color, 0.32, 0.7, 0.06);
    if (size > 0.28) this.scorch(x, z, 0.45 + size * 1.9, 6 + size * 4);
    this.flashLight(x, y + 0.3, z, color, 12 + size * 20, 3 + size * 4, 0.25);
  }

  // -------------------------------------------------------------------------------- orbital strike
  // Lock-on while the strike charges: a satellite glint brightening high overhead, the targeting laser tightening
  // onto the spot, the ground heating up under it, energy motes spiralling in from the blast edge and up the beam,
  // the lock ring closing, and a rumble that builds.
  orbitalCharge(x, z, r, delay) {
    const color = ABILITIES.orbital.color;
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flare, color: col('#ffb3ec').clone().multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
    glint.position.set(x, ORBIT_Y * 0.8, z);
    glint.renderOrder = 12;
    this.addFx(glint, delay + 0.1, (k) => { const t = 1 - k; glint.material.opacity = Math.min(1, t * 1.6); glint.scale.setScalar(1.2 + t * 2.2 + Math.sin(this.time * 30) * 0.15); });
    const laser = this.beamKit.make(new THREE.Vector3(x, ORBIT_Y, z), new THREE.Vector3(x, 0, z), color, 0.03, 2.4);
    const u = laser.material.uniforms;
    this.addFx(laser, delay, (k) => {
      const t = 1 - k;
      u.uTime.value = this.time;
      u.uWidth.value = 0.03 + t * t * 0.3;
      u.uFade.value = (0.3 + t * 0.7) * (0.85 + Math.random() * 0.15); // flickers as it locks
    });
    const heat = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: glowTexture, color: col(color).clone().multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }));
    heat.position.set(x, 0.05, z);
    heat.renderOrder = 4;
    this.addFx(heat, delay, (k) => { const t = 1 - k; heat.material.opacity = t * t * 0.9; heat.scale.setScalar(r * (2.6 - t * 1.2)); });
    this.shockwave(x, z, r * 1.7, r, color, delay, 1, 0.08);
    let last = this.time;
    this.addFx(new THREE.Object3D(), delay, (k) => {
      const t = 1 - k;
      this.shakeT = Math.max(this.shakeT, t * 0.22);
      const dt = this.time - last;
      last = this.time;
      if (this.fxBusy) return;
      // Motes drawn in from the edge of the blast and up into the beam, more of them as the charge peaks.
      RAMP_A.copy(col('#ffd6f5')).multiplyScalar(4);
      RAMP_B.copy(col(color)).multiplyScalar(1.4);
      for (let n = Math.round(dt * (80 + 220 * t)); n > 0; n--) {
        const a = Math.random() * TAU, d = r * (1 + Math.random() * 0.7);
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        this.sparks.add(px, 0.08, pz, {
          vel: [(x - px) * 2.2 - Math.sin(a) * 1.2, 0.3 + Math.random() * 0.6, (z - pz) * 2.2 + Math.cos(a) * 1.2],
          color: RAMP_A, end: RAMP_B, size: 0.06, endSize: 0.02, life: 0.45, grav: 9, drag: 1.2, stretch: 0.7,
        });
      }
    });
  }

  // Impact: a white-hot lance slams down with a wide glow around it, a ground flash and two shock fronts race out,
  // ion arcs crackle across the ground, debris and embers fly, and a smoke column climbs. Then the lance lifts off
  // back to orbit, leaving a molten crater that cools from white to red, and a scorch mark.
  orbitalImpact(x, z, r) {
    const color = ABILITIES.orbital.color;
    const ground = new THREE.Vector3(x, 0, z), sky = new THREE.Vector3(x, ORBIT_Y, z);
    const LANCE = 1.15;
    const lance = this.beamKit.make(ground, sky, color, r * 0.6, 2.2);
    const lu = lance.material.uniforms;
    lu.uCore.value = 1.5;
    this.addFx(lance, LANCE, (k) => {
      const t = 1 - k;
      lu.uTime.value = this.time;
      // Punches in at full width, throbs while it burns, then thins out as it lifts from the ground up.
      const punch = Math.min(1, t / 0.06);
      const thin = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55;
      lu.uWidth.value = r * 0.6 * punch * (0.25 + 0.75 * thin) * (1 + Math.sin(this.time * 38) * 0.07);
      lu.uFade.value = Math.min(1, k * 3);
      lu.uCut.value = t < 0.5 ? -0.2 : -0.2 + ((t - 0.5) / 0.5) * 1.3;
    });
    const halo = this.beamKit.make(ground, sky, color, r * 1.1, 0.3);
    const hu = halo.material.uniforms;
    hu.uCore.value = 0;
    this.addFx(halo, 0.45, (k) => { hu.uTime.value = this.time; hu.uFade.value = k * k; hu.uWidth.value = r * (1.1 + (1 - k) * 0.6); });
    // Flash.
    this.flare(x, 0.6, z, '#ffffff', 1.2 + r * 0.6, 0.12, 2.5);
    this.flare(x, 0.6, z, color, 1.6 + r * 0.8, 0.35, 1.5);
    this.flashLight(x, 1.5, z, '#ff7ae0', 12, 3 + r * 1.5, 0.4);
    this.aberrationKick = 1;
    this.shakeT = Math.max(this.shakeT, 1.1);
    // Shock fronts: a fast white one, then the magenta wave.
    this.shockwave(x, z, 0.1, r * 2.2, '#ffffff', 0.3, 0.45, 0.1);
    this.shockwave(x, z, 0.2, r * 3.4, color, 0.8, 0.55, 0.09);
    // An energy burst rather than a fireball: this is a lance, not a shell.
    this.flipbook(new THREE.Vector3(x, 0.5, z), 'burst', r * 1.3, 0.45, color, 1.6, true);
    // Ion arcs crawling out across the ground from the impact.
    if (!this.fxBusy) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + Math.random() * 0.8, d = r * (1 + Math.random() * 0.6);
        const mid = new THREE.Vector3(x + Math.cos(a) * d * 0.5, 0.25 + Math.random() * 0.3, z + Math.sin(a) * d * 0.5);
        this.lightning([new THREE.Vector3(x, 0.2, z), mid, new THREE.Vector3(x + Math.cos(a) * d, 0.08, z + Math.sin(a) * d)], '#ff9ee8', 0.35 + Math.random() * 0.25, { width: 2.2 });
      }
    }
    // Debris, embers and a climbing smoke column.
    this.sparkBurst(x, 0.2, z, '#ffffff', 60, 10, { life: 0.9, size: 0.05, up: 0.75, heat: 0.8 });
    this.sparkBurst(x, 0.15, z, color, 40, 6, { life: 1.2, size: 0.045, up: 0.35, grav: -6 });
    this.sparkBurst(x, 0.2, z, '#ffb070', 30, 4, { life: 2.2, size: 0.05, up: 0.9, grav: -3, drag: 1.4, stretch: 0.4, heat: 0.4, glow: 3 });
    this.smokePuff(x, 0.2, z, 14, { size: 0.6, grow: 2.6, spread: r * 0.7, rise: 2.2, life: 3, alpha: 0.5, warm: 1 });
    this.smokePuff(x, 0.1, z, 8, { size: 0.35, grow: 2, spread: r * 1.6, rise: 0.25, life: 1.6, alpha: 0.35, warm: 0.4 });
    // Molten crater: white-hot, cooling through orange to a dull red glow, over a big scorch.
    const crater = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    crater.position.set(x, 0.045, z);
    crater.scale.setScalar(r * 1.5);
    crater.renderOrder = 4;
    const hot = new THREE.Color(1.5, 1.15, 1), warm = new THREE.Color(1.3, 0.42, 0.12), cool = new THREE.Color(0.5, 0.07, 0.04);
    this.addFx(crater, 3.2, (k) => {
      const t = 1 - k;
      crater.material.color.copy(t < 0.12 ? hot.clone().lerp(warm, t / 0.12) : warm.clone().lerp(cool, (t - 0.12) / 0.88));
      crater.material.opacity = Math.min(1, k * 1.6);
    });
    this.scorch(x, z, r * 2.6, 12);
  }

  processEvents(game) {
    const evs = game.fx.events;
    if (!evs.length) return;
    for (const ev of evs) {
      if (ev.skip3d) continue; // 2D-only garnish (e.g. the rings/sparks FX.explosion adds for the minimap renderer)
      switch (ev.type) {
        case 'beam': {
          const tv = this.towerViews.get(ev.tower?.id);
          if (!tv) break;
          const from = this.muzzleWorld(tv, new THREE.Vector3());
          if (!tv.barrels) tv.recoil = 1; // rotary cannons vibrate instead (see tracer)
          let to;
          if (ev.shard) {
            const ev2 = ev.target && this.enemyViews.get(ev.target.id);
            const src = tv.root.position.clone().add(tmpV2.set(0, tv.topY, 0));
            to = ev2 ? this.enemyCenter(ev2, new THREE.Vector3()) : new THREE.Vector3(wx(ev.x2), 0.4, wz(ev.y2));
            this.beam(src, to, '#bfe3ff', 0.06, 0.16, { core: 0.8 });
            this.sparkBurst(to.x, to.y, to.z, '#dff3ff', 5, 2.5, { life: 0.35, size: 0.035, grav: -6 });
            break;
          }
          if (ev.rail) {
            to = new THREE.Vector3(wx(ev.x2), from.y * 0.6, wz(ev.y2));
            const w = (0.16 + ev.tower.level * 0.02) * (ev.width || 1);
            this.beam(from, to, ev.color, w, 0.55, { core: 1.0, dissolve: true, intensity: 1.7 });
            this.flare(from.x, from.y, from.z, ev.color, 1.1, 0.14, 2.5);
            this.flare(from.x, from.y, from.z, '#ffffff', 0.6, 0.08, 3);
            this.sparkBurst(from.x, from.y, from.z, '#ffffff', 10, 4, { life: 0.3, size: 0.035, up: 0.3 });
            this.smokePuff(from.x, from.y, from.z, 3, { size: 0.22, grow: 3, spread: 0.12, rise: 0.25, life: 1.1, alpha: 0.35, warm: 0.4 });
            this.flashLight(from.x, from.y, from.z, ev.color, 8, 2.5, 0.15);
            // Ionized corkscrew trail and a thin smoke line along the slug's path.
            if (!this.fxBusy) {
              const dir = tmpV.copy(to).sub(from);
              const len = dir.length();
              dir.normalize();
              const s1 = new THREE.Vector3().crossVectors(dir, UP).normalize(), s2 = new THREE.Vector3().crossVectors(dir, s1);
              RAMP_A.copy(col(ev.color)).lerp(WHITE, 0.4).multiplyScalar(3);
              RAMP_B.copy(col(ev.color)).multiplyScalar(0.4);
              const n = Math.min(90, Math.round(len * 7));
              for (let i = 0; i < n; i++) {
                const t = i / n, ang = t * len * 7, r = 0.09 + ev.tower.level * 0.01;
                const ox = s1.x * Math.cos(ang) * r + s2.x * Math.sin(ang) * r;
                const oy = s1.y * Math.cos(ang) * r + s2.y * Math.sin(ang) * r;
                const oz = s1.z * Math.cos(ang) * r + s2.z * Math.sin(ang) * r;
                this.sparks.add(from.x + dir.x * len * t + ox, from.y + dir.y * len * t + oy, from.z + dir.z * len * t + oz, {
                  vel: [ox * 1.5, oy * 1.5 + 0.1, oz * 1.5], color: RAMP_A, end: RAMP_B, size: 0.05, endSize: 0.02, life: 0.35 + t * 0.35, drag: 2,
                });
              }
              for (let d = 0.4; d < len; d += 0.7) {
                this.smokePuff(from.x + dir.x * d, from.y + dir.y * d, from.z + dir.z * d, 1, { size: 0.12, grow: 3.2, spread: 0.02, rise: 0.12, life: 1.2, alpha: 0.22 });
              }
            }
            this.sparkBurst(to.x, to.y, to.z, ev.color, 8, 3.5, { life: 0.4, size: 0.04 });
          } else if (tv.barrels) {
            const ev2 = ev.target && this.enemyViews.get(ev.target.id);
            to = ev2 ? this.enemyCenter(ev2, new THREE.Vector3()) : new THREE.Vector3(wx(ev.x2), 0.4, wz(ev.y2));
            this.tracer(tv, to, ev.color);
          } else {
            const ev2 = ev.target && this.enemyViews.get(ev.target.id);
            to = ev2 ? this.enemyCenter(ev2, new THREE.Vector3()) : new THREE.Vector3(wx(ev.x2), 0.4, wz(ev.y2));
            this.beam(from, to, ev.color, 0.07 + ev.tower.level * 0.012, 0.11);
            this.flare(from.x, from.y, from.z, ev.color, 0.45, 0.06, 3);
            this.flare(to.x, to.y, to.z, ev.color, 0.55, 0.09, 3);
            this.sparkBurst(to.x, to.y, to.z, ev.color, 4, 3, { life: 0.28, size: 0.03 });
          }
          break;
        }
        case 'bolt': {
          const tv = this.towerViews.get(ev.tower?.id);
          if (!tv) break;
          const pts = [this.muzzleWorld(tv, new THREE.Vector3())];
          for (const e of ev.targets) {
            const v = this.enemyViews.get(e.id);
            if (v) pts.push(this.enemyCenter(v, new THREE.Vector3()));
          }
          if (pts.length > 1) {
            this.lightning(pts, ev.color, ev.burst ? 0.3 : 0.2, { width: ev.burst ? 4 : 3 });
            if (ev.burst) this.lightning(pts, '#ffffff', 0.22, { width: 2, forks: false });
            this.flare(pts[0].x, pts[0].y, pts[0].z, ev.color, 0.7, 0.1, 2);
            for (const p of pts.slice(1)) {
              this.flare(p.x, p.y, p.z, ev.color, 0.8, 0.14, 3);
              this.sparkBurst(p.x, p.y, p.z, ev.color, 6, 3.2, { life: 0.3, size: 0.03, grav: -4 });
            }
            this.flashLight(pts[0].x, pts[0].y, pts[0].z, ev.color, 5, 2.5, 0.12);
          }
          break;
        }
        case 'fire': {
          const tv = this.towerViews.get(ev.tower?.id);
          if (!tv) break;
          tv.recoil = 1.4;
          const p = this.muzzleWorld(tv, new THREE.Vector3());
          this.flare(p.x, p.y, p.z, ev.tower.def.color, 1.1, 0.12, 3);
          this.sparkBurst(p.x, p.y, p.z, ev.tower.def.color, 6, 2.5, { life: 0.3, size: 0.035, up: 0.8 });
          this.smokePuff(p.x, p.y, p.z, 4, { size: 0.28, grow: 2.8, spread: 0.15, rise: 0.5, life: 1.3, alpha: 0.4, warm: 0.6 });
          break;
        }
        case 'ring': {
          const r0 = ev.r0 / TILE, r1 = ev.r1 / TILE;
          if (r1 < 0.05 || (this.fxBusy && ev.life < 0.4)) break;
          const x = wx(ev.x), z = wz(ev.y);
          this.shockwave(x, z, r0, r1, ev.color, ev.life, 0.9);
          if (ev.kind === 'frost' && !this.fxBusy) {
            // Cryo pulse: a wall of frost mist rolling outward plus a spray of ice glints.
            const n = Math.min(14, 5 + Math.round(r1 * 2.5));
            RAMP_A.set(ev.color).lerp(WHITE, 0.65).multiplyScalar(0.55);
            RAMP_B.set(ev.color).lerp(WHITE, 0.3).multiplyScalar(0.18);
            for (let i = 0; i < n; i++) {
              const a = (i / n) * TAU + Math.random() * 0.4, sp = r1 * 2.4;
              const sz = 0.25 + Math.random() * 0.2;
              this.smoke.add(x + Math.cos(a) * 0.4, 0.1, z + Math.sin(a) * 0.4, {
                vel: [Math.cos(a) * sp, 0.05, Math.sin(a) * sp], color: RAMP_A, end: RAMP_B, size: sz, endSize: sz * 3.2,
                life: ev.life * 1.8, drag: 3, alpha: 0.2, fadeIn: 0.05, spin: (Math.random() - 0.5),
              });
            }
            this.sparkBurst(x, 0.3, z, ev.color, 10, r1 * 3, { life: 0.5, size: 0.03, up: 0.2, grav: -3, heat: 0.7 });
          }
          break;
        }
        case 'sparks':
          if (this.fxBusy) break;
          this.sparkBurst(wx(ev.x), 0.35, wz(ev.y), ev.color, Math.min(ev.n, 20), ev.speed / TILE * 1.6, { life: 0.45 });
          break;
        case 'explosion': {
          const s = ev.size / TILE;
          this.explosion(wx(ev.x), 0.3 + s * 0.3, wz(ev.y), ev.color, s);
          break;
        }
        case 'upgrade': {
          const tv = this.unitView(ev.tower);
          if (!tv) break;
          const color = ev.tower.def.paths[ev.path].color;
          const p = tv.root.position;
          const S = tv.size;
          const column = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * S, 0.55 * S, 5, 24, 1, true), new THREE.MeshBasicMaterial({ color: col(color).clone().multiplyScalar(2.5), map: fadeUpTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
          column.position.set(p.x, 2.5, p.z);
          this.addFx(column, 0.7, (k) => { column.material.opacity = k * 0.7; column.scale.set(1 + (1 - k) * 0.5, 1, 1 + (1 - k) * 0.5); });
          this.sparkBurst(p.x, 0.3, p.z, color, 18 + ev.tier * 6, 4, { up: 0.95, life: 0.8, size: 0.04, grav: -3, drag: 1.5 });
          this.shockwave(p.x, p.z, 0.2, 0.9 * S + ev.tier * 0.2, color, 0.6, 1, 0.12);
          this.flare(p.x, 0.9 * S, p.z, color, 1.2 + ev.tier * 0.2, 0.25, 3);
          this.flashLight(p.x, 1.2, p.z, color, 10 + ev.tier * 4, 4 + S, 0.5);
          if (ev.tier === 3) {
            // The tower takes on its path's colors.
            this.flipbook(new THREE.Vector3(p.x, 0.7, p.z), 'burst', 2 * S, 0.5, color, 3, true);
          } else if (ev.tier === 5) {
            // Evolution: a bigger blast and a lingering glow while the new form materializes.
            this.flipbook(new THREE.Vector3(p.x, 0.8, p.z), 'burst', 3.5 * S, 0.7, color, 4, true);
            this.shockwave(p.x, p.z, 0.3, 3 * S, '#ffffff', 0.8, 1, 0.12);
            this.smokePuff(p.x, 0.2, p.z, 8, { size: 0.5 * S, grow: 2.2, spread: 0.7 * S, rise: 0.3, life: 1.6, alpha: 0.3, tint: color });
            this.shakeT = Math.max(this.shakeT, 0.35);
          }
          break;
        }
        case 'zone': {
          // Burning ground: flickering glow, rising embers and wisps of smoke over a scorch mark.
          const r = ev.r / TILE, x = wx(ev.x), z = wz(ev.y);
          const glow = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: glowTexture, color: col(ev.color).clone().multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
          glow.position.set(x, 0.05, z);
          glow.scale.setScalar(r * 2.4);
          glow.renderOrder = 4;
          this.scorch(x, z, r * 2, ev.life + 4);
          RAMP_A.copy(col(ev.color)).lerp(WHITE, 0.3).multiplyScalar(3.5);
          RAMP_B.copy(col(ev.color)).multiplyScalar(0.3);
          const hot = RAMP_A.clone(), cool = RAMP_B.clone();
          this.addFx(glow, ev.life, (k) => {
            glow.material.opacity = Math.min(1, k * 3) * (0.5 + Math.random() * 0.25);
            if (this.fxBusy) return;
            if (Math.random() < 0.6) {
              const a = Math.random() * TAU, d = Math.random() * r;
              this.sparks.add(x + Math.cos(a) * d, 0.08, z + Math.sin(a) * d, { vel: [0, 1 + Math.random() * 1.2, 0], color: hot, end: cool, size: 0.035, life: 0.5 + Math.random() * 0.4, stretch: 0.6, grav: 0.4, drag: 0.8 });
            }
            if (Math.random() < 0.06) this.smokePuff(x, 0.1, z, 1, { size: 0.3, grow: 2.5, spread: r * 0.6, rise: 0.6, life: 1.4, alpha: 0.3, warm: 0.5 });
          });
          break;
        }
        case 'shatter': {
          const p = new THREE.Vector3(wx(ev.x), 0.45, wz(ev.y));
          const r = ev.r / TILE;
          this.flipbook(p, 'burst', r * 2.2, 0.4, '#bfe3ff', 3.5, true);
          this.flare(p.x, p.y, p.z, '#dff3ff', 1.2 + r, 0.18, 3);
          this.sparkBurst(p.x, p.y, p.z, '#e6f6ff', 26, 5, { life: 0.7, size: 0.04, grav: -10, heat: 0.7 });
          this.smokePuff(p.x, p.y - 0.2, p.z, 4, { size: 0.3, grow: 2.4, spread: r * 0.5, rise: 0.15, life: 1.0, alpha: 0.3, tint: '#9fd8ff' });
          break;
        }
        case 'shieldhit': {
          const v = this.enemyViews.get(ev.enemy.id);
          if (v && v.shield) {
            v.shieldPulse = 1;
            if (!this.fxBusy) {
              this.enemyCenter(v, tmpV);
              this.sparkBurst(tmpV.x, tmpV.y, tmpV.z, '#7fb2ff', 3, 2.5, { life: 0.25, size: 0.03, grav: 0 });
            }
          }
          break;
        }
        case 'kill': {
          const v = this.enemyViews.get(ev.enemy.id);
          if (v) {
            this.enemyViews.delete(ev.enemy.id);
            const c = this.enemyCenter(v, new THREE.Vector3());
            // The hull crumples into the blast instead of vanishing.
            const base = v.root.scale.clone(), spin = (Math.random() - 0.5) * 2;
            this.addFx(v.root, 0.13, (k) => { v.root.scale.copy(base).multiplyScalar(0.2 + 0.8 * k * k); v.root.rotation.y += spin * 0.05; });
            this.sparkBurst(c.x, c.y, c.z, ev.enemy.def.color, 10, 4.5, { life: 0.7, size: 0.045, up: 0.6 });
            if (ev.enemy.def.boss) {
              this.shakeT = 1;
              for (let i = 0; i < 6; i++) {
                setTimeout(() => this.explosion(c.x + (Math.random() - 0.5) * 1.6, c.y + Math.random(), c.z + (Math.random() - 0.5) * 1.6, i % 2 ? '#ffffff' : ev.enemy.def.color, 0.8), i * 90);
              }
              this.smokePuff(c.x, 0.3, c.z, 10, { size: 0.9, grow: 2.2, spread: 1.2, rise: 0.9, life: 3, alpha: 0.5, warm: 0.7 });
            }
          }
          break;
        }
        case 'leak': {
          const v = this.enemyViews.get(ev.enemy.id);
          if (v) { this.dynGroup.remove(v.root); this.enemyViews.delete(ev.enemy.id); }
          this.coreHit = 1;
          if (ev.escape) {
            // A courier got out: the breach portal flares.
            const pt = this.portals[ev.enemy.pathIdx];
            if (pt) {
              const p = pt.holder.position;
              this.flare(p.x, 1, p.z, '#3dffc5', 2.2, 0.4, 3);
              this.sparkBurst(p.x, 0.8, p.z, '#3dffc5', 24, 4, { life: 0.7, size: 0.04, up: 0.6 });
            }
          }
          break;
        }
        case 'text':
          if (!this.settings.texts && !ev.important) break;
          this.texts.push({ x: wx(ev.x), y: 0.9, z: wz(ev.y), text: ev.text, color: ev.color, size: ev.size, life: 1.1 });
          break;
        case 'reaction': {
          const v = ev.enemy && this.enemyViews.get(ev.enemy.id);
          const c = v ? this.enemyCenter(v, new THREE.Vector3()) : new THREE.Vector3(wx(ev.x), 0.5, wz(ev.y));
          if (ev.kind === 'thermal') {
            // Steam burst: fire and ice cancelling out.
            this.flare(c.x, c.y, c.z, '#fff1dc', 1.3, 0.2, 3);
            this.sparkBurst(c.x, c.y, c.z, '#ffb070', 14, 4, { life: 0.5, size: 0.04, up: 0.5 });
            this.smokePuff(c.x, c.y, c.z, 5, { size: 0.3, grow: 2.8, spread: 0.2, rise: 0.9, life: 1.2, alpha: 0.4, tint: '#e8eef5' });
          } else if (ev.kind === 'superconduct') {
            this.flare(c.x, c.y, c.z, '#bff4ff', 0.9, 0.14, 3);
            this.sparkBurst(c.x, c.y, c.z, '#9fe8ff', 6, 3, { life: 0.3, size: 0.03, grav: 0 });
          } else if (ev.kind === 'overload') {
            this.explosion(c.x, c.y, c.z, '#ffd23c', 0.45);
          } else if (ev.kind === 'exposed') {
            this.flare(c.x, c.y, c.z, '#ff3355', 1.1, 0.16, 3);
            this.sparkBurst(c.x, c.y, c.z, '#ffffff', 8, 4.5, { life: 0.3, size: 0.035, up: 0.3 });
          } else if (ev.kind === 'fracture') {
            this.flipbook(c, 'burst', 1.2, 0.35, '#bfe3ff', 3, true);
            this.sparkBurst(c.x, c.y, c.z, '#e6f6ff', 16, 4, { life: 0.6, size: 0.04, grav: -10, heat: 0.7 });
          }
          break;
        }
        case 'rankup': {
          const tv = this.unitView(ev.tower);
          if (!tv) break;
          const p = tv.root.position;
          this.sparkBurst(p.x, tv.topY, p.z, '#ffe600', 10 + ev.rank * 3, 2.5, { up: 1, life: 0.8, size: 0.035, grav: -2 });
          this.flare(p.x, tv.topY + 0.2, p.z, '#ffe600', 0.9, 0.3, 2);
          break;
        }
        case 'jam': {
          const tv = this.unitView(ev.tower);
          if (!tv) break;
          const p = tv.root.position, c = ev.kind === 'hijack' ? '#ffe600' : '#ff2a6a';
          this.sparkBurst(p.x, tv.topY, p.z, c, 12, 3, { life: 0.35, size: 0.03, grav: -3 });
          this.flare(p.x, tv.topY, p.z, c, 0.8, 0.18, 2);
          break;
        }
        case 'bossphase': {
          const v = this.enemyViews.get(ev.enemy.id);
          if (!v) break;
          const c = this.enemyCenter(v, new THREE.Vector3());
          const color = ev.enemy.type === 'titan' ? '#ff2bd6' : '#ffe600';
          const r = ev.enemy.type === 'titan' ? 3.2 : 1.8;
          const sph = new THREE.Mesh(this.sphereGeo, this.shieldMatBase.clone());
          sph.material.uniforms.color.value = col(color);
          sph.position.set(c.x, 0, c.z);
          this.addFx(sph, 0.7, (k) => { sph.scale.setScalar(r * (1.05 - k)); sph.material.uniforms.opacity.value = k * 1.5; });
          this.shockwave(c.x, c.z, 0.4, r, color, 0.8, 1, 0.1);
          this.flare(c.x, c.y, c.z, color, 3.5, 0.4, 3);
          this.flashLight(c.x, c.y, c.z, color, 30, 8, 0.5);
          this.sparkBurst(c.x, c.y, c.z, color, 40, 6, { life: 0.8, size: 0.05, up: 0.5 });
          this.shakeT = Math.max(this.shakeT, 0.7);
          break;
        }
        case 'hijack': {
          const v = this.enemyViews.get(ev.enemy.id), tv = this.towerViews.get(ev.tower.id);
          if (!v || !tv) break;
          const a = this.enemyCenter(v, new THREE.Vector3());
          const b = tv.root.position.clone().add(tmpV2.set(0, tv.topY, 0));
          this.lightning([a, b], '#ffe600', 0.7, { width: 3.5 });
          break;
        }
        case 'steal': {
          const c = this.core.position;
          this.flare(c.x, 1.6, c.z, '#3dffc5', 1.8, 0.35, 3);
          this.sparkBurst(c.x, 1.4, c.z, '#3dffc5', 20, 3.5, { life: 0.6, size: 0.04, up: 0.8 });
          break;
        }
        case 'drop': case 'grab': {
          const p = ev.packet;
          this.flare(wx(p.x), 0.5, wz(p.y), '#3dffc5', 1.2, 0.25, 3);
          this.sparkBurst(wx(p.x), 0.5, wz(p.y), '#3dffc5', 12, 3, { life: 0.5, size: 0.035, up: 0.6 });
          break;
        }
        case 'recover': {
          const c = this.core.position;
          this.flare(c.x, 1.6, c.z, '#39ff14', 1.6, 0.35, 3);
          this.shockwave(c.x, c.z, 0.2, 1.4, '#3dffc5', 0.6, 0.8);
          break;
        }
        case 'emp': {
          const r = ev.r / TILE, x = wx(ev.x), z = wz(ev.y);
          const sph = new THREE.Mesh(this.sphereGeo, this.shieldMatBase.clone());
          sph.material.uniforms.color.value = col('#00f0ff');
          sph.position.set(x, 0, z);
          this.addFx(sph, 0.6, (k) => { sph.scale.setScalar(r * (1.05 - k)); sph.material.uniforms.opacity.value = k * 1.5; });
          this.flashLight(x, 1, z, '#00f0ff', 30, 8, 0.4);
          this.flare(x, 0.8, z, '#00f0ff', 3 + r, 0.3, 3);
          this.flipbook(new THREE.Vector3(x, 0.6, z), 'burst', r * 2.4, 0.55, '#00f0ff', 4, true);
          this.sparkBurst(x, 0.4, z, '#7df9ff', 40, r * 4, { life: 0.6, size: 0.04, up: 0.3, grav: -4 });
          break;
        }
        case 'adapt': {
          // A boss adapting at a skull: sparks in each new buff's color spiral off it, and a ring in the first one's.
          const v = this.enemyViews.get(ev.enemy.id);
          if (!v) break;
          const c = this.enemyCenter(v, new THREE.Vector3());
          ev.mods.forEach((m, i) => this.sparkBurst(c.x, c.y, c.z, MODS[m].color, 16, 3 + i * 0.6, { life: 0.9, size: 0.05, up: 0.6, grav: -2, heat: 0.3 }));
          this.shockwave(c.x, c.z, 0.3, ev.enemy.radius / TILE * 5, MODS[ev.mods[0]].color, 0.7, 0.8);
          break;
        }
        case 'variant': {
          // Re-locking to a new variant: a shower of sparks off the turret as it swings.
          const tv = this.towerViews.get(ev.tower.id);
          if (tv) this.sparkBurst(tv.root.position.x, tv.topY * 0.8, tv.root.position.z, ev.tower.def.color, 14, 2.2, { life: 0.4, size: 0.03, up: 0.6, grav: -6 });
          break;
        }
        // ---- hero
        case 'herofire': {
          const v = this.heroView;
          if (!v) break;
          const from = this.heroMuzzle(v, ev.side, new THREE.Vector3());
          const ev2 = this.enemyViews.get(ev.target.id);
          const to = ev2 ? this.enemyCenter(ev2, new THREE.Vector3()) : new THREE.Vector3(wx(ev.target.x), 0.4, wz(ev.target.y));
          const arsenal = ev.hero.tiers[1];
          const color = arsenal >= 5 ? '#ff2bd6' : arsenal >= 3 ? '#ff3355' : HERO.color;
          this.beam(from, to, color, 0.04 + arsenal * 0.012, 0.07, { core: 0.9 });
          this.flare(from.x, from.y, from.z, color, 0.45 + arsenal * 0.05, 0.06, 3);
          this.sparkBurst(to.x, to.y, to.z, color, 4, 3, { life: 0.25, size: 0.03 });
          // Standing and firing, the fire clip's own recoil plays in step with the shots; on the move, the barrels kick.
          if (v.state === 'fire' && v.current) v.current.time = ev.side ? v.current.getClip().duration / 2 : 0;
          else v.recoil[ev.side] = 1;
          break;
        }
        case 'herohack': {
          const v = this.heroView, ev2 = this.enemyViews.get(ev.enemy.id);
          if (!v || !ev2) break;
          const a = v.root.position.clone().add(tmpV2.set(0, 0.75, 0));
          const b = this.enemyCenter(ev2, new THREE.Vector3());
          const color = HERO_RULES.hackColor;
          this.lightning([a, b], color, 0.4, { width: ev.convert ? 3.5 : 2.5 });
          this.flare(b.x, b.y, b.z, color, 1.1, 0.25, 3);
          this.shockwave(b.x, b.z, 0.1, 0.8, color, 0.5, 0.9);
          if (ev.convert) this.flipbook(b, 'burst', 1.1, 0.4, color, 3, true);
          break;
        }
        case 'convertzap': {
          const a = this.enemyViews.get(ev.from.id), b = this.enemyViews.get(ev.to.id);
          if (!a || !b) break;
          const p = this.enemyCenter(a, new THREE.Vector3()), q = this.enemyCenter(b, new THREE.Vector3());
          this.beam(p, q, HERO_RULES.hackColor, 0.05, 0.12, { core: 0.8 });
          this.sparkBurst(q.x, q.y, q.z, HERO_RULES.hackColor, 5, 3, { life: 0.3, size: 0.03 });
          break;
        }
        case 'convertend': {
          const v = this.enemyViews.get(ev.enemy.id);
          const c = v ? this.enemyCenter(v, new THREE.Vector3()) : new THREE.Vector3(wx(ev.enemy.x), 0.4, wz(ev.enemy.y));
          this.flare(c.x, c.y, c.z, HERO_RULES.hackColor, 1.6, 0.3, 3);
          this.shockwave(c.x, c.z, 0.2, 1.2, HERO_RULES.hackColor, 0.5, 0.9);
          break;
        }
        case 'trapboom': {
          const x = wx(ev.trap.x), z = wz(ev.trap.y), r = ev.r / TILE;
          const color = ev.trap.emp ? '#00f0ff' : HERO_RULES.trapColor;
          this.shockwave(x, z, 0.1, r, color, 0.45, 1);
          this.flashLight(x, 0.5, z, color, 10, 3, 0.2);
          if (ev.trap.emp) this.flipbook(new THREE.Vector3(x, 0.4, z), 'burst', r * 2.2, 0.45, color, 3.5, true);
          break;
        }
        case 'enemyshot': {
          // Return fire at the hero: a short red tracer and a spark on its hull.
          const v = this.enemyViews.get(ev.enemy.id), hv = this.heroView;
          if (!v || !hv || (this.fxBusy && Math.random() < 0.7)) break;
          const from = this.enemyCenter(v, new THREE.Vector3());
          const to = hv.root.position.clone().add(tmpV2.set((Math.random() - 0.5) * 0.3, 0.5, (Math.random() - 0.5) * 0.3));
          const big = ev.enemy.def.boss;
          this.beam(from, to, big ? ev.enemy.def.color : '#ff5a3c', big ? 0.1 : 0.045, big ? 0.18 : 0.1, { core: 0.8 });
          this.sparkBurst(to.x, to.y, to.z, '#ffb070', big ? 10 : 3, 2.5, { life: 0.25, size: 0.03 });
          break;
        }
        case 'herosalvo': {
          const v = this.heroView;
          if (!v) break;
          const p = v.root.position;
          this.flare(p.x, 0.95, p.z, HERO_RULES.missileColor, 0.9, 0.15, 3);
          this.smokePuff(p.x, 0.9, p.z, 3, { size: 0.2, grow: 3, spread: 0.2, rise: 0.4, life: 1, alpha: 0.35, warm: 0.5 });
          break;
        }
        case 'herodeploy': case 'heroreboot': {
          const x = wx(ev.hero.x), z = wz(ev.hero.y);
          const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5, 24, 1, true), new THREE.MeshBasicMaterial({ color: col(HERO.color).clone().multiplyScalar(2.5), map: fadeUpTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
          column.position.set(x, 2.5, z);
          this.addFx(column, 0.9, (k) => { column.material.opacity = k * 0.6; column.scale.set(1 + (1 - k) * 0.4, 1, 1 + (1 - k) * 0.4); });
          this.shockwave(x, z, 0.2, 1.3, HERO.color, 0.7, 1, 0.12);
          this.sparkBurst(x, 0.3, z, HERO.color, 24, 3.5, { up: 0.9, life: 0.8, size: 0.04, grav: -3 });
          this.flashLight(x, 1, z, HERO.color, 14, 4, 0.5);
          break;
        }
        case 'herodown': {
          const x = wx(ev.hero.x), z = wz(ev.hero.y);
          this.sparkBurst(x, 0.5, z, '#ffb000', 30, 4.5, { life: 0.8, size: 0.045, up: 0.7 });
          this.smokePuff(x, 0.4, z, 8, { size: 0.45, grow: 2.4, spread: 0.4, rise: 0.8, life: 2.4, alpha: 0.5, warm: 0.6 });
          this.flashLight(x, 0.8, z, '#ff8a00', 18, 5, 0.4);
          this.shakeT = Math.max(this.shakeT, 0.4);
          break;
        }
        case 'orbital': this.orbitalCharge(wx(ev.x), wz(ev.y), ev.r / TILE, ev.delay); break;
        case 'orbitalhit': this.orbitalImpact(wx(ev.x), wz(ev.y), ev.r / TILE); break;
      }
    }
    evs.length = 0;
  }

  updateFx(dt) {
    let j = 0;
    for (const f of this.fxItems) {
      f.life -= dt;
      if (f.life <= 0) {
        this.dynGroup.remove(f.obj);
        f.end?.();
        // Only free per-effect geometry. Disposing materials would drop the shared shader program once the
        // last user is gone, forcing a recompile (a visible hitch) on the next explosion or bolt.
        f.obj.traverse?.((o) => { if (o.geometry instanceof LineGeometry) o.geometry.dispose(); });
        continue;
      }
      f.update(f.life / f.max);
      this.fxItems[j++] = f;
    }
    this.fxItems.length = j;
    for (const l of this.lightPool) {
      if (l.userData.life > 0) {
        l.userData.life -= dt;
        l.intensity = Math.max(0, l.userData.peak * (l.userData.life / l.userData.max));
      } else l.intensity = 0;
    }
  }

  // -------------------------------------------------------------------------------- frame
  // Adaptive resolution: trade pixel density for frame rate on slower GPUs.
  adaptResolution(dt) {
    const p = this.perf;
    p.t += dt; p.frames++;
    if (p.t < 2) return;
    const avg = p.t / p.frames;
    p.t = 0; p.frames = 0;
    let next = this.dpr;
    if (avg > 1 / 50 && this.dpr > 1) { next = Math.max(1, this.dpr - 0.25); p.stable = 0; }
    else if (avg < 1 / 58) { if (++p.stable >= 4 && this.dpr < this.maxDpr) { next = Math.min(this.maxDpr, this.dpr + 0.25); p.stable = 0; } }
    if (next !== this.dpr) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.resize(this.width, this.height);
    }
  }

  render(game, ui, realDt, simDt) {
    this.time += realDt;
    this.adaptResolution(realDt);
    const t = this.time;
    this.gridMat.uniforms.time.value = t;

    this.processEvents(game);
    this.updateSkyLanes(game, realDt);
    this.syncTowers(game, simDt, ui);
    this.syncEnemies(game, simDt);
    this.syncHero(game, simDt, ui);
    this.syncTraps(game, simDt);
    this.syncShells(game);
    this.syncPackets(game, simDt);
    this.updateFx(simDt);
    this.sparks.update(simDt);
    this.smoke.update(simDt);

    // Core pulse.
    if (this.core) {
      const k = game.lives / game.maxLives;
      const c = k > 0.5 ? this.coreAccent : k > 0.25 ? col('#ffe600') : col('#ff3355');
      this.coreCrystal.material.emissive.copy(c);
      this.coreCrystal.rotation.y += realDt * 1.2;
      this.coreCrystal.rotation.x += realDt * 0.5;
      this.coreCrystal.position.y = 2.3 + Math.sin(t * 2) * 0.06;
      this.coreLight.color.copy(c);
      this.coreLight.intensity = 7 + Math.sin(t * 3) * 1.5 + (this.coreHit || 0) * 30;
      for (const p of this.portals) p.light.intensity = 4 + Math.sin(t * 13) * 1.2 + Math.random() * 1.5;
    }
    this.coreHit = Math.max(0, (this.coreHit || 0) - realDt * 1.8);

    // Environment motion.
    const rp = this.rain.pos;
    for (let i = 0; i < this.rain.n; i++) {
      const dy = this.rain.speed[i] * realDt;
      rp[i * 6 + 1] -= dy; rp[i * 6 + 4] -= dy;
      rp[i * 6] -= dy * 0.08; rp[i * 6 + 3] -= dy * 0.08;
      if (rp[i * 6 + 1] < -1) this.resetDrop(i, false);
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;
    for (const c of this.cars) {
      const d = c.userData;
      d.t += realDt * d.speed;
      const a = d.t / d.lane;
      c.position.set(Math.cos(a) * d.lane * 1.25, d.h, Math.sin(a) * d.lane);
      c.rotation.y = -a;
    }

    this.updateCursor(game, ui);

    // Camera (boss intros take it over), then shake.
    if (this.cine) this.updateCinematic(realDt);
    else {
      this.updateCamera(realDt);
      this.controls.update();
    }
    const shake = Math.max(game.shake * 0.012, this.shakeT * 0.35) * this.settings.shake;
    this.shakeT = Math.max(0, this.shakeT - realDt * 1.5);
    const base = this.camera.position.clone();
    if (shake > 0.001) this.camera.position.add(tmpV.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    this.shadowTimer -= realDt;
    if (this.shadowTimer <= 0) { this.renderer.shadowMap.needsUpdate = true; this.shadowTimer = 0.05; }
    this.finalPass.uniforms.time.value = t;
    this.finalPass.uniforms.hit.value = Math.max(this.coreHit || 0, game.coreHit || 0);
    // Orbital impacts shear the image for a moment.
    this.aberrationKick = Math.max(0, (this.aberrationKick || 0) - realDt * 2.5);
    this.finalPass.uniforms.aberration.value = 0.0012 + 0.006 * this.aberrationKick ** 2;
    // Close up, neon fills much more of the screen, so bloom backs off as the camera zooms in.
    const zoom = this.fitDist ? this.camera.position.distanceTo(this.controls.target) / this.fitDist : 1;
    const near = 1 - THREE.MathUtils.smoothstep(zoom, 0.28, 1);
    this.bloom.strength = (0.7 + (game.overclockT > 0 ? 0.2 : 0)) * (1 - near * 0.6);
    this.bloom.threshold = 0.92 + near * 0.6;
    this.composer.render();
    this.camera.position.copy(base);

    this.drawOverlay(game, ui, realDt);
  }

  // Sky lanes brighten and their dashes flow faster while drones are on them or the next wave brings some.
  updateSkyLanes(game, dt) {
    if (!this.skyLanes.length) return;
    const key = `${game.wave}|${game.endless}`; // continuing into endless opens up the next wave without a new one
    if (this.laneWave !== key) {
      this.laneWave = key;
      this.laneNext = !game.campaignDone && game.waveDef(game.wave + 1).some((grp) => ENEMIES[grp.type].flying);
    }
    const hot = game.enemies.some((e) => e.air) || (game.state === 'build' && this.laneNext);
    this.laneK += ((hot ? 1 : 0) - this.laneK) * Math.min(1, dt * 3);
    this.laneMat.opacity = 0.34 + 0.32 * this.laneK;
    this.laneGroundMat.opacity = 0.14 + 0.14 * this.laneK;
    this.laneMat.dashOffset -= dt * (0.3 + 1.1 * this.laneK);
    this.laneGroundMat.dashOffset = this.laneMat.dashOffset;
  }

  // Sky lane stretch a tower at (px, py) with range r (px) can hit: in range, and not behind a tall block.
  showAirCover(game, px, py, r, walls, color) {
    const key = `${px}|${py}|${r}|${walls}`;
    if (key !== this.airCoverKey) {
      this.airCoverKey = key;
      const pos = [];
      const hover = ENEMY_VIS.drone.hover;
      for (const p of game.airPaths) {
        let prev = null;
        for (let d = 0; d <= p.length; d += TILE * 0.2) {
          const q = pathPoint(p, d);
          const ok = (q.x - px) ** 2 + (q.y - py) ** 2 <= r * r && (!walls || game.los(px, py, q.x, q.y, true));
          const pt = [wx(q.x), flightAlt(d, p.length - d, hover) + LANE_LIFT, wz(q.y)];
          if (ok && prev) pos.push(...prev, ...pt);
          prev = ok ? pt : null;
        }
      }
      this.airCoverEmpty = !pos.length;
      if (pos.length) {
        const geo = new LineSegmentsGeometry();
        geo.setPositions(pos);
        this.airCover.geometry.dispose();
        this.airCover.geometry = geo;
      }
    }
    if (this.airCoverEmpty) return;
    this.airCoverMat.color.copy(col(color)).multiplyScalar(2.2);
    this.airCover.visible = true;
  }

  // Manual aim of tower `t` at point `pt` (px): the Mortar's blast ring, or the Railgun's firing line on the ground.
  showAim(game, t, pt, bright) {
    const c = col(t.def.color);
    if (t.type === 'plasma') {
      this.aimRing.visible = true;
      this.aimRing.position.set(wx(pt.x), 0.15, wz(pt.y));
      this.aimRing.scale.setScalar(t.stats.splash);
      this.aimRing.children[0].material.color.copy(c).multiplyScalar(2.5 * bright);
      this.aimRing.children[1].material.color.copy(c).multiplyScalar(bright);
      return;
    }
    const { ux, uy, reach, reachAir } = t.railLine(game, Math.atan2(pt.y - t.y, pt.x - t.x));
    const y = SIGHT_Y + 0.012;
    const at = (d) => [wx(t.x + ux * d), y, wz(t.y + uy * d)];
    const start = TILE * t.size * 0.5;
    this.aimLine.geometry.dispose();
    this.aimLine.geometry = new LineGeometry().setPositions([...at(start), ...at(reach)]);
    this.aimLineMat.color.copy(c).multiplyScalar(2.2 * bright);
    this.aimLine.visible = reach > start;
    if (reachAir > reach + 1) {
      this.aimFar.geometry.dispose();
      this.aimFar.geometry = new LineGeometry().setPositions([...at(reach), ...at(reachAir)]);
      this.aimFar.computeLineDistances();
      this.aimFarMat.color.copy(c).multiplyScalar(1.6 * bright);
      this.aimFar.visible = true;
    }
  }

  // Buildings as world-space rectangles, inset like the game's line-of-sight test.
  setSightBlockers(blocked) {
    const inset = 0.1;
    this.sightRects = blocked.map(([x, y, s]) => [x - HW + inset, y - HH + inset, x + s - HW - inset, y + s - HH - inset]);
    // What an anti-air tower's view up to the flyers is blocked by: only the tall blocks.
    this.airSightRects = this.sightRects.filter((_, i) => blocked[i][2] > 1);
    this.sightKey = '';
  }

  // Visibility polygon around (x, z): rays every degree plus a pair grazing each building corner (crisp shadow
  // edges), each cut short by the first building it meets. Returns [x, z] points in angle order.
  sightPolygon(x, z, r, walls, air = false) {
    const rects = walls ? (air ? this.airSightRects : this.sightRects).filter(([ax, az, bx, bz]) => {
      const dx = Math.max(ax - x, 0, x - bx), dz = Math.max(az - z, 0, z - bz);
      return dx * dx + dz * dz < r * r;
    }) : [];
    const angles = [];
    for (let i = 0; i < 360; i++) angles.push((i / 360) * TAU);
    for (const [ax, az, bx, bz] of rects) {
      for (const [cx, cz] of [[ax, az], [bx, az], [ax, bz], [bx, bz]]) {
        const a = Math.atan2(cz - z, cx - x);
        angles.push(a - 1e-4, a + 1e-4);
      }
    }
    const norm = angles.map((a) => ((a % TAU) + TAU) % TAU).sort((p, q) => p - q);
    return norm.map((a) => {
      const ux = Math.cos(a), uz = Math.sin(a);
      const t = rects.length ? segmentBlock(rects, x, z, x + ux * r, z + uz * r) : Infinity;
      const d = t === Infinity ? r : t * r;
      return [x + ux * d, z + uz * d];
    });
  }

  // Show the sight polygon for a tower at (x, z) with range r (world units); rebuilt only when something changed.
  // `air`: an anti-air-only tower, whose view up to the flyers only the tall blocks cut.
  showSight(x, z, r, color, walls, bright = 1, air = false) {
    const key = `${x.toFixed(2)}|${z.toFixed(2)}|${r.toFixed(2)}|${walls}|${air}`;
    if (key !== this.sightKey) {
      this.sightKey = key;
      const poly = this.sightPolygon(x, z, r, walls, air);
      const n = poly.length;
      const pos = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        pos.set([x, SIGHT_Y, z, p[0], SIGHT_Y, p[1], q[0], SIGHT_Y, q[1]], i * 9);
      }
      const fill = new THREE.BufferGeometry();
      fill.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.sightFill.geometry.dispose();
      this.sightFill.geometry = fill;
      const flat = [];
      for (const p of poly) flat.push(p[0], SIGHT_Y + 0.004, p[1]);
      flat.push(poly[0][0], SIGHT_Y + 0.004, poly[0][1]);
      const line = new LineGeometry();
      line.setPositions(flat);
      this.sightLine.geometry.dispose();
      this.sightLine.geometry = line;
    }
    this.sightFill.material.color.copy(col(color)).multiplyScalar(1.3);
    this.sightLineMat.color.copy(col(color)).multiplyScalar(2 * bright);
    this.sightFill.visible = this.sightLine.visible = true;
  }

  // Heat map for placing `type`: recolored only when the tower layout (or, for uplinks, tower levels) changes.
  updateHeat(game, type, variant = null) {
    const key = `${type}|${variant}|${game.towers.map((t) => (type === 'uplink' ? `${t.id}:${t.level}` : t.id)).join(',')}`;
    if (key !== this.heat.key) {
      const data = coverageMap(game, type, variant);
      let max = 0;
      for (const v of data) if (v > max) max = v;
      this.heat = { key, data, max: max || 1, type };
      const c = new THREE.Color();
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v < 0) c.setRGB(0, 0, 0); // can't build here: additive black is invisible
        else {
          // Red (little road in view) through amber to green (the most road on the map), dimmer when poor.
          // Poor spots fade almost to nothing so the good ones read at a glance.
          const k = v / this.heat.max;
          if (k < 0.5) c.setRGB(1, 0.1 + k * 1.4, 0.06);
          else c.setRGB(1 - (k - 0.5) * 1.7, 0.8 + (k - 0.5) * 0.3, 0.1 + (k - 0.5) * 0.5);
          c.multiplyScalar(0.03 + 0.5 * k ** 1.6);
        }
        this.heatMesh.setColorAt(i, c);
      }
      this.heatMesh.instanceColor.needsUpdate = true;
    }
    this.heatMesh.visible = true;
  }

  // Coverage (score, tiles of road and of sky lane in view) for a tower anchored at (tx, ty), from the current heat map.
  heatAt(type, tx, ty) {
    if (this.heat.type !== type || !this.heat.data || tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
    const i = ty * COLS + tx, v = this.heat.data[i];
    return v < 0 ? null : { v, k: v / this.heat.max, road: this.heat.data.road[i], air: this.heat.data.air[i] };
  }

  updateCursor(game, ui) {
    const se = ui.selectedEnemy;
    const sv = se && this.enemyViews.get(se.id);
    this.enemyRing.visible = !!sv;
    if (sv) {
      this.enemyRing.position.set(sv.root.position.x, 0.13, sv.root.position.z);
      this.enemyRing.scale.setScalar(Math.max(0.35, se.radius / TILE * 1.6) * (1 + Math.sin(this.time * 6) * 0.06));
      this.enemyRing.rotation.y = this.time;
    }
    const h = ui.hover;
    this.tileMarker.visible = false;
    this.rangeRing.visible = false;
    this.sightFill.visible = this.sightLine.visible = false;
    this.reticle.visible = false;
    this.heatMesh.visible = false;
    this.airCover.visible = this.aimRing.visible = this.aimLine.visible = this.aimFar.visible = false;
    this.routeLine.visible = this.destRing.visible = false;
    if (this.heroGhostObj) this.heroGhostObj.visible = false;
    if (ui.placing && this.settings.heatmap) this.updateHeat(game, ui.placing, ui.placeVariant?.[ui.placing]);
    if (this.ghosts) for (const g of Object.values(this.ghosts)) g.visible = false;
    const sel = ui.selected;
    if (sel?.isHero) this.showRoute(sel);
    if (ui.placingHero && h && h.tx >= 0) {
      // Deploying the hero: its ghost and the ground it would cover, green where it can stand.
      const ok = game.canDeployHero(h.x, h.y) && game.credits >= HERO.cost;
      const gh = this.heroGhost();
      gh.visible = true;
      gh.position.set(wx(h.x), 0, wz(h.y));
      gh.userData.mat.color.copy(col(ok ? HERO.color : '#ff3355')).multiplyScalar(1.4);
      gh.userData.mat.opacity = 0.24 + Math.sin(this.time * 8) * 0.08;
      this.showSight(wx(h.x), wz(h.y), HERO.base.range, ok ? HERO.color : '#ff3355', true, ok ? 1 : 0.3);
      return;
    }
    if (sel) this.showSight(wx(sel.x), wz(sel.y), sel.range / TILE, sel.def.color, !sel.ignoresWalls, 1, sel.hitsAir && !sel.hitsGround);
    if (sel && sel.hitsAir) this.showAirCover(game, sel.x, sel.y, sel.range, !sel.ignoresWalls, sel.def.color);
    // Manual aim: the inspected tower's spot / line, or a live preview under the cursor while one is being picked.
    const aimer = ui.aiming || (sel?.aiming ? sel : null);
    if (aimer) {
      const pt = ui.aiming && h && h.tx >= 0 ? aimer.aimAt(h.x, h.y) : aimer.aim;
      if (pt) this.showAim(game, aimer, pt, ui.aiming ? 1 : 0.6);
      if (ui.aiming) return;
    }
    if (!h) return;
    if (ui.ability) {
      const ab = ABILITIES[ui.ability];
      this.reticle.visible = true;
      this.reticle.position.set(wx(h.x), 0.15, wz(h.y));
      this.reticle.scale.setScalar(ab.radius);
      this.reticle.children[0].material.color.copy(col(ab.color)).multiplyScalar(2.5);
      this.reticle.children[1].material.color.copy(col(ab.color));
      return;
    }
    const inside = h.tx >= 0 && h.ty >= 0 && h.tx < COLS && h.ty < ROWS;
    if (!inside) return;
    const cx = h.tx - HW + 0.5, cz = h.ty - HH + 0.5;
    this.tileMarker.scale.setScalar(1);
    if (ui.placing) {
      const def = TOWERS[ui.placing];
      const size = def.size || 1;
      const pv = variantOf(def, ui.placeVariant?.[ui.placing]);
      const placeStats = computeStats(def, [0, 0, 0], 0, pv);
      const placeHits = targetsOf(def, placeStats, pv);
      const a = footprintAnchor(size, h.x, h.y);
      const fx = a.tx - HW + size / 2, fz = a.ty - HH + size / 2;
      const fits = game.canPlace(a.tx, a.ty, size);
      const ok = fits && game.credits >= def.cost;
      this.tileMarker.visible = true;
      this.tileMarker.position.set(fx, 0.115, fz);
      this.tileMarker.scale.setScalar(size);
      this.tileMarker.material.color.set(ok ? '#39ff14' : '#ff3355').multiplyScalar(2);
      const airOnly = placeHits.air && !placeHits.ground;
      if (!sel) this.showSight(fx, fz, placeStats.range, def.color, ui.placing !== 'plasma' && ui.placing !== 'uplink', ok ? 1 : 0.3, airOnly);
      if (!sel && placeHits.air && fits) this.showAirCover(game, (a.tx + size / 2) * TILE, (a.ty + size / 2) * TILE, placeStats.range * TILE, ui.placing !== 'plasma', def.color);
      const gh = this.ghost(ui.placing);
      gh.visible = fits;
      if (gh.userData.head) gh.userData.head.rotation.x = placeHits.air && !placeHits.ground ? -AA_PITCH : 0;
      gh.position.set(fx, PAD_Y, fz);
      gh.userData.mat.opacity = 0.22 + Math.sin(this.time * 8) * 0.08;
    } else if (game.grid[h.ty][h.tx] !== 1) {
      this.tileMarker.visible = true;
      this.tileMarker.position.set(cx, 0.115, cz);
      this.tileMarker.material.color.set('#ffffff').multiplyScalar(0.5);
    }
  }

  drawOverlay(game, ui, dt) {
    const g = this.octx;
    g.clearRect(0, 0, this.width, this.height);
    if (this.cinematic) { this.texts.length = 0; return; } // clean frame for boss intros
    // Cloaked enemies: violet marker so the player knows something is there.
    for (const e of game.enemies) {
      if (e.revealed) continue;
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const p = this.project(v.root.position.x, v.root.position.y + v.height + 0.2, v.root.position.z);
      if (p.behind) continue;
      const s = 5 + Math.sin(this.time * 6 + e.id) * 1.2;
      g.strokeStyle = 'rgba(190,120,255,0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(p.sx, p.sy - s); g.lineTo(p.sx + s, p.sy); g.lineTo(p.sx, p.sy + s); g.lineTo(p.sx - s, p.sy); g.closePath();
      g.stroke();
    }
    // Variant badges: one small lettered chip per variant (M = mirror-plated, I = insulated, ...).
    g.textAlign = 'center';
    g.font = '700 9px "Share Tech Mono", monospace';
    for (const e of game.enemies) {
      if (!e.mods.length || !e.revealed) continue;
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const p = this.project(v.root.position.x, v.root.position.y + v.height + 0.05, v.root.position.z);
      if (p.behind) continue;
      e.mods.forEach((m, i) => {
        const x = p.sx + (i - (e.mods.length - 1) / 2) * 13, y = p.sy - 12;
        g.fillStyle = 'rgba(8,5,18,0.8)';
        g.fillRect(x - 5.5, y - 6, 11, 11);
        g.strokeStyle = MODS[m].color;
        g.lineWidth = 1;
        g.strokeRect(x - 5.5, y - 6, 11, 11);
        g.fillStyle = MODS[m].color;
        g.fillText(MODS[m].glyph, x, y + 3);
      });
    }
    // Couriers running out with a packet: teal diamond so they stand out in a crowd.
    for (const e of game.enemies) {
      if (!e.carrying || !e.revealed) continue;
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const p = this.project(v.root.position.x, v.root.position.y + v.height + 0.55, v.root.position.z);
      if (p.behind) continue;
      const s = 6 + Math.sin(this.time * 8 + e.id) * 1.5;
      g.strokeStyle = 'rgba(61,255,197,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(p.sx, p.sy - s); g.lineTo(p.sx + s, p.sy); g.lineTo(p.sx, p.sy + s); g.lineTo(p.sx - s, p.sy); g.closePath();
      g.stroke();
    }
    // Offline towers: a warning tag with the time left on longer outages (EMP vents, hijacks).
    g.textAlign = 'center';
    for (const t of game.towers) {
      if (!(t.jamT > 0)) continue;
      const tv = this.towerViews.get(t.id);
      if (!tv) continue;
      const p = this.project(tv.root.position.x, tv.topY + 0.35, tv.root.position.z);
      if (p.behind) continue;
      const hijack = t.jamKind === 'hijack';
      const label = hijack ? 'HIJACKED' : t.jamKind === 'emp' ? 'EMP' : 'JAMMED';
      const text = t.jamT > 0.5 ? `${label} ${t.jamT.toFixed(1)}` : label;
      g.font = '700 10px "Share Tech Mono", monospace';
      const tw = g.measureText(text).width + 8;
      g.fillStyle = 'rgba(10,4,14,0.8)';
      g.fillRect(p.sx - tw / 2, p.sy - 8, tw, 13);
      g.fillStyle = hijack ? '#ffe600' : '#ff4f86';
      g.globalAlpha = 0.75 + 0.25 * Math.sin(this.time * 14);
      g.fillText(text, p.sx, p.sy + 2);
      g.globalAlpha = 1;
    }
    // The hero: hull bar (always), a status tag while it's offline, rebooting or jammed, and its name when selected.
    const hero = game.hero, hv = this.heroView;
    if (hero && hv) {
      const p = this.project(hv.root.position.x, 1.25, hv.root.position.z);
      if (!p.behind) {
        const w = 46, x = p.sx - w / 2, y = p.sy;
        const k = Math.max(0, hero.hp / hero.maxHp);
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(x - 1, y - 1, w + 2, 6);
        g.fillStyle = hero.downT > 0 ? '#ff3355' : k > 0.5 ? HERO.color : k > 0.25 ? '#ffe600' : '#ff3355';
        g.fillRect(x, y, w * (hero.downT > 0 ? 1 - hero.downT / HERO_RULES.downTime : k), 4);
        if (hero.contact > 0 && hero.online) { g.fillStyle = `rgba(255,51,85,${0.5 + 0.5 * Math.sin(this.time * 18)})`; g.fillRect(x + w * k - 2, y - 1, 3, 6); }
        const tag = hero.downT > 0 ? `OFFLINE ${hero.downT.toFixed(1)}` : hero.rebootT > 0 ? 'REBOOTING' : hero.jamT > 0 ? (hero.jamKind === 'emp' ? 'EMP' : 'JAMMED') : ui.selected === hero ? HERO.name : '';
        if (tag) {
          g.font = '700 10px "Share Tech Mono", monospace';
          g.textAlign = 'center';
          const tw = g.measureText(tag).width + 8;
          g.fillStyle = 'rgba(10,4,14,0.8)';
          g.fillRect(p.sx - tw / 2, y - 16, tw, 13);
          g.fillStyle = hero.downT > 0 || hero.jamT > 0 ? '#ff4f86' : HERO.color;
          g.fillText(tag, p.sx, y - 6);
        }
        if (ui.selected === hero && hero.rank > 0) {
          g.strokeStyle = '#ffe600';
          g.lineWidth = 2;
          for (let i = 0; i < hero.rank; i++) {
            const cy = y - 22 - i * 5;
            g.beginPath(); g.moveTo(p.sx - 7, cy + 4); g.lineTo(p.sx, cy); g.lineTo(p.sx + 7, cy + 4); g.stroke();
          }
        }
      }
    }
    // Hijacked enemies: a green diamond and how long they have left before they blow.
    for (const e of game.enemies) {
      if (!e.converted) continue;
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const p = this.project(v.root.position.x, v.root.position.y + v.height + 0.25, v.root.position.z);
      if (p.behind) continue;
      const s = 5;
      g.strokeStyle = HERO_RULES.hackColor;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(p.sx, p.sy - s - 6); g.lineTo(p.sx + s, p.sy - 6); g.lineTo(p.sx, p.sy + s - 6); g.lineTo(p.sx - s, p.sy - 6); g.closePath(); g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(p.sx - 13, p.sy + 2, 26, 3);
      g.fillStyle = HERO_RULES.hackColor;
      g.fillRect(p.sx - 12, p.sy + 2.5, 24 * (e.converted.t / e.converted.max), 2);
    }
    // Re-locking after a variant switch: a small tag with the time left.
    for (const t of game.towers) {
      if (!(t.relockT > 0) || t.jamT > 0) continue;
      const tv = this.towerViews.get(t.id);
      if (!tv) continue;
      const p = this.project(tv.root.position.x, tv.topY + 0.35, tv.root.position.z);
      if (p.behind) continue;
      const text = `RE-LOCK ${t.relockT.toFixed(1)}`;
      g.font = '700 10px "Share Tech Mono", monospace';
      const tw = g.measureText(text).width + 8;
      g.fillStyle = 'rgba(10,4,14,0.8)';
      g.fillRect(p.sx - tw / 2, p.sy - 8, tw, 13);
      g.fillStyle = t.def.color;
      g.fillText(text, p.sx, p.sy + 2);
    }
    // Veterancy chevrons over the inspected tower.
    const sel = ui.selected;
    if (sel && sel.rank > 0) {
      const tv = this.towerViews.get(sel.id);
      if (tv) {
        const p = this.project(tv.root.position.x, tv.topY + 0.2, tv.root.position.z);
        if (!p.behind) {
          g.strokeStyle = '#ffe600';
          g.lineWidth = 2;
          g.shadowColor = '#ffe600';
          g.shadowBlur = 6;
          for (let i = 0; i < sel.rank; i++) {
            const y = p.sy - 18 - i * 5;
            g.beginPath(); g.moveTo(p.sx - 7, y + 4); g.lineTo(p.sx, y); g.lineTo(p.sx + 7, y + 4); g.stroke();
          }
          g.shadowBlur = 0;
        }
      }
    }
    // Marked targets (Railgun targeting path): red reticle.
    for (const e of game.enemies) {
      if (!(e.markT > 0) || !e.revealed) continue;
      const v = this.enemyViews.get(e.id);
      if (!v) continue;
      const c = this.enemyCenter(v, new THREE.Vector3());
      const p = this.project(c.x, c.y, c.z);
      if (p.behind) continue;
      const r = 12 + Math.sin(this.time * 8) * 2;
      g.strokeStyle = 'rgba(255,60,90,0.9)';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.sx, p.sy, r, 0, TAU); g.stroke();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + this.time;
        g.beginPath(); g.moveTo(p.sx + Math.cos(a) * (r - 4), p.sy + Math.sin(a) * (r - 4)); g.lineTo(p.sx + Math.cos(a) * (r + 5), p.sy + Math.sin(a) * (r + 5)); g.stroke();
      }
    }
    // Health bars.
    for (const e of game.enemies) {
      const v = this.enemyViews.get(e.id);
      if (!v || !e.revealed || e.converted) continue;
      const damaged = e.hp < e.maxHp - 0.5 || (e.maxShield && e.shield < e.maxShield - 0.5);
      if (!damaged && !e.def.boss) continue;
      const top = v.root.position.y + (v.vis.hover ? 0 : 0) + v.height + 0.12;
      const p = this.project(v.root.position.x, top + (v.vis.hover || 0) * 0.2, v.root.position.z);
      if (p.behind) continue;
      const w = e.def.boss ? 70 : 30;
      const x = p.sx - w / 2, y = p.sy;
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(x - 1, y - 1, w + 2, 5);
      const k = Math.max(0, e.hp / e.maxHp);
      g.fillStyle = e.phaseT > 0 ? '#ffffff' : k > 0.5 ? '#39ff14' : k > 0.25 ? '#ffe600' : '#ff3355';
      g.fillRect(x, y, w * k, 3);
      // Skull thresholds: bright until passed.
      if (e.def.phases) {
        e.def.phases.forEach((f, i) => {
          g.fillStyle = i < e.phase ? 'rgba(255,255,255,0.25)' : '#ffffff';
          g.fillRect(x + w * f - 1, y - 2, 2, 7);
        });
      }
      if (e.maxShield) {
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(x - 1, y - 5, w + 2, 4);
        g.fillStyle = '#5aa0ff';
        g.fillRect(x, y - 4, w * (e.shield / e.maxShield), 2);
      }
    }
    // Floating texts.
    g.textAlign = 'center';
    let j = 0;
    for (const tx of this.texts) {
      tx.life -= dt;
      if (tx.life <= 0) continue;
      tx.y += dt * 0.7;
      const p = this.project(tx.x, tx.y, tx.z);
      g.globalAlpha = Math.min(1, tx.life * 2);
      g.font = `700 ${tx.size + 2}px "Share Tech Mono", monospace`;
      g.fillStyle = '#000';
      g.fillText(tx.text, p.sx + 1, p.sy + 1);
      g.fillStyle = tx.color;
      g.fillText(tx.text, p.sx, p.sy);
      this.texts[j++] = tx;
    }
    this.texts.length = j;
    g.globalAlpha = 1;
  }
}

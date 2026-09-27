// Effect building blocks for the 3D renderer: procedural textures, an instanced particle system (velocity-stretched
// sparks and soft smoke), and a camera-facing energy-beam shader.
import * as THREE from 'three';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- procedural textures
const hash = (x, y, s) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 5) {
  let f = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr, s + i * 17); amp *= 0.5; fr *= 2; }
  return f;
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Fills an RGBA canvas from fn(u, v) → [r, g, b, a] in 0..1, with (u, v) in -1..1.
function pixelTexture(size, fn, srgb = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b, a] = fn((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const i = (y * size + x) * 4;
      img.data[i] = r * 255; img.data[i + 1] = gg * 255; img.data[i + 2] = b * 255; img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeVfxTextures() {
  // Hot spark: tight core with a soft skirt; stretched into a streak by the particle shader.
  const spark = pixelTexture(64, (u, v) => {
    const r = Math.hypot(u, v);
    return [1, 1, 1, clamp01(Math.exp(-r * r * 9) * 1.1 + Math.exp(-r * r * 60) * 0.6)];
  });
  // Billowy smoke puff: noisy, soft-edged, with darker creases.
  const smoke = pixelTexture(128, (u, v) => {
    const r = Math.hypot(u, v);
    const n = fbm(u * 2.2 + 3, v * 2.2 + 7, 11);
    const edge = 1 - smooth(0.35 + n * 0.45, 1.0, r);
    const shade = 0.72 + 0.28 * fbm(u * 4 + 9, v * 4 + 1, 23);
    return [shade, shade, shade, clamp01(edge * (0.55 + n * 0.8))];
  });
  // Lens flare: sharp core, anamorphic horizontal streak and a faint 4-point star.
  const flare = pixelTexture(128, (u, v) => {
    const r2 = u * u + v * v;
    const core = Math.exp(-r2 * 80) * 1.2 + Math.exp(-r2 * 14) * 0.35;
    const streak = Math.exp(-v * v * 900) * Math.exp(-u * u * 2.2) * 0.9;
    const star = (Math.exp(-v * v * 1600) + Math.exp(-u * u * 1600)) * Math.exp(-r2 * 7) * 0.45;
    return [1, 1, 1, clamp01(core + streak + star)];
  });
  // Shock ring: crisp bright rim with a soft wash falling inward.
  const ring = pixelTexture(256, (u, v) => {
    const r = Math.hypot(u, v);
    const rim = Math.exp(-((r - 0.93) ** 2) * 900);
    const wash = smooth(0.45, 0.93, r) * (1 - smooth(0.93, 0.99, r)) * 0.35;
    const n = 0.8 + 0.2 * fbm(Math.atan2(v, u) * 3 + 10, r * 4, 5);
    return [1, 1, 1, clamp01((rim + wash) * n)];
  });
  // Scorch mark: dark, irregular blotch with a ragged edge.
  const scorch = pixelTexture(128, (u, v) => {
    const r = Math.hypot(u, v);
    const n = fbm(u * 3 + 5, v * 3 + 2, 31);
    const a = (1 - smooth(0.25 + n * 0.5, 0.95, r)) * (0.65 + 0.35 * fbm(u * 8, v * 8, 41));
    return [0.05, 0.04, 0.05, clamp01(a)];
  });
  return { spark, smoke, flare, ring, scorch };
}

// ---------------------------------------------------------------- particles
const PARTICLE_VERT = `
  attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iColor; attribute vec4 iParams; // size, rotation, stretch
  varying vec2 vUv; varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec2 corner = position.xy;
    float size = iParams.x;
    if (iParams.z > 0.0) {
      // Streak: stretch along the on-screen direction of travel, head at the particle.
      vec2 vel = (modelViewMatrix * vec4(iVel, 0.0)).xy;
      float sp = length(vel);
      vec2 dir = sp > 1e-4 ? vel / sp : vec2(1.0, 0.0);
      float len = size * (1.0 + sp * iParams.z);
      mv.xy += dir * (corner.x - 0.5) * len + vec2(-dir.y, dir.x) * corner.y * size;
    } else {
      float c = cos(iParams.y), s = sin(iParams.y);
      mv.xy += mat2(c, s, -s, c) * corner * size;
    }
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FRAG = `
  uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  }`;

// CPU-simulated, GPU-drawn particles: one instanced quad each. Colors lerp start → end over life (sparks cool from
// white-hot to their color to dark; smoke goes from fire-lit to grey), sizes grow or shrink, alpha fades in and out.
export class ParticleSystem {
  constructor(max, map, { blending = THREE.AdditiveBlending, renderOrder = 10 } = {}) {
    this.max = max;
    this.count = 0;
    const f = (n) => new Float32Array(max * n);
    this.p = f(3); this.v = f(3); this.c0 = f(3); this.c1 = f(3);
    this.life = f(1); this.maxLife = f(1); this.s0 = f(1); this.s1 = f(1); this.rot = f(1); this.spin = f(1);
    this.grav = f(1); this.drag = f(1); this.stretch = f(1); this.alpha = f(1); this.fadeIn = f(1);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = attr(3); this.aVel = attr(3); this.aCol = attr(4); this.aPar = attr(4);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aCol); geo.setAttribute('iParams', this.aPar);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } }, vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false, blending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  get free() { return this.max - this.count; }

  // o: { vel:[x,y,z], color, end, size, endSize, life, grav, drag, stretch, alpha, fadeIn, rot, spin }
  add(x, y, z, o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    const vel = o.vel || [0, 0, 0];
    this.v[i3] = vel[0]; this.v[i3 + 1] = vel[1]; this.v[i3 + 2] = vel[2];
    const c = o.color, e = o.end || o.color;
    this.c0[i3] = c.r; this.c0[i3 + 1] = c.g; this.c0[i3 + 2] = c.b;
    this.c1[i3] = e.r; this.c1[i3 + 1] = e.g; this.c1[i3 + 2] = e.b;
    this.life[i] = this.maxLife[i] = o.life;
    this.s0[i] = o.size; this.s1[i] = o.endSize ?? o.size;
    this.rot[i] = o.rot ?? Math.random() * TAU; this.spin[i] = o.spin || 0;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 1;
    this.stretch[i] = o.stretch || 0; this.alpha[i] = o.alpha ?? 1; this.fadeIn[i] = o.fadeIn || 0;
  }

  // Radial burst: n particles flung from a point. `up` biases the spray upward (0 = flat, 1 = mostly up).
  burst(x, y, z, n, speed, o) {
    const up = o.up ?? 0.5;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU;
      const el = (Math.random() * 2 - 1) * (1 - up) * 0.9 + up * 1.1;
      const v = speed * (0.3 + Math.random() * 0.7);
      const ce = Math.cos(el);
      this.add(x, y, z, {
        ...o,
        vel: [Math.cos(a) * ce * v, Math.sin(el) * v, Math.sin(a) * ce * v],
        size: o.size * (0.6 + Math.random() * 0.8),
        endSize: (o.endSize ?? o.size) * (0.6 + Math.random() * 0.8),
        life: o.life * (0.55 + Math.random() * 0.6),
      });
    }
  }

  move(i, j) {
    const i3 = i * 3, j3 = j * 3;
    for (const a of [this.p, this.v, this.c0, this.c1]) { a[j3] = a[i3]; a[j3 + 1] = a[i3 + 1]; a[j3 + 2] = a[i3 + 2]; }
    for (const a of [this.life, this.maxLife, this.s0, this.s1, this.rot, this.spin, this.grav, this.drag, this.stretch, this.alpha, this.fadeIn]) a[j] = a[i];
  }

  update(dt) {
    const P = this.aPos.array, V = this.aVel.array, C = this.aCol.array, Q = this.aPar.array;
    let j = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      if (i !== j) this.move(i, j);
      this.life[j] = life;
      const j3 = j * 3, j4 = j * 4;
      const d = Math.max(0, 1 - this.drag[j] * dt);
      this.v[j3] *= d; this.v[j3 + 1] = this.v[j3 + 1] * d + this.grav[j] * dt; this.v[j3 + 2] *= d;
      this.p[j3] += this.v[j3] * dt;
      this.p[j3 + 1] = Math.max(0.03, this.p[j3 + 1] + this.v[j3 + 1] * dt);
      this.p[j3 + 2] += this.v[j3 + 2] * dt;
      this.rot[j] += this.spin[j] * dt;
      const t = 1 - life / this.maxLife[j]; // 0 → 1 over life
      const ct = Math.sqrt(t);
      let a = this.alpha[j] * Math.min(1, (1 - t) * 2.2);
      if (this.fadeIn[j] > 0) a *= Math.min(1, t / this.fadeIn[j]);
      P[j3] = this.p[j3]; P[j3 + 1] = this.p[j3 + 1]; P[j3 + 2] = this.p[j3 + 2];
      V[j3] = this.v[j3]; V[j3 + 1] = this.v[j3 + 1]; V[j3 + 2] = this.v[j3 + 2];
      C[j4] = this.c0[j3] + (this.c1[j3] - this.c0[j3]) * ct;
      C[j4 + 1] = this.c0[j3 + 1] + (this.c1[j3 + 1] - this.c0[j3 + 1]) * ct;
      C[j4 + 2] = this.c0[j3 + 2] + (this.c1[j3 + 2] - this.c0[j3 + 2]) * ct;
      C[j4 + 3] = a;
      Q[j4] = this.s0[j] + (this.s1[j] - this.s0[j]) * t;
      Q[j4 + 1] = this.rot[j];
      Q[j4 + 2] = this.stretch[j];
      j++;
    }
    this.count = j;
    this.geo.instanceCount = j;
    for (const at of [this.aPos, this.aVel, this.aCol, this.aPar]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, j * at.itemSize);
      at.needsUpdate = true;
    }
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }
}

// ---------------------------------------------------------------- energy beams
// A ribbon from A to B that always faces the camera. Across its width: a white-hot core inside a colored glow with
// a gaussian falloff; along it: flowing energy noise and tapered ends. `cut` erases it from the muzzle end forward.
const BEAM_VERT = `
  uniform vec3 uA; uniform vec3 uB; uniform float uWidth;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = mix(uA, uB, uv.x);
    vec3 dir = normalize(uB - uA);
    vec3 side = normalize(cross(dir, normalize(cameraPosition - p)));
    p += side * (uv.y - 0.5) * uWidth;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const BEAM_FRAG = `
  uniform vec3 uColor; uniform float uTime; uniform float uFade; uniform float uSeed; uniform float uLen;
  uniform float uCut; uniform float uCore;
  varying vec2 vUv;
  float h(float n) { return fract(sin(n + uSeed) * 43758.5453); }
  float n1(float x) { float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float y = vUv.y * 2.0 - 1.0;
    float d = vUv.x * uLen;
    float flow = n1(d * 3.0 - uTime * 26.0) * 0.55 + n1(d * 9.0 - uTime * 47.0) * 0.45;
    float wob = (flow - 0.5) * 0.25;
    float core = exp(-(y - wob * 0.3) * (y - wob * 0.3) * 40.0) * uCore;
    float glow = exp(-y * y * 6.0) * (0.4 + 0.7 * flow);
    float ends = smoothstep(0.0, min(0.5, 0.12 / uLen), vUv.x) * smoothstep(1.0, 1.0 - min(0.5, 0.08 / uLen), vUv.x);
    float cut = smoothstep(uCut, uCut + 0.12, vUv.x);
    float a = (glow + core) * ends * cut * uFade;
    gl_FragColor = vec4(uColor * glow + vec3(1.0) * core * 1.3, a);
  }`;

export class BeamKit {
  constructor() {
    this.geo = new THREE.PlaneGeometry(1, 1, 12, 1);
    this.geo.translate(0.5, 0.5, 0);
    this.base = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uWidth: { value: 0.1 },
        uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uFade: { value: 1 }, uSeed: { value: 0 },
        uLen: { value: 1 }, uCut: { value: -0.2 }, uCore: { value: 1 },
      },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }

  // Returns a mesh whose uniforms the caller animates (uFade, uWidth, uCut, uTime).
  make(a, b, color, width, intensity = 2.2) {
    const m = this.base.clone();
    const u = m.uniforms;
    u.uA.value.copy(a); u.uB.value.copy(b); u.uWidth.value = width;
    u.uColor.value.set(color).multiplyScalar(intensity);
    u.uSeed.value = Math.random() * 100;
    u.uLen.value = Math.max(0.01, a.distanceTo(b));
    const mesh = new THREE.Mesh(this.geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 9;
    return mesh;
  }
}

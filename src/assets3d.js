// Loads the Meshy-generated, Blender-processed GLB models and prepares reusable templates.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TOWERS } from './config.js';

const BASE = 'assets/models/';

export const MODEL_FILES = [
  'tower_laser', 'tower_plasma', 'tower_tesla', 'tower_cryo', 'tower_rail', 'tower_uplink',
  'enemy_runner', 'enemy_runner_walk', 'enemy_drone', 'enemy_brute', 'enemy_aegis', 'enemy_phantom',
  'enemy_splitter', 'enemy_mite', 'enemy_medic', 'boss_titan', 'boss_overmind',
  'env_core', 'env_portal', 'env_building',
  // Tier-5 evolutions: Meshy-7 flagship per tower + Blender path recolors for the other paths.
  'tower_laser_t5', 'tower_plasma_t5', 'tower_tesla_t5', 'tower_cryo_t5', 'tower_rail_t5', 'tower_uplink_t5',
  'tower_laser_p1_t5', 'tower_laser_p2_t5', 'tower_plasma_p1_t5', 'tower_plasma_p2_t5',
  'tower_tesla_p1_t5', 'tower_tesla_p2_t5', 'tower_cryo_p1_t5', 'tower_cryo_p2_t5',
  'tower_rail_p1_t5', 'tower_rail_p2_t5', 'tower_uplink_p0_t5', 'tower_uplink_p1_t5',
];

// How each enemy type is presented: which model, how big (world units, 1 = one tile), hover height,
// which animation clip to loop and how fast it plays relative to movement speed.
export const ENEMY_VIS = {
  runner: { model: 'enemy_runner', height: 1.05, clip: 'run', animRate: 0.8 },
  drone: { model: 'enemy_drone', scale: 1.6, hover: 0.85, tilt: true },
  brute: { model: 'enemy_brute', height: 1.55, clip: 'walk', animRate: 1.0 },
  aegis: { model: 'enemy_aegis', scale: 1.7, hover: 0.3, shield: 0.72 },
  phantom: { model: 'enemy_phantom', height: 1.0, clip: 'run', animRate: 0.75 },
  splitter: { model: 'enemy_splitter', scale: 1.55, clip: 'crawl', animRate: 1.4 },
  mite: { model: 'enemy_mite', scale: 1.6, clip: 'crawl', animRate: 1.15 },
  medic: { model: 'enemy_medic', scale: 1.6, hover: 0.55 },
  titan: { model: 'boss_titan', height: 3.0, clip: 'walk', animRate: 1.05 },
  overmind: { model: 'boss_overmind', scale: 2.0, hover: 0.85, shield: 1.75, spin: true },
};

// Bloom budget per model: intensity × mean emissive-map brightness, summed over its materials. Models whose neon
// covers a lot of the texture (pale cryo shells, recolored tier-5 variants) are scaled back to this, so every
// model glows about as much as the rest of the cast.
const MAX_EMISSIVE = 3.5;
const GLOW_BUDGET = 0.075;
let probe;
function emissiveLuma(tex) {
  const img = tex.image;
  if (!img || !img.width) return 0;
  probe ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  probe.canvas.width = probe.canvas.height = 32;
  probe.clearRect(0, 0, 32, 32);
  probe.drawImage(img, 0, 0, 32, 32);
  const d = probe.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  return sum / (255 * 1024);
}
function normalizeGlow(root) {
  const mats = new Set();
  root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.emissiveMap && mats.add(m)); });
  let energy = 0;
  for (const m of mats) energy += emissiveLuma(m.emissiveMap) * m.emissiveIntensity;
  if (energy <= GLOW_BUDGET) return;
  for (const m of mats) m.emissiveIntensity *= GLOW_BUDGET / energy;
}

// Tier 3-4 look of each upgrade path: the tower's own model with its neon hue-shifted to the path color and the
// armor lightly tinted (same math as tools/blender/recolor_variant.py). Done in the shader, so the 18 variants share
// the base models' geometry and textures instead of shipping as extra GLBs.
const PATH_TINT = 0.32;
const SAME_HUE_TINT = 0.55; // a path in the tower's own color gets a heavier paint job, or it wouldn't look any different
const RECOLOR_MAP = `#include <map_fragment>
  float pathLuma = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, uPathColor * pathLuma * 2.2, uPathTint);`;
const RECOLOR_EMISSIVE = `#include <emissivemap_fragment>
  {
    vec3 e = totalEmissiveRadiance;
    float eMax = max(e.r, max(e.g, e.b));
    float sat = eMax > 1e-4 ? (eMax - min(e.r, min(e.g, e.b))) / eMax : 0.0;
    vec3 hue = uPathColor / max(max(uPathColor.r, max(uPathColor.g, uPathColor.b)), 1e-4);
    totalEmissiveRadiance = mix(vec3(1.0), hue, max(sat, 0.6)) * eMax;
  }`;
function recolorMaterial(src, hex, tint) {
  const m = src.clone();
  const color = new THREE.Color(hex);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPathColor = { value: color };
    shader.uniforms.uPathTint = { value: tint };
    shader.fragmentShader = 'uniform vec3 uPathColor;\nuniform float uPathTint;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', RECOLOR_MAP)
      .replace('#include <emissivemap_fragment>', RECOLOR_EMISSIVE);
  };
  m.customProgramCacheKey = () => 'pathRecolor';
  m.userData.pathRecolor = true; // material.clone() drops onBeforeCompile, so callers must share this one
  return m;
}

export class AssetLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.models = {};
    this.progress = 0;
    const draco = new DRACOLoader();
    draco.setDecoderPath('vendor/three/addons/libs/draco/gltf/');
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
  }

  async loadAll(onProgress) {
    let done = 0;
    await Promise.all(MODEL_FILES.map(async (name) => {
      try {
        const gltf = await this.loader.loadAsync(BASE + name + '.glb');
        this.models[name] = this.prepare(name, gltf);
      } catch (err) {
        console.warn(`[assets] ${name}: ${err.message || err}`);
      }
      done++;
      this.progress = done / (MODEL_FILES.length + 1); // the last step is building the path variants
      onProgress?.(this.progress, name);
    }));
    this.buildPathVariants();
    this.progress = 1;
    onProgress?.(1, 'variants');
    return this;
  }

  // `tower_<type>_p<path>_t3`: the tier 3-4 form of every upgrade path.
  buildPathVariants() {
    for (const [type, def] of Object.entries(TOWERS)) {
      const base = this.models[`tower_${type}`];
      if (!base) continue;
      const own = new THREE.Color(def.color).getHSL({});
      def.paths.forEach((path, p) => {
        const hsl = new THREE.Color(path.color).getHSL({});
        const dh = Math.abs(hsl.h - own.h);
        const tint = Math.min(dh, 1 - dh) < 0.06 ? SAME_HUE_TINT : PATH_TINT;
        const made = new Map();
        const swap = (m) => {
          if (!made.has(m)) made.set(m, recolorMaterial(m, path.color, tint));
          return made.get(m);
        };
        const scene = base.scene.clone(true);
        scene.traverse((o) => {
          if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
        });
        this.models[`tower_${type}_p${p}_t3`] = { ...base, scene };
      });
    }
  }

  prepare(name, gltf) {
    const root = gltf.scene;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = !o.isSkinnedMesh;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.envMapIntensity = name.startsWith('env_building') ? 0.6 : 1.0;
        // Meshy metalness maps run hot; keep a little diffuse so base colors survive.
        if (m.metalnessMap) m.metalness = 0.85;
        for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          if (m[key]) m[key].anisotropy = Math.min(8, maxAniso);
        }
        // Neon strips come in via the Blender-derived emissive map; push them into bloom range.
        if (m.emissiveMap) {
          m.emissive = new THREE.Color(1, 1, 1);
          m.emissiveIntensity = THREE.MathUtils.clamp(m.emissiveIntensity || 1, 2.2, MAX_EMISSIVE);
        }
      }
    });
    normalizeGlow(root);
    const box = new THREE.Box3().setFromObject(root);
    return { scene: root, animations: gltf.animations, box, size: box.getSize(new THREE.Vector3()) };
  }

  has(name) { return !!this.models[name]; }
  get(name) { return this.models[name]; }
  clip(name, clipName) {
    const m = this.models[name];
    return m?.animations.find((a) => a.name === clipName) || m?.animations[0] || null;
  }
}

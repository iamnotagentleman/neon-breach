// Pure simulation: no DOM, no audio. Renderer and UI read state; side effects go through `hooks`.
import {
  TILE, COLS, ROWS, TOWERS, ENEMIES, MAPS, WAVES, ABILITIES, MODS, VET, REACTIONS, HERO, HERO_RULES,
  hpMultiplier, rewardScale, waveBonus, earlyBonus, SELL_RATIO, endlessWave, computeStats, canUpgradePath, variantOf, targetsOf,
} from './config.js';

let nextId = 1;
const noop = () => {};

// Corners are rounded into arcs (radius CORNER_R), so enemies sweep through turns instead of snapping 90°.
const CORNER_R = 0.72 * TILE;
export function buildPath(waypoints) {
  const raw = waypoints.map(([x, y]) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }));
  const pts = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1], c = raw[i], b = raw[i + 1];
    const la = Math.hypot(c.x - a.x, c.y - a.y), lb = Math.hypot(b.x - c.x, b.y - c.y);
    const ux = (c.x - a.x) / la, uy = (c.y - a.y) / la, vx = (b.x - c.x) / lb, vy = (b.y - c.y) / lb;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (turn < 1e-3) { pts.push(c); continue; }
    // Tangent distance for this radius, kept within half of either leg so back-to-back turns can't overlap.
    const r = Math.min(CORNER_R, (Math.min(la, lb) * 0.5) / Math.tan(turn / 2));
    const tdist = r * Math.tan(turn / 2);
    const p0 = { x: c.x - ux * tdist, y: c.y - uy * tdist };
    const side = Math.sign(ux * vy - uy * vx); // +1 turning clockwise on screen
    const cx = p0.x - uy * side * r, cy = p0.y + ux * side * r;
    const a0 = Math.atan2(p0.y - cy, p0.x - cx);
    const steps = Math.max(3, Math.round(turn / (Math.PI / 16)));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + side * turn * (k / steps);
      pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
    }
  }
  pts.push(raw[raw.length - 1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, length: cum[cum.length - 1], waypoints };
}

// Sky lane for a road: flyers leave the same gate and follow the road, but cut straight across each corner (up to
// AIR_CUT tiles back along both legs, at most half of either) wherever that chord keeps AIR_CLEAR tiles from the tall
// blocks, which stand above their flight level. `tall` = [x, y, size] footprints. Returns tile waypoints.
const AIR_CUT = 2.5, AIR_CLEAR = 0.45;
export function skyLane(waypoints, tall) {
  const P = waypoints.map(([x, y]) => [x + 0.5, y + 0.5]); // tile centres
  const clear = ([ax, ay], [bx, by]) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1);
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
      for (const [rx, ry, rs] of tall) {
        if (Math.hypot(Math.max(rx - x, 0, x - rx - rs), Math.max(ry - y, 0, y - ry - rs)) < AIR_CLEAR) return false;
      }
    }
    return true;
  };
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const [ax, ay] = P[i - 1], [cx, cy] = P[i], [bx, by] = P[i + 1];
    const la = Math.hypot(cx - ax, cy - ay), lb = Math.hypot(bx - cx, by - cy);
    const u = [(cx - ax) / la, (cy - ay) / la], v = [(bx - cx) / lb, (by - cy) / lb];
    // Out of the gate along the road first (it starts a tile off the board), and into the core along it.
    let k = Math.min(AIR_CUT, i === 1 ? la - 1.5 : la / 2, i === P.length - 2 ? lb - 0.5 : lb / 2);
    const cut = (d) => [[cx - u[0] * d, cy - u[1] * d], [cx + v[0] * d, cy + v[1] * d]];
    while (k > 0.2 && !clear(...cut(k))) k -= 0.25;
    if (k > 0.2) out.push(...cut(k)); else out.push(P[i]);
  }
  out.push(P[P.length - 1]);
  return out.map(([x, y]) => [x - 0.5, y - 0.5]);
}

// Tiles covered by axis-aligned segments between waypoints, clipped to the grid.
export function pathTiles(waypoints) {
  const out = [];
  for (let i = 1; i < waypoints.length; i++) {
    let [x0, y0] = waypoints[i - 1];
    const [x1, y1] = waypoints[i];
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    for (;;) {
      if (x0 >= 0 && y0 >= 0 && x0 < COLS && y0 < ROWS) out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      x0 += dx; y0 += dy;
    }
  }
  return out;
}

// Position and heading at distance `dist` along a built path, searching from segment hint `seg`.
export function pathPoint(p, dist, seg = 0) {
  while (seg < p.pts.length - 2 && dist > p.cum[seg + 1]) seg++;
  while (seg > 0 && dist < p.cum[seg]) seg--;
  const a = p.pts[seg], b = p.pts[seg + 1];
  const segLen = p.cum[seg + 1] - p.cum[seg];
  const t = Math.min(1, Math.max(0, (dist - p.cum[seg]) / segLen));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / segLen, dy: (b.y - a.y) / segLen, seg };
}

export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Top-left tile of a size x size footprint whose center is nearest to pixel (px, py).
export function footprintAnchor(size, px, py) {
  return size === 1
    ? { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) }
    : { tx: Math.round(px / TILE - size / 2), ty: Math.round(py / TILE - size / 2) };
}

// 0 = buildable, 1 = path, 2 = blocked scenery, 3 = tower
// Scenery mixes 2x2 tower blocks and single-tile buildings, kept one tile clear of the road.
export function buildGrid(map) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (const wp of map.paths) for (const [x, y] of pathTiles(wp)) grid[y][x] = 1;
  const rnd = seededRandom(map.seed * 7919);
  const blocked = []; // [x, y, size]
  const free = (x, y, s) => {
    for (let oy = -1; oy <= s; oy++) for (let ox = -1; ox <= s; ox++) {
      const gx = x + ox, gy = y + oy;
      const inside = ox >= 0 && oy >= 0 && ox < s && oy < s;
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) { if (inside) return false; continue; }
      if (inside ? grid[gy][gx] !== 0 : grid[gy][gx] === 1) return false;
    }
    return true;
  };
  const place = (count, s) => {
    let n = 0, tries = 0;
    while (n < count && tries++ < 600) {
      const x = Math.floor(rnd() * (COLS - s + 1)), y = Math.floor(rnd() * (ROWS - s + 1));
      if (!free(x, y, s)) continue;
      for (let oy = 0; oy < s; oy++) for (let ox = 0; ox < s; ox++) grid[y + oy][x + ox] = 2;
      blocked.push([x, y, s]);
      n++;
    }
  };
  if (map.buildings) {
    // Hand-placed city blocks: level design uses them to break up sight lines.
    for (const [x, y, sz] of map.buildings) {
      let ok = true;
      for (let oy = 0; oy < sz; oy++) for (let ox = 0; ox < sz; ox++) if (grid[y + oy]?.[x + ox] !== 0) ok = false;
      if (!ok) continue;
      for (let oy = 0; oy < sz; oy++) for (let ox = 0; ox < sz; ox++) grid[y + oy][x + ox] = 2;
      blocked.push([x, y, sz]);
    }
  } else {
    place(3, 2);
    place(7, 1);
  }
  return { grid, blocked };
}

// ---------------------------------------------------------------- line of sight
// Buildings block direct fire. Footprints are inset a little so shots can graze a corner.
const LOS_INSET = 0.1 * TILE;
export function losRects(blocked) {
  return blocked.map(([x, y, s]) => [x * TILE + LOS_INSET, y * TILE + LOS_INSET, (x + s) * TILE - LOS_INSET, (y + s) * TILE - LOS_INSET]);
}
// Fraction (0..1) along the segment where it first enters a building, or Infinity if the line is clear.
export function segmentBlock(rects, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  let best = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    let t0 = 0, t1 = 1, ok = true;
    const ps = [-dx, dx, -dy, dy], qs = [x0 - r[0], r[2] - x0, y0 - r[1], r[3] - y0];
    for (let k = 0; k < 4 && ok; k++) {
      const p = ps[k], q = qs[k];
      if (p === 0) { if (q < 0) ok = false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
      if (t0 > t1) ok = false;
    }
    if (ok && t0 < best) best = t0;
  }
  return best;
}

// Points every `step` px along some built paths, clipped to the board.
function routeSamples(paths, step) {
  const out = [];
  for (const p of paths) {
    for (let d = 0; d < p.length; d += step) {
      const q = pathPoint(p, d);
      if (q.x >= 0 && q.y >= 0 && q.x <= COLS * TILE && q.y <= ROWS * TILE) out.push(q);
    }
  }
  return out;
}

// Sky lane tiles count for much less than road in the heat map: only the drones fly them, a small share of any wave.
export const AIR_HEAT_WEIGHT = 0.25;

// Placement heat map: for every tile, how many tiles of road a `type` tower anchored there would cover (only road it
// can see, unless it fires over buildings), or -1 where it can't be built. Uplinks score the towers they'd buff.
// Towers that hit flyers also score the sky lanes they'd see (over the low-rise blocks), at AIR_HEAT_WEIGHT, or in
// full for an anti-air-only variant; the parts are kept on the result as `.road` and `.air` (tiles in view).
export function coverageMap(game, type, variantId = null) {
  const def = TOWERS[type], size = def.size || 1;
  const variant = variantOf(def, variantId);
  const base = computeStats(def, [0, 0, 0], 0, variant);
  const hits = targetsOf(def, base, variant);
  const r = base.range * TILE;
  const walls = type !== 'plasma' && type !== 'uplink';
  const STEP = 8;
  game.roadSamples ||= routeSamples(game.paths, STEP);
  game.airSamples ||= routeSamples(game.airPaths, STEP);
  const road = hits.ground || type === 'uplink' ? game.roadSamples : [];
  const air = hits.air ? game.airSamples : [];
  const airWeight = hits.ground ? AIR_HEAT_WEIGHT : 1;
  const out = new Float32Array(COLS * ROWS).fill(-1);
  out.road = new Float32Array(COLS * ROWS);
  out.air = new Float32Array(COLS * ROWS);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (!game.canPlace(tx, ty, size)) continue;
      const x = (tx + size / 2) * TILE, y = (ty + size / 2) * TILE;
      const i = ty * COLS + tx;
      let v = 0;
      if (type === 'uplink') {
        for (const t of game.towers) {
          if (t.type !== 'uplink' && (t.x - x) ** 2 + (t.y - y) ** 2 <= (r + TILE * t.size * 0.5) ** 2) v += 1 + t.level;
        }
      } else {
        for (const q of road) {
          if ((q.x - x) ** 2 + (q.y - y) ** 2 <= r * r && (!walls || game.los(x, y, q.x, q.y))) v += STEP / TILE;
        }
        for (const q of air) {
          if ((q.x - x) ** 2 + (q.y - y) ** 2 <= r * r && (!walls || game.los(x, y, q.x, q.y, true))) out.air[i] += STEP / TILE;
        }
      }
      out.road[i] = v;
      out[i] = v + out.air[i] * airWeight;
    }
  }
  return out;
}

// Core damage of a breach: the hull's hit, plus the shield as an extra layer (in proportion to how much of it is
// still up), plus the children a Replicator would have spawned.
export function coreDamage(e) {
  const d = e.def;
  if (d.courier) return d.courier.packet; // lost only if it escapes with a packet
  let dmg = d.lives;
  if (e.shieldLives && e.maxShield > 0) dmg += Math.ceil(e.shieldLives * (e.shield / e.maxShield));
  if (d.splits) dmg += d.splits.count * ENEMIES[d.splits.type].lives;
  return dmg;
}

export class Enemy {
  // `air`: `pathIdx` is one of the map's sky lanes instead of a road.
  constructor(game, type, pathIdx, waveId, startDist = 0, mods = null, air = false) {
    const def = ENEMIES[type];
    const mul = hpMultiplier(waveId) * game.map.diff;
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.waveId = waveId;
    this.maxHp = def.hp * mul;
    this.hp = this.maxHp;
    this.maxShield = (def.shield || 0) * mul;
    this.shieldLives = def.shieldLives || 0;
    this.shield = this.maxShield;
    this.armor = def.armor || 0;
    this.speedMul = 1;
    this.regen = 0;
    this.mirror = this.insulated = this.thermal = false;
    this.cloaked = !!def.cloaked;
    // Variants (config MODS): resistances and endless mutators. Bosses spawn without them but adapt at their skulls
    // (bossPhase). Hardened goes first so a Warded shield is sized on the hardened hull.
    this.mods = [];
    const list = def.boss || !mods ? [] : mods.filter((m) => MODS[m]);
    for (const m of list.sort((a, b) => (b === 'hardened') - (a === 'hardened'))) this.applyMod(m);
    this.radius = def.radius * TILE;
    this.flying = !!def.flying;
    this.reward = Math.round(def.reward * 1.3 * rewardScale(waveId) * (1 + 0.2 * this.mods.length));
    this.healRate = def.heal ? def.heal.rate * mul : 0;
    this.pathIdx = pathIdx;
    this.air = air;
    this.path = (air ? game.airPaths : game.paths)[pathIdx];
    this.dist = startDist;
    this.seg = 0;
    this.offset = def.boss ? 0 : (Math.random() - 0.5) * 0.26 * TILE;
    this.slowT = 0;
    this.slowAmt = 0;
    this.slowFull = false;
    this.stunT = 0;
    this.frozenT = 0;
    this.lastHit = -99;
    this.flash = 0;
    this.revealed = !this.cloaked;
    this.spawnEvery = def.spawns ? def.spawns.every : 0;
    this.spawnT = this.spawnEvery;
    this.dir = 1; // -1: a Data Courier running back out with a packet
    this.carrying = false;
    this.phase = 0; // boss skulls passed
    this.phaseT = 0; // boss phase transition: untouchable
    this.surgeT = 0;
    this.dead = false;
    this.leaked = false;
    this.anim = Math.random() * 10;
    // Status effects applied by upgrades.
    this.burnDps = 0; this.burnT = 0; this.burnSrc = null;
    this.shred = 0;
    this.markAmp = 0; this.markT = 0;
    this.brittle = 0; this.brittleT = 0;
    this.shatter = 0; this.shatterT = 0; this.shatterSrc = null;
    this.auraSlow = 0; this.auraAmp = 0; this.auraArmorDown = 0;
    this.crackT = 0; // Thermal Shock: armor cracked open
    this.reactT = 0; // per-enemy combo cooldown
    this.converted = null; // hijacked by the hero: { t, max, cd, hero } while it fights for us
    this.updatePos();
  }

  // One variant's effect. `adapt`: gained mid-fight by a boss at a skull, where the hull isn't grown (Hardened adds
  // only armor) and repair and wards come in weaker.
  applyMod(m, adapt = false) {
    if (!this.mods.includes(m)) this.mods.push(m);
    switch (m) {
      case 'hardened': this.armor += 3; if (!adapt) { this.maxHp *= 1.5; this.hp = this.maxHp; } break;
      case 'amped': this.speedMul *= 1.3; break;
      case 'repair': this.regen = adapt ? 0.01 : 0.04; break;
      case 'warded':
        if (!this.maxShield) { this.maxShield = this.maxHp * (adapt ? 0.12 : 0.5); this.shield = this.maxShield; this.shieldLives = 2; }
        break;
      case 'mirror': this.mirror = true; break;
      case 'insulated': this.insulated = true; break;
      case 'thermal': this.thermal = true; this.slowT = this.burnT = this.frozenT = 0; break;
      case 'ghosted': this.cloaked = true; this.revealed = false; break;
    }
  }

  // Distance left to where this enemy does damage: the core, or the exit for a courier carrying a packet.
  get remaining() { return this.dir > 0 ? this.path.length - this.dist : this.dist; }
  get effArmor() { return this.crackT > 0 ? 0 : Math.max(0, this.armor - this.shred - this.auraArmorDown); }
  get stripped() { return this.shred > 0 || this.auraArmorDown > 0 || this.crackT > 0; }

  applySlow(amount, dur, full = false) {
    if (this.thermal) return;
    this.slowAmt = Math.max(this.slowT > 0 ? this.slowAmt : 0, amount);
    this.slowT = Math.max(this.slowT, dur);
    if (full) this.slowFull = true;
  }

  stun(dur) {
    const d = this.def.boss ? dur * 0.3 : dur;
    this.stunT = Math.max(this.stunT, d);
  }

  updatePos() {
    const q = pathPoint(this.path, this.dist, this.seg);
    this.seg = q.seg;
    this.x = q.x - q.dy * this.offset;
    this.y = q.y + q.dx * this.offset;
    this.angle = Math.atan2(q.dy, q.dx) + (this.dir < 0 ? Math.PI : 0);
  }

  // Knockback always pushes away from where the enemy is heading.
  knockBack(px) {
    const d = this.def.boss ? px * 0.3 : px;
    this.dist = this.dir > 0 ? Math.max(0, this.dist - d) : Math.min(this.path.length - 1, this.dist + d);
    this.updatePos();
  }

  update(dt, game) {
    this.anim += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.markT = Math.max(0, this.markT - dt);
    this.brittleT = Math.max(0, this.brittleT - dt);
    this.shatterT = Math.max(0, this.shatterT - dt);
    this.frozenT = Math.max(0, this.frozenT - dt);
    this.crackT = Math.max(0, this.crackT - dt);
    this.reactT = Math.max(0, this.reactT - dt);
    this.phaseT = Math.max(0, this.phaseT - dt);
    this.surgeT = Math.max(0, this.surgeT - dt);
    // Hijacked: marches back toward its gate shooting its old squad, then self-destructs.
    if (this.converted) {
      const c = this.converted;
      c.t -= dt;
      this.dist = Math.max(0, this.dist - this.speed * TILE * dt);
      this.updatePos();
      if (this.dist <= 0 || c.t <= 0) { game.detonateConvert(this); return; }
      c.cd -= dt;
      if (c.cd <= 0) { c.cd = HERO_RULES.convertZapEvery; game.convertZap(this); }
      return;
    }
    if (this.regen && game.time - this.lastHit > 1.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * this.regen * dt);
    if (this.burnT > 0) {
      this.burnT -= dt;
      game.damage(this, this.burnDps * dt, { tower: this.burnSrc, pierce: true, quiet: true });
      if (this.dead) return;
    }
    if (this.stunT > 0) { this.stunT -= dt; return; }
    if (this.slowT > 0) this.slowT -= dt;
    const boss = this.def.boss;
    const slow = Math.max(this.slowT > 0 ? this.slowAmt * (boss && !this.slowFull ? 0.5 : 1) : 0, this.auraSlow * (boss ? 0.5 : 1));
    this.dist = Math.max(0, this.dist + this.dir * this.speed * (1 - Math.min(0.85, slow)) * TILE * dt);
    this.updatePos();

    if (this.maxShield > 0 && game.time - this.lastHit > 2 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.12 * dt);
    }
    if (this.healRate) {
      const r = this.def.heal.radius * TILE;
      for (const o of game.enemies) {
        if (o.dead || o.converted || o.hp >= o.maxHp) continue;
        const dx = o.x - this.x, dy = o.y - this.y;
        if (dx * dx + dy * dy < r * r) o.hp = Math.min(o.maxHp, o.hp + this.healRate * dt * (o === this ? 0.5 : 1));
      }
    }
    if (this.def.spawns) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.spawnEvery;
        for (let i = 0; i < this.def.spawns.count; i++) {
          game.spawnEnemy(this.def.spawns.type, this.pathIdx, this.waveId, Math.max(0, this.dist - i * 14));
        }
        game.fx.ring(this.x, this.y, 10, 60, this.def.color, 0.5);
      }
    }
    if (this.dir < 0) { if (this.dist <= 0) game.escape(this); }
    else if (this.dist >= this.path.length) {
      if (this.def.courier) game.steal(this); else game.leak(this);
    }
  }

  // Base speed with variants, boss surges and a courier's packet weighing it down (tiles/s, before slows).
  get speed() {
    return this.def.speed * this.speedMul * (this.surgeT > 0 ? 1.6 : 1) * (this.carrying ? this.def.courier.carrySpeed : 1);
  }
}

// Seconds a tower spends re-locking after switching variants (no fire).
export const RELOCK_TIME = 1.2;

export class Tower {
  constructor(type, tx, ty, variant = null, def = TOWERS[type]) {
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.tx = tx;
    this.ty = ty;
    this.size = this.def.size || 1;
    this.x = (tx + this.size / 2) * TILE;
    this.y = (ty + this.size / 2) * TILE;
    this.tiers = [0, 0, 0];
    this.angle = -Math.PI / 2;
    this.mode = 'first';
    this.invested = this.def.cost;
    this.kills = 0;
    this.dmgDealt = 0;
    this.buffDmg = 0;
    this.buffRate = 0;
    this.camoGrant = false;
    this.fireFlash = 0;
    this.built = 0;
    this.shots = 0;
    this.pulses = 0;
    this.xp = 0;
    this.rank = 0;
    this.jamT = 0; // knocked offline (Signal Jammer field, Titan EMP, Overmind hijack)
    this.jamKind = null;
    this.buffSrc = null; // the Uplink whose buff this tower is getting
    this.fresh = false; // bought during the current build phase: sells for a full refund
    this.aim = null; // manual aim point (Mortar: ground spot, Railgun: firing line through it), used in 'aim' mode
    this.engaged = false; // has something to shoot at (so it's loading / firing)
    this.charge = 0; // load progress 0..1 while engaged, for the renderer
    this.variant = variantOf(this.def, variant)?.id ?? null; // e.g. a Pulse Laser's 'ground' / 'air'
    this.relockT = 0; // re-locking after a variant switch
    this.refresh();
    this.cd = this.stats.rate ? 1 / this.stats.rate : 0; // built unloaded
  }

  refresh() { this.stats = computeStats(this.def, this.tiers, this.rank, this.variantDef); }
  get variantDef() { return variantOf(this.def, this.variant); }
  get hitsAir() { return targetsOf(this.def, this.stats, this.variantDef).air; }
  get hitsGround() { return targetsOf(this.def, this.stats, this.variantDef).ground; }
  // Highest tier on any path (0-5): drives visual intensity.
  get level() { return Math.max(...this.tiers); }
  get range() { return (this.stats.global ? 40 : this.stats.range) * TILE; }
  get sellValue() { return this.fresh ? this.invested : Math.floor(this.invested * SELL_RATIO); }
  get mainPath() {
    const m = Math.max(...this.tiers);
    return m ? this.tiers.indexOf(m) : -1;
  }
  canUpgrade(p) { return canUpgradePath(this.tiers, p); }
  nextTier(p) { return this.tiers[p] < 5 ? this.def.paths[p].tiers[this.tiers[p]] : null; }

  // Mortar shells arc over buildings, the uplink is a field, and wall-piercing slugs or orbital targeting ignore them.
  get ignoresWalls() { return this.type === 'plasma' || this.type === 'uplink' || !!this.stats.xray || !!this.stats.global; }

  // Line of sight to an enemy, cached per 8px cell (towers and buildings never move). Flyers cruise above the
  // low-rise blocks, so only the tall ones hide them.
  sees(game, e) {
    if (this.ignoresWalls) return true;
    const key = ((e.x >> 3) * 1024 + (e.y >> 3)) * 2 + (e.flying ? 1 : 0);
    this.sight ||= new Map();
    let v = this.sight.get(key);
    if (v === undefined) { v = game.los(this.x, this.y, e.x, e.y, e.flying); this.sight.set(key, v); }
    return v;
  }

  // How far a straight shot travels before hitting a building (`air`: only a tall one, for shots at flyers).
  reach(game, ux, uy, len, air = false) {
    return this.ignoresWalls ? len : game.rayClear(this.x, this.y, ux, uy, len, air);
  }

  // Manual aim ('aim' mode, Mortar and Railgun only): the player picks a ground spot or a firing line.
  get aimable() { return this.type === 'plasma' || this.type === 'rail'; }
  get aiming() { return this.mode === 'aim' && !!this.aim; }

  // The aim point a click at (x, y) gives: pulled inside the Mortar's range; null if it's on top of the tower.
  aimAt(x, y) {
    let dx = x - this.x, dy = y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < TILE * 0.5) return null;
    if (this.type === 'plasma' && d > this.range) { dx *= this.range / d; dy *= this.range / d; }
    return { x: this.x + dx, y: this.y + dy };
  }

  setAim(x, y) {
    const p = this.aimAt(x, y);
    if (!p) return false;
    this.aim = p;
    this.mode = 'aim';
    return true;
  }

  // Default firing line for a tower that can only fire down a fixed line (Annihilator): the bearing whose slug path
  // covers the most road it can reach (plus a little for sky lane), in 4° steps.
  defaultLine(game) {
    game.roadSamples ||= routeSamples(game.paths, 8);
    game.airSamples ||= routeSamples(game.airPaths, 8);
    const w = TILE * 0.5;
    let best = this.angle, bs = -1;
    for (let deg = 0; deg < 360; deg += 4) {
      const a = (deg * Math.PI) / 180;
      const { ux, uy, reach, reachAir } = this.railLine(game, a);
      let sc = 0;
      const count = (pts, len, wt) => {
        for (const q of pts) {
          const px = q.x - this.x, py = q.y - this.y, along = px * ux + py * uy;
          if (along > TILE * 0.5 && along <= len && Math.abs(px * uy - py * ux) < w) sc += wt;
        }
      };
      count(game.roadSamples, reach, 1);
      count(game.airSamples, reachAir, AIR_HEAT_WEIGHT);
      if (sc > bs) { bs = sc; best = a; }
    }
    this.aim = { x: this.x + Math.cos(best) * TILE * 3, y: this.y + Math.sin(best) * TILE * 3 };
    this.mode = 'aim';
  }

  canHit(e) {
    if (e.dead || e.converted) return false;
    if (!e.revealed && !this.stats.camo && !this.camoGrant) return false;
    return e.flying ? this.hitsAir : this.hitsGround;
  }

  inRange(e, r) {
    const dx = e.x - this.x, dy = e.y - this.y;
    const rr = r + e.radius * 0.5;
    return dx * dx + dy * dy <= rr * rr;
  }

  score(e) {
    switch (this.mode) {
      case 'last': return e.remaining;
      case 'strong': return e.hp + e.shield;
      case 'close': return -((e.x - this.x) ** 2 + (e.y - this.y) ** 2);
      default: return -e.remaining;
    }
  }

  acquire(game, n = 1) {
    const r = this.range;
    const pool = [];
    for (const e of game.enemies) if (this.canHit(e) && this.inRange(e, r) && this.sees(game, e)) pool.push(e);
    if (pool.length <= n) return pool.sort((a, b) => this.score(b) - this.score(a));
    return pool.sort((a, b) => this.score(b) - this.score(a)).slice(0, n);
  }

  // Every direct hit goes through here so on-hit upgrades apply uniformly.
  hit(game, e, amount, opts = {}) {
    const s = this.stats;
    if (e.def.boss) amount *= s.bossMul;
    game.damage(e, amount, { tower: this, shieldMul: s.shieldMul, armorMul: s.armorMul, ...opts });
    if (e.dead) return;
    if (s.burn && !e.thermal) {
      // Igniting a chilled enemy: Thermal Shock instead of a burn.
      if (e.slowT > 0 && e.reactT <= 0) game.thermalShock(e, this);
      else {
        e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, amount * s.burn);
        e.burnT = s.burnDur;
        e.burnSrc = this;
      }
      if (e.dead) return;
    }
    if (s.shred) e.shred = Math.min(s.shredMax, e.shred + s.shred);
    if (s.hitSlow) e.applySlow(s.hitSlow, 0.8);
    if (s.stunChance && Math.random() < s.stunChance) e.stun(s.stunDur);
    if (s.markAmp) { e.markAmp = Math.max(e.markT > 0 ? e.markAmp : 0, s.markAmp); e.markT = s.markDur; }
  }

  // Enemies within `width` of the segment from (x0,y0) in direction (ux,uy), sorted by distance along it. Ground
  // enemies only count up to `groundLen` (where a low building stops the shot); flyers above it up to `len`.
  lineHits(game, x0, y0, ux, uy, len, width, groundLen = len) {
    const out = [];
    for (const e of game.enemies) {
      if (e.dead || e.converted) continue;
      const px = e.x - x0, py = e.y - y0;
      const along = px * ux + py * uy;
      if (along < 0 || along > (e.flying ? len : groundLen)) continue;
      if (Math.abs(px * uy - py * ux) < e.radius + width) out.push([along, e]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  }

  // Where an enemy will be `t` seconds from now if it keeps its current pace (for the Mortar's spot trigger).
  predict(e, t) {
    if (e.stunT > 0) return e;
    const slow = Math.max(e.slowT > 0 ? e.slowAmt : 0, e.auraSlow);
    const d = e.dist + e.dir * e.speed * (1 - Math.min(0.85, slow)) * TILE * t;
    return pathPoint(e.path, Math.max(0, Math.min(e.path.length, d)), e.seg);
  }

  // Aim mode: fire only when a shot at the spot / down the line would actually hit something the tower can target.
  aimReady(game) {
    const { x: ax, y: ay } = this.aim;
    if (this.type === 'plasma') {
      const dur = this.shellTime(ax, ay);
      // Wait until the shell would land near the middle of the blast, not glance its edge at half damage.
      const r = this.stats.splash * TILE * 0.65;
      return game.enemies.some((e) => {
        if (!this.canHit(e)) return false;
        const q = this.predict(e, dur);
        return (q.x - ax) ** 2 + (q.y - ay) ** 2 <= (r + e.radius * 0.5) ** 2;
      });
    }
    const { ux, uy, reach, reachAir } = this.railLine(game, Math.atan2(ay - this.y, ax - this.x));
    return this.lineHits(game, this.x, this.y, ux, uy, reachAir, 6 * this.stats.beamWidth, reach).some((e) => this.canHit(e));
  }

  update(dt, game) {
    this.built = Math.min(1, this.built + dt * 3);
    this.fireFlash = Math.max(0, this.fireFlash - dt);
    this.engaged = false;
    this.charge = 0;
    if (this.jamT > 0) return; // offline: no fire, no pulses, no fields
    if (this.relockT > 0) { this.relockT -= dt; return; } // turret swinging to its new variant
    const s = this.stats;
    if (this.type === 'uplink') { this.angle += dt * 1.4; return; }
    const rateMul = (1 + this.buffRate) * (game.overclockT > 0 ? ABILITIES.overclock.mult : 1);
    // Weapons only load while there's something to shoot at: an idle tower doesn't sit on a ready shot, so every
    // engagement opens with the load (whatever is left of it from the last one). True once loaded.
    const load = () => {
      this.engaged = true;
      this.cd -= dt * rateMul;
      this.charge = Math.min(1, Math.max(0, 1 - this.cd * s.rate));
      return this.cd <= 0;
    };
    const dmg = (s.dmg || 0) * (1 + this.buffDmg);

    if (this.type === 'cryo') { this.pulse(game, dmg, load); return; }

    // Fixed-line weapons (Annihilator) never track: without a line of their own they take the default one.
    if (s.aimOnly && !this.aiming) this.defaultLine(game);
    if (this.aiming) {
      // Manual aim: load while anything it can hit is in range, then hold the shot until something is about to be
      // in the spot / on the line.
      this.angle = Math.atan2(this.aim.y - this.y, this.aim.x - this.x);
      if (!game.enemies.some((e) => this.canHit(e) && this.inRange(e, this.range))) return;
      if (!load()) return;
      if (!this.aimReady(game)) { this.cd = 0; return; }
      this.cd += 1 / s.rate;
      this.fireFlash = 0.12;
      this.shots++;
      const [mx, my] = this.muzzle();
      if (this.type === 'plasma') {
        // Extra shells of a volley land around the spot rather than stacking on it.
        for (let i = 0; i < s.targets; i++) {
          const a = Math.random() * Math.PI * 2, d = i ? Math.sqrt(Math.random()) * s.splash * TILE * 0.45 : 0;
          this.lobShell(game, this.aim.x + Math.cos(a) * d, this.aim.y + Math.sin(a) * d, dmg, mx, my);
        }
        game.fx.emit({ type: 'fire', tower: this });
        game.hooks.sfx('plasma', this);
      } else {
        this.fireRail(game, dmg, mx, my);
        game.hooks.sfx('rail', this);
      }
      return;
    }

    const targets = this.acquire(game, s.targets);
    if (!targets.length) return;
    const target = targets[0];
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (!load()) return;
    this.cd += 1 / s.rate;
    this.fireFlash = 0.12;
    this.shots++;
    const [mx, my] = this.muzzle();

    switch (this.type) {
      case 'laser':
        for (const t of targets) this.fireLaser(game, t, dmg, mx, my);
        game.hooks.sfx('laser', this);
        break;
      case 'plasma':
        for (const t of targets) this.launchShell(game, t, dmg, mx, my);
        game.fx.emit({ type: 'fire', tower: this });
        game.hooks.sfx('plasma', this);
        break;
      case 'tesla': {
        const burst = s.burstEvery && this.shots % s.burstEvery === 0;
        for (const t of targets) this.arc(game, t, burst ? dmg * s.burstMul : dmg, mx, my, burst);
        game.hooks.sfx('tesla', this);
        break;
      }
      case 'rail':
        this.fireRail(game, dmg, mx, my);
        game.hooks.sfx('rail', this);
        break;
    }
  }

  muzzle() {
    return [this.x + Math.cos(this.angle) * TILE * 0.38 * this.size, this.y + Math.sin(this.angle) * TILE * 0.38 * this.size];
  }

  fireLaser(game, target, dmg, mx, my) {
    const s = this.stats;
    if (s.pierce > 1) {
      const a = Math.atan2(target.y - this.y, target.x - this.x);
      const ux = Math.cos(a), uy = Math.sin(a);
      const hits = this.lineHits(game, this.x, this.y, ux, uy, this.reach(game, ux, uy, this.range, true), 6, this.reach(game, ux, uy, this.range))
        .filter((e) => this.canHit(e)).slice(0, s.pierce);
      for (const e of hits) this.hit(game, e, dmg);
      const end = hits[hits.length - 1] || target;
      game.fx.beam(mx, my, end.x, end.y, this.def.color, 3 + this.level, 0.1, { tower: this, target: end, pierce: true });
    } else {
      this.hit(game, target, dmg);
      game.fx.beam(mx, my, target.x, target.y, this.def.color, 2 + this.level * 0.7, 0.08, { tower: this, target });
    }
    game.fx.sparks(target.x, target.y, this.def.color, 3, 80);
  }

  // Flight time of a mortar shell to (x, y).
  shellTime(x, y) { return Math.max(0.25, Math.hypot(x - this.x, y - this.y) / (7 * TILE)); }

  launchShell(game, target, dmg, mx, my) {
    const lead = Math.hypot(target.x - this.x, target.y - this.y) / (7 * TILE);
    const sp = target.speed * TILE * (target.stunT > 0 ? 0 : 1);
    this.lobShell(game, target.x + Math.cos(target.angle) * sp * lead, target.y + Math.sin(target.angle) * sp * lead, dmg, mx, my, Math.max(0.25, lead));
  }

  lobShell(game, tx, ty, dmg, mx, my, dur = this.shellTime(tx, ty)) {
    game.projectiles.push({
      kind: 'plasma', x0: mx, y0: my, id: nextId++, t: 0, tx, ty,
      dur, dmg, splash: this.stats.splash * TILE, tower: this, color: this.def.color,
    });
  }

  arc(game, first, dmg, mx, my, burst) {
    const s = this.stats;
    const hit = new Set([first]);
    const pts = [{ x: mx, y: my - 8 }, { x: first.x, y: first.y }];
    // One link of the chain. Chilled targets superconduct (+50%, no falloff on the next jump); burning ones overload.
    const zap = (e, m) => {
      let d = dmg * m, cold = false;
      if (e.slowT > 0 && !e.thermal) { d *= 1.5; cold = true; game.react('superconduct', e); }
      if (e.burnT > 0 && e.reactT <= 0) game.overload(e, this);
      if (!e.dead) this.hit(game, e, d);
      return cold;
    };
    let cur = first, mult = 1;
    let cold = zap(cur, 1);
    const jump = s.chainRange * TILE;
    for (let i = 1; i < s.chains; i++) {
      if (cur.insulated) break; // grounded hull: the arc stops here
      let next = null, bd = jump * jump;
      for (const e of game.enemies) {
        if (hit.has(e) || !this.canHit(e)) continue;
        const d2 = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
        if (d2 < bd && game.los(cur.x, cur.y, e.x, e.y, cur.flying || e.flying)) { bd = d2; next = e; }
      }
      if (!next) break;
      if (!cold) mult *= s.falloff;
      hit.add(next);
      cold = zap(next, mult);
      pts.push({ x: next.x, y: next.y });
      cur = next;
    }
    game.fx.bolt(pts, burst ? '#ffffff' : this.def.color, burst ? 0.22 : 0.14, { tower: this, targets: [...hit], burst });
  }

  // A slug's line at angle `a`: full length, how far it gets before a building, and how far over the low-rise blocks
  // (for the flyers above them).
  railLine(game, a) {
    const ux = Math.cos(a), uy = Math.sin(a);
    const len = Math.min(this.range, 30 * TILE) + TILE;
    return { ux, uy, len, reach: this.reach(game, ux, uy, len), reachAir: this.reach(game, ux, uy, len, true) };
  }

  fireRail(game, dmg, mx, my) {
    const s = this.stats;
    const n = s.slugs;
    for (let i = 0; i < n; i++) {
      const { ux, uy, len, reach, reachAir } = this.railLine(game, this.angle + (i - (n - 1) / 2) * 0.1);
      // The slug loses power with every enemy it passes through (not the Annihilator's).
      let k = 1, end = reach;
      for (const e of this.lineHits(game, this.x, this.y, ux, uy, reachAir, 6 * s.beamWidth, reach)) {
        // A flyer past a low building: the slug carries on over the roofs.
        if (e.flying && (e.x - this.x) * ux + (e.y - this.y) * uy > reach) end = reachAir;
        // Exposed: armor-stripped targets take a critical slug.
        const crit = e.stripped && !e.dead;
        if (crit) game.react('exposed', e);
        // Kinetic slugs spend themselves on energy shields (shieldMul 0.5): Tesla and EMP are the shield answer.
        this.hit(game, e, dmg * k * (crit ? 1.5 : 1), { pierce: true });
        k = Math.max(0.5, k - s.slugFalloff);
      }
      const ex = this.x + ux * end, ey = this.y + uy * end;
      if (end < len) game.fx.sparks(ex, ey, this.def.color, 10, 140); // slug slams into a building
      game.fx.beam(mx, my, ex, ey, this.def.color, (5 + this.level) * s.beamWidth, 0.28, { tower: this, rail: true, width: s.beamWidth });
    }
    game.fx.sparks(mx, my, '#ffffff', 8, 160);
    game.shake = Math.max(game.shake, 3 * s.beamWidth);
  }

  // `load`: advances the reload (see update); only runs while something is in the field.
  pulse(game, dmg, load) {
    const s = this.stats;
    this.angle += 0.013;
    const r = this.range;
    const covers = (e) => !e.dead && this.inRange(e, r) && this.sees(game, e);
    if (!game.enemies.some(covers) || !load()) return;
    const inside = game.enemies.filter(covers);
    this.cd += 1 / s.rate;
    this.pulses++;
    this.fireFlash = 0.3;
    const freezeAll = s.freezeEvery && this.pulses % s.freezeEvery === 0;
    for (const e of inside) {
      // Chilling a burning enemy: Thermal Shock.
      if (e.burnT > 0 && !e.thermal && e.reactT <= 0) { game.thermalShock(e, this); if (e.dead) continue; }
      e.applySlow(s.slow, s.slowDur, s.bossSlow);
      if (!e.thermal) {
        if (s.brittle) { e.brittle = Math.max(e.brittleT > 0 ? e.brittle : 0, s.brittle); e.brittleT = s.slowDur; }
        if (s.shatter) { e.shatter = Math.max(e.shatterT > 0 ? e.shatter : 0, s.shatter); e.shatterT = s.slowDur; e.shatterSrc = this; }
        game.addXp(this, e.def.reward * 0.1); // crowd control earns its keep
      }
      this.hit(game, e, dmg);
      if (!e.dead && !e.thermal && (freezeAll || (s.freezeChance && Math.random() < s.freezeChance))) {
        e.stun(s.freezeDur);
        e.frozenT = Math.max(e.frozenT, e.def.boss ? s.freezeDur * 0.3 : s.freezeDur);
      }
    }
    if (s.shards) {
      for (const e of this.acquire(game, s.shards)) {
        this.hit(game, e, dmg * 3);
        game.fx.beam(this.x, this.y, e.x, e.y, '#bfe3ff', 2, 0.12, { tower: this, target: e, shard: true });
      }
    }
    game.fx.ring(this.x, this.y, 8, r, freezeAll ? '#ffffff' : this.def.color, 0.45, freezeAll ? 4 : 2, { kind: 'frost' });
    game.hooks.sfx('cryo', this);
  }
}

// ---------------------------------------------------------------- hero
// Open ground and road are walkable for the hero; buildings and towers are not.
const walkable = (game, tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && game.grid[ty][tx] <= 1;
const tileOf = (px) => Math.floor(px / TILE);

// Route for the hero from (x0, y0) to (x1, y1) in pixels: A* over tiles (8-way, no cutting past blocked corners),
// string-pulled into straight legs. A blocked goal snaps to the nearest open tile. Returns pixel points or null.
export function heroRoute(game, x0, y0, x1, y1) {
  let gx = tileOf(x1), gy = tileOf(y1);
  if (!walkable(game, gx, gy)) {
    let best = null, bd = Infinity;
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const d = (tx + 0.5 - x1 / TILE) ** 2 + (ty + 0.5 - y1 / TILE) ** 2;
      if (d < bd && walkable(game, tx, ty)) { bd = d; best = [tx, ty]; }
    }
    if (!best) return null;
    [gx, gy] = best;
    x1 = (gx + 0.5) * TILE; y1 = (gy + 0.5) * TILE;
  }
  const sx = Math.min(COLS - 1, Math.max(0, tileOf(x0))), sy = Math.min(ROWS - 1, Math.max(0, tileOf(y0)));
  const idx = (x, y) => y * COLS + x;
  const g = new Float32Array(COLS * ROWS).fill(Infinity), from = new Int32Array(COLS * ROWS).fill(-1);
  const open = [idx(sx, sy)];
  g[open[0]] = 0;
  const h = (i) => { const dx = Math.abs((i % COLS) - gx), dy = Math.abs(Math.floor(i / COLS) - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const goal = idx(gx, gy);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === goal) break;
    const cx = cur % COLS, cy = Math.floor(cur / COLS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(game, nx, ny)) continue;
      if (dx && dy && (!walkable(game, cx + dx, cy) || !walkable(game, cx, cy + dy))) continue;
      const n = idx(nx, ny), c = g[cur] + (dx && dy ? 1.414 : 1);
      if (c < g[n]) { g[n] = c; from[n] = cur; if (!open.includes(n)) open.push(n); }
    }
  }
  if (goal !== idx(sx, sy) && from[goal] < 0) return null;
  const tiles = [];
  for (let i = goal; i >= 0 && i !== idx(sx, sy); i = from[i]) tiles.push([(i % COLS + 0.5) * TILE, (Math.floor(i / COLS) + 0.5) * TILE]);
  tiles.reverse();
  if (tiles.length) tiles[tiles.length - 1] = [x1, y1];
  else tiles.push([x1, y1]);
  // String-pull: from each corner, head straight for the furthest point still reachable over open tiles.
  const clear = (ax, ay, bx, by) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (TILE * 0.2));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      if (!walkable(game, tileOf(x), tileOf(y)) && !(tileOf(x) === sx && tileOf(y) === sy)) return false;
    }
    return true;
  };
  const out = [];
  let ax = x0, ay = y0, i = 0;
  while (i < tiles.length) {
    let j = tiles.length - 1;
    while (j > i && !clear(ax, ay, ...tiles[j])) j--;
    out.push(tiles[j]);
    [ax, ay] = tiles[j];
    i = j + 1;
  }
  return out;
}

// Road samples every 8px with how far along their road they sit (0 = gate, 1 = core): where traps can go.
function trapSamples(game) {
  const out = [];
  for (const p of game.paths) {
    for (let d = 0; d < p.length; d += 8) {
      const q = pathPoint(p, d);
      if (q.x >= 0 && q.y >= 0 && q.x <= COLS * TILE && q.y <= ROWS * TILE) out.push({ x: q.x, y: q.y, k: d / p.length });
    }
  }
  return out;
}

const turnToward = (a, b, max) => {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + Math.max(-max, Math.min(max, d));
};

export class Hero extends Tower {
  constructor(x, y) {
    super('hero', tileOf(x), tileOf(y), null, HERO);
    this.isHero = true;
    this.x = x;
    this.y = y;
    this.heading = -Math.PI / 2; // body facing (the guns aim along `angle`)
    this.angle = this.heading;
    this.route = [];
    this.dest = null;
    this.moving = false;
    this.lastHurt = -99;
    this.hurtT = 0;
    this.contact = 0; // enemies shooting at it
    this.downT = 0; // knocked out: seconds until it reboots
    this.rebootT = HERO_RULES.rebootTime; // booting up (deploy, reboot): no moving or firing
    this.downs = 0;
    this.side = 0; // which cannon fires next
    this.hackCd = 3;
    this.missileCd = 1;
    this.layCd = 1;
    this.trapsLaid = 0;
    this.hacks = 0;
  }

  // Stats as a tower's, plus the hull: it grows with rank and every tier bought (the damage taken carries over).
  refresh() {
    const k = this.maxHp ? this.hp / this.maxHp : 1;
    super.refresh();
    const tiers = this.tiers.reduce((a, b) => a + b, 0);
    this.maxHp = this.stats.hp * (1 + HERO_RULES.hpPerRank * this.rank) * (1 + HERO_RULES.hpPerTier * tiers);
    this.hp = this.maxHp * k;
  }

  get online() { return this.downT <= 0 && this.rebootT <= 0; }
  get sellValue() { return 0; }
  get aimable() { return false; }
  // It moves, so sight isn't cached per enemy cell like a tower's.
  sees(game, e) { return game.los(this.x, this.y, e.x, e.y, e.flying); }

  muzzle(side = this.side) {
    const a = this.angle, o = (side ? 1 : -1) * 0.2 * TILE;
    return [this.x + Math.cos(a) * 0.35 * TILE - Math.sin(a) * o, this.y + Math.sin(a) * 0.35 * TILE + Math.cos(a) * o];
  }

  // No orders get through while it's knocked out or jammed.
  moveTo(game, x, y) {
    if (this.downT > 0 || this.jamT > 0) return false;
    const route = heroRoute(game, this.x, this.y, x, y);
    if (!route) return false;
    this.route = route;
    const [dx, dy] = route[route.length - 1];
    this.dest = { x: dx, y: dy };
    return true;
  }

  stop() { this.route = []; this.dest = null; }

  hurt(game, amount) {
    if (this.downT > 0 || this.rebootT > 0) return;
    this.hp -= amount;
    this.lastHurt = game.time;
    this.hurtT = 0.2;
    if (this.hp > 0) return;
    this.hp = 0;
    this.downT = HERO_RULES.downTime;
    this.downs++;
    this.stop();
    game.fx.explosion(this.x, this.y, HERO.color, TILE * 0.5);
    game.fx.emit({ type: 'herodown', hero: this });
    game.shake = Math.max(game.shake, 9);
    game.hooks.sfx('herodown', this);
    game.hooks.heroDown(this);
  }

  update(dt, game) {
    const R = HERO_RULES, s = this.stats;
    this.fireFlash = Math.max(0, this.fireFlash - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.engaged = false;
    this.charge = 0;
    this.moving = false;
    if (this.downT > 0) {
      this.downT -= dt;
      if (this.downT <= 0) {
        this.downT = 0;
        this.rebootT = R.rebootTime;
        this.hp = this.maxHp;
        game.fx.emit({ type: 'heroreboot', hero: this });
        game.hooks.sfx('heroreboot', this);
        game.hooks.heroUp(this);
      }
      return;
    }
    if (this.rebootT > 0) { this.rebootT -= dt; return; }

    // Walk the route; the body turns toward where it's going. Jammed, it freezes where it stands (the walk resumes after).
    if (this.route.length && this.jamT <= 0) {
      const [tx, ty] = this.route[0];
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy), step = s.speed * TILE * dt;
      if (d <= step) { this.x = tx; this.y = ty; this.route.shift(); if (!this.route.length) this.dest = null; }
      else { this.x += (dx / d) * step; this.y += (dy / d) * step; }
      if (d > 1) this.heading = turnToward(this.heading, Math.atan2(dy, dx), 9 * dt);
      this.moving = true;
    }

    // Return fire: every armed enemy that has it in range and in sight shoots it once a second (buildings block the
    // shot, flyers fire over the low blocks); out of fire it self-repairs.
    let firing = 0;
    for (const e of game.enemies) {
      const a = e.def.atk;
      if (!a || e.dead || e.converted || e.stunT > 0 || e.phaseT > 0) continue;
      const r = a.range * TILE + R.bodyR * TILE;
      if ((e.x - this.x) ** 2 + (e.y - this.y) ** 2 > r * r || !game.los(e.x, e.y, this.x, this.y, e.flying)) continue;
      firing++;
      e.atkT = (e.atkT ?? Math.random()) - dt;
      if (e.atkT > 0) continue;
      e.atkT += 1;
      this.hurt(game, e.maxHp * a.dps);
      game.fx.emit({ type: 'enemyshot', enemy: e, hero: this });
      game.hooks.sfx('herohit', this);
      if (this.downT > 0) return;
    }
    this.contact = firing; // enemies firing at it right now
    if (!firing && game.time - this.lastHurt > R.regenDelay && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * R.regen * dt);

    if (this.jamT > 0) return; // jammed: no control, no guns, no traps
    this.lay(dt, game);
    const rateMul = (1 + this.buffRate) * (game.overclockT > 0 ? ABILITIES.overclock.mult : 1);
    const dmg = s.dmg * (1 + this.buffDmg);
    this.hackCd = Math.max(0, this.hackCd - dt);
    if (s.hackEvery && this.hackCd <= 0 && this.hack(game)) this.hackCd = s.hackEvery;
    const targets = this.acquire(game, s.targets);
    if (!targets.length) return;
    const target = targets[0];
    this.engaged = true;
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (!this.moving) this.heading = turnToward(this.heading, this.angle, 5 * dt);
    if (s.missiles) {
      this.missileCd -= dt * rateMul;
      if (this.missileCd <= 0) { this.missileCd = s.missileEvery; this.salvo(game, dmg); }
    }
    this.cd -= dt * rateMul;
    this.charge = Math.min(1, Math.max(0, 1 - this.cd * s.rate));
    if (this.cd > 0) return;
    this.cd += 1 / s.rate;
    this.fireFlash = 0.1;
    this.shots++;
    targets.forEach((e, i) => {
      const side = (this.side + i) % 2;
      this.hit(game, e, dmg, { pierce: !!s.pierceArmor });
      game.fx.emit({ type: 'herofire', hero: this, target: e, side });
    });
    this.side = (this.side + 1) % 2;
    game.fx.sparks(target.x, target.y, HERO.color, 3, 80);
    game.hooks.sfx('heroshot', this);
  }

  // Signal Spike / Hijack: the strongest enemies in range are stunned and marked, or (HIJACK on) turned. Bosses run
  // hardened firmware: immune to all of it.
  hack(game) {
    const s = this.stats;
    const pool = game.enemies.filter((e) => !e.def.boss && this.canHit(e) && this.inRange(e, this.range) && this.sees(game, e))
      .sort((a, b) => b.hp + b.shield - (a.hp + a.shield));
    if (!pool.length) return false;
    for (const e of pool.slice(0, s.convert || 1)) {
      if (s.convert) game.convert(e, this);
      else {
        e.stun(s.hackStun);
        e.markAmp = Math.max(e.markT > 0 ? e.markAmp : 0, s.hackMark);
        e.markT = 5;
      }
      game.fx.emit({ type: 'herohack', hero: this, enemy: e, convert: !!s.convert });
    }
    this.hacks++;
    game.hooks.sfx(s.convert ? 'herohijack' : 'herohack', this);
    return true;
  }

  // Hellfire Pods: micro-missiles spread over the targets in range, led onto where they'll be.
  salvo(game, dmg) {
    const s = this.stats;
    const pool = this.acquire(game, s.missiles);
    if (!pool.length) return;
    for (let i = 0; i < s.missiles; i++) {
      const e = pool[i % pool.length];
      const dur = 0.35 + Math.hypot(e.x - this.x, e.y - this.y) / (9 * TILE) + i * 0.04;
      const sp = e.stunT > 0 ? 0 : e.speed * TILE * 0.8;
      const j = () => (Math.random() - 0.5) * TILE * 0.35;
      game.projectiles.push({
        kind: 'missile', id: nextId++, x0: this.x, y0: this.y, t: 0, dur, dmg: dmg * s.missileDmg, splash: 0.7 * TILE,
        tx: e.x + Math.cos(e.angle) * sp * dur + j(), ty: e.y + Math.sin(e.angle) * sp * dur + j(), air: e.flying, tower: this, color: HERO_RULES.missileColor,
      });
    }
    game.fx.emit({ type: 'herosalvo', hero: this });
    game.hooks.sfx('missile', this);
  }

  // Trapper: plants a trap on the road in range whenever it has one to spare.
  lay(dt, game) {
    const s = this.stats;
    if (!s.mines) return;
    this.layCd -= dt;
    if (this.layCd > 0) return;
    if (game.traps.filter((t) => t.hero === this).length >= s.mines) { this.layCd = 0.4; return; }
    const spot = this.trapSpot(game);
    if (!spot) { this.layCd = 1; return; }
    this.layCd = s.mineEvery;
    this.trapsLaid++;
    const trap = { id: nextId++, hero: this, x: spot.x, y: spot.y, emp: !!s.empTrap && this.trapsLaid % s.empTrap === 0, armT: 0.8, age: 0 };
    game.traps.push(trap);
    game.fx.emit({ type: 'trapset', hero: this, trap });
    game.hooks.sfx('trapset', this);
  }

  // Road in range, away from the other traps (spread out), leaning toward the gate end so enemies meet them first.
  trapSpot(game) {
    game.trapSamples ||= trapSamples(game);
    const r = this.range, gap = TILE;
    let best = null, bs = -Infinity;
    for (const q of game.trapSamples) {
      if ((q.x - this.x) ** 2 + (q.y - this.y) ** 2 > r * r) continue;
      let near = 3 * TILE;
      for (const t of game.traps) near = Math.min(near, Math.hypot(t.x - q.x, t.y - q.y));
      if (near < gap) continue;
      const sc = near / TILE - q.k * 0.5 + Math.random() * 0.3;
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }
}

class FX {
  constructor() { this.clear(); }
  clear() {
    this.beams = []; this.bolts = []; this.rings = []; this.parts = []; this.texts = []; this.strikes = [];
    this.events = []; // drained by the 3D renderer; trimmed in update() when nothing consumes it
  }
  emit(ev) { this.events.push(ev); }
  beam(x1, y1, x2, y2, color, width, life, meta = {}) {
    this.beams.push({ x1, y1, x2, y2, color, width, life, max: life });
    this.emit({ type: 'beam', x1, y1, x2, y2, color, width, life, ...meta });
  }
  bolt(pts, color, life, meta = {}) {
    this.emit({ type: 'bolt', pts, color, life, ...meta });
    // Pre-jitter the polyline so each bolt keeps its shape while fading.
    const jag = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = 5;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        jag.push({ x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 16, y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 16 });
      }
      jag.push(b);
    }
    this.bolts.push({ pts: jag, nodes: pts.slice(1), color, life, max: life });
  }
  ring(x, y, r0, r1, color, life, width = 2, meta = {}) {
    this.rings.push({ x, y, r0, r1, color, life, max: life, width });
    this.emit({ type: 'ring', x, y, r0, r1, color, life, width, ...meta });
  }
  sparks(x, y, color, n, speed, meta = {}) {
    this.emit({ type: 'sparks', x, y, color, n, speed, ...meta });
    if (this.parts.length > 900) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, max: 0.6, color, size: 1.5 + Math.random() * 2 });
    }
  }
  explosion(x, y, color, size) {
    this.emit({ type: 'explosion', x, y, color, size });
    // The 3D renderer builds its own blast from the explosion event; these are for the flat renderer only.
    const flat = { skip3d: true };
    this.ring(x, y, 4, size * 2.2, color, 0.35, 3, flat);
    this.ring(x, y, 2, size * 1.2, '#ffffff', 0.2, 2, flat);
    this.sparks(x, y, color, Math.min(30, 8 + size / 2), 60 + size * 4, flat);
    this.sparks(x, y, '#ffffff', 4, 90, flat);
  }
  text(x, y, text, color, size = 13) {
    this.texts.push({ x, y, text, color, size, life: 1, max: 1 });
    this.emit({ type: 'text', x, y, text, color, size });
  }
  update(dt) {
    const decay = (arr) => {
      let j = 0;
      for (let i = 0; i < arr.length; i++) { const o = arr[i]; o.life -= dt; if (o.life > 0) arr[j++] = o; }
      arr.length = j;
    };
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; }
    for (const t of this.texts) t.y -= 28 * dt;
    decay(this.beams); decay(this.bolts); decay(this.rings); decay(this.parts); decay(this.texts);
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 500);
  }
}

export class Game {
  constructor(mapIndex, hooks = {}) {
    this.mapIndex = mapIndex;
    this.map = MAPS[mapIndex];
    this.hooks = {
      sfx: noop, message: noop, newThreat: noop, newVariant: noop, waveStart: noop, waveClear: noop, end: noop, leak: noop,
      bossSpawn: noop, bossPhase: noop, steal: noop, escape: noop, recover: noop, jammed: noop, rankUp: noop, reaction: noop,
      heroDown: noop, heroUp: noop,
      ...hooks,
    };
    this.paths = this.map.paths.map(buildPath);
    const { grid, blocked } = buildGrid(this.map);
    this.grid = grid;
    this.blocked = blocked;
    // Sky lanes, one per road: wave flyers leave the road's gate but cut across its corners.
    const tall = blocked.filter(([, , s]) => s > 1);
    this.airPaths = this.map.paths.map((w) => buildPath(skyLane(w, tall)));
    this.losRects = losRects(blocked);
    // Flyers cruise above the low-rise blocks: only the tall 2x2 towers block sight to them.
    this.airRects = losRects(blocked.filter(([, , s]) => s > 1));
    this.credits = this.map.credits;
    this.lives = this.map.lives;
    this.maxLives = this.map.lives;
    this.wave = 0;
    this.totalWaves = WAVES.length;
    this.endless = false;
    this.time = 0;
    this.towers = [];
    this.hero = null; // the player's war bot, once deployed
    this.traps = []; // the hero's road traps
    this.enemies = [];
    this.projectiles = [];
    this.timers = [];
    this.zones = [];
    this.spawners = [];
    this.waveAlive = new Map();
    this.fx = new FX();
    this.shake = 0;
    this.coreHit = 0;
    this.state = 'build'; // build | playing | won | lost
    this.seen = new Set();
    this.seenMods = new Set();
    this.cooldowns = { emp: 0, orbital: 0, overclock: 0 };
    this.overclockT = 0;
    this.packets = []; // data packets dropped by couriers, drifting back to the core
    this.retired = []; // sold towers, kept for the end-of-run breakdown
    this.reactShown = {};
    this.stats = { kills: 0, leaked: 0, spent: 0, earned: 0, stolen: 0, escaped: 0, recovered: 0, reactions: {}, dmgByType: {}, converted: 0, traps: 0 };
  }

  get core() { const p = this.paths[0].pts; return p[p.length - 1]; }
  // Hijacked enemies marching home don't hold up the next build phase.
  get busy() { return this.spawners.length > 0 || this.enemies.some((e) => !e.converted); }
  // Everything that can be jammed, buffed by Uplinks or knocked out by an EMP: the towers and the hero.
  get units() { return this.hero ? [...this.towers, this.hero] : this.towers; }
  get campaignDone() { return !this.endless && this.wave >= this.totalWaves; }

  waveDef(n) { return n <= WAVES.length ? WAVES[n - 1] : endlessWave(n); }

  // True when no building stands between the two points (pixel space). `air`: sight up to a flyer, which only the
  // tall blocks can hide.
  los(x0, y0, x1, y1, air = false) { return segmentBlock(air ? this.airRects : this.losRects, x0, y0, x1, y1) === Infinity; }

  // Distance a straight shot from (x0, y0) along unit (ux, uy) travels before a building stops it (max len).
  rayClear(x0, y0, ux, uy, len, air = false) {
    const t = segmentBlock(air ? this.airRects : this.losRects, x0, y0, x0 + ux * len, y0 + uy * len);
    return t === Infinity ? len : t * len;
  }

  canPlace(tx, ty, size = 1) {
    const h = this.hero;
    if (h && tileOf(h.x) >= tx && tileOf(h.x) < tx + size && tileOf(h.y) >= ty && tileOf(h.y) < ty + size) return false;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS || this.grid[y][x] !== 0) return false;
      }
    }
    return true;
  }

  towerAt(tx, ty) {
    return this.towers.find((t) => tx >= t.tx && tx < t.tx + t.size && ty >= t.ty && ty < t.ty + t.size) || null;
  }

  setFootprint(t, value) {
    for (let y = t.ty; y < t.ty + t.size; y++) for (let x = t.tx; x < t.tx + t.size; x++) this.grid[y][x] = value;
  }

  build(type, tx, ty, variant = null) {
    const def = TOWERS[type];
    if (!this.canPlace(tx, ty, def.size || 1) || this.credits < def.cost) return null;
    const t = new Tower(type, tx, ty, variant);
    t.fresh = this.state === 'build';
    this.towers.push(t);
    this.setFootprint(t, 3);
    this.credits -= def.cost;
    this.stats.spent += def.cost;
    this.fx.ring(t.x, t.y, 4, TILE * 0.8, def.color, 0.4, 2);
    this.fx.sparks(t.x, t.y, def.color, 12, 90);
    this.hooks.sfx('build', t);
    if (this.hero?.dest && !this.hero.moveTo(this, this.hero.dest.x, this.hero.dest.y)) this.hero.stop();
    return t;
  }

  // The hero goes down anywhere the war bot can stand (open ground or road). One per run.
  canDeployHero(px, py) {
    const tx = tileOf(px), ty = tileOf(py);
    return !this.hero && walkable(this, tx, ty);
  }

  deployHero(px, py) {
    if (!this.canDeployHero(px, py) || this.credits < HERO.cost) return null;
    const h = new Hero(px, py);
    this.hero = h;
    this.credits -= HERO.cost;
    this.stats.spent += HERO.cost;
    this.fx.ring(px, py, 4, TILE * 1.1, HERO.color, 0.5, 3);
    this.fx.sparks(px, py, HERO.color, 18, 110);
    this.fx.emit({ type: 'herodeploy', hero: h });
    this.hooks.sfx('herodeploy', h);
    return h;
  }

  // Switch a tower's variant (Pulse Laser: Ground / Anti-Air). Free, but the turret re-locks and has to reload.
  setVariant(t, id) {
    if (!t.def.variants || t.variant === id || !t.def.variants.some((v) => v.id === id)) return false;
    t.variant = id;
    t.refresh();
    t.relockT = RELOCK_TIME;
    t.cd = 1 / t.stats.rate;
    this.fx.emit({ type: 'variant', tower: t });
    return true;
  }

  upgrade(t, p) {
    const next = t.nextTier(p);
    if (!next || !t.canUpgrade(p) || this.credits < next.cost) return false;
    this.credits -= next.cost;
    this.stats.spent += next.cost;
    t.invested += next.cost;
    t.tiers[p]++;
    t.refresh();
    const color = t.def.paths[p].color;
    this.fx.ring(t.x, t.y, 4, TILE * t.size, color, 0.5, 3);
    this.fx.sparks(t.x, t.y, '#ffffff', 16, 120);
    this.fx.emit({ type: 'upgrade', tower: t, path: p, tier: t.tiers[p] });
    this.hooks.sfx('upgrade', t);
    return true;
  }

  sell(t) {
    if (t.isHero) return;
    const v = t.sellValue;
    if (t.dmgDealt > 0 || t.kills > 0) this.retired.push({ type: t.type, tiers: [...t.tiers], rank: t.rank, dmg: t.dmgDealt, kills: t.kills, sold: true });
    this.credits += v;
    this.setFootprint(t, 0);
    this.towers = this.towers.filter((o) => o !== t);
    this.fx.text(t.x, t.y - 10, `+${v}¢`, '#39ff14');
    this.fx.sparks(t.x, t.y, t.def.color, 14, 100);
    this.hooks.sfx('sell', t);
  }

  launchWave() {
    if (this.state === 'won' || this.state === 'lost') return false;
    if (this.campaignDone) return false;
    if (this.busy && this.wave > 0) {
      const b = earlyBonus(this.wave + 1);
      this.credits += b;
      this.stats.earned += b;
      this.hooks.message(`EARLY CALL +${b}¢`, 'bonus');
    }
    this.wave++;
    for (const t of this.towers) t.fresh = false;
    const n = this.wave;
    const groups = this.waveDef(n).map((grp) => ({ ...grp, t: -grp.delay, spawned: 0 }));
    this.spawners.push({ id: n, groups, counter: 0, airCounter: 0 });
    this.waveAlive.set(n, 0);
    this.state = 'playing';
    const boss = groups.some((grp) => ENEMIES[grp.type].boss);
    for (const grp of groups) {
      if (!this.seen.has(grp.type) && !ENEMIES[grp.type].hidden) {
        this.seen.add(grp.type);
        this.hooks.newThreat(grp.type);
      }
      for (const m of grp.mods || []) {
        if (!this.seenMods.has(m)) { this.seenMods.add(m); this.hooks.newVariant(m); }
      }
    }
    this.hooks.waveStart(n, boss);
    return true;
  }

  spawnEnemy(type, pathIdx, waveId, startDist = 0, mods = null, air = false) {
    const e = new Enemy(this, type, pathIdx, waveId, startDist, mods, air);
    this.enemies.push(e);
    this.waveAlive.set(waveId, (this.waveAlive.get(waveId) || 0) + 1);
    if (e.def.boss) this.hooks.bossSpawn(e);
    return e;
  }

  // `raw` damage (combo bursts) skips the variant resistances.
  // `shieldMul` scales what reaches an energy shield, `armorMul` what hits a hull that still has armor on it.
  damage(e, amount, { tower = null, pierce = false, shieldMul = 1, armorMul = 1, quiet = false, raw = false } = {}) {
    if (e.dead || e.converted || amount <= 0 || e.phaseT > 0) return 0;
    let dealt = 0;
    if (tower && !raw) {
      if (e.mirror && tower.type === 'laser') amount *= 0.5;
      if (e.insulated && tower.type === 'tesla') amount *= 0.5;
    }
    // Debuffs from upgrades: marked, brittle (while chilled) and aura amplification.
    amount *= 1 + (e.markT > 0 ? e.markAmp : 0) + (e.brittleT > 0 && e.slowT > 0 ? e.brittle : 0) + e.auraAmp;
    if (e.shield > 0) {
      const sd = amount * shieldMul;
      const absorbed = Math.min(e.shield, sd);
      e.shield -= absorbed;
      dealt += absorbed;
      amount -= absorbed / shieldMul;
      if (e.shield <= 0.01) {
        e.shield = 0;
        this.fx.ring(e.x, e.y, e.radius, e.radius * 2.2, '#3d8bff', 0.3, 2);
        this.hooks.sfx('shieldbreak', e);
      } else if (absorbed > 0 && !quiet) {
        // Hits soaked by a shield sound and look different from hull hits.
        this.fx.emit({ type: 'shieldhit', enemy: e });
        this.hooks.sfx('shieldhit', e);
      }
    }
    if (amount > 0) {
      const armor = e.effArmor;
      if (armor && !pierce) amount = Math.max(amount * 0.25, amount * armorMul - armor);
      dealt += Math.min(e.hp, amount);
      e.hp -= amount;
      // Boss skulls: the hull stops at each threshold and the boss triggers its phase ability.
      const ph = e.def.phases;
      if (ph && e.phase < ph.length && e.hp <= ph[e.phase] * e.maxHp) {
        dealt -= ph[e.phase] * e.maxHp - e.hp;
        e.hp = ph[e.phase] * e.maxHp;
        e.phase++;
        this.bossPhase(e);
      }
    }
    e.lastHit = this.time;
    // Hit flash, at most ~8 a second: rapid-fire towers strobe the target instead of blowing it out to white.
    if (!quiet && this.time - (e.lastFlash ?? -1) > 0.12) { e.flash = 0.05; e.lastFlash = this.time; }
    if (tower) {
      tower.dmgDealt += dealt;
      this.stats.dmgByType[tower.type] = (this.stats.dmgByType[tower.type] || 0) + dealt;
      if (dealt > 0) this.addXp(tower, (dealt / (e.maxHp + e.maxShield)) * e.def.reward);
    }
    if (e.hp <= 0) this.kill(e, tower);
    return dealt;
  }

  // ---------------------------------------------------------------- veterancy
  addXp(t, xp) {
    t.xp += xp;
    this.checkRank(t);
    const u = t.buffSrc;
    if (u && u !== t) { u.xp += xp * 0.25; this.checkRank(u); }
  }

  checkRank(t) {
    while (t.rank < VET.xp.length && t.xp >= VET.xp[t.rank] * (t.isHero ? HERO_RULES.xpScale : 1)) {
      t.rank++;
      t.refresh();
      this.fx.emit({ type: 'rankup', tower: t, rank: t.rank });
      this.fx.text(t.x, t.y - 34, `RANK ${VET.numerals[t.rank]}`, '#ffe600', 13);
      this.hooks.rankUp(t);
    }
  }

  // ---------------------------------------------------------------- status combos
  react(kind, e) {
    this.stats.reactions[kind] = (this.stats.reactions[kind] || 0) + 1;
    // Name pops up at most every 0.4s per combo, so a Tesla sweeping a frozen crowd doesn't spam the screen.
    if (this.time - (this.reactShown[kind] ?? -9) > 0.4) {
      this.reactShown[kind] = this.time;
      this.fx.text(e.x, e.y - e.radius - 16, REACTIONS[kind].name, REACTIONS[kind].color, 12);
      this.fx.emit({ type: 'reaction', kind, x: e.x, y: e.y, enemy: e });
    }
    this.hooks.reaction(kind, e);
  }

  // Fire meets cold: a burst of max-hull damage, the burn is spent and the armor cracks open.
  thermalShock(e, tower) {
    e.reactT = 1.5;
    e.burnT = 0;
    e.crackT = 3;
    this.react('thermal', e);
    this.damage(e, e.maxHp * (e.def.boss ? 0.04 : 0.12), { tower, pierce: true, raw: true });
  }

  // Lightning through a burning enemy detonates what's left of the burn, splashing its neighbours.
  overload(e, tower) {
    const burst = e.burnDps * e.burnT * 1.5;
    e.burnT = 0;
    e.reactT = 1;
    if (burst < 1) return;
    this.react('overload', e);
    const r = TILE * 1.1;
    for (const o of [...this.enemies]) {
      if (o === e || o.dead || (o.x - e.x) ** 2 + (o.y - e.y) ** 2 > r * r) continue;
      this.damage(o, burst * 0.5, { tower, pierce: true, raw: true, quiet: true });
    }
    this.damage(e, burst, { tower, pierce: true, raw: true });
  }

  // ---------------------------------------------------------------- jamming & boss phases
  jamTower(t, dur, kind) {
    if (t.jamT <= 0) this.fx.emit({ type: 'jam', tower: t, kind });
    if (dur >= t.jamT) t.jamKind = kind; // the longest outage names it (a passing jammer doesn't relabel a hijack)
    t.jamT = Math.max(t.jamT, dur);
  }

  bossPhase(e) {
    const n = e.phase;
    e.phaseT = e.type === 'overmind' ? 1.5 : 1.2;
    this.shake = Math.max(this.shake, 12);
    this.fx.emit({ type: 'bossphase', enemy: e, n });
    this.hooks.sfx('emp', e);
    if (e.type === 'titan') {
      // EMP vent: knocks out every tower nearby (firewalls don't help against a raw pulse), then surges forward.
      const r = 3.2 * TILE;
      for (const t of this.units) {
        if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= (r + TILE * t.size * 0.5) ** 2) this.jamTower(t, 3.5, 'emp');
      }
      e.surgeT = 3;
      this.fx.ring(e.x, e.y, 10, r, '#ff2bd6', 0.7, 4);
    } else if (e.type === 'overmind') {
      // Hijack: the two most valuable towers within reach go dark.
      const r = 5 * TILE;
      const near = this.towers.filter((t) => (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= r * r).sort((a, b) => b.invested - a.invested).slice(0, 2);
      for (const t of near) {
        this.jamTower(t, 5, 'hijack');
        this.fx.emit({ type: 'hijack', enemy: e, tower: t });
      }
      if (n === 1) {
        for (let i = 0; i < 4; i++) this.spawnEnemy('phantom', e.pathIdx, e.waveId, Math.max(0, e.dist - 20 - i * 16));
        for (let i = 0; i < 3; i++) this.spawnEnemy('drone', e.pathIdx, e.waveId, Math.max(0, e.dist - 10 - i * 14));
      } else if (n === 2) {
        e.shield = Math.max(e.shield, e.maxShield * 0.6);
      } else if (n === 3) {
        e.speedMul *= 1.35;
        e.spawnEvery *= 0.5;
      }
    }
    // Adaptation: each skull hardens the boss with variant buffs; by its last one it carries nearly all of them.
    const buffs = (e.def.phaseBuffs?.[n - 1] || []).filter((m) => !e.mods.includes(m));
    for (const m of buffs) e.applyMod(m, true);
    if (buffs.length) this.fx.emit({ type: 'adapt', enemy: e, mods: buffs });
    this.hooks.bossPhase(e, n, buffs);
  }

  // ---------------------------------------------------------------- data couriers
  steal(e) {
    e.carrying = true;
    e.dir = -1;
    e.dist = e.path.length - 0.01;
    this.stats.stolen++;
    const c = this.core;
    this.fx.emit({ type: 'steal', enemy: e });
    this.fx.text(c.x, c.y - 30, 'DATA STOLEN', '#3dffc5', 14);
    this.coreHit = 0.3;
    this.hooks.steal(e);
    this.hooks.sfx('leak', e);
  }

  escape(e) {
    if (e.dead) return;
    this.stats.escaped++;
    this.breach(e, e.def.courier.packet);
    this.hooks.escape(e);
  }

  // A courier killed with a packet drops it; the packet drifts back along the road to the core.
  dropPacket(e) {
    const pk = { id: nextId++, path: e.path, dist: e.dist, seg: e.seg, x: e.x, y: e.y };
    this.packets.push(pk);
    this.fx.emit({ type: 'drop', packet: pk });
  }

  updatePackets(dt) {
    if (!this.packets.length) return;
    for (const pk of this.packets) {
      pk.dist += 1.1 * TILE * dt;
      if (pk.dist >= pk.path.length) {
        pk.done = true;
        this.stats.recovered++;
        const c = this.core;
        this.fx.text(c.x, c.y - 30, 'DATA RECOVERED', '#39ff14', 13);
        this.fx.emit({ type: 'recover', packet: pk });
        this.hooks.recover(pk);
        continue;
      }
      const q = pathPoint(pk.path, pk.dist, pk.seg);
      pk.seg = q.seg; pk.x = q.x; pk.y = q.y;
      // Another courier on its way in snatches it and turns back.
      for (const e of this.enemies) {
        if (e.dead || e.converted || !e.def.courier || e.carrying || (e.x - pk.x) ** 2 + (e.y - pk.y) ** 2 > (0.6 * TILE) ** 2) continue;
        pk.done = true;
        e.carrying = true;
        e.dir = -1;
        e.updatePos();
        this.stats.stolen++;
        this.fx.emit({ type: 'grab', packet: pk, enemy: e });
        this.hooks.steal(e);
        break;
      }
    }
    this.packets = this.packets.filter((pk) => !pk.done);
  }

  kill(e, tower) {
    if (e.dead) return;
    e.dead = true;
    // Bounties: the killing tower's own (Netburn) plus Economy uplinks covering the kill.
    let reward = e.reward + (tower?.stats.bounty || 0);
    for (const u of this.towers) {
      if (u.type === 'uplink' && u.stats.killBounty && u.inRange(e, u.range)) reward += u.stats.killBounty;
    }
    this.credits += reward;
    this.stats.earned += reward;
    this.stats.kills++;
    if (tower) tower.kills++;
    const big = e.def.boss;
    this.fx.emit({ type: 'kill', enemy: e });
    this.fx.explosion(e.x, e.y, e.def.color, e.radius * (big ? 3 : 1));
    this.fx.text(e.x, e.y - e.radius - 4, `+${reward}¢`, '#ffe600', big ? 18 : 12);
    // Shatter: chilled enemies burst into shrapnel that damages their neighbours.
    if (e.shatterT > 0 && e.shatter > 0 && (this.shatterDepth || 0) < 3) {
      this.shatterDepth = (this.shatterDepth || 0) + 1;
      const r = 1.3 * TILE, dmg = e.maxHp * e.shatter;
      for (const o of [...this.enemies]) {
        if (o === e || o.dead || (o.x - e.x) ** 2 + (o.y - e.y) ** 2 > r * r) continue;
        this.damage(o, dmg, { tower: e.shatterSrc });
      }
      this.fx.emit({ type: 'shatter', x: e.x, y: e.y, r });
      this.fx.ring(e.x, e.y, 6, r, '#bfe3ff', 0.35, 3);
      this.shatterDepth--;
    }
    if (big) {
      this.shake = 16;
      for (let i = 0; i < 5; i++) {
        this.fx.explosion(e.x + (Math.random() - 0.5) * 60, e.y + (Math.random() - 0.5) * 60, i % 2 ? '#ffffff' : e.def.color, 30);
      }
    }
    this.hooks.sfx(big ? 'bossdeath' : e.radius > 16 ? 'explode' : 'pop', e);
    if (e.carrying) this.dropPacket(e);
    if (e.def.splits) {
      for (let i = 0; i < e.def.splits.count; i++) {
        this.spawnEnemy(e.def.splits.type, e.pathIdx, e.waveId, Math.max(0, e.dist - i * 10), e.mods);
      }
    }
  }

  leak(e) {
    if (e.dead) return;
    this.breach(e, coreDamage(e));
    const c = this.core;
    this.fx.explosion(c.x, c.y, '#ff3355', 30);
  }

  // An enemy got through (into the core, or out of the district with a packet): integrity damage.
  breach(e, dmg) {
    e.dead = true;
    e.leaked = true;
    this.lives = Math.max(0, this.lives - dmg);
    this.stats.leaked++;
    this.coreHit = 0.6;
    this.shake = Math.max(this.shake, e.def.boss ? 20 : 7);
    this.fx.emit({ type: 'leak', enemy: e, escape: e.dir < 0 });
    this.hooks.leak(e);
    this.hooks.sfx('leak', e);
    if (this.lives <= 0 && this.state !== 'lost') {
      this.state = 'lost';
      this.hooks.end(false);
    }
  }

  // Plasma detonation: splash falloff, optional air hits, knockback and on-hit effects via the tower.
  blast(tower, x, y, r, dmg, color, main) {
    const s = tower.stats;
    for (const e of [...this.enemies]) {
      if (e.dead || e.converted || (e.flying && !s.air)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > r + e.radius * 0.5) continue;
      let hit = dmg * (1 - 0.5 * Math.min(1, d / r));
      // Fracture: the blast shatters a frozen enemy's ice for double damage.
      if (e.frozenT > 0) { hit *= 2; e.frozenT = 0; e.stunT = 0; this.react('fracture', e); }
      tower.hit(this, e, hit);
      if (s.knockback && !e.dead) e.knockBack(s.knockback * TILE);
    }
    this.fx.explosion(x, y, color, r * (main ? 0.55 : 0.4));
    if (main) this.hooks.sfx('plasmahit', { x });
  }

  // ---------------------------------------------------------------- hero: hijack, traps, missiles
  // Hijack: the enemy leaves its wave (paid and counted as a kill now), turns around and fights for the hero.
  convert(e, hero) {
    const reward = e.reward + (hero.stats.bounty || 0);
    this.credits += reward;
    this.stats.earned += reward;
    this.stats.kills++;
    this.stats.converted++;
    hero.kills++;
    this.waveAlive.set(e.waveId, this.waveAlive.get(e.waveId) - 1);
    e.uncounted = true;
    if (e.carrying) { this.dropPacket(e); e.carrying = false; }
    const life = hero.stats.convertLife;
    e.converted = { t: life, max: life, cd: 0.3, hero };
    e.dir = -1;
    e.stunT = e.slowT = e.burnT = e.frozenT = e.markT = 0;
    e.cloaked = false;
    e.revealed = true;
    e.updatePos();
    this.fx.text(e.x, e.y - e.radius - 4, `+${reward}¢`, HERO_RULES.hackColor, 12);
    this.fx.emit({ type: 'convert', enemy: e });
  }

  // A hijacked enemy shoots the nearest hostile near it for a share of its own hull (credited to the hero).
  convertZap(e) {
    const R = HERO_RULES, hero = e.converted.hero, r = R.convertRange * TILE;
    let best = null, bd = r * r;
    for (const o of this.enemies) {
      if (o === e || o.dead || o.converted) continue;
      const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    this.damage(best, Math.max(8, e.maxHp * R.convertZap), { tower: hero, pierce: true });
    if (!best.dead && hero.stats.convertStun) best.stun(hero.stats.convertStun);
    this.fx.emit({ type: 'convertzap', from: e, to: best });
  }

  // Its time is up (or it made it home): it self-destructs among its old squad.
  detonateConvert(e) {
    const hero = e.converted.hero, r = 1.2 * TILE, dmg = e.maxHp * HERO_RULES.convertBlast;
    const emp = hero.stats.convertEmp;
    e.dead = true;
    for (const o of [...this.enemies]) {
      if (o.dead || o.converted || (o.x - e.x) ** 2 + (o.y - e.y) ** 2 > (r + o.radius) ** 2) continue;
      // Ghost Protocol: the blast is also an EMP (bosses are immune to the hack's tricks).
      if (emp && !o.def.boss) { o.stun(emp); if (o.shield > 0) o.shield *= 0.5; o.revealed = true; }
      this.damage(o, dmg, { tower: hero, pierce: true });
    }
    this.fx.explosion(e.x, e.y, HERO_RULES.hackColor, e.radius * 1.4);
    this.fx.emit({ type: 'convertend', enemy: e });
    this.hooks.sfx('explode', e);
  }

  updateTraps(dt) {
    if (!this.traps.length) return;
    for (const tr of this.traps) {
      tr.age += dt;
      if (tr.armT > 0) { tr.armT -= dt; continue; }
      const trig = 0.35 * TILE;
      if (this.enemies.some((e) => !e.dead && !e.flying && !e.converted && (e.x - tr.x) ** 2 + (e.y - tr.y) ** 2 <= (trig + e.radius) ** 2)) {
        this.detonateTrap(tr);
      }
    }
    this.traps = this.traps.filter((t) => !t.done);
  }

  // A trap going off: splash (EMP traps also stun and halve shields), snare, cluster bomblets and a kill-zone field.
  detonateTrap(tr) {
    tr.done = true;
    this.stats.traps++;
    const h = tr.hero, s = h.stats, r = s.mineR * TILE, dmg = s.mineDmg * (1 + h.buffDmg);
    this.trapBlast(h, tr.x, tr.y, r, dmg, tr.emp);
    for (let i = 0; i < s.mineCluster; i++) {
      const a = Math.random() * Math.PI * 2, d = (0.5 + Math.random() * 0.7) * TILE;
      const bx = tr.x + Math.cos(a) * d, by = tr.y + Math.sin(a) * d;
      this.timers.push({ t: 0.1 + i * 0.07, fn: () => this.trapBlast(h, bx, by, r * 0.55, dmg * 0.4, false, true) });
    }
    if (s.mineZone) {
      this.zones.push({ x: tr.x, y: tr.y, r: r * 0.9, dps: dmg * 0.15, t: s.mineZone, tower: h });
      this.fx.emit({ type: 'zone', x: tr.x, y: tr.y, r: r * 0.9, life: s.mineZone, color: HERO_RULES.trapColor });
    }
    this.fx.emit({ type: 'trapboom', trap: tr, r });
    this.hooks.sfx(tr.emp ? 'emptrap' : 'mineblast', tr);
  }

  trapBlast(h, x, y, r, dmg, emp = false, small = false) {
    const s = h.stats;
    for (const e of [...this.enemies]) {
      if (e.dead || e.flying || e.converted) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > r + e.radius * 0.5) continue;
      if (emp) { e.stun(2); if (e.shield > 0) e.shield *= 0.5; e.revealed = true; }
      h.hit(this, e, dmg * (1 - 0.4 * Math.min(1, d / r)));
      if (!e.dead && s.mineSlow) e.applySlow(s.mineSlow, 2.5);
    }
    this.fx.explosion(x, y, emp ? '#00f0ff' : HERO_RULES.trapColor, r * (small ? 0.4 : 0.6));
  }

  // Micro-missile impact: splash on the ground (and on flyers, if it was fired at one).
  missileHit(p) {
    const h = p.tower;
    for (const e of [...this.enemies]) {
      if (e.dead || e.converted || (e.flying && !p.air)) continue;
      const d = Math.hypot(e.x - p.tx, e.y - p.ty);
      if (d > p.splash + e.radius * 0.5) continue;
      h.hit(this, e, p.dmg * (1 - 0.5 * Math.min(1, d / p.splash)));
    }
    this.fx.explosion(p.tx, p.ty, p.color, p.splash * 0.45);
  }

  useAbility(key, x, y) {
    const ab = ABILITIES[key];
    if (!ab || this.cooldowns[key] > 0 || this.state === 'won' || this.state === 'lost') return false;
    this.cooldowns[key] = ab.cd;
    if (key === 'emp') {
      const r = ab.radius * TILE;
      for (const e of this.enemies) {
        if (e.converted || (e.x - x) ** 2 + (e.y - y) ** 2 > r * r) continue;
        e.stunT = Math.max(e.stunT, e.def.boss ? 1 : ab.stun);
        if (e.shield > 0) this.damage(e, e.shield, { shieldMul: 1 });
        e.revealed = true;
      }
      this.fx.ring(x, y, 10, r, ab.color, 0.6, 4);
      this.fx.ring(x, y, 4, r * 0.6, '#ffffff', 0.4, 2);
      this.fx.sparks(x, y, ab.color, 40, 260);
      this.fx.emit({ type: 'emp', x, y, r });
      this.shake = Math.max(this.shake, 8);
    } else if (key === 'orbital') {
      this.fx.strikes.push({ x, y, t: 0, delay: ab.delay, r: ab.radius * TILE, dmg: ab.dmg(this.wave), done: false });
      this.fx.emit({ type: 'orbital', x, y, r: ab.radius * TILE, delay: ab.delay });
    } else if (key === 'overclock') {
      this.overclockT = ab.duration;
      for (const t of this.towers) this.fx.ring(t.x, t.y, 4, TILE * 0.7, ab.color, 0.5, 2);
    }
    this.hooks.sfx(key);
    return true;
  }

  update(dt) {
    if (this.state === 'lost') { this.fx.update(dt); return; }
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.coreHit = Math.max(0, this.coreHit - dt);
    // Ability timers only run while a wave is live; waiting in the build phase doesn't recharge them.
    if (this.state === 'playing') {
      this.overclockT = Math.max(0, this.overclockT - dt);
      for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }

    // Spawning
    for (const s of this.spawners) {
      for (const grp of s.groups) {
        grp.t += dt;
        while (grp.spawned < grp.count && grp.t >= 0) {
          const def = ENEMIES[grp.type];
          // Flyers take the sky lanes (a boss's own escort drones stay with it on the road).
          const air = !!def.flying && this.airPaths.length > 0;
          const pathIdx = def.boss ? 0 : air ? s.airCounter++ % this.airPaths.length : s.counter++ % this.paths.length;
          this.spawnEnemy(grp.type, pathIdx, s.id, 0, grp.mods, air);
          grp.spawned++;
          grp.t -= grp.gap;
        }
      }
      s.done = s.groups.every((grp) => grp.spawned >= grp.count);
    }

    // Jamming: Signal Jammer fields knock nearby towers offline unless an Intrusion Uplink firewalls them.
    const covers = (u, t) => (u.x - t.x) ** 2 + (u.y - t.y) ** 2 <= (u.range + TILE * t.size * 0.5) ** 2;
    const units = this.units;
    for (const t of units) t.jamT = Math.max(0, t.jamT - dt);
    const jammers = this.enemies.filter((e) => e.def.jam && !e.dead && !e.converted && e.stunT <= 0);
    if (jammers.length) {
      const firewalls = this.towers.filter((u) => u.stats.firewall && u.jamT <= 0);
      for (const e of jammers) {
        const r = e.def.jam.radius * TILE;
        for (const t of units) {
          if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 > (r + TILE * t.size * 0.5) ** 2) continue;
          if (t.stats.firewall || firewalls.some((u) => covers(u, t))) { t.firewalled = 0.4; continue; }
          if (t.jamT <= 0) this.hooks.jammed(t, e);
          this.jamTower(t, 0.25, 'field');
        }
      }
    }
    for (const t of units) if (t.firewalled > 0) t.firewalled -= dt;

    // Buffs, auras & reveal (offline towers give nothing)
    const online = this.towers.filter((t) => t.jamT <= 0);
    const uplinks = online.filter((t) => t.type === 'uplink');
    for (const t of units) {
      t.buffDmg = 0; t.buffRate = 0; t.camoGrant = false; t.buffSrc = null;
      for (const u of uplinks) {
        if (u === t) continue;
        if (covers(u, t)) {
          if (u.stats.buffDmg >= t.buffDmg) t.buffSrc = u;
          t.buffDmg = Math.max(t.buffDmg, u.stats.buffDmg);
          t.buffRate = Math.max(t.buffRate, u.stats.buffRate);
          if (u.stats.grantCamo) t.camoGrant = true;
        }
      }
    }
    const revealers = online.filter((t) => t.type === 'uplink' || t.stats.reveal);
    const auras = online.filter((t) => t.stats.auraDps || t.stats.auraSlow || t.stats.auraShieldDrain || t.stats.auraArmorDown || t.stats.auraAmp || t.stats.globalSlow);
    for (const e of this.enemies) {
      e.auraSlow = 0; e.auraAmp = 0; e.auraArmorDown = 0;
      if (e.converted) continue;
      for (const t of auras) {
        const s = t.stats;
        if (s.globalSlow && !e.thermal) e.auraSlow = Math.max(e.auraSlow, s.globalSlow);
        if (!t.inRange(e, t.range)) continue;
        if (s.auraSlow) e.auraSlow = Math.max(e.auraSlow, s.auraSlow);
        if (s.auraAmp) e.auraAmp = Math.max(e.auraAmp, s.auraAmp);
        if (s.auraArmorDown) e.auraArmorDown = Math.max(e.auraArmorDown, s.auraArmorDown);
        if (s.auraShieldDrain && e.shield > 0) e.shield = Math.max(0, e.shield - e.maxShield * s.auraShieldDrain * dt);
        if (s.auraDps && !e.dead) this.damage(e, s.dmg * (1 + t.buffDmg) * s.auraDps * dt, { tower: t, quiet: true });
      }
      if (!e.cloaked) continue;
      // Permanent camo: only revealers (Uplinks, Cold Snap) and stuns (EMP, freezes) expose it.
      e.revealed = e.stunT > 0 || revealers.some((u) => u.inRange(e, u.range));
    }
    // Aura damage can kill; drop the dead before they act.
    for (const t of this.timers) t.t -= dt;
    for (const t of this.timers.filter((t) => t.t <= 0)) t.fn();
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const z of this.zones) {
      z.t -= dt;
      for (const e of this.enemies) {
        if (e.dead || e.flying || (e.x - z.x) ** 2 + (e.y - z.y) ** 2 > z.r * z.r) continue;
        this.damage(e, z.dps * dt, { tower: z.tower, quiet: true });
      }
    }
    this.zones = this.zones.filter((z) => z.t > 0);

    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    for (const t of this.towers) t.update(dt, this);
    if (this.hero) this.hero.update(dt, this);
    this.updateTraps(dt);
    this.updatePackets(dt);

    // Projectiles
    for (const p of this.projectiles) {
      p.t += dt;
      if (p.t >= p.dur && p.kind === 'missile') { p.done = true; this.missileHit(p); continue; }
      if (p.t >= p.dur) {
        p.done = true;
        this.blast(p.tower, p.tx, p.ty, p.splash, p.dmg, p.color, true);
        const s = p.tower.stats;
        for (let i = 0; i < s.cluster; i++) {
          const a = Math.random() * Math.PI * 2, d = (0.6 + Math.random() * 0.8) * TILE;
          const bx = p.tx + Math.cos(a) * d, by = p.ty + Math.sin(a) * d;
          this.timers.push({ t: 0.08 + i * 0.06, fn: () => this.blast(p.tower, bx, by, p.splash * 0.55, p.dmg * 0.4, p.color, false) });
        }
        if (s.fireZone) {
          this.zones.push({ x: p.tx, y: p.ty, r: p.splash * 0.8, dps: p.dmg * s.fireZone, t: 2, tower: p.tower });
          this.fx.emit({ type: 'zone', x: p.tx, y: p.ty, r: p.splash * 0.8, life: 2, color: p.color });
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);

    // Orbital strikes
    for (const s of this.fx.strikes) {
      s.t += dt;
      if (!s.done && s.t >= s.delay) {
        s.done = true;
        for (const e of this.enemies) {
          if (e.dead) continue;
          if ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 <= (s.r + e.radius) ** 2) this.damage(e, s.dmg, { pierce: true });
        }
        this.fx.emit({ type: 'orbitalhit', x: s.x, y: s.y, r: s.r }); // the renderer builds the whole impact from this
        this.shake = Math.max(this.shake, 14);
        this.hooks.sfx('orbitalhit');
      }
    }
    this.fx.strikes = this.fx.strikes.filter((s) => s.t < s.delay + 0.5);

    // Cleanup & wave bookkeeping
    if (this.enemies.some((e) => e.dead)) {
      for (const e of this.enemies) {
        if (e.dead && !e.uncounted) this.waveAlive.set(e.waveId, this.waveAlive.get(e.waveId) - 1);
      }
      this.enemies = this.enemies.filter((e) => !e.dead);
    }
    for (const s of this.spawners) {
      if (s.done && this.waveAlive.get(s.id) <= 0) {
        s.cleared = true;
        let b = waveBonus(s.id);
        for (const u of this.towers) {
          if (!u.stats.income) continue;
          b += u.stats.income;
          this.fx.text(u.x, u.y - 24, `+${u.stats.income}¢`, '#ffe600', 14);
        }
        this.credits += b;
        this.stats.earned += b;
        this.hooks.waveClear(s.id, b);
      }
    }
    this.spawners = this.spawners.filter((s) => !s.cleared);

    if (this.state === 'playing' && !this.busy) {
      if (this.campaignDone && this.lives > 0) {
        this.state = 'won';
        this.hooks.end(true);
      } else {
        this.state = 'build';
      }
    }

    this.fx.update(dt);
  }

  continueEndless() {
    this.endless = true;
    this.state = 'build';
  }
}

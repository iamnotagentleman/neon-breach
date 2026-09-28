// Pure simulation: no DOM, no audio. Renderer and UI read state; side effects go through `hooks`.
import {
  TILE, COLS, ROWS, TOWERS, ENEMIES, MAPS, WAVES, ABILITIES, MODS, VET, REACTIONS,
  hpMultiplier, waveBonus, earlyBonus, SELL_RATIO, endlessWave, computeStats, canUpgradePath,
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

// Placement heat map: for every tile, how many tiles of road a `type` tower anchored there would cover (only road it
// can see, unless it fires over buildings), or -1 where it can't be built. Uplinks score the towers they'd buff.
export function coverageMap(game, type) {
  const def = TOWERS[type], size = def.size || 1;
  const r = def.base.range * TILE;
  const walls = type !== 'plasma' && type !== 'uplink';
  const STEP = 8;
  if (!game.roadSamples) {
    game.roadSamples = [];
    for (const p of game.paths) {
      for (let d = 0; d < p.length; d += STEP) {
        const q = pathPoint(p, d);
        if (q.x >= 0 && q.y >= 0 && q.x <= COLS * TILE && q.y <= ROWS * TILE) game.roadSamples.push(q);
      }
    }
  }
  const out = new Float32Array(COLS * ROWS).fill(-1);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (!game.canPlace(tx, ty, size)) continue;
      const x = (tx + size / 2) * TILE, y = (ty + size / 2) * TILE;
      let v = 0;
      if (type === 'uplink') {
        for (const t of game.towers) {
          if (t.type !== 'uplink' && (t.x - x) ** 2 + (t.y - y) ** 2 <= (r + TILE * t.size * 0.5) ** 2) v += 1 + t.level;
        }
      } else {
        for (const q of game.roadSamples) {
          if ((q.x - x) ** 2 + (q.y - y) ** 2 <= r * r && (!walls || game.los(x, y, q.x, q.y))) v += STEP / TILE;
        }
      }
      out[ty * COLS + tx] = v;
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
  constructor(game, type, pathIdx, waveId, startDist = 0, mods = null) {
    const def = ENEMIES[type];
    const mul = hpMultiplier(waveId) * game.map.diff;
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.waveId = waveId;
    // Variants (config MODS): resistances and endless mutators. Bosses never carry them.
    this.mods = def.boss || !mods ? [] : mods.filter((m) => MODS[m]);
    const has = (m) => this.mods.includes(m);
    this.maxHp = def.hp * mul * (has('hardened') ? 1.5 : 1);
    this.hp = this.maxHp;
    this.maxShield = (def.shield || 0) * mul;
    this.shieldLives = def.shieldLives || 0;
    if (has('warded') && !this.maxShield) { this.maxShield = this.maxHp * 0.5; this.shieldLives = 2; }
    this.shield = this.maxShield;
    this.armor = (def.armor || 0) + (has('hardened') ? 3 : 0);
    this.speedMul = has('amped') ? 1.3 : 1;
    this.regen = has('repair') ? 0.04 : 0;
    this.mirror = has('mirror');
    this.insulated = has('insulated');
    this.thermal = has('thermal');
    this.cloaked = !!def.cloaked || has('ghosted');
    this.radius = def.radius * TILE;
    this.flying = !!def.flying;
    this.reward = Math.round(def.reward * 1.3 * (1 + 0.04 * (waveId - 1)) * (1 + 0.2 * this.mods.length));
    this.healRate = def.heal ? def.heal.rate * mul : 0;
    this.pathIdx = pathIdx;
    this.path = game.paths[pathIdx];
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
    this.updatePos();
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
    this.dist += this.dir * this.speed * (1 - Math.min(0.85, slow)) * TILE * dt;
    this.updatePos();

    if (this.maxShield > 0 && game.time - this.lastHit > 2 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.12 * dt);
    }
    if (this.healRate) {
      const r = this.def.heal.radius * TILE;
      for (const o of game.enemies) {
        if (o.dead || o.hp >= o.maxHp) continue;
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

export class Tower {
  constructor(type, tx, ty) {
    this.id = nextId++;
    this.type = type;
    this.def = TOWERS[type];
    this.tx = tx;
    this.ty = ty;
    this.size = this.def.size || 1;
    this.x = (tx + this.size / 2) * TILE;
    this.y = (ty + this.size / 2) * TILE;
    this.tiers = [0, 0, 0];
    this.cd = 0.2;
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
    this.refresh();
  }

  refresh() { this.stats = computeStats(this.def, this.tiers, this.rank); }
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

  // Line of sight to an enemy, cached per 8px cell (towers and buildings never move).
  sees(game, e) {
    if (this.ignoresWalls) return true;
    const key = (e.x >> 3) * 1024 + (e.y >> 3);
    this.sight ||= new Map();
    let v = this.sight.get(key);
    if (v === undefined) { v = game.los(this.x, this.y, e.x, e.y); this.sight.set(key, v); }
    return v;
  }

  // How far a straight shot travels before hitting a building.
  reach(game, ux, uy, len) {
    return this.ignoresWalls ? len : game.rayClear(this.x, this.y, ux, uy, len);
  }

  canHit(e) {
    if (e.dead) return false;
    if (!e.revealed && !this.stats.camo && !this.camoGrant) return false;
    return e.flying ? (this.def.air || this.stats.air) : this.def.ground;
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
    game.damage(e, amount, { tower: this, ...opts });
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

  // Enemies within `width` of the segment from (x0,y0) in direction (ux,uy), sorted by distance along it.
  lineHits(game, x0, y0, ux, uy, len, width) {
    const out = [];
    for (const e of game.enemies) {
      if (e.dead) continue;
      const px = e.x - x0, py = e.y - y0;
      const along = px * ux + py * uy;
      if (along < 0 || along > len) continue;
      if (Math.abs(px * uy - py * ux) < e.radius + width) out.push([along, e]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  }

  update(dt, game) {
    this.built = Math.min(1, this.built + dt * 3);
    this.fireFlash = Math.max(0, this.fireFlash - dt);
    if (this.jamT > 0) return; // offline: no fire, no pulses, no fields
    const s = this.stats;
    if (this.type === 'uplink') { this.angle += dt * 1.4; return; }
    const rateMul = (1 + this.buffRate) * (game.overclockT > 0 ? ABILITIES.overclock.mult : 1);
    this.cd -= dt * rateMul;
    const dmg = (s.dmg || 0) * (1 + this.buffDmg);

    if (this.type === 'cryo') { this.pulse(game, dmg); return; }

    const targets = this.acquire(game, s.targets);
    if (!targets.length) { this.cd = Math.max(this.cd, 0); return; }
    const target = targets[0];
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.cd > 0) return;
    this.cd += 1 / s.rate;
    this.fireFlash = 0.12;
    this.shots++;
    const mx = this.x + Math.cos(this.angle) * TILE * 0.38 * this.size;
    const my = this.y + Math.sin(this.angle) * TILE * 0.38 * this.size;

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

  fireLaser(game, target, dmg, mx, my) {
    const s = this.stats;
    if (s.pierce > 1) {
      const a = Math.atan2(target.y - this.y, target.x - this.x);
      const ux = Math.cos(a), uy = Math.sin(a);
      const hits = this.lineHits(game, this.x, this.y, ux, uy, this.reach(game, ux, uy, this.range), 6).filter((e) => this.canHit(e)).slice(0, s.pierce);
      for (const e of hits) this.hit(game, e, dmg);
      const end = hits[hits.length - 1] || target;
      game.fx.beam(mx, my, end.x, end.y, this.def.color, 3 + this.level, 0.1, { tower: this, target: end, pierce: true });
    } else {
      this.hit(game, target, dmg);
      game.fx.beam(mx, my, target.x, target.y, this.def.color, 2 + this.level * 0.7, 0.08, { tower: this, target });
    }
    game.fx.sparks(target.x, target.y, this.def.color, 3, 80);
  }

  launchShell(game, target, dmg, mx, my) {
    const lead = Math.hypot(target.x - this.x, target.y - this.y) / (7 * TILE);
    const sp = target.speed * TILE * (target.stunT > 0 ? 0 : 1);
    game.projectiles.push({
      kind: 'plasma', x0: mx, y0: my, id: nextId++, t: 0,
      tx: target.x + Math.cos(target.angle) * sp * lead,
      ty: target.y + Math.sin(target.angle) * sp * lead,
      dur: Math.max(0.25, lead), dmg, splash: this.stats.splash * TILE, tower: this, color: this.def.color,
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
      if (!e.dead) this.hit(game, e, d, { shieldMul: s.shieldMul });
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
        if (d2 < bd && game.los(cur.x, cur.y, e.x, e.y)) { bd = d2; next = e; }
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

  fireRail(game, dmg, mx, my) {
    const s = this.stats;
    const len = Math.min(this.range, 30 * TILE) + TILE;
    const n = s.slugs;
    for (let i = 0; i < n; i++) {
      const a = this.angle + (i - (n - 1) / 2) * 0.1;
      const ux = Math.cos(a), uy = Math.sin(a);
      const reach = this.reach(game, ux, uy, len);
      // The slug loses power with every enemy it passes through (not the Annihilator's).
      let k = 1;
      for (const e of this.lineHits(game, this.x, this.y, ux, uy, reach, 6 * s.beamWidth)) {
        // Exposed: armor-stripped targets take a critical slug.
        const crit = e.stripped && !e.dead;
        if (crit) game.react('exposed', e);
        this.hit(game, e, dmg * k * (crit ? 1.5 : 1), { pierce: true });
        k = Math.max(0.5, k - s.slugFalloff);
      }
      const ex = this.x + ux * reach, ey = this.y + uy * reach;
      if (reach < len) game.fx.sparks(ex, ey, this.def.color, 10, 140); // slug slams into a building
      game.fx.beam(mx, my, ex, ey, this.def.color, (5 + this.level) * s.beamWidth, 0.28, { tower: this, rail: true, width: s.beamWidth });
    }
    game.fx.sparks(mx, my, '#ffffff', 8, 160);
    game.shake = Math.max(game.shake, 3 * s.beamWidth);
  }

  pulse(game, dmg) {
    const s = this.stats;
    this.angle += 0.013;
    if (this.cd > 0) return;
    const r = this.range;
    const inside = game.enemies.filter((e) => !e.dead && this.inRange(e, r) && this.sees(game, e));
    if (!inside.length) { this.cd = Math.max(this.cd, 0); return; }
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
      ...hooks,
    };
    this.paths = this.map.paths.map(buildPath);
    const { grid, blocked } = buildGrid(this.map);
    this.grid = grid;
    this.blocked = blocked;
    this.losRects = losRects(blocked);
    this.credits = this.map.credits;
    this.lives = this.map.lives;
    this.maxLives = this.map.lives;
    this.wave = 0;
    this.totalWaves = WAVES.length;
    this.endless = false;
    this.time = 0;
    this.towers = [];
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
    this.stats = { kills: 0, leaked: 0, spent: 0, earned: 0, stolen: 0, escaped: 0, recovered: 0, reactions: {}, dmgByType: {} };
  }

  get core() { const p = this.paths[0].pts; return p[p.length - 1]; }
  get busy() { return this.spawners.length > 0 || this.enemies.length > 0; }
  get campaignDone() { return !this.endless && this.wave >= this.totalWaves; }

  waveDef(n) { return n <= WAVES.length ? WAVES[n - 1] : endlessWave(n); }

  // True when no building stands between the two points (pixel space).
  los(x0, y0, x1, y1) { return segmentBlock(this.losRects, x0, y0, x1, y1) === Infinity; }

  // Distance a straight shot from (x0, y0) along unit (ux, uy) travels before a building stops it (max len).
  rayClear(x0, y0, ux, uy, len) {
    const t = segmentBlock(this.losRects, x0, y0, x0 + ux * len, y0 + uy * len);
    return t === Infinity ? len : t * len;
  }

  canPlace(tx, ty, size = 1) {
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

  build(type, tx, ty) {
    const def = TOWERS[type];
    if (!this.canPlace(tx, ty, def.size || 1) || this.credits < def.cost) return null;
    const t = new Tower(type, tx, ty);
    t.fresh = this.state === 'build';
    this.towers.push(t);
    this.setFootprint(t, 3);
    this.credits -= def.cost;
    this.stats.spent += def.cost;
    this.fx.ring(t.x, t.y, 4, TILE * 0.8, def.color, 0.4, 2);
    this.fx.sparks(t.x, t.y, def.color, 12, 90);
    this.hooks.sfx('build', t);
    return t;
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
    this.spawners.push({ id: n, groups, counter: 0 });
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

  spawnEnemy(type, pathIdx, waveId, startDist = 0, mods = null) {
    const e = new Enemy(this, type, pathIdx, waveId, startDist, mods);
    this.enemies.push(e);
    this.waveAlive.set(waveId, (this.waveAlive.get(waveId) || 0) + 1);
    if (e.def.boss) this.hooks.bossSpawn(e);
    return e;
  }

  // `raw` damage (combo bursts) skips the variant resistances.
  damage(e, amount, { tower = null, pierce = false, shieldMul = 1, quiet = false, raw = false } = {}) {
    if (e.dead || amount <= 0 || e.phaseT > 0) return 0;
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
      if (armor && !pierce) amount = Math.max(amount * 0.25, amount - armor);
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
    while (t.rank < VET.xp.length && t.xp >= VET.xp[t.rank]) {
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
      for (const t of this.towers) {
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
    this.hooks.bossPhase(e, n);
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
        if (e.dead || !e.def.courier || e.carrying || (e.x - pk.x) ** 2 + (e.y - pk.y) ** 2 > (0.6 * TILE) ** 2) continue;
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
      if (e.dead || (e.flying && !s.air)) continue;
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

  useAbility(key, x, y) {
    const ab = ABILITIES[key];
    if (!ab || this.cooldowns[key] > 0 || this.state === 'won' || this.state === 'lost') return false;
    this.cooldowns[key] = ab.cd;
    if (key === 'emp') {
      const r = ab.radius * TILE;
      for (const e of this.enemies) {
        if ((e.x - x) ** 2 + (e.y - y) ** 2 > r * r) continue;
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
          const boss = ENEMIES[grp.type].boss;
          const pathIdx = boss ? 0 : s.counter++ % this.paths.length;
          this.spawnEnemy(grp.type, pathIdx, s.id, 0, grp.mods);
          grp.spawned++;
          grp.t -= grp.gap;
        }
      }
      s.done = s.groups.every((grp) => grp.spawned >= grp.count);
    }

    // Jamming: Signal Jammer fields knock nearby towers offline unless an Intrusion Uplink firewalls them.
    const covers = (u, t) => (u.x - t.x) ** 2 + (u.y - t.y) ** 2 <= (u.range + TILE * t.size * 0.5) ** 2;
    for (const t of this.towers) t.jamT = Math.max(0, t.jamT - dt);
    const jammers = this.enemies.filter((e) => e.def.jam && !e.dead && e.stunT <= 0);
    if (jammers.length) {
      const firewalls = this.towers.filter((u) => u.stats.firewall && u.jamT <= 0);
      for (const e of jammers) {
        const r = e.def.jam.radius * TILE;
        for (const t of this.towers) {
          if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 > (r + TILE * t.size * 0.5) ** 2) continue;
          if (t.stats.firewall || firewalls.some((u) => covers(u, t))) { t.firewalled = 0.4; continue; }
          if (t.jamT <= 0) this.hooks.jammed(t, e);
          this.jamTower(t, 0.25, 'field');
        }
      }
    }
    for (const t of this.towers) if (t.firewalled > 0) t.firewalled -= dt;

    // Buffs, auras & reveal (offline towers give nothing)
    const online = this.towers.filter((t) => t.jamT <= 0);
    const uplinks = online.filter((t) => t.type === 'uplink');
    for (const t of this.towers) {
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
    this.updatePackets(dt);

    // Projectiles
    for (const p of this.projectiles) {
      p.t += dt;
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
        this.fx.emit({ type: 'orbitalhit', x: s.x, y: s.y, r: s.r });
        this.fx.explosion(s.x, s.y, '#ff2bd6', s.r);
        this.fx.ring(s.x, s.y, 10, s.r * 1.6, '#ffffff', 0.5, 5);
        this.shake = Math.max(this.shake, 14);
        this.hooks.sfx('orbitalhit');
      }
    }
    this.fx.strikes = this.fx.strikes.filter((s) => s.t < s.delay + 0.5);

    // Cleanup & wave bookkeeping
    if (this.enemies.some((e) => e.dead)) {
      for (const e of this.enemies) {
        if (e.dead) this.waveAlive.set(e.waveId, this.waveAlive.get(e.waveId) - 1);
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

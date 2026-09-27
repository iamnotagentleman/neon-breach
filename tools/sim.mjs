// Headless balance check: a scripted "reasonable player" plays every map.
// Usage: node tools/sim.mjs [runs=3] [skill=1]   (skill < 1 = sloppier player that spends less)
import { Game } from '../src/game.js';
import { MAPS, TOWERS, TILE, COLS, ROWS, ABILITIES } from '../src/config.js';

const runs = Number(process.argv[2] || 3);
const skill = Number(process.argv[3] || 1);
const CASUAL = !!process.env.CASUAL;
const NOABIL = !!process.env.NOABIL;

// Main path to tier 5, secondary to tier 2 (a typical BTD-style build).
const PREF = { laser: [0, 2], plasma: [0, 1], tesla: [0, 1], cryo: [0, 2], rail: [0, 1], uplink: [0, 2] };
function nextUpgrade(t) {
  const [main, sec] = PREF[t.type];
  if (t.tiers[main] < 5 && t.canUpgrade(main)) return main;
  if (t.tiers[sec] < 2 && t.canUpgrade(sec)) return sec;
  return -1;
}
const upCost = (t) => { const p = nextUpgrade(t); return p < 0 ? Infinity : t.nextTier(p).cost; };

const PLAN = ['laser', 'laser', 'plasma', 'cryo', 'up:laser', 'tesla', 'uplink', 'up:plasma', 'rail', 'up:laser',
  'up:laser', 'laser', 'up:tesla', 'up:cryo', 'rail', 'up:rail', 'up:uplink', 'up:plasma', 'plasma', 'up:rail',
  'up:laser', 'up:tesla', 'uplink', 'tesla', 'up:rail'];
const CYCLE = ['laser', 'rail', 'tesla', 'plasma', 'uplink', 'cryo'];

function samples(game) {
  const pts = [];
  for (const p of game.paths) {
    for (let d = 0; d < p.length; d += 8) {
      let i = 0;
      while (i < p.pts.length - 2 && d > p.cum[i + 1]) i++;
      const a = p.pts[i], b = p.pts[i + 1], t = (d - p.cum[i]) / (p.cum[i + 1] - p.cum[i]);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x >= 0 && y >= 0 && x <= COLS * TILE && y <= ROWS * TILE) pts.push({ x, y, w: 0.5 + d / p.length });
    }
  }
  return pts;
}

function bestTile(game, type, pts) {
  const r = TOWERS[type].base.range * TILE;
  const size = TOWERS[type].size || 1;
  let best = null, bs = -1;
  const cands = [];
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (!game.canPlace(tx, ty, size)) continue;
    const x = (tx + size / 2) * TILE, y = (ty + size / 2) * TILE;
    let s = 0;
    if (type === 'uplink') {
      for (const t of game.towers) if (t.type !== 'uplink' && (t.x - x) ** 2 + (t.y - y) ** 2 <= (r + 1) ** 2) s += 1 + t.level;
    } else {
      // Only road the tower can actually see counts (mortars lob over buildings).
      const walls = type !== 'plasma';
      for (const p of pts) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r && (!walls || game.los(x, y, p.x, p.y))) s += p.w;
    }
    if (CASUAL && s > 0) cands.push({ s, tile: [tx, ty] });
    if (s > bs) { bs = s; best = [tx, ty]; }
  }
  if (CASUAL && cands.length) {
    // Casual player: any reasonable spot from the top 50% by coverage.
    cands.sort((a, b) => b.s - a.s);
    return cands[Math.floor(Math.random() * Math.ceil(cands.length * (Number(process.env.TOP) || 0.5)))].tile;
  }
  return best;
}

function spend(game, st, pts) {
  for (let guard = 0; guard < 40; guard++) {
    let step = PLAN[st.i];
    if (step == null) {
      const up = game.towers.filter((t) => upCost(t) < Infinity).sort((a, b) => upCost(a) - upCost(b))[0];
      step = up && game.towers.length >= 14 ? `up:${up.type}` : CYCLE[st.c % CYCLE.length];
    }
    if (game.credits * skill < 0) return;
    let ok = false;
    if (step.startsWith('up:')) {
      const type = step.slice(3);
      const t = game.towers.filter((o) => o.type === type && upCost(o) < Infinity).sort((a, b) => upCost(a) - upCost(b))[0];
      if (!t) ok = true; // nothing to upgrade, skip step
      else if (game.credits * skill >= upCost(t)) ok = game.upgrade(t, nextUpgrade(t));
      else return;
    } else {
      if (game.credits * skill < TOWERS[step].cost) return;
      const tile = bestTile(game, step, pts);
      ok = tile ? !!game.build(step, tile[0], tile[1]) : true;
    }
    if (!ok) return;
    if (PLAN[st.i] != null) st.i++; else st.c++;
  }
}

function useAbilities(game) {
  if (NOABIL) return;
  const threat = game.enemies.filter((e) => e.remaining < e.path.length * 0.35).sort((a, b) => b.hp - a.hp)[0];
  if (threat && game.cooldowns.orbital === 0) game.useAbility('orbital', threat.x, threat.y);
  if (threat && game.cooldowns.emp === 0 && (threat.def.boss || game.enemies.length > 12)) game.useAbility('emp', threat.x, threat.y);
  if (game.cooldowns.overclock === 0 && (game.enemies.length > 18 || game.enemies.some((e) => e.def.boss))) game.useAbility('overclock');
}

function play(mapIndex) {
  const log = [];
  const game = new Game(mapIndex, {});
  if (process.env.DIFF) game.map = { ...game.map, diff: Number(process.env.DIFF) };
  const pts = samples(game);
  const st = { i: 0, c: 0 };
  const dt = 1 / 30;
  let t = 0;
  while (game.state !== 'won' && game.state !== 'lost' && t < 60 * 60) {
    if (game.state === 'build') {
      spend(game, st, pts);
      log.push({ wave: game.wave + 1, lives: game.lives, credits: Math.floor(game.credits), towers: game.towers.length });
      game.launchWave();
    }
    game.update(dt);
    useAbilities(game);
    t += dt;
  }
  return { map: MAPS[mapIndex].name, result: game.state, wave: game.wave, lives: game.lives, towers: game.towers.length, credits: Math.floor(game.credits), time: Math.round(t), log };
}

const only = process.env.MAP != null ? [Number(process.env.MAP)] : MAPS.map((_, i) => i);
for (const m of only) {
  const results = [];
  for (let r = 0; r < runs; r++) results.push(play(m));
  const s = results.map((r) => `${r.result === 'won' ? 'WIN ' : 'LOSS'} w${r.wave} lives=${r.lives} towers=${r.towers} ¢=${r.credits} ${r.time}s`).join(' | ');
  console.log(`${MAPS[m].name.padEnd(12)} ${s}`);
  if (process.env.VERBOSE) console.log(results[0].log.map((l) => `w${l.wave}:L${l.lives}/$${l.credits}/T${l.towers}`).join(' '));
}

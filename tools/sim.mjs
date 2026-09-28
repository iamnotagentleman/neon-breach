// Headless balance check: a scripted "reasonable player" plays every map.
// Usage: node tools/sim.mjs [runs=3] [skill=1]   (skill < 1 = sloppier player that spends less)
// STATS=1 prints damage share by tower type, the final build, couriers, tower ranks and combo counts per run;
// VERBOSE=1 a per-wave log.
// STRAT picks the build: mixed (default, every tower) or a focused one from STRATS below (e.g. STRAT=laser).
import { Game, AIR_HEAT_WEIGHT } from '../src/game.js';
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

// Steps: 'type' builds one, 'up:type' buys the cheapest next upgrade among those towers, 'max:type' pushes the most
// upgraded one on towards its capstone. After the plan, the player cycles `cycle` (upgrading once it has 14 towers).
const STRATS = {
  mixed: {
    plan: ['laser', 'laser', 'plasma', 'cryo', 'up:laser', 'tesla', 'uplink', 'up:plasma', 'rail', 'up:laser',
      'up:laser', 'laser', 'up:tesla', 'up:cryo', 'rail', 'up:rail', 'up:uplink', 'up:plasma', 'plasma', 'up:rail',
      'up:laser', 'up:tesla', 'uplink', 'tesla', 'up:rail'],
    cycle: ['laser', 'rail', 'tesla', 'plasma', 'uplink', 'cryo'],
  },
  // Pulse Lasers rushed to Photon Storm, an Uplink beside them, a Railgun: no Tesla, Cryo or Mortar. Played by
  // priority like a person would: rules in order, each taken if affordable ('!' = save for it if not). `cluster`:
  // once there's an Uplink, damage towers go inside its buff field.
  laser: {
    cluster: true,
    policy: (g, n) => [
      n.laser < 2 && '!laser',
      g.wave >= 4 && !n.uplink && '!uplink',
      g.wave >= 8 && !n.rail && '!rail',
      'max:laser',
      n.laser < 2 + Math.floor(g.wave / 5) && 'laser',
      'up:uplink',
      'max:rail',
    ],
  },
};
const STRAT = STRATS[process.env.STRAT || 'mixed'];
const { plan: PLAN = [], cycle: CYCLE = [] } = STRAT;

function samples(paths) {
  const pts = [];
  for (const p of paths) {
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

// `air`: sky lane samples, scored (at the heat map's weight) for towers that can hit flyers.
function bestTile(game, type, pts, air, anywhere = false) {
  const r = TOWERS[type].base.range * TILE;
  const size = TOWERS[type].size || 1;
  let best = null, bs = -1;
  const cands = [];
  const hub = STRAT.cluster && !anywhere && type !== 'uplink' ? game.towers.find((t) => t.type === 'uplink') : null;
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (!game.canPlace(tx, ty, size)) continue;
    const x = (tx + size / 2) * TILE, y = (ty + size / 2) * TILE;
    if (hub && (hub.x - x) ** 2 + (hub.y - y) ** 2 > (hub.range + TILE * size * 0.5) ** 2) continue;
    let s = 0;
    if (type === 'uplink') {
      for (const t of game.towers) if (t.type !== 'uplink' && (t.x - x) ** 2 + (t.y - y) ** 2 <= (r + 1) ** 2) s += 1 + t.level;
    } else {
      // Only road the tower can actually see counts (mortars lob over buildings).
      const walls = type !== 'plasma';
      for (const p of pts) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r && (!walls || game.los(x, y, p.x, p.y))) s += p.w;
      if (TOWERS[type].air) {
        for (const p of air) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r && (!walls || game.los(x, y, p.x, p.y, true))) s += p.w * AIR_HEAT_WEIGHT;
      }
    }
    if (CASUAL && s > 0) cands.push({ s, tile: [tx, ty] });
    if (s > bs) { bs = s; best = [tx, ty]; }
  }
  if (hub && !best) return bestTile(game, type, pts, air, true);
  if (CASUAL && cands.length) {
    // Casual player: any reasonable spot from the top 50% by coverage.
    cands.sort((a, b) => b.s - a.s);
    return cands[Math.floor(Math.random() * Math.ceil(cands.length * (Number(process.env.TOP) || 0.5)))].tile;
  }
  return best;
}

function spend(game, st, pts) {
  if (STRAT.policy) return spendPolicy(game, pts);
  for (let guard = 0; guard < 40; guard++) {
    let step = PLAN[st.i];
    if (step == null) {
      const up = game.towers.filter((t) => upCost(t) < Infinity).sort((a, b) => upCost(a) - upCost(b))[0];
      step = up && game.towers.length >= 14 ? `up:${up.type}` : CYCLE[st.c % CYCLE.length];
    }
    if (game.credits * skill < 0) return;
    let ok = false;
    const [verb, arg] = step.includes(':') ? step.split(':') : [null, step];
    if (verb) {
      const type = arg;
      const pool = game.towers.filter((o) => o.type === type && upCost(o) < Infinity);
      const t = verb === 'max' ? pool.sort((a, b) => b.invested - a.invested)[0] : pool.sort((a, b) => upCost(a) - upCost(b))[0];
      if (!t) ok = true; // nothing to upgrade, skip step
      else if (game.credits * skill >= upCost(t)) ok = game.upgrade(t, nextUpgrade(t));
      else return;
    } else {
      if (game.credits * skill < TOWERS[step].cost) return;
      const tile = bestTile(game, step, pts.road, pts.air);
      ok = tile ? !!game.build(step, tile[0], tile[1]) : true;
    }
    if (!ok) return;
    if (PLAN[st.i] != null) st.i++; else st.c++;
  }
}

// One step (build 'type', 'up:type' or 'max:type'); false when it can't be afforded or done.
function doStep(game, step, pts) {
  const [verb, type] = step.includes(':') ? step.split(':') : [null, step];
  if (!verb) {
    if (game.credits < TOWERS[type].cost) return false;
    const tile = bestTile(game, type, pts.road, pts.air);
    return !!tile && !!game.build(type, tile[0], tile[1]);
  }
  const pool = game.towers.filter((o) => o.type === type && upCost(o) < Infinity);
  const t = verb === 'max' ? pool.sort((a, b) => b.invested - a.invested)[0] : pool.sort((a, b) => upCost(a) - upCost(b))[0];
  return !!t && game.credits >= upCost(t) && game.upgrade(t, nextUpgrade(t));
}

function spendPolicy(game, pts) {
  for (let guard = 0; guard < 60; guard++) {
    const n = {};
    for (const t of game.towers) n[t.type] = (n[t.type] || 0) + 1;
    for (const k of Object.keys(TOWERS)) n[k] ||= 0;
    let acted = false;
    for (const rule of STRAT.policy(game, n)) {
      if (!rule) continue;
      const must = rule.startsWith('!');
      if (doStep(game, must ? rule.slice(1) : rule, pts)) { acted = true; break; }
      if (must) return; // save up for it
    }
    if (!acted) return;
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
  const pts = { road: samples(game.paths), air: samples(game.airPaths || []) };
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
  const ranks = game.towers.map((tw) => tw.rank).sort().join('');
  const gs = game.stats;
  const tot = Object.values(gs.dmgByType).reduce((x, y) => x + y, 0) || 1;
  const share = Object.entries(gs.dmgByType).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join(' ');
  const build = game.towers.map((tw) => `${tw.type}:${tw.tiers.join('')}`).join(' ');
  const extra = `damage ${share} | ${build} | stolen=${gs.stolen} escaped=${gs.escaped} recovered=${gs.recovered} ranks=${ranks} combos=${JSON.stringify(gs.reactions)}`;
  return { map: MAPS[mapIndex].name, result: game.state, wave: game.wave, lives: game.lives, towers: game.towers.length, credits: Math.floor(game.credits), time: Math.round(t), log, extra };
}

const only = process.env.MAP != null ? [Number(process.env.MAP)] : MAPS.map((_, i) => i);
for (const m of only) {
  const results = [];
  for (let r = 0; r < runs; r++) results.push(play(m));
  const s = results.map((r) => `${r.result === 'won' ? 'WIN ' : 'LOSS'} w${r.wave} lives=${r.lives} towers=${r.towers} ¢=${r.credits} ${r.time}s`).join(' | ');
  console.log(`${MAPS[m].name.padEnd(12)} ${s}`);
  if (process.env.VERBOSE) console.log(results[0].log.map((l) => `w${l.wave}:L${l.lives}/$${l.credits}/T${l.towers}`).join(' '));
  if (process.env.STATS) for (const r of results) console.log(`   ${r.extra}`);
}

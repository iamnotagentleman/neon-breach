// Economy lab: what each upgrade buys per credit, and how credits flow through a run.
//   node tools/econ.mjs              upgrade value table for every tower
//   node tools/econ.mjs rail         one tower
//   node tools/econ.mjs flow [runs]  credits earned / spent / banked per wave in simulated runs (CASUAL=1 TOP=0.25 works)
//   node tools/econ.mjs raw [type]   raw damage per credit of every tier-4 / tier-5 build against enemies that can't die
//
// A tier is judged in the part of the campaign where it's usually bought (tier 1 around wave 4 ... tier 5 around
// wave 18): one tower on Sector 7, at the spot that sees the most road, faces a stream of real (killable) enemies
// drawn from those waves. Value = hull + shield it strips. Cryo counts its own damage plus what it adds to two
// nearby Pulse Lasers; the Uplink's buff paths what they add to a small battery of towers; Economy by payback time.
// EFF = the upgrade's value per credit ÷ a fresh base tower's value per credit on the same stream: ~1 means the
// upgrade is about as good as buying another copy of the tower, well above 1 means it's cheap for what it does.
import { Game, coverageMap } from '../src/game.js';
import { TOWERS, TOWER_ORDER, WAVES, ENEMIES, TILE, COLS } from '../src/config.js';

const DT = 1 / 30;
const STREAM = 40; // seconds of spawning
const RUN = 70; // seconds simulated
const GAP = 0.6; // seconds between spawns
const TIER_WAVE = [4, 4, 7, 10, 14, 18]; // stream difficulty used to judge base / tier 1..5

// Stream for wave w: enemy types weighted by count over the nearby campaign waves (no bosses, jammers or couriers).
function streamTypes(w) {
  const counts = {};
  for (let n = Math.max(1, w - 2); n <= Math.min(WAVES.length, w + 2); n++) {
    for (const g of WAVES[n - 1]) {
      const d = ENEMIES[g.type];
      if (d.boss || d.hidden || d.jam || d.courier) continue;
      counts[g.type] = (counts[g.type] || 0) + g.count;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const mix = Object.entries(counts).map(([t, c]) => [t, c / total]);
  let s = 12345 + w;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let t = 0; t < STREAM; t += GAP) {
    let r = rnd(), pick = mix[0][0];
    for (const [type, p] of mix) { if ((r -= p) <= 0) { pick = type; break; } }
    out.push(pick);
  }
  return out;
}
const STREAMS = new Map();
const stream = (w) => { if (!STREAMS.has(w)) STREAMS.set(w, streamTypes(w)); return STREAMS.get(w); };

function bestSpots(game, type, n = 1, near = null) {
  const heat = coverageMap(game, type);
  const size = TOWERS[type].size || 1;
  const cands = [];
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] < 0) continue;
    const tx = i % COLS, ty = Math.floor(i / COLS);
    const x = (tx + size / 2) * TILE, y = (ty + size / 2) * TILE;
    if (near && (x - near.x) ** 2 + (y - near.y) ** 2 > (near.r * TILE) ** 2) continue;
    cands.push({ tx, ty, v: heat[i] });
  }
  return cands.sort((a, b) => b.v - a.v).slice(0, n);
}

// One lab run against wave `w`'s stream: `setup(game)` places towers and returns those whose damage counts.
const memo = new Map();
function run(key, w, setup) {
  const k = `${key}@${w}`;
  if (memo.has(k)) return memo.get(k);
  const game = new Game(0, {});
  game.credits = 1e9;
  game.lives = game.maxLives = 1e9; // leaks don't end the lab run
  const counted = setup(game);
  game.state = 'playing';
  game.wave = w;
  const types = stream(w);
  let next = 0, i = 0;
  for (let t = 0; t < RUN; t += DT) {
    if (t >= next && i < types.length) { game.spawnEnemy(types[i++], 0, w); next += GAP; }
    game.update(DT);
    for (const tw of game.towers) { tw.xp = 0; tw.rank = 0; } // no veterancy in the lab
  }
  const v = counted.reduce((a, tw) => a + tw.dmgDealt, 0);
  memo.set(k, v);
  return v;
}

function place(game, type, spot, tiers) {
  const t = game.build(type, spot.tx, spot.ty);
  if (!t) throw new Error(`cannot place ${type} at ${spot.tx},${spot.ty}`);
  tiers.forEach((n, p) => { for (let k = 0; k < n; k++) if (!game.upgrade(t, p)) throw new Error(`upgrade ${type} ${tiers}`); });
  return t;
}

const cost = (def, tiers) => def.cost + tiers.reduce((a, n, p) => a + def.paths[p].tiers.slice(0, n).reduce((b, t) => b + t.cost, 0), 0);

// Value of a tower at `tiers` against wave `w`, measured the way that fits its role.
function value(type, tiers, w) {
  const key = `${type}:${tiers.join('')}`;
  if (type === 'cryo' || type === 'uplink') {
    const probe = new Game(0, {});
    let refSpots, sup, battery;
    if (type === 'cryo') {
      sup = bestSpots(probe, 'cryo')[0];
      const c = { x: (sup.tx + 0.5) * TILE, y: (sup.ty + 0.5) * TILE, r: 3 };
      refSpots = bestSpots(probe, 'laser', 6, c).filter((s) => s.tx !== sup.tx || s.ty !== sup.ty).slice(0, 2);
      battery = (g) => refSpots.map((s) => place(g, 'laser', s, [1, 1, 0]));
    } else {
      refSpots = bestSpots(probe, 'laser', 2);
      for (const s of refSpots) probe.build('laser', s.tx, s.ty);
      const ps = bestSpots(probe, 'plasma')[0];
      probe.build('plasma', ps.tx, ps.ty);
      sup = bestSpots(probe, 'uplink')[0];
      battery = (g) => [...refSpots.map((s) => place(g, 'laser', s, [2, 1, 0])), place(g, 'plasma', ps, [2, 1, 0])];
    }
    const without = run(`${type}-battery`, w, (g) => battery(g));
    const withSup = run(key, w, (g) => { const r = battery(g); return [...r, place(g, type, sup, tiers)]; });
    return withSup - without;
  }
  return run(key, w, (g) => [place(g, type, bestSpots(g, type)[0], tiers)]);
}

function table(type) {
  const def = TOWERS[type];
  const baseEff = (w) => value(type, [0, 0, 0], w) / def.cost;
  const rows = [];
  const line = (label, from, to, w) => {
    const dv = value(type, to, w) - value(type, from, w), dc = cost(def, to) - cost(def, from);
    const eff = dv / dc / baseEff(w);
    const flag = eff > 1.8 ? '  << cheap' : eff < 0.4 ? '  >> pricey' : '';
    rows.push(`  ${label.padEnd(36)} ${String(dc).padStart(5)}¢ (total ${String(cost(def, to)).padStart(5)})  w${String(w).padStart(2)}  +${String(Math.round(dv)).padStart(6)}  EFF ${eff.toFixed(2).padStart(5)}${flag}`);
  };
  console.log(`\n${def.name}  ${def.cost}¢   base value per ¢ at w4 ${baseEff(4).toFixed(1)} · w10 ${baseEff(10).toFixed(1)} · w18 ${baseEff(18).toFixed(1)}`);
  def.paths.forEach((path, p) => {
    for (let k = 1; k <= 5; k++) {
      const from = [0, 0, 0], to = [0, 0, 0];
      from[p] = k - 1; to[p] = k;
      line(`${path.name} ${k} ${path.tiers[k - 1].name}`, from, to, TIER_WAVE[k]);
    }
  });
  // Crosspaths: tiers 1-2 of another path on top of each capstone, late game.
  def.paths.forEach((path, p) => {
    for (let q = 0; q < 3; q++) {
      if (q === p) continue;
      for (let k = 1; k <= 2; k++) {
        const from = [0, 0, 0], to = [0, 0, 0];
        from[p] = to[p] = 5; from[q] = k - 1; to[q] = k;
        line(`  ${def.paths[q].name} ${k} on ${path.name} 5`, from, to, 18);
      }
    }
  });
  if (type === 'uplink') {
    const eco = def.paths[1];
    let spent = def.cost, inc = 0;
    rows.push('  ECONOMY payback (income only; kill bounties not counted):');
    eco.tiers.forEach((t) => {
      spent += t.cost;
      const m = t.mods.find((x) => x.key === 'income');
      if (m) inc = m.val;
      rows.push(`    ${t.name.padEnd(20)} ${String(t.cost).padStart(5)}¢  +${inc}¢/wave  whole tower pays back in ${(spent / inc).toFixed(1)} waves`);
    });
  }
  console.log(rows.join('\n'));
}

// ---------------------------------------------------------------- credit flow
async function flow(runs) {
  const games = [];
  const orig = Game.prototype.launchWave;
  Game.prototype.launchWave = function () {
    if (!games.includes(this)) { games.push(this); this.flowLog = []; }
    this.flowLog.push({ wave: this.wave + 1, bank: Math.floor(this.credits), earned: this.stats.earned, spent: this.stats.spent, towers: this.towers.length });
    return orig.call(this);
  };
  process.argv = [process.argv[0], 'sim', String(runs)];
  const log = console.log; console.log = () => {};
  await import('./sim.mjs');
  console.log = log;
  const byMap = new Map();
  for (const g of games) { if (!byMap.has(g.map.name)) byMap.set(g.map.name, []); byMap.get(g.map.name).push(g); }
  for (const [name, gs] of byMap) {
    console.log(`\n${name} (${gs.length} runs)   wave: banked at launch / earned so far / spent so far / towers`);
    const out = [];
    for (const w of [1, 3, 5, 8, 10, 12, 15, 18, 20]) {
      const rows = gs.map((g) => g.flowLog.find((r) => r.wave === w)).filter(Boolean);
      if (!rows.length) continue;
      const avg = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) / rows.length);
      out.push(`  w${String(w).padStart(2)}: ${String(avg('bank')).padStart(5)}¢ banked · ${String(avg('earned') + gs[0].map.credits).padStart(6)}¢ in · ${String(avg('spent')).padStart(6)}¢ out · ${avg('towers')} towers`);
    }
    console.log(out.join('\n'));
    console.log(`  end of run: ${Math.round(gs.reduce((a, g) => a + g.credits, 0) / gs.length)}¢ unspent on average`);
  }
}

// Raw throughput: the value table above counts only hull a tower strips, so once it kills everything a stronger tier
// looks worthless (overkill). Here one build, at its best Sector 7 spot, faces a dense stream of wave-16 enemies that
// can't die, for 40 s: damage per credit invested shows which capstones outclass the rest.
function raw(only) {
  const mix = ['runner', 'brute', 'aegis', 'drone', 'runner', 'splitter', 'phantom', 'medic', 'runner', 'drone'];
  const lab = (type, tiers) => {
    const game = new Game(0, {});
    game.credits = 1e9;
    game.lives = game.maxLives = 1e9;
    const heat = coverageMap(game, type);
    let bi = 0;
    for (let i = 0; i < heat.length; i++) if (heat[i] > heat[bi]) bi = i;
    const t = game.build(type, bi % COLS, Math.floor(bi / COLS));
    tiers.forEach((n, p) => { for (let k = 0; k < n; k++) game.upgrade(t, p); });
    game.state = 'playing';
    game.wave = 16;
    let next = 0, i = 0;
    for (let time = 0; time < 40; time += DT) {
      if (time >= next) {
        const e = game.spawnEnemy(mix[i % mix.length], i % game.paths.length, 16, 0, null, mix[i % mix.length] === 'drone' && game.airPaths.length > 0);
        e.hp = e.maxHp = 1e7;
        e.cloaked = false; e.revealed = true; // camo is a separate question
        i++;
        next += 0.35;
      }
      game.update(DT);
      t.xp = 0; t.rank = 0; // no veterancy in the lab
    }
    return t.dmgDealt / t.invested;
  };
  for (const type of only ? [only] : TOWER_ORDER.filter((k) => k !== 'uplink')) {
    const def = TOWERS[type];
    console.log(def.name);
    def.paths.forEach((p, i) => {
      const tiers = (lvl) => [0, 1, 2].map((k) => (k === i ? lvl : k === (i ? 0 : 1) ? 2 : 0));
      console.log(`  ${p.name.padEnd(12)} T4 ${lab(type, tiers(4)).toFixed(1).padStart(5)}   T5 ${p.tiers[4].name.padEnd(16)} ${lab(type, tiers(5)).toFixed(1).padStart(5)} dmg/¢`);
    });
  }
}

const arg = process.argv[2];
if (arg === 'flow') await flow(Number(process.argv[3] || 4));
else if (arg === 'raw') raw(process.argv[3]);
else for (const type of arg ? [arg] : TOWER_ORDER) table(type);

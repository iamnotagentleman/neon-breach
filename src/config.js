// Static game data: grid, towers, enemies, maps, waves, abilities.

export const TILE = 48;
export const COLS = 24;
export const ROWS = 14;
export const W = COLS * TILE;
export const H = ROWS * TILE;

export const TOWER_ORDER = ['laser', 'plasma', 'tesla', 'cryo', 'rail', 'uplink'];

// Bloons-style upgrades: every tower has 3 paths of 5 tiers. Crosspathing rule: at most two paths,
// and only one of them past tier 2 (e.g. 5-2-0). Mods are compact strings applied in path order:
//   'dmg*1.4' multiply · 'range+0.8' add · 'targets=2' set · 'camo' flag.
// Base stats cover the behaviour every tower starts with; unlisted keys fall back to STAT_DEFAULTS.
export const STAT_DEFAULTS = {
  targets: 1, pierce: 1, camo: false, bossMul: 1, burn: 0, burnDur: 2, shred: 0, shredMax: 0, hitSlow: 0,
  stunChance: 0, stunDur: 0.4, markAmp: 0, markDur: 3, bounty: 0,
  splash: 0, air: false, cluster: 0, knockback: 0, fireZone: 0,
  chains: 0, chainRange: 1.9, falloff: 0.85, shieldMul: 1, burstEvery: 0, burstMul: 1,
  auraDps: 0, auraSlow: 0, auraShieldDrain: 0, reveal: false,
  slow: 0, slowDur: 1.4, bossSlow: false, freezeChance: 0, freezeDur: 0.8, freezeEvery: 0,
  brittle: 0, shards: 0, shatter: 0, globalSlow: 0,
  slugs: 1, beamWidth: 1, global: false, xray: false,
  buffDmg: 0, buffRate: 0, grantCamo: false, income: 0, killBounty: 0, auraArmorDown: 0, auraAmp: 0,
};

const tier = (name, cost, desc, ...mods) => ({ name, cost, desc, mods });
const path = (name, color, tiers, flagship = false) => ({ name, color, tiers, flagship });

export const TOWERS = {
  laser: {
    name: 'PULSE LASER', color: '#00f0ff', cost: 100, air: true, ground: true,
    desc: 'Rapid-fire hitscan beam. Reliable against air and ground.',
    base: { dmg: 11, rate: 4, range: 3.0 },
    paths: [
      path('OVERDRIVE', '#00f0ff', [
        tier('Rapid Capacitors', 70, '+30% fire rate.', 'rate*1.3'),
        tier('Twin Emitters', 170, 'Fires at 2 targets at once.', 'targets=2'),
        tier('Gatling Array', 360, '+60% fire rate, +30% damage.', 'rate*1.6', 'dmg*1.3'),
        tier('Quad Lattice', 850, 'Fires at 4 targets, faster and harder.', 'targets=4', 'rate*1.25', 'dmg*1.4'),
        tier('PHOTON STORM', 2860, 'Eight-barrel light storm that shreds entire waves.', 'targets=8', 'rate*1.8', 'dmg*2'),
      ], true),
      path('FOCUS', '#ff9a3c', [
        tier('Focusing Lens', 90, '+45% damage.', 'dmg*1.45'),
        tier('Extended Barrel', 140, '+0.8 range.', 'range+0.8'),
        tier('Burn Beam', 385, 'Beam sets targets ablaze.', 'dmg*1.4', 'burn=0.6'),
        tier('Piercing Lance', 900, 'Pierces up to 4 enemies in a line.', 'pierce=4', 'dmg*1.6'),
        tier('SOLAR LANCE', 3300, 'A searing lance that melts everything in its path.', 'dmg*3', 'pierce=12', 'burn=1.2', 'range+1'),
      ]),
      path('HACK', '#39ff14', [
        tier('Target Tracking', 65, 'Can target cloaked Phantoms.', 'camo'),
        tier('Armor Shred', 180, 'Hits strip 2 armor (up to 8).', 'shred=2', 'shredMax=8'),
        tier('Overheat Rounds', 300, 'Hits slow targets by 20%.', 'hitSlow=0.2'),
        tier('Neural Spike', 750, '8% chance per hit to stun.', 'stunChance=0.08', 'stunDur=0.6', 'dmg*1.3'),
        tier('NETBURN', 2475, 'Fries enemy firmware: frequent stuns, +2¢ per kill.', 'stunChance=0.2', 'bounty=2', 'shredMax=16', 'dmg*1.8'),
      ]),
    ],
  },
  plasma: {
    name: 'PLASMA MORTAR', color: '#ff2bd6', cost: 170, air: false, ground: true, size: 2,
    desc: 'Lobs plasma shells over buildings that splash on impact. Cannot hit airborne drones.',
    base: { dmg: 36, rate: 0.8, range: 3.8, splash: 1.2 },
    paths: [
      path('PAYLOAD', '#ff2bd6', [
        tier('Bigger Shells', 120, '+30% blast radius.', 'splash*1.3'),
        tier('Heavy Plasma', 265, '+50% damage.', 'dmg*1.5'),
        tier('Cluster Shells', 470, 'Impacts scatter 3 bomblets.', 'cluster=3'),
        tier('Thermobaric', 1050, 'Leaves burning plasma on the ground.', 'dmg*1.8', 'splash*1.25', 'fireZone=0.35'),
        tier('SUNFALL', 3850, 'A falling star of plasma. Craters whole columns.', 'dmg*3', 'splash*1.5', 'cluster=6', 'fireZone=0.8'),
      ], true),
      path('BARRAGE', '#ffd23c', [
        tier('Auto-Loader', 110, '+30% fire rate.', 'rate*1.3'),
        tier('Twin Tubes', 295, 'Fires 2 shells per volley.', 'targets=2'),
        tier('Rapid Barrage', 520, '+50% fire rate.', 'rate*1.5'),
        tier('Salvo Racks', 1150, '4 shells per volley, faster.', 'targets=4', 'rate*1.2'),
        tier('ARTILLERY STORM', 3575, 'Eight-shell carpet bombardment.', 'targets=8', 'rate*1.6', 'dmg*1.4'),
      ]),
      path('TACTICAL', '#7df9ff', [
        tier('Air-Burst Fuse', 130, 'Shells detonate mid-air: can hit drones.', 'air'),
        tier('Concussion', 250, 'Blasts stun briefly (bosses resist).', 'stunChance=1', 'stunDur=0.35'),
        tier('Napalm Plasma', 430, 'Blasts ignite targets.', 'burn=0.5', 'burnDur=3'),
        tier('Shockwave Core', 975, 'Blasts knock enemies back along the road.', 'knockback=0.6', 'dmg*1.4'),
        tier('GRAVITY WELL', 3080, 'Collapsing plasma: huge knockback and stun.', 'knockback=1.2', 'stunDur=0.8', 'splash*1.4', 'dmg*1.6'),
      ]),
    ],
  },
  tesla: {
    name: 'TESLA COIL', color: '#ffe600', cost: 210, air: true, ground: true, size: 2,
    desc: 'Chain lightning arcs between targets. Deals triple damage to shields.',
    base: { dmg: 19, rate: 1.1, range: 2.9, chains: 3, shieldMul: 3 },
    paths: [
      path('ARC', '#ffe600', [
        tier('Extra Coil', 135, '+1 chain.', 'chains+1'),
        tier('Arc Extender', 250, '+2 chains, longer jumps.', 'chains+2', 'chainRange*1.3'),
        tier('Storm Arc', 520, '+3 chains, +0.5 range.', 'chains+3', 'range+0.5'),
        tier('Superconductors', 1150, 'Arcs lose no power between jumps.', 'falloff=1', 'chains+3'),
        tier('THUNDERHEAD', 3850, 'A living storm: massive chains that see through camo.', 'chains+10', 'dmg*2.2', 'rate*1.4', 'camo'),
      ], true),
      path('VOLTAGE', '#ff5a5a', [
        tier('High Voltage', 145, '+40% damage.', 'dmg*1.4'),
        tier('Shield Breaker', 250, '6× damage to shields.', 'shieldMul=6'),
        tier('Capacitor Burst', 520, 'Every 4th discharge deals 4× damage.', 'burstEvery=4', 'burstMul=4'),
        tier('Overcharge', 1200, '+80% damage, +20% fire rate.', 'dmg*1.8', 'rate*1.2'),
        tier('ZEUS PROTOCOL', 3575, 'Every arc stuns; bursts hit 6×.', 'dmg*2.5', 'stunChance=1', 'stunDur=0.5', 'burstMul=6'),
      ]),
      path('FIELD', '#7fb2ff', [
        tier('Static Field', 160, 'Damages every enemy in range continuously.', 'auraDps=0.4'),
        tier('Magnetic Drag', 250, 'The field slows enemies by 20%.', 'auraSlow=0.2'),
        tier('Ion Stripper', 450, 'Drains 12% of shields per second.', 'auraShieldDrain=0.12'),
        tier('Faraday Cage', 1025, 'Stronger field; reveals cloaked units.', 'auraDps*2.5', 'reveal'),
        tier('ION STORM', 3190, 'A crushing storm field.', 'auraDps*3', 'auraSlow=0.35', 'range+1'),
      ]),
    ],
  },
  cryo: {
    name: 'CRYO EMITTER', color: '#3d8bff', cost: 140, air: true, ground: true,
    desc: 'Pulses freezing coolant, slowing everything in range — even cloaked units.',
    base: { dmg: 4, rate: 1, range: 2.4, slow: 0.35, slowDur: 1.4 },
    paths: [
      path('DEEP FREEZE', '#bfe3ff', [
        tier('Colder Coolant', 90, '+10% slow.', 'slow+0.1'),
        tier('Flash Freeze', 195, '12% chance to freeze solid.', 'freezeChance=0.12'),
        tier('Absolute Zero', 395, '+15% slow; bosses feel the full slow.', 'slow+0.15', 'bossSlow'),
        tier('Cryo Lock', 900, 'Every 4th pulse freezes everything in range.', 'freezeEvery=4'),
        tier('GLACIER CORE', 3025, 'Every other pulse is a flash freeze.', 'freezeEvery=2', 'freezeDur=1.6', 'range+0.8', 'dmg*4'),
      ], true),
      path('FROSTBITE', '#5aa0ff', [
        tier('Frostbite', 95, '×2.2 pulse damage.', 'dmg*2.2'),
        tier('Brittle Ice', 210, 'Chilled enemies take +20% damage from everything.', 'brittle=0.2'),
        tier('Ice Shards', 420, 'Each pulse also fires 4 ice shards.', 'shards=4'),
        tier('Shatter', 950, 'Chilled enemies explode on death.', 'shatter=0.4'),
        tier('PERMAFROST', 2860, 'Glass-brittle enemies, a storm of shards.', 'brittle=0.5', 'shards=10', 'dmg*3'),
      ]),
      path('COVERAGE', '#a8fffb', [
        tier('Wide Nozzles', 80, '+0.4 range.', 'range+0.4'),
        tier('Dual Pumps', 175, '+30% pulse rate, +0.3 range.', 'rate*1.3', 'range+0.3'),
        tier('Cold Snap', 330, 'Reveals cloaked units in range.', 'reveal'),
        tier('Polar Vortex', 800, '+0.8 range, slows last 60% longer.', 'range+0.8', 'slowDur*1.6'),
        tier('BLIZZARD', 2750, 'Chills the whole district: every enemy −15% speed.', 'globalSlow=0.15', 'range+1'),
      ]),
    ],
  },
  rail: {
    name: 'RAILGUN', color: '#ff3355', cost: 325, air: true, ground: true, size: 2,
    desc: 'Hypersonic slug pierces every enemy in a line. Ignores armor.',
    base: { dmg: 150, rate: 0.36, range: 6.0 },
    paths: [
      path('CALIBER', '#ff3355', [
        tier('Tungsten Slugs', 240, '+40% damage.', 'dmg*1.4'),
        tier('Depleted Core', 435, 'Double damage to bosses.', 'bossMul=2'),
        tier('Hyper Slug', 770, '+80% damage.', 'dmg*1.8'),
        tier('Plasma Jacket', 1500, 'Slugs ignite everything they pass through.', 'dmg*1.6', 'burn=0.3'),
        tier('ANNIHILATOR', 4675, 'One shot, one erased column.', 'dmg*3', 'bossMul=3', 'beamWidth=2.2'),
      ], true),
      path('CYCLE', '#ffd23c', [
        tier('Faster Capacitors', 210, '+30% fire rate.', 'rate*1.3'),
        tier('Dual Rails', 455, 'Fires 2 slugs in a spread.', 'slugs=2'),
        tier('Supercapacitors', 745, '+50% fire rate.', 'rate*1.5'),
        tier('Triple Rails', 1400, 'Fires 3 slugs.', 'slugs=3'),
        tier('GAUSS STORM', 4125, 'A five-slug fan at blistering speed.', 'slugs=5', 'rate*1.6'),
      ]),
      path('TARGETING', '#00f0ff', [
        tier('Long Barrel', 160, '+1 range.', 'range+1'),
        tier('Thermal Scope', 250, 'Sees cloaked Phantoms and through buildings; slugs punch through walls.', 'camo', 'xray'),
        tier('Marked Target', 605, 'Hit enemies take +25% damage for 3s.', 'markAmp=0.25'),
        tier('Kill Protocol', 1300, '+50% damage; marks amplify 40%.', 'dmg*1.5', 'markAmp=0.4'),
        tier('ORBITAL LINK', 3850, 'Satellite targeting: unlimited range.', 'global', 'dmg*1.8'),
      ]),
    ],
  },
  uplink: {
    name: 'NETRUNNER UPLINK', color: '#39ff14', cost: 190, air: false, ground: false,
    desc: 'Boosts damage and fire rate of nearby towers. Decloaks Phantoms in range.',
    base: { buffDmg: 0.2, buffRate: 0.1, range: 2.2 },
    paths: [
      path('NEURAL MESH', '#39ff14', [
        tier('Signal Boost', 120, '+5% damage and fire-rate buffs.', 'buffDmg+0.05', 'buffRate+0.05'),
        tier('Wide Band', 210, '+0.6 range.', 'range+0.6'),
        tier('Combat Algorithms', 440, '+15% damage, +10% fire-rate buffs.', 'buffDmg+0.15', 'buffRate+0.1'),
        tier('Overmind Link', 1000, '+20% damage buff, +0.6 range.', 'buffDmg+0.2', 'range+0.6'),
        tier('HIVE MIND', 3300, 'Massive buffs; linked towers see cloaked units.', 'buffDmg+0.4', 'buffRate+0.25', 'grantCamo'),
      ]),
      path('ECONOMY', '#ffe600', [
        tier('Micro-Transactions', 145, '+25¢ every wave.', 'income=25'),
        tier('Data Brokerage', 250, '+55¢ every wave.', 'income=55'),
        tier('Bounty Protocol', 495, '+1¢ for kills in range.', 'killBounty=1'),
        tier('Crypto Farm', 1100, '+160¢ every wave.', 'income=160'),
        tier('CORPORATE HEIST', 3300, '+450¢ every wave, +3¢ per kill in range.', 'income=450', 'killBounty=3'),
      ]),
      path('INTRUSION', '#a855ff', [
        tier('Deep Scan', 120, 'Wider decloak field (+0.5 range).', 'range+0.5'),
        tier('ICE Breaker', 280, 'Enemies in range lose 3 armor.', 'auraArmorDown=3'),
        tier('Shield Leech', 495, 'Drains 12% of shields per second in range.', 'auraShieldDrain=0.12'),
        tier('Black ICE', 1200, 'Enemies in range slowed 20% and take +15% damage.', 'auraSlow=0.2', 'auraAmp=0.15'),
        tier('BLACKWALL', 3575, 'A wall of lethal ICE around the core of your defense.', 'auraAmp=0.35', 'auraSlow=0.35', 'auraArmorDown=10'),
      ], true),
    ],
  },
};

function parseMod(str) {
  const m = /^(\w+)(?:([*+=])(.+))?$/.exec(str);
  if (!m) throw new Error(`bad mod ${str}`);
  const [, key, op = '=', raw = 'true'] = m;
  const val = raw === 'true' ? true : Number(raw);
  return { key, op, val };
}

for (const def of Object.values(TOWERS)) {
  for (const p of def.paths) for (const t of p.tiers) t.mods = t.mods.map(parseMod);
}

export function computeStats(def, tiers) {
  const s = { ...STAT_DEFAULTS, ...def.base };
  def.paths.forEach((p, pi) => {
    for (let i = 0; i < tiers[pi]; i++) {
      for (const { key, op, val } of p.tiers[i].mods) {
        if (op === '*') s[key] *= val;
        else if (op === '+') s[key] += val;
        else s[key] = val;
      }
    }
  });
  return s;
}

// Crosspath rule: <= 2 paths in use, and only one path beyond tier 2.
export function canUpgradePath(tiers, p) {
  if (tiers[p] >= 5) return false;
  if (tiers[p] === 0 && tiers.filter((v, i) => i !== p && v > 0).length >= 2) return false;
  if (tiers[p] >= 2 && tiers.some((v, i) => i !== p && v > 2)) return false;
  return true;
}

export const ENEMIES = {
  runner: {
    name: 'STREET RUNNER', hp: 55, speed: 1.35, reward: 7, lives: 3, radius: 0.33, color: '#ff8a00',
    desc: 'Chrome-augmented street punk. Standard threat.',
  },
  drone: {
    name: 'HUNTER DRONE', hp: 28, speed: 1.9, reward: 5, lives: 2, radius: 0.32, color: '#00f0ff', flying: true,
    desc: 'Fast and airborne. Plasma Mortars cannot hit it.',
  },
  brute: {
    name: 'HEAVY MECH', hp: 240, speed: 0.75, reward: 18, lives: 12, radius: 0.5, armor: 6, color: '#ff3355',
    desc: 'Armored walker. Armor blunts every hit — Railguns ignore it.',
  },
  aegis: {
    name: 'AEGIS UNIT', hp: 90, shield: 130, speed: 1.05, reward: 15, lives: 4, shieldLives: 4, radius: 0.42, color: '#3d8bff',
    desc: 'Regenerating energy shield. Tesla Coils and EMP shred shields.',
  },
  phantom: {
    name: 'PHANTOM', hp: 75, speed: 1.6, reward: 13, lives: 4, radius: 0.33, color: '#a855ff', cloaked: true,
    desc: 'Permanent optical camo: invisible to towers without camo detection unless inside a Netrunner Uplink field or stunned. Splash & slow still hit it.',
  },
  splitter: {
    name: 'REPLICATOR', hp: 140, speed: 1.0, reward: 10, lives: 4, radius: 0.44, color: '#39ff14',
    splits: { type: 'mite', count: 3 },
    desc: 'Self-replicating nanoswarm. Bursts into three Nano-Mites when destroyed.',
  },
  mite: {
    name: 'NANO-MITE', hp: 30, speed: 1.8, reward: 2, lives: 1, radius: 0.22, color: '#39ff14', hidden: true,
    desc: 'Tiny self-replicated crawler released when a Replicator is destroyed.',
  },
  medic: {
    name: 'PATCH DRONE', hp: 110, speed: 1.1, reward: 16, lives: 5, radius: 0.38, color: '#e8f6ff',
    heal: { rate: 14, radius: 1.6 },
    desc: 'Field repair unit. Continuously heals nearby enemies — kill it first.',
  },
  titan: {
    name: 'TITAN WARFRAME', hp: 2300, speed: 0.5, reward: 250, lives: 35, radius: 0.85, armor: 10, color: '#ff2bd6', boss: true,
    desc: 'Corporate siege frame. Massive armor plating. A breach costs 35 core integrity.',
  },
  overmind: {
    name: 'OVERMIND', hp: 5200, shield: 1400, speed: 0.42, reward: 600, lives: 80, shieldLives: 30, radius: 1.0, armor: 12, color: '#ffe600', boss: true,
    spawns: { type: 'drone', every: 3.5, count: 3 },
    desc: 'Rogue AI core. Shielded, armored, and launches drone swarms. Stop it at all costs.',
  },
};

// Campaign (waves 1-20): a quadratic ramp. Endless (21+): logarithmic growth from the wave-20 level, so each wave
// is harder than the last but by less and less (starts at the campaign's ~8%/wave and tapers off).
const campaignHp = (wave) => 1 + 0.16 * (wave - 1) + 0.017 * (wave - 1) ** 2;
export const endlessLog = (wave) => Math.log(1 + Math.max(0, wave - 20) / 10);
export const hpMultiplier = (wave) => campaignHp(Math.min(wave, 20)) * (1 + 0.8 * endlessLog(wave));
export const waveBonus = (wave) => 30 + 8 * wave;
export const earlyBonus = (wave) => 10 + 3 * wave;
export const SELL_RATIO = 0.7;

export const ABILITIES = {
  emp: {
    name: 'EMP BURST', key: 'Q', cd: 40, radius: 2.6, stun: 2.5, color: '#00f0ff', targeted: true,
    desc: 'Stuns enemies in an area and wipes their shields.',
  },
  orbital: {
    name: 'ORBITAL STRIKE', key: 'W', cd: 65, radius: 1.5, delay: 0.9, color: '#ff2bd6', targeted: true,
    dmg: (wave) => 400 + 90 * wave,
    desc: 'Calls down a satellite lance. Massive armor-piercing damage.',
  },
  overclock: {
    name: 'OVERCLOCK', key: 'E', cd: 50, duration: 8, mult: 1.6, color: '#ffe600', targeted: false,
    desc: 'All towers fire 60% faster for 8 seconds.',
  },
};

// Waypoints are tile coordinates; the first sits just off-map, the last is the data core.
export const MAPS = [
  {
    id: 'sector7', name: 'SECTOR 7', subtitle: 'Downtown Grid', diff: 0.72, credits: 420, lives: 100,
    theme: { path: '#ff2bd6', accent: '#00f0ff', ground: '#070512' },
    difficulty: 'STANDARD',
    paths: [
      [[-1, 2], [4, 2], [4, 10], [10, 10], [10, 3], [16, 3], [16, 11], [20, 11], [20, 6], [22, 6]],
    ],
    // City blocks [x, y, size] break up sight lines: walls down both U-turn pockets and a split in the
    // right-hand pocket, so no single spot sees three stretches of road (tools/sightlines.mjs).
    buildings: [[6, 4, 2], [6, 7, 2], [12, 4, 2], [12, 8, 2], [17, 8, 1], [19, 8, 1], [18, 10, 1], [5, 11, 1], [9, 11, 1], [2, 5, 1],
      [20, 0, 2], [22, 1, 1], [22, 9, 1]],
    seed: 7,
  },
  {
    id: 'docks', name: 'NEON DOCKS', subtitle: 'Harbor Freight Zone', diff: 0.74, credits: 480, lives: 100,
    theme: { path: '#00f0ff', accent: '#ff8a00', ground: '#040912' },
    difficulty: 'HARD',
    paths: [
      [[-1, 2], [7, 2], [7, 6], [13, 6], [13, 2], [18, 2], [18, 10], [22, 10]],
      [[-1, 11], [7, 11], [7, 6], [13, 6], [13, 2], [18, 2], [18, 10], [22, 10]],
    ],
    // A wall between the two entry lanes, blocks in both loop pockets and at the exit bend.
    buildings: [[15, 3, 2], [14, 5, 1], [17, 5, 1], [11, 4, 2], [9, 5, 1], [2, 6, 2], [4, 6, 2], [19, 8, 1], [21, 8, 1], [19, 6, 1],
      [13, 0, 1], [22, 13, 1], [0, 12, 1]],
    seed: 21,
  },
  {
    id: 'nexus', name: 'CORE NEXUS', subtitle: 'Arcology Mainframe', diff: 0.56, credits: 560, lives: 100,
    theme: { path: '#ffe600', accent: '#a855ff', ground: '#0a0510' },
    difficulty: 'EXTREME',
    paths: [
      [[2, -1], [2, 5], [8, 5], [8, 2], [14, 2], [14, 7], [21, 7]],
      [[2, 14], [2, 9], [8, 9], [8, 12], [14, 12], [14, 7], [21, 7]],
    ],
    // An arcology wall down the spine between the lanes, towers on both merge corners and in the loop pockets.
    buildings: [[15, 5, 2], [15, 8, 2], [3, 7, 1], [4, 7, 1], [5, 7, 1], [6, 7, 1], [7, 7, 1], [10, 3, 2], [10, 9, 2], [12, 5, 1], [12, 8, 1],
      [20, 0, 1], [20, 13, 1]],
    seed: 99,
  },
];

const g = (type, count, gap, delay = 0) => ({ type, count, gap, delay });

export const WAVES = [
  /* 1 */[g('runner', 8, 1.1)],
  /* 2 */[g('runner', 10, 0.9), g('drone', 5, 0.8, 6)],
  /* 3 */[g('drone', 14, 0.55), g('runner', 6, 1, 4)],
  /* 4 */[g('runner', 12, 0.7), g('brute', 2, 4, 5)],
  /* 5 */[g('aegis', 6, 1.6), g('runner', 10, 0.7, 2)],
  /* 6 */[g('splitter', 6, 1.8), g('drone', 10, 0.6, 4)],
  /* 7 */[g('phantom', 8, 1.2), g('runner', 12, 0.6, 3)],
  /* 8 */[g('medic', 3, 4), g('brute', 4, 3, 1), g('runner', 14, 0.5, 2)],
  /* 9 */[g('aegis', 8, 1.2), g('splitter', 6, 1.5, 4), g('drone', 14, 0.45, 8)],
  /* 10 */[g('runner', 16, 0.5), g('titan', 1, 1, 6), g('drone', 12, 0.6, 10)],
  /* 11 */[g('brute', 6, 2.2), g('phantom', 10, 0.9, 4), g('medic', 3, 4, 6)],
  /* 12 */[g('drone', 30, 0.3), g('aegis', 8, 1.2, 6)],
  /* 13 */[g('splitter', 12, 1.1), g('medic', 4, 3, 4), g('brute', 4, 2.5, 8)],
  /* 14 */[g('phantom', 16, 0.7), g('aegis', 10, 1, 5)],
  /* 15 */[g('brute', 10, 1.6), g('medic', 5, 2.5, 3), g('drone', 20, 0.4, 6)],
  /* 16 */[g('runner', 30, 0.3), g('splitter', 10, 1, 4), g('phantom', 10, 0.8, 8)],
  /* 17 */[g('aegis', 16, 0.8), g('brute', 8, 1.5, 4), g('medic', 5, 2.5, 6)],
  /* 18 */[g('titan', 2, 10), g('drone', 25, 0.35, 3), g('phantom', 12, 0.7, 8)],
  /* 19 */[g('brute', 14, 1.1), g('aegis', 14, 0.9, 3), g('splitter', 12, 0.9, 6), g('medic', 6, 2, 5)],
  /* 20 */[g('overmind', 1, 1, 4), g('runner', 20, 0.5), g('brute', 8, 2, 10), g('phantom', 12, 0.8, 14)],
];

const ENDLESS_POOL = ['runner', 'drone', 'brute', 'aegis', 'phantom', 'splitter', 'medic'];

// Deterministic generator for waves past the scripted campaign.
export function endlessWave(n) {
  let s = n * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const groups = [];
  const k = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < k; i++) {
    const type = ENDLESS_POOL[Math.floor(rnd() * ENDLESS_POOL.length)];
    const base = { runner: 18, drone: 20, brute: 7, aegis: 10, phantom: 10, splitter: 8, medic: 4 }[type];
    // Group sizes, spawn density and boss counts grow on the same logarithmic curve as enemy health.
    const grow = 1 + 0.9 * endlessLog(n);
    groups.push(g(type, Math.round(base * grow), Math.max(0.2, 0.8 / grow), i * 3));
  }
  if (n % 5 === 0) groups.push(g(n % 10 === 0 ? 'overmind' : 'titan', 1 + Math.floor(Math.log2(1 + (n - 20) / 10)), 6, 5));
  return groups;
}

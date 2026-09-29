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
// Base stats cover the behaviour every tower starts with; unlisted keys fall back to STAT_DEFAULTS. `shieldMul` scales
// damage to energy shields, `armorMul` damage to a hull that still has armor on it (stripping the armor lifts it).
export const STAT_DEFAULTS = {
  targets: 1, pierce: 1, camo: false, bossMul: 1, burn: 0, burnDur: 2, shred: 0, shredMax: 0, hitSlow: 0,
  stunChance: 0, stunDur: 0.4, markAmp: 0, markDur: 3, bounty: 0,
  splash: 0, air: false, cluster: 0, knockback: 0, fireZone: 0,
  chains: 0, chainRange: 1.9, falloff: 0.85, shieldMul: 1, armorMul: 1, burstEvery: 0, burstMul: 1,
  auraDps: 0, auraSlow: 0, auraShieldDrain: 0, reveal: false,
  slow: 0, slowDur: 1.4, bossSlow: false, freezeChance: 0, freezeDur: 0.8, freezeEvery: 0,
  brittle: 0, shards: 0, shatter: 0, globalSlow: 0,
  slugs: 1, beamWidth: 1, global: false, xray: false, slugFalloff: 0.1, aimOnly: false,
  buffDmg: 0, buffRate: 0, grantCamo: false, income: 0, killBounty: 0, auraArmorDown: 0, auraAmp: 0, firewall: false,
};

const tier = (name, cost, desc, ...mods) => ({ name, cost, desc, mods });
const path = (name, color, tiers, flagship = false) => ({ name, color, tiers, flagship });

export const TOWERS = {
  laser: {
    name: 'PULSE LASER', color: '#00f0ff', cost: 100, air: true, ground: true,
    desc: 'Rapid-fire hitscan beam, set to Ground or Anti-Air (V). Shreds light units, but does half damage to shields and to armor that hasn\'t been stripped.',
    base: { dmg: 11, rate: 4, range: 3.0, shieldMul: 0.5, armorMul: 0.5 },
    // Variants: switch any time in the inspector (V); the turret re-locks for a moment and reloads. `hits` limits the
    // targets, `mods` (path mod syntax) apply on top of the upgrades.
    variants: [
      { id: 'ground', name: 'GROUND', hits: 'ground', mods: ['dmg*1.2'], desc: 'Barrels level: fires at ground targets only, with +20% damage.' },
      { id: 'air', name: 'ANTI-AIR', hits: 'air', mods: ['range+0.6', 'dmg*1.4'], desc: 'Barrels locked skyward, sweeping the sky: fires at flyers only, with +0.6 range and +40% damage.' },
    ],
    paths: [
      path('OVERDRIVE', '#00f0ff', [
        tier('Rapid Capacitors', 85, '+30% fire rate.', 'rate*1.3'),
        tier('Twin Emitters', 205, 'Both emitters on one target: +50% damage.', 'dmg*1.5'),
        tier('Gatling Array', 430, '+60% fire rate, +30% damage.', 'rate*1.6', 'dmg*1.3'),
        tier('Quad Lattice', 1020, 'Four emitters focused on one target: +40% fire rate, +50% damage.', 'rate*1.4', 'dmg*1.5'),
        tier('PHOTON STORM', 3430, 'Six-barrel rotary storm: tears apart whatever it locks onto.', 'rate*1.4', 'dmg*1.6'),
      ], true),
      path('FOCUS', '#ff9a3c', [
        tier('Focusing Lens', 110, '+45% damage.', 'dmg*1.45'),
        tier('Extended Barrel', 170, '+0.8 range.', 'range+0.8'),
        tier('Burn Beam', 460, 'Beam sets targets ablaze.', 'dmg*1.4', 'burn=0.6'),
        tier('Piercing Lance', 1080, 'Pierces up to 4 enemies in a line.', 'pierce=4', 'dmg*1.6'),
        tier('SOLAR LANCE', 3960, 'A searing lance that melts everything in its path.', 'dmg*3', 'pierce=8', 'burn=0.7', 'range+1'),
      ]),
      path('HACK', '#39ff14', [
        tier('Target Tracking', 80, 'Can target cloaked Phantoms.', 'camo'),
        tier('Armor Shred', 215, 'Hits strip 2 armor (up to 8).', 'shred=2', 'shredMax=8'),
        tier('Overheat Rounds', 360, 'Hits slow targets by 20%.', 'hitSlow=0.2'),
        tier('Neural Spike', 900, '8% chance per hit to stun.', 'stunChance=0.08', 'stunDur=0.6', 'dmg*1.3'),
        tier('NETBURN', 2970, 'Fries enemy firmware: frequent stuns, +2¢ per kill.', 'stunChance=0.2', 'bounty=2', 'shredMax=16', 'dmg*1.8'),
      ]),
    ],
  },
  plasma: {
    name: 'PLASMA MORTAR', color: '#ff2bd6', cost: 170, air: false, ground: true, size: 2,
    desc: 'Lobs plasma shells over buildings that splash on impact. Cannot hit airborne drones.',
    base: { dmg: 36, rate: 0.8, range: 3.8, splash: 1.2 },
    paths: [
      path('PAYLOAD', '#ff2bd6', [
        tier('Bigger Shells', 145, '+30% blast radius.', 'splash*1.3'),
        tier('Heavy Plasma', 320, '+50% damage.', 'dmg*1.5'),
        tier('Cluster Shells', 565, 'Impacts scatter 3 bomblets.', 'cluster=3'),
        tier('Thermobaric', 1260, 'Leaves burning plasma on the ground.', 'dmg*1.8', 'splash*1.25', 'fireZone=0.35'),
        tier('SUNFALL', 4620, 'A falling star of plasma. Craters whole columns.', 'dmg*3', 'splash*1.5', 'cluster=6', 'fireZone=0.8'),
      ], true),
      path('BARRAGE', '#ffd23c', [
        tier('Auto-Loader', 130, '+30% fire rate.', 'rate*1.3'),
        tier('Twin Tubes', 355, 'Fires 2 shells per volley.', 'targets=2'),
        tier('Rapid Barrage', 625, '+50% fire rate.', 'rate*1.5'),
        tier('Salvo Racks', 1380, '4 shells per volley, faster.', 'targets=4', 'rate*1.2'),
        tier('ARTILLERY STORM', 4290, 'Eight-shell carpet bombardment.', 'targets=8', 'rate*1.6', 'dmg*1.4'),
      ]),
      path('TACTICAL', '#7df9ff', [
        tier('Air-Burst Fuse', 155, 'Shells detonate mid-air: can hit drones.', 'air'),
        tier('Concussion', 300, 'Blasts stun briefly (bosses resist).', 'stunChance=1', 'stunDur=0.35'),
        tier('Napalm Plasma', 515, 'Blasts ignite targets.', 'burn=0.5', 'burnDur=3'),
        tier('Shockwave Core', 1170, 'Blasts knock enemies back along the road.', 'knockback=0.6', 'dmg*1.4'),
        tier('GRAVITY WELL', 3695, 'Collapsing plasma: huge knockback and stun.', 'knockback=1.2', 'stunDur=0.8', 'splash*1.4', 'dmg*1.6'),
      ]),
    ],
  },
  tesla: {
    name: 'TESLA COIL', color: '#ffe600', cost: 210, air: true, ground: true, size: 2,
    desc: 'Chain lightning arcs between targets. Deals triple damage to shields.',
    base: { dmg: 32, rate: 1.1, range: 2.9, chains: 3, shieldMul: 3 },
    paths: [
      path('ARC', '#ffe600', [
        tier('Extra Coil', 160, '+1 chain.', 'chains+1'),
        tier('Arc Extender', 300, '+2 chains, longer jumps.', 'chains+2', 'chainRange*1.3'),
        tier('Storm Arc', 625, '+3 chains, +0.5 range, +25% damage.', 'chains+3', 'range+0.5', 'dmg*1.25'),
        tier('Superconductors', 1380, 'Arcs lose no power between jumps; +3 chains, +30% damage.', 'falloff=1', 'chains+3', 'dmg*1.3'),
        tier('THUNDERHEAD', 4620, 'A living storm: massive chains that see through camo.', 'chains+10', 'dmg*2.2', 'rate*1.4', 'camo'),
      ], true),
      path('VOLTAGE', '#ff5a5a', [
        tier('High Voltage', 175, '+40% damage.', 'dmg*1.4'),
        tier('Shield Breaker', 300, '6× damage to shields.', 'shieldMul=6'),
        tier('Capacitor Burst', 625, 'Every 4th discharge deals 4× damage.', 'burstEvery=4', 'burstMul=4'),
        tier('Overcharge', 1440, '+80% damage, +20% fire rate.', 'dmg*1.8', 'rate*1.2'),
        tier('ZEUS PROTOCOL', 4290, 'Every arc stuns; bursts hit 6×.', 'dmg*2.5', 'stunChance=1', 'stunDur=0.5', 'burstMul=6'),
      ]),
      path('FIELD', '#7fb2ff', [
        tier('Static Field', 190, 'Damages every enemy in range continuously.', 'auraDps=0.4'),
        tier('Magnetic Drag', 300, 'The field slows enemies by 20%.', 'auraSlow=0.2'),
        tier('Ion Stripper', 540, 'Drains 12% of shields per second.', 'auraShieldDrain=0.12'),
        tier('Faraday Cage', 1230, 'Stronger field; reveals cloaked units.', 'auraDps*2.5', 'reveal'),
        tier('ION STORM', 3830, 'A crushing storm field.', 'auraDps*3', 'auraSlow=0.35', 'range+1'),
      ]),
    ],
  },
  cryo: {
    name: 'CRYO EMITTER', color: '#3d8bff', cost: 140, air: true, ground: true,
    desc: 'Pulses freezing coolant, slowing everything in range — even cloaked units.',
    base: { dmg: 4, rate: 1, range: 2.4, slow: 0.35, slowDur: 1.4 },
    paths: [
      path('DEEP FREEZE', '#bfe3ff', [
        tier('Colder Coolant', 110, '+10% slow.', 'slow+0.1'),
        tier('Flash Freeze', 235, '12% chance to freeze solid.', 'freezeChance=0.12'),
        tier('Absolute Zero', 475, '+15% slow; bosses feel the full slow.', 'slow+0.15', 'bossSlow'),
        tier('Cryo Lock', 1080, 'Every 4th pulse freezes everything in range.', 'freezeEvery=4'),
        tier('GLACIER CORE', 3630, 'Every other pulse is a flash freeze.', 'freezeEvery=2', 'freezeDur=1.6', 'range+0.8', 'dmg*4'),
      ], true),
      path('FROSTBITE', '#5aa0ff', [
        tier('Frostbite', 115, '×2.2 pulse damage.', 'dmg*2.2'),
        tier('Brittle Ice', 250, 'Chilled enemies take +20% damage from everything.', 'brittle=0.2'),
        tier('Ice Shards', 505, 'Each pulse also fires 4 ice shards.', 'shards=4'),
        tier('Shatter', 1140, 'Chilled enemies explode on death.', 'shatter=0.4'),
        tier('PERMAFROST', 3430, 'Glass-brittle enemies, a storm of shards.', 'brittle=0.5', 'shards=10', 'dmg*3'),
      ]),
      path('COVERAGE', '#a8fffb', [
        tier('Wide Nozzles', 95, '+0.4 range.', 'range+0.4'),
        tier('Dual Pumps', 210, '+30% pulse rate, +0.3 range.', 'rate*1.3', 'range+0.3'),
        tier('Cold Snap', 395, 'Reveals cloaked units in range.', 'reveal'),
        tier('Polar Vortex', 960, '+0.8 range, slows last 60% longer.', 'range+0.8', 'slowDur*1.6'),
        tier('BLIZZARD', 3300, 'Chills the whole district: every enemy −15% speed.', 'globalSlow=0.15', 'range+1'),
      ]),
    ],
  },
  rail: {
    name: 'RAILGUN', color: '#ff3355', cost: 700, air: true, ground: true, size: 2,
    desc: 'Hypersonic slug pierces every enemy in a line, losing 10% per enemy it passes through. Ignores armor, but energy shields soak half of it.',
    base: { dmg: 150, rate: 0.36, range: 6.0, shieldMul: 0.5 },
    paths: [
      path('CALIBER', '#ff3355', [
        tier('Tungsten Slugs', 320, '+40% damage.', 'dmg*1.4'),
        tier('Depleted Core', 575, 'Double damage to bosses.', 'bossMul=2'),
        tier('Hyper Slug', 1015, '+80% damage.', 'dmg*1.8'),
        tier('Plasma Jacket', 1980, 'Slugs ignite everything they pass through.', 'dmg*1.6', 'burn=0.3'),
        tier('ANNIHILATOR', 6180, 'One shot, one erased column: slugs keep full power through every enemy. Too heavy to track: fires only down a fixed firing line (G re-aims).', 'dmg*3', 'bossMul=3', 'beamWidth=2.2', 'slugFalloff=0', 'aimOnly'),
      ], true),
      path('CYCLE', '#ffd23c', [
        tier('Faster Capacitors', 275, '+30% fire rate.', 'rate*1.3'),
        tier('Dual Rails', 600, 'Fires 2 slugs in a spread.', 'slugs=2'),
        tier('Supercapacitors', 985, '+50% fire rate.', 'rate*1.5'),
        tier('Triple Rails', 1850, 'Fires 3 slugs.', 'slugs=3'),
        tier('GAUSS STORM', 5450, 'A five-slug fan at blistering speed.', 'slugs=5', 'rate*1.6'),
      ]),
      path('TARGETING', '#00f0ff', [
        tier('Long Barrel', 210, '+1 range.', 'range+1'),
        tier('Thermal Scope', 330, 'Sees cloaked Phantoms and through buildings; slugs punch through walls.', 'camo', 'xray'),
        tier('Marked Target', 800, 'Hit enemies take +25% damage for 3s.', 'markAmp=0.25'),
        tier('Kill Protocol', 1715, '+50% damage; marks amplify 40%.', 'dmg*1.5', 'markAmp=0.4'),
        tier('ORBITAL LINK', 5080, 'Satellite targeting: unlimited range.', 'global', 'dmg*1.8'),
      ]),
    ],
  },
  uplink: {
    name: 'NETRUNNER UPLINK', color: '#39ff14', cost: 190, air: false, ground: false,
    desc: 'Boosts damage and fire rate of nearby towers. Decloaks Phantoms in range.',
    base: { buffDmg: 0.2, buffRate: 0.1, range: 2.2 },
    paths: [
      path('NEURAL MESH', '#39ff14', [
        tier('Signal Boost', 145, '+5% damage and fire-rate buffs.', 'buffDmg+0.05', 'buffRate+0.05'),
        tier('Wide Band', 250, '+0.6 range.', 'range+0.6'),
        tier('Combat Algorithms', 530, '+15% damage, +10% fire-rate buffs.', 'buffDmg+0.15', 'buffRate+0.1'),
        tier('Overmind Link', 1200, '+20% damage buff, +0.6 range.', 'buffDmg+0.2', 'range+0.6'),
        tier('HIVE MIND', 3960, 'Massive buffs; linked towers see cloaked units.', 'buffDmg+0.4', 'buffRate+0.25', 'grantCamo'),
      ]),
      path('ECONOMY', '#ffe600', [
        tier('Micro-Transactions', 175, '+25¢ every wave.', 'income=25'),
        tier('Data Brokerage', 300, '+55¢ every wave.', 'income=55'),
        tier('Bounty Protocol', 595, '+1¢ for kills in range.', 'killBounty=1'),
        tier('Crypto Farm', 1320, '+160¢ every wave.', 'income=160'),
        tier('CORPORATE HEIST', 3960, '+450¢ every wave, +3¢ per kill in range.', 'income=450', 'killBounty=3'),
      ]),
      path('INTRUSION', '#a855ff', [
        tier('Deep Scan', 145, 'Wider decloak field (+0.5 range); firewalls towers in range against Signal Jammers.', 'range+0.5', 'firewall'),
        tier('ICE Breaker', 335, 'Enemies in range lose 3 armor.', 'auraArmorDown=3'),
        tier('Shield Leech', 595, 'Drains 12% of shields per second in range.', 'auraShieldDrain=0.12'),
        tier('Black ICE', 1440, 'Enemies in range slowed 20% and take +15% damage.', 'auraSlow=0.2', 'auraAmp=0.15'),
        tier('BLACKWALL', 4290, 'A wall of lethal ICE around the core of your defense.', 'auraAmp=0.35', 'auraSlow=0.35', 'auraArmorDown=10'),
      ], true),
    ],
  },
};

// The hero: one war bot per run that walks anywhere on the board and fights with twin autocannons. Same 3x5 paths
// and crosspath rule as a tower, but pricier tiers. Hero-only stats (hull, gait, hacking, missiles, traps) sit in its
// base so path mods can scale them.
export const HERO = {
  name: 'ARACHNE-9', type: 'hero', color: '#00f0ff', cost: 300, air: true, ground: true, hotkey: '7',
  desc: 'Hero war bot. Walks anywhere (right-click to move) and fights with twin autocannons that hit air and ground; its thermal sensors see cloaked units. Enemies shoot back when it\'s in their range (heavies and bosses from further out, buildings block their fire); knocked out, it reboots after 15s. One per run; upgrades are expensive but powerful.',
  base: {
    dmg: 33, rate: 2.5, range: 2.7, camo: true,
    hp: 800, speed: 1.05, pierceArmor: false,
    // ICE BREAKER: every `hackEvery` s the strongest enemies in range are hacked (stunned + marked), or from HIJACK on
    // turned into allies (`convert` of them) that march back to their gate for `convertLife` s. Bosses are immune.
    hackEvery: 0, hackStun: 0, hackMark: 0, convert: 0, convertLife: 0, convertStun: 0, convertEmp: 0,
    // ARSENAL: micro-missile salvos (`missiles` every `missileEvery` s, each `missileDmg` x damage, splash).
    missiles: 0, missileEvery: 3, missileDmg: 0,
    // TRAPPER: proximity traps laid on the road in range (`mines` armed at once, one every `mineEvery` s).
    mines: 0, mineEvery: 6, mineDmg: 0, mineR: 1.1, mineSlow: 0, empTrap: 0, mineCluster: 0, mineZone: 0,
  },
  paths: [
    path('ICE BREAKER', '#39ff14', [
      tier('Intrusion Rounds', 330, 'Rounds strip 3 armor (up to 9), deal double damage to shields and +50% overall.', 'shred=3', 'shredMax=9', 'shieldMul=2', 'dmg*1.5'),
      tier('Signal Spike', 620, 'Every 8s hacks the strongest enemy in range: stunned 2.5s, takes +40% damage from everything for 5s. Bosses are immune.', 'hackEvery=8', 'hackStun=2.5', 'hackMark=0.4'),
      tier('HIJACK', 1450, 'Every 10s the hack turns the strongest enemy in range: it marches back toward its gate blasting its own squad for 14s, then self-destructs.', 'convert=1', 'convertLife=14', 'hackEvery=10'),
      tier('Swarm Protocol', 3100, 'Hijacks 2 enemies every 9s; they fight for 16s and their shots stun.', 'convert=2', 'convertLife=16', 'hackEvery=9', 'convertStun=0.6'),
      tier('GHOST PROTOCOL', 7800, 'Hijacks 3 every 7s for 20s; each goes out in an EMP blast that stuns its squad 2s and halves their shields. +50% damage.', 'convert=3', 'convertLife=20', 'hackEvery=7', 'convertEmp=2', 'dmg*1.5'),
    ], true),
    path('ARSENAL', '#ff3355', [
      tier('Heavy Rounds', 330, '+60% damage.', 'dmg*1.6'),
      tier('Autoloader', 620, '+65% fire rate.', 'rate*1.65'),
      tier('Rail Cannons', 1450, 'Rounds punch through armor and each cannon tracks its own target; +55% damage, +0.6 range.', 'pierceArmor', 'targets=2', 'dmg*1.55', 'range+0.6'),
      tier('Hellfire Pods', 3100, 'Every 2.5s a salvo of 4 micro-missiles (2x damage, splash) at enemies in range; +30% damage.', 'missiles=4', 'missileEvery=2.5', 'missileDmg=2', 'dmg*1.3'),
      tier('ANNIHILATION MODE', 8200, 'Plasma cannons and 8-missile barrages: x2.5 damage, +40% fire rate, +50% vs bosses.', 'dmg*2.5', 'rate*1.4', 'missiles=8', 'bossMul=1.5', 'range+0.5'),
    ]),
    path('TRAPPER', '#ffb000', [
      tier('Mine Layer', 330, 'Plants a proximity mine on the road in range every 5s (up to 3 armed).', 'mines=3', 'mineEvery=5', 'mineDmg=195'),
      tier('Snare Mines', 620, 'Blasts snare what survives (-50% speed, 2.5s); a mine every 4s, up to 5; +30% damage.', 'mineSlow=0.5', 'mines=5', 'mineEvery=4', 'mineDmg*1.3'),
      tier('EMP Traps', 1450, 'Every 3rd trap is an EMP: stuns everything nearby 2s and strips half its shield. A trap every 3s, up to 6; +80% damage.', 'empTrap=3', 'mineEvery=3', 'mines=6', 'mineDmg*1.8'),
      tier('Cluster Mines', 3100, 'Mines burst into 4 bomblets; x2.2 damage; up to 8 armed.', 'mineCluster=4', 'mineDmg*2.2', 'mines=8'),
      tier('KILL ZONE', 7800, 'Every blast leaves a lethal field for 6s; a trap every 2s, up to 10; +60% damage.', 'mineZone=6', 'mineEvery=2', 'mines=10', 'mineDmg*1.6'),
    ]),
  ],
};
// Hull and knock-out: enemies shoot back (ENEMIES[].atk) at a share of their own hull; the hero's hull grows with
// its rank and upgrades.
export const HERO_RULES = {
  bodyR: 0.4, // tiles: how far out its hull counts for enemy fire
  regen: 0.04, regenDelay: 3, // share of max hull per second, after this long untouched
  hpPerRank: 0.15, hpPerTier: 0.08,
  xpScale: 2.5, // it racks up XP like no single tower does: ranks take this much more
  downTime: 15, rebootTime: 1.7,
  convertZap: 0.6, convertZapEvery: 0.6, convertRange: 1.6, convertBlast: 1.0, // shares of the convert's own hull
  hackColor: '#39ff14', trapColor: '#ffb000', missileColor: '#ff8a00',
};

function parseMod(str) {
  const m = /^(\w+)(?:([*+=])(.+))?$/.exec(str);
  if (!m) throw new Error(`bad mod ${str}`);
  const [, key, op = '=', raw = 'true'] = m;
  const val = raw === 'true' ? true : Number(raw);
  return { key, op, val };
}

for (const def of [...Object.values(TOWERS), HERO]) {
  for (const p of def.paths) for (const t of p.tiers) t.mods = t.mods.map(parseMod);
  for (const v of def.variants || []) v.mods = v.mods.map(parseMod);
}

// The variant object for id `id` (the tower's first variant when unset), or null for towers without variants.
export const variantOf = (def, id) => (def.variants ? def.variants.find((v) => v.id === id) || def.variants[0] : null);

// What a tower can shoot at, given its stats (upgrades like Air-Burst Fuse) and variant.
export function targetsOf(def, s, variant = null) {
  if (variant) return { air: variant.hits === 'air', ground: variant.hits === 'ground' };
  return { air: !!(def.air || s.air), ground: !!def.ground };
}

// `rank` (0-5) adds the tower's veterancy bonus on top of its upgrades; `variant` its variant's mods.
export function computeStats(def, tiers, rank = 0, variant = null) {
  const s = { ...STAT_DEFAULTS, ...def.base };
  const apply = (mods) => {
    for (const { key, op, val } of mods) {
      if (op === '*') s[key] *= val;
      else if (op === '+') s[key] += val;
      else s[key] = val;
    }
  };
  def.paths.forEach((p, pi) => { for (let i = 0; i < tiers[pi]; i++) apply(p.tiers[i].mods); });
  if (variant) apply(variant.mods);
  if (rank) {
    if (s.dmg) s.dmg *= 1 + VET.dmg * rank;
    if (s.rate) s.rate *= 1 + VET.rate * rank;
    if (s.buffDmg) { s.buffDmg += VET.buff * rank; s.buffRate += VET.buff * 0.5 * rank; }
  }
  return s;
}

// Veterancy: towers earn XP for the share of each enemy's hull they strip (weighted by its bounty); Cryo also for
// every enemy it chills, and an Uplink takes a cut of what the towers it buffs earn. Each rank adds damage and rate.
export const VET = {
  xp: [50, 180, 450, 1000, 2000], // XP needed for ranks I-V
  dmg: 0.05, rate: 0.03, buff: 0.02,
  names: ['', 'BLOODED', 'VETERAN', 'ELITE', 'ACE', 'LEGEND'],
  numerals: ['', 'I', 'II', 'III', 'IV', 'V'],
};

// Status combos: two effects from different towers meeting on one enemy.
export const REACTIONS = {
  thermal: { name: 'THERMAL SHOCK', color: '#ffb070', desc: 'Fire meets cold: igniting a chilled enemy (or chilling a burning one) bursts for 12% of its max hull (4% on bosses) and cracks its armor for 3s.' },
  superconduct: { name: 'SUPERCONDUCT', color: '#9fe8ff', desc: 'A Tesla arc through a chilled enemy deals +50% and jumps on without losing power.' },
  overload: { name: 'OVERLOAD', color: '#ffd23c', desc: 'A Tesla arc through a burning enemy detonates the rest of the burn at once, splashing its neighbours.' },
  exposed: { name: 'EXPOSED', color: '#ff3355', desc: 'A Railgun slug crits (×1.5) on an enemy whose armor is stripped (Armor Shred, ICE Breaker, cracked).' },
  fracture: { name: 'FRACTURE', color: '#bfe3ff', desc: 'A plasma blast on a frozen enemy deals double damage and shatters the ice.' },
};

// Crosspath rule: <= 2 paths in use, and only one path beyond tier 2.
export function canUpgradePath(tiers, p) {
  if (tiers[p] >= 5) return false;
  if (tiers[p] === 0 && tiers.filter((v, i) => i !== p && v > 0).length >= 2) return false;
  if (tiers[p] >= 2 && tiers.some((v, i) => i !== p && v > 2)) return false;
  return true;
}

// `atk`: return fire at the hero (the only unit enemies shoot at): anything within `range` tiles that it can see gets
// `dps` x its own max hull per second (so it keeps pace with the waves), in one shot a second.
export const ENEMIES = {
  runner: {
    name: 'STREET RUNNER', hp: 55, speed: 1.35, reward: 7, lives: 3, radius: 0.33, color: '#ff8a00', atk: { range: 1.7, dps: 0.012 },
    desc: 'Chrome-augmented street punk. Standard threat.',
  },
  drone: {
    name: 'HUNTER DRONE', hp: 28, speed: 1.9, reward: 5, lives: 2, radius: 0.32, color: '#00f0ff', flying: true, atk: { range: 1.8, dps: 0.014 },
    desc: 'Fast and airborne: leaves the gate with the rest but cuts across the road\'s corners, over the low blocks. Plasma Mortars cannot hit it.',
  },
  brute: {
    name: 'HEAVY MECH', hp: 240, speed: 0.75, reward: 18, lives: 12, radius: 0.5, armor: 6, color: '#ff3355', atk: { range: 2.3, dps: 0.01 },
    desc: 'Armored walker. Armor blunts every hit — Railguns ignore it.',
  },
  aegis: {
    name: 'AEGIS UNIT', hp: 90, shield: 130, speed: 1.05, reward: 15, lives: 4, shieldLives: 4, radius: 0.42, color: '#3d8bff', atk: { range: 1.9, dps: 0.012 },
    desc: 'Regenerating energy shield. Tesla Coils and EMP shred shields; Railgun slugs do only half to them.',
  },
  phantom: {
    name: 'PHANTOM', hp: 75, speed: 1.6, reward: 13, lives: 4, radius: 0.33, color: '#a855ff', cloaked: true, atk: { range: 1.2, dps: 0.02 },
    desc: 'Permanent optical camo: invisible to towers without camo detection unless inside a Netrunner Uplink field or stunned. Splash & slow still hit it.',
  },
  splitter: {
    name: 'REPLICATOR', hp: 140, speed: 1.0, reward: 10, lives: 4, radius: 0.44, color: '#39ff14', atk: { range: 1.0, dps: 0.014 },
    splits: { type: 'mite', count: 3 },
    desc: 'Self-replicating nanoswarm. Bursts into three Nano-Mites when destroyed.',
  },
  mite: {
    name: 'NANO-MITE', hp: 30, speed: 1.8, reward: 2, lives: 1, radius: 0.22, color: '#39ff14', hidden: true, atk: { range: 0.9, dps: 0.025 },
    desc: 'Tiny self-replicated crawler released when a Replicator is destroyed.',
  },
  medic: {
    name: 'PATCH DRONE', hp: 110, speed: 1.1, reward: 16, lives: 5, radius: 0.38, color: '#e8f6ff', flying: true,
    heal: { rate: 14, radius: 1.6 },
    desc: 'Airborne field repair drone. Continuously heals everything near it — kill it first. Plasma Mortars cannot hit it.',
  },
  jammer: {
    name: 'SIGNAL JAMMER', hp: 150, speed: 0.95, reward: 18, lives: 5, radius: 0.4, armor: 2, color: '#ff2a6a', flying: true,
    jam: { radius: 1.8 },
    desc: 'Airborne ECM drone. Every tower under its field goes dark until it leaves, dies or is stunned. Plasma Mortars cannot hit it.',
  },
  courier: {
    name: 'DATA COURIER', hp: 70, speed: 1.75, reward: 12, lives: 0, radius: 0.33, color: '#3dffc5',
    courier: { packet: 8, carrySpeed: 0.8 },
    desc: 'Fast data thief. It grabs a packet at the core and runs back out: integrity is only lost if it escapes.',
  },
  // Bosses: `phases` are the "skull" thresholds (fraction of hull) where the boss triggers its phase ability.
  titan: {
    name: 'TITAN WARFRAME', hp: 1900, speed: 0.5, reward: 250, lives: 35, radius: 0.85, armor: 10, color: '#ff2bd6', boss: true, atk: { range: 3.6, dps: 0.005 },
    phases: [0.66, 0.33], phaseName: 'SIEGE PROTOCOL',
    // Variant buffs it adapts at each skull (bosses gain them mid-fight: see Enemy.applyMod).
    phaseBuffs: [['hardened', 'insulated'], ['mirror', 'repair', 'warded']],
    phaseDesc: 'At each skull it vents an EMP that knocks out towers within 3 tiles for 3.5s, surges forward and adapts: first HARDENED and INSULATED, then MIRROR-PLATED, SELF-REPAIR and a WARDED shield.',
    desc: 'Corporate siege frame. Massive armor plating. A breach costs 35 core integrity.',
  },
  overmind: {
    name: 'OVERMIND', hp: 4000, shield: 1400, speed: 0.42, reward: 600, lives: 80, shieldLives: 30, radius: 1.0, armor: 12, color: '#ffe600', boss: true, atk: { range: 4.0, dps: 0.003 },
    spawns: { type: 'drone', every: 3.5, count: 3 },
    phases: [0.75, 0.5, 0.25], phaseName: 'ROGUE PROTOCOL',
    phaseBuffs: [['hardened', 'mirror'], ['insulated'], ['repair']],
    phaseDesc: 'At each skull it hijacks your two most valuable towers nearby, then: calls a cloaked escort, reboots its shield to 60%, overclocks itself. It adapts every time: HARDENED + MIRROR-PLATED, then INSULATED, then SELF-REPAIR.',
    desc: 'Rogue AI core. Shielded, armored, and launches drone swarms. Stop it at all costs.',
  },
};

// Campaign (waves 1-80): exponential hull growth, gentle in absolute terms early and steep late (Bloons-style: the early
// acts are for building up, the last one is the test). Endless (81+): logarithmic growth from the wave-80 level, each wave harder by a little less.
export const CAMPAIGN_WAVES = 80;
// ~6.7% more hull per wave: x4.5 by wave 20, x16 by 40, x60 by 60, x220 by 80.
const campaignHp = (wave) => 1.3 * Math.exp(0.065 * (wave - 1));
export const endlessLog = (wave) => Math.log(1 + Math.max(0, wave - CAMPAIGN_WAVES) / 10);
export const hpMultiplier = (wave) => campaignHp(Math.min(wave, CAMPAIGN_WAVES)) * (1 + 0.8 * endlessLog(wave));
// Bounties grow with the wave (Enemy.reward), but much more slowly than hull. Like Bloons' cash-per-pop cuts, they
// drop after wave 50 and again after 60, so the last act is fought with the defense built so far, not bought mid-wave.
export const rewardScale = (wave) => {
  const w = Math.min(wave, CAMPAIGN_WAVES);
  return (1 + 0.02 * (w - 1)) * (w > 60 ? 0.35 : w > 50 ? 0.6 : 1);
};
export const waveBonus = (wave) => 30 + 6 * Math.min(wave, CAMPAIGN_WAVES);
export const earlyBonus = (wave) => 10 + 3 * wave;
export const SELL_RATIO = 0.7;

export const ABILITIES = {
  emp: {
    name: 'EMP BURST', key: 'Q', cd: 40, radius: 2.6, stun: 2.5, color: '#00f0ff', targeted: true,
    desc: 'Stuns enemies in an area and wipes their shields.',
  },
  orbital: {
    name: 'ORBITAL STRIKE', key: 'W', cd: 65, radius: 1.5, delay: 0.9, color: '#ff2bd6', targeted: true,
    dmg: (wave) => 300 + 200 * hpMultiplier(wave), // keeps pace with enemy hull
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
    id: 'sector7', name: 'SECTOR 7', subtitle: 'Downtown Grid', diff: 0.50, credits: 380, lives: 100,
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
    id: 'docks', name: 'NEON DOCKS', subtitle: 'Harbor Freight Zone', diff: 0.58, credits: 430, lives: 100,
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
    id: 'nexus', name: 'CORE NEXUS', subtitle: 'Arcology Mainframe', diff: 0.42, credits: 500, lives: 100,
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

// Enemy variants. The first three are resistances (each blunts one kind of tower), the rest show up as endless-mode
// mutators. Any non-boss enemy can carry them; a variant wears its color on its neon.
export const MODS = {
  mirror: { name: 'MIRROR-PLATED', glyph: 'M', color: '#e8f6ff', desc: 'Chrome plating: Pulse Lasers deal half damage.', voice: 'variant_mirror' },
  insulated: { name: 'INSULATED', glyph: 'I', color: '#ffb000', desc: "Grounded hull: Tesla arcs deal half damage and can't chain on through it.", voice: 'variant_insulated' },
  thermal: { name: 'HEAT-SINKED', glyph: 'T', color: '#ff5a1f', desc: 'Regulated core: immune to chill, freeze and burn (no fire or ice combos).', voice: 'variant_thermal' },
  hardened: { name: 'HARDENED', glyph: 'H', color: '#ff3355', desc: '+50% hull and +3 armor.' },
  amped: { name: 'AMPED', glyph: 'A', color: '#00f0ff', desc: 'Overclocked servos: +30% speed.' },
  repair: { name: 'SELF-REPAIR', glyph: 'R', color: '#39ff14', desc: 'Regenerates 4% of its hull per second after 1.5s without taking damage.' },
  warded: { name: 'WARDED', glyph: 'W', color: '#5aa0ff', desc: 'Carries a regenerating energy shield worth half its hull.' },
  ghosted: { name: 'GHOSTED', glyph: 'G', color: '#a855ff', desc: 'Permanent optical camo, like a Phantom.' },
};

// A wave group: `mods` is an optional variant (string) or list of variants applied to every enemy in it.
const g = (type, count, gap, delay = 0, mods = null) => ({ type, count, gap, delay, mods: mods ? [].concat(mods) : null });

// The campaign, in four acts of 20 waves (designed like Bloons TD's 80 rounds). Every act ends on a boss milestone, and
// between them each threat and variant gets its own debut wave before it's mixed in. Rush waves (a crowd of light
// units: tests coverage) alternate with tank waves (a few heavies: tests single-target) and specialist waves (camo,
// air, shields, splitters), with a breather after every boss.
//   I   STREET LEVEL     1-20  one new enemy at a time: flyers 3, armor 6, shields 9, Replicators 11, camo 14,
//                              healers 17. First Titan at 20.
//   II  CORPORATE PUSH  21-40  couriers 22, jammers 26 and the three resistances (Mirror 28, like Bloons' first lead
//                              on 28; Insulated 32; Heat-Sinked 36). Titan at 30, twin Titans at 40.
//   III BLACK ICE       41-60  the mutators one by one: Hardened 42, Warded 45, Amped 48, Self-Repair 52, Ghosted 56.
//                              Two Titans at 50; the first Overmind at 60.
//   IV  SINGULARITY     61-80  stacked variants and dense rushes: the Replicator rush at 63 (Bloons' round 63), an
//                              armored wall at 76, the hardest regular wave at 78, then the finale: two Overminds and
//                              three Titans at 80.
export const WAVES = [
  // ---- I STREET LEVEL
  /* 1 */[g('runner', 8, 1.3)],
  /* 2 */[g('runner', 12, 1.0)],
  /* 3 */[g('runner', 10, 1.0), g('drone', 5, 1.0, 5)],
  /* 4 */[g('runner', 16, 0.75)],
  /* 5 */[g('drone', 12, 0.6), g('runner', 8, 0.9, 4)],
  /* 6 */[g('runner', 16, 0.65), g('brute', 1, 1, 8)],
  /* 7 */[g('drone', 14, 0.5), g('runner', 12, 0.6, 3)],
  /* 8 */[g('brute', 3, 3), g('runner', 16, 0.5, 2)],
  /* 9 */[g('aegis', 5, 1.6), g('runner', 10, 0.7, 3)],
  /* 10 */[g('runner', 28, 0.35), g('drone', 10, 0.5, 6)],
  /* 11 */[g('splitter', 5, 2), g('drone', 8, 0.6, 5)],
  /* 12 */[g('aegis', 8, 1.2), g('brute', 3, 2.5, 5)],
  /* 13 */[g('drone', 22, 0.35), g('runner', 10, 0.6, 4)],
  /* 14 */[g('phantom', 7, 1.3), g('runner', 12, 0.6, 3)],
  /* 15 */[g('splitter', 8, 1.3), g('aegis', 6, 1.2, 5)],
  /* 16 */[g('brute', 5, 2), g('phantom', 10, 0.9, 4)],
  /* 17 */[g('medic', 2, 5), g('runner', 16, 0.5, 1), g('brute', 4, 2.4, 3)],
  /* 18 */[g('drone', 24, 0.35), g('aegis', 10, 1, 4)],
  /* 19 */[g('splitter', 10, 1), g('phantom', 12, 0.8, 4), g('medic', 3, 4, 6)],
  /* 20 */[g('titan', 1, 1, 6), g('runner', 20, 0.5), g('drone', 10, 0.6, 10)],
  // ---- II CORPORATE PUSH
  /* 21 */[g('runner', 30, 0.35), g('drone', 12, 0.5, 5)],
  /* 22 */[g('courier', 5, 1.5), g('runner', 16, 0.5, 2)],
  /* 23 */[g('brute', 8, 1.8), g('medic', 3, 4, 3)],
  /* 24 */[g('aegis', 16, 0.8), g('phantom', 8, 1, 6)],
  /* 25 */[g('drone', 28, 0.3), g('splitter', 8, 1.2, 5)],
  /* 26 */[g('jammer', 2, 5), g('brute', 6, 2, 2), g('runner', 16, 0.5, 4)],
  /* 27 */[g('splitter', 14, 0.9), g('aegis', 8, 1, 5), g('courier', 5, 1.2, 8)],
  /* 28 */[g('brute', 8, 1.8, 0, 'mirror'), g('runner', 20, 0.45, 3)],
  /* 29 */[g('phantom', 16, 0.6), g('medic', 4, 3, 3)],
  /* 30 */[g('titan', 1, 1, 5), g('aegis', 12, 0.9), g('drone', 14, 0.5, 8)],
  /* 31 */[g('runner', 36, 0.28), g('drone', 16, 0.35, 5)],
  /* 32 */[g('aegis', 12, 0.9, 0, 'insulated'), g('brute', 6, 2, 4)],
  /* 33 */[g('splitter', 16, 0.8), g('jammer', 3, 4, 3), g('courier', 6, 1, 6)],
  /* 34 */[g('drone', 24, 0.35, 0, 'mirror'), g('phantom', 12, 0.7, 4)],
  /* 35 */[g('brute', 12, 1.3), g('medic', 5, 2.8, 2), g('aegis', 10, 0.9, 6)],
  /* 36 */[g('runner', 20, 0.45, 0, 'thermal'), g('splitter', 14, 0.8, 4)],
  /* 37 */[g('aegis', 16, 0.7), g('brute', 10, 1.4, 3, 'mirror'), g('jammer', 3, 4, 6)],
  /* 38 */[g('phantom', 28, 0.4), g('courier', 8, 0.9, 6)],
  /* 39 */[g('drone', 24, 0.35), g('brute', 14, 1.1, 3), g('medic', 5, 2.5, 5), g('jammer', 3, 4, 8)],
  /* 40 */[g('titan', 2, 12, 5), g('aegis', 18, 0.7), g('courier', 8, 1, 10)],
  // ---- III BLACK ICE
  /* 41 */[g('runner', 40, 0.25), g('drone', 20, 0.3, 4)],
  /* 42 */[g('brute', 10, 1.5, 0, 'hardened'), g('aegis', 12, 0.9, 4)],
  /* 43 */[g('splitter', 18, 0.7, 0, 'mirror'), g('medic', 5, 2.5, 4)],
  /* 44 */[g('aegis', 24, 0.55, 0, 'insulated'), g('jammer', 4, 3.5, 3)],
  /* 45 */[g('runner', 24, 0.4, 0, 'warded'), g('phantom', 12, 0.7, 5, 'warded')],
  /* 46 */[g('drone', 36, 0.25), g('medic', 6, 2.2, 3), g('courier', 8, 0.9, 6)],
  /* 47 */[g('brute', 14, 1.1, 0, ['mirror', 'warded']), g('splitter', 12, 0.8, 5)],
  /* 48 */[g('runner', 30, 0.3, 0, 'amped'), g('phantom', 14, 0.6, 4, 'amped')],
  /* 49 */[g('splitter', 16, 0.7, 0, 'thermal'), g('aegis', 18, 0.6, 4), g('jammer', 4, 3.5, 6)],
  /* 50 */[g('titan', 2, 10, 5), g('brute', 16, 1, 0, 'hardened'), g('drone', 20, 0.35, 8)],
  /* 51 */[g('phantom', 36, 0.35), g('medic', 8, 2, 4)],
  /* 52 */[g('brute', 18, 1, 0, 'repair'), g('aegis', 18, 0.6, 4)],
  /* 53 */[g('drone', 44, 0.22), g('jammer', 5, 3, 3)],
  /* 54 */[g('splitter', 22, 0.55, 0, 'hardened'), g('courier', 10, 0.8, 5)],
  /* 55 */[g('aegis', 20, 0.6, 0, 'warded'), g('brute', 16, 1, 3, 'insulated'), g('medic', 8, 2, 6)],
  /* 56 */[g('runner', 30, 0.3, 0, 'ghosted'), g('courier', 10, 0.8, 5, 'ghosted')],
  /* 57 */[g('brute', 20, 0.8, 0, 'mirror'), g('aegis', 20, 0.8, 2, 'insulated'), g('jammer', 5, 3, 6)],
  /* 58 */[g('phantom', 36, 0.3, 0, 'amped'), g('medic', 8, 2, 5)],
  /* 59 */[g('brute', 24, 0.8, 0, 'hardened'), g('drone', 30, 0.3, 3, 'mirror'), g('medic', 8, 2, 6), g('jammer', 5, 3, 9)],
  /* 60 */[g('overmind', 1, 1, 6), g('aegis', 24, 0.6), g('runner', 24, 0.4, 12)],
  // ---- IV SINGULARITY
  /* 61 */[g('runner', 50, 0.2, 0, 'amped'), g('drone', 24, 0.3, 4)],
  /* 62 */[g('brute', 24, 0.8, 0, 'warded'), g('medic', 10, 1.8, 3)],
  /* 63 */[g('splitter', 30, 0.4), g('aegis', 20, 0.6, 6)],
  /* 64 */[g('aegis', 30, 0.45, 0, 'mirror'), g('jammer', 6, 3, 3)],
  /* 65 */[g('titan', 3, 8, 4), g('phantom', 30, 0.4, 0, 'warded')],
  /* 66 */[g('drone', 44, 0.22, 0, 'amped'), g('medic', 10, 1.8, 3), g('courier', 12, 0.7, 6)],
  /* 67 */[g('brute', 26, 0.7, 0, ['mirror', 'hardened']), g('splitter', 16, 0.6, 4, 'thermal')],
  /* 68 */[g('phantom', 44, 0.28, 0, 'amped'), g('jammer', 6, 3, 4)],
  /* 69 */[g('aegis', 30, 0.45, 0, ['insulated', 'warded']), g('splitter', 18, 0.5, 5, 'mirror')],
  /* 70 */[g('overmind', 1, 1, 5), g('titan', 2, 10, 12), g('aegis', 20, 0.6)],
  /* 71 */[g('runner', 60, 0.18, 0, ['amped', 'warded']), g('drone', 30, 0.25, 4, 'mirror')],
  /* 72 */[g('brute', 30, 0.6, 0, 'repair'), g('medic', 12, 1.6, 3), g('jammer', 8, 2.5, 6)],
  /* 73 */[g('drone', 50, 0.2, 0, ['mirror', 'amped']), g('phantom', 30, 0.35, 4, 'warded')],
  /* 74 */[g('splitter', 24, 0.45, 0, 'hardened'), g('aegis', 30, 0.45, 3, 'insulated')],
  /* 75 */[g('titan', 4, 6, 4), g('brute', 24, 0.8, 0, 'mirror')],
  /* 76 */[g('brute', 36, 0.55, 0, ['mirror', 'warded']), g('aegis', 36, 0.55, 2, 'insulated')],
  /* 77 */[g('phantom', 50, 0.25, 0, 'amped'), g('courier', 16, 0.6, 5, 'ghosted'), g('jammer', 8, 2.5, 8)],
  /* 78 */[g('brute', 40, 0.5, 0, 'hardened'), g('splitter', 24, 0.5, 2, ['mirror', 'thermal']), g('medic', 12, 1.6, 4), g('jammer', 8, 2.5, 8)],
  /* 79 */[g('drone', 60, 0.18, 0, 'amped'), g('aegis', 30, 0.5, 3, 'warded'), g('medic', 12, 1.6, 6)],
  /* 80 */[g('overmind', 2, 20, 6), g('titan', 3, 8, 14), g('aegis', 30, 0.5, 0, 'mirror'), g('brute', 30, 0.6, 8, 'insulated')],
];

const ENDLESS_POOL = ['runner', 'drone', 'brute', 'aegis', 'phantom', 'splitter', 'medic', 'jammer', 'courier'];
const MUTATOR_POOL = ['hardened', 'amped', 'repair', 'warded', 'ghosted', 'mirror', 'insulated', 'thermal'];

// Endless waves roll mutators: one from wave 81, two from wave 90. Deterministic per wave number.
export function endlessMutators(n) {
  if (n <= WAVES.length) return [];
  let s = n * 7919 + 104729;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pool = [...MUTATOR_POOL];
  const out = [];
  for (let i = 0; i < (n >= CAMPAIGN_WAVES + 10 ? 2 : 1); i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

// Deterministic generator for waves past the scripted campaign.
export function endlessWave(n) {
  let s = n * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const groups = [];
  const k = 3 + Math.floor(rnd() * 2);
  const muts = endlessMutators(n);
  for (let i = 0; i < k; i++) {
    const type = ENDLESS_POOL[Math.floor(rnd() * ENDLESS_POOL.length)];
    // Starting sizes match the last act's groups.
    const base = { runner: 50, drone: 45, brute: 26, aegis: 30, phantom: 40, splitter: 22, medic: 10, jammer: 6, courier: 14 }[type];
    // Group sizes, spawn density and boss counts grow on the same logarithmic curve as enemy health.
    const grow = 1 + 0.9 * endlessLog(n);
    // Mutators land on most groups (always the first); Phantoms are already cloaked.
    const mods = muts.filter((m) => (i === 0 || rnd() < 0.6) && !(m === 'ghosted' && type === 'phantom'));
    groups.push(g(type, Math.round(base * grow), Math.max(0.16, 0.5 / grow), i * 3, mods.length ? mods : null));
  }
  if (n % 5 === 0) groups.push(g(n % 10 === 0 ? 'overmind' : 'titan', 2 + Math.floor(Math.log2(1 + (n - CAMPAIGN_WAVES) / 10)), 6, 5));
  return groups;
}

import { MAPS, TOWERS, TOWER_ORDER, ENEMIES, ABILITIES, MODS, VET, REACTIONS, TILE, W, H, computeStats, endlessMutators } from './config.js';
import { Game, footprintAnchor, coreDamage, AIR_HEAT_WEIGHT } from './game.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';
import { AssetLibrary } from './assets3d.js';
import { AudioManager } from './audio.js';
import { TitleFx } from './titlefx.js';

const $ = (sel) => document.querySelector(sel);
const SAVE_KEY = 'neonbreach.save';
const MODES = [['first', 'FIRST'], ['last', 'LAST'], ['strong', 'STRONG'], ['close', 'CLOSE']];
// Mortars and Railguns can also hold a manual aim: a ground spot / a firing line (G sets it).
const AIM_MODE = ['aim', 'AIM'];
const modesFor = (t) => (t.aimable ? [...MODES, AIM_MODE] : MODES);
const ABILITY_ICONS = { emp: '⌁', orbital: '✦', overclock: '⚡' };
// Portraits rendered from the 3D models in Blender (tools/blender/render_icons.py).
const towerIcon = (t) => `assets/icons/tower_${t}.webp`;
const enemyIcon = (t) => `assets/icons/${ENEMIES[t].boss ? 'boss' : 'enemy'}_${t}.webp`;

const audio = new AudioManager();
const titleFx = new TitleFx($('#bgfx'));
// The 2D renderer now only draws level-select minimaps; gameplay renders in 3D.
const renderer = new Renderer(document.createElement('canvas'));
const r3d = new Renderer3D($('#game'), $('#overlay'), null);
const assets = new AssetLibrary(r3d.renderer);
r3d.assets = assets;
const assetsReady = assets.loadAll((k) => {
  $('#loadbar-fill').style.width = `${Math.round(k * 100)}%`;
  $('#loadbar-text').textContent = k < 1 ? `LOADING 3D ASSETS ${Math.round(k * 100)}%` : 'SYSTEMS ONLINE';
  if (k >= 1) $('#loadbar').classList.add('done');
});

let save = { maps: {} };
try { save = { maps: {}, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch { /* fresh save */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage blocked */ } };

// Gameplay & display settings (audio levels live in the AudioManager).
const SETTINGS_KEY = 'neonbreach.settings';
const settings = { autoStart: false, intros: true, heatmap: true, shake: 1, crt: true, texts: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* defaults */ }
function applySettings() {
  Object.assign(r3d.settings, { shake: settings.shake, texts: settings.texts, heatmap: settings.heatmap });
  document.querySelector('.crt')?.classList.toggle('off', !settings.crt);
  $('#btn-auto')?.classList.toggle('on', settings.autoStart);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
}

let game = null;
let screen = 'title';
let speed = 1;
let paused = false;
let modalOpen = false;
let autoT = 0; // countdown to an auto-launched wave
let introWave = 0; // last wave whose boss got an intro
let pendingIntro = null; // boss waiting to clear its spawn portal before the intro starts
// `aiming`: the Mortar / Railgun whose manual aim the next click sets.
const ui = { hover: null, placing: null, selected: null, selectedEnemy: null, ability: null, shift: false, previewPath: null, aiming: null };

// ---------------------------------------------------------------- screens
function show(name) {
  screen = name;
  if (name !== 'game') { $('#comms').classList.remove('show'); $('#cine').classList.remove('show'); }
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  $('#bgfx').style.display = name === 'game' ? 'none' : 'block';
  if (name !== 'game') audio.playMusic('menu');
  if (name === 'levels') buildLevelCards();
  if (name === 'game') requestAnimationFrame(fitCanvas);
}

document.addEventListener('pointerdown', () => {
  audio.unlock();
  $('#audio-hint').classList.add('gone');
  if (screen !== 'game') audio.playMusic('menu');
}, { capture: true });

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  audio.play('click');
  const a = btn.dataset.action;
  if (a === 'play') show('levels');
  else if (a === 'back') show('title');
  else if (a === 'howto') showHowTo();
  else if (a === 'settings') showSettings();
});
// Keep keyboard shortcuts (Space especially) from re-triggering whichever button was clicked last.
document.addEventListener('pointerup', () => {
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
});
document.addEventListener('pointerover', (ev) => {
  if (ev.target.closest?.('.btn, .shop-item, .level-card, .ability')) audio.play('hover');
});

// ---------------------------------------------------------------- level select
function buildLevelCards() {
  const wrap = $('#level-cards');
  wrap.innerHTML = '';
  MAPS.forEach((map, i) => {
    const rec = save.maps[map.id] || {};
    const card = document.createElement('div');
    card.className = 'level-card';
    card.style.setProperty('--accent', map.theme.path);
    const stars = [0, 1, 2].map((k) => `<span class="${k < (rec.stars || 0) ? '' : 'off'}">★</span>`).join('');
    card.innerHTML = `
      <canvas width="480" height="280"></canvas>
      <h3>${map.name}</h3>
      <div class="sub">${map.subtitle} · ${map.paths.length} breach point${map.paths.length > 1 ? 's' : ''}</div>
      <div class="meta">
        <span class="diff" style="color:${map.theme.path}">${map.difficulty}</span>
        <span class="stars">${stars}</span>
      </div>
      <div class="meta"><span style="color:var(--dim)">BEST WAVE</span><span>${rec.best || 0}${rec.endless ? ` · ENDLESS ${rec.endless}` : ''}</span></div>`;
    const cv = card.querySelector('canvas');
    const preview = new Game(i);
    const bg = renderer.renderBackground(preview);
    const g = cv.getContext('2d');
    g.drawImage(bg, 0, 0, cv.width, cv.height);
    g.strokeStyle = map.theme.path;
    g.lineWidth = 3;
    g.setLineDash([6, 8]);
    const sx = cv.width / W, sy = cv.height / H;
    for (const p of preview.paths) {
      g.beginPath();
      p.pts.forEach((pt, k) => g[k ? 'lineTo' : 'moveTo'](pt.x * sx, pt.y * sy));
      g.stroke();
    }
    card.addEventListener('click', () => { audio.play('click'); startGame(i); });
    wrap.appendChild(card);
  });
}

// ---------------------------------------------------------------- game lifecycle
async function startGame(mapIndex) {
  if (assets.progress < 1) {
    toast('LOADING 3D ASSETS…', '#00f0ff');
    await assetsReady;
  }
  let briefed = false; // a new-threat or variant line already covers this wave's callout
  const g = new Game(mapIndex, {
    // A tier-5 Overdrive laser (Photon Storm) is a rotary cannon: it rattles instead of zapping.
    sfx: (name, src) => audio.play(name === 'laser' && src?.tiers?.[0] === 5 ? 'gatling' : name, src),
    message: (text, kind) => toast(text, kind === 'bonus' ? '#ffe600' : '#00f0ff'),
    newThreat: (type) => {
      threatCard(type);
      if (!ENEMIES[type].boss) { audio.say(`threat_${type}`); briefed = true; }
    },
    newVariant: (mod) => {
      variantCard(mod);
      audio.say(MODS[mod].voice || 'mutators');
      briefed = true;
    },
    waveStart: (n, boss) => {
      banner(boss ? `WAVE ${n}` : `WAVE ${n}`, boss ? 'BOSS SIGNATURE DETECTED' : 'HOSTILES INBOUND', boss);
      audio.play(boss ? 'boss_warning' : 'wave_start');
      if (!boss && !briefed && Math.random() < 0.4) audio.say(`wave_start_${1 + Math.floor(Math.random() * 3)}`);
      briefed = false;
      buildNextWave();
    },
    waveClear: (n, bonus) => {
      toast(`WAVE ${n} NEUTRALIZED  +${bonus}¢`, '#39ff14');
      audio.play('wave_clear');
      if (Math.random() < 0.3) audio.say(`wave_clear_${1 + Math.floor(Math.random() * 2)}`);
    },
    leak: () => {
      if (game.lives > 0 && game.lives <= game.maxLives * 0.25) { toast('⚠ CORE INTEGRITY CRITICAL', '#ff3355'); audio.say('core_critical'); }
    },
    bossSpawn: (e) => {
      if (game === g && settings.intros && !g.endless && introWave !== g.wave) { introWave = g.wave; pendingIntro = e; }
    },
    bossPhase: (e, n) => {
      toast(`☠\uFE0E ${e.def.name} // ${e.def.phaseName} ${n}/${e.def.phases.length}`, e.def.color, 3200);
      audio.say(e.type === 'titan' ? 'phase_titan' : 'phase_overmind');
    },
    steal: () => { toast('⚠ DATA PACKET STOLEN — STOP THE COURIER', '#3dffc5'); audio.say('data_stolen'); },
    escape: (e) => { toast(`DATA PACKET LOST  −${e.def.courier.packet} INTEGRITY`, '#ff3355'); audio.say('data_escaped'); },
    recover: () => { toast('DATA PACKET RECOVERED', '#39ff14', 1800); audio.say('data_recovered'); },
    jammed: () => audio.say('jammed'),
    rankUp: (t) => { if (t.rank >= 3) toast(`${towerTitle(t)} PROMOTED // RANK ${VET.numerals[t.rank]} ${VET.names[t.rank]}`, '#ffe600', 2200); },
    end: (won) => {
      audio.say(won ? 'victory' : 'defeat');
      setTimeout(() => { if (game === g) endScreen(won); }, won ? 900 : 1400);
    },
  });
  game = g;
  ui.placing = null;
  ui.selected = null;
  ui.ability = null;
  paused = false;
  autoT = 0;
  introWave = 0;
  pendingIntro = null;
  audio.clearVoice();
  setSpeed(1);
  $('#hud-maxlives').textContent = game.maxLives;
  $('#toasts').innerHTML = '';
  show('game');
  fitCanvas();
  r3d.setGame(game);
  r3d.homeView();
  buildShop();
  buildAbilities();
  buildNextWave();
  renderInfo(true);
  audio.playMusic('battle');
  toast(`${game.map.name} // PLACE DEFENSES, THEN LAUNCH WAVE`, game.map.theme.accent);
  if (!save.briefed) { save.briefed = true; persist(); audio.say('start'); }
  updateBossBars(true);
}

// Boss intro: once the boss has stepped out of its portal, the camera flies to it while a name card shows and the
// simulation runs in slow motion.
function checkIntro() {
  const e = pendingIntro;
  if (!e) return;
  if (e.dead || game.state === 'lost') { pendingIntro = null; return; }
  if (e.dist < 1.4 * TILE) return;
  pendingIntro = null;
  bossIntro(e);
}

function bossIntro(e) {
  const d = e.def;
  const cine = $('#cine');
  cine.style.setProperty('--c', d.color);
  $('#cc-name').textContent = d.name;
  $('#cc-desc').textContent = d.desc;
  $('#cc-phase').innerHTML = `${'☠\uFE0E '.repeat(d.phases.length)}<b>${d.phaseName}</b><br>${d.phaseDesc}`;
  ui.placing = null;
  ui.ability = null;
  r3d.startCinematic(e);
  cine.classList.add('show');
  audio.say(e.type === 'titan' ? 'boss_titan' : 'boss_overmind');
}

function skipIntro() {
  if (!r3d.cinematic) return false;
  r3d.skipCinematic();
  return true;
}

function recordProgress(won) {
  const rec = save.maps[game.map.id] || (save.maps[game.map.id] = {});
  rec.best = Math.max(rec.best || 0, Math.min(game.wave, game.totalWaves));
  if (game.endless) rec.endless = Math.max(rec.endless || 0, game.wave);
  if (won) {
    const stars = game.lives >= game.maxLives * 0.9 ? 3 : game.lives >= game.maxLives * 0.5 ? 2 : 1;
    rec.stars = Math.max(rec.stars || 0, stars);
  }
  persist();
}

function endScreen(won) {
  if (screen !== 'game' || !game) return;
  recordProgress(won);
  audio.play(won ? 'victory' : 'game_over');
  const stars = game.lives >= game.maxLives * 0.9 ? 3 : game.lives >= game.maxLives * 0.5 ? 2 : 1;
  const starHtml = won ? `<div class="end-stars stars">${[0, 1, 2].map((k) => `<span class="${k < stars ? '' : 'off'}">★</span>`).join('')}</div>` : '';
  const endlessNote = game.endless ? `<p>Endless run ended at wave <b>${game.wave}</b>.</p>` : '';
  const body = `
    ${starHtml}
    <p>${won ? 'The data core holds. Corporate forces have been repelled from ' + game.map.name + '.' : 'The data core has been breached. ' + game.map.name + ' is lost to the corps.'}</p>
    ${endlessNote}
    <div class="end-stats">
      <div><b>${game.wave}</b>WAVES</div>
      <div><b>${game.stats.kills}</b>KILLS</div>
      <div><b>${game.lives}</b>INTEGRITY</div>
      <div><b>${game.stats.earned}</b>¢ EARNED</div>
    </div>
    ${damageReport()}`;
  const buttons = [
    { label: 'LEVEL SELECT', action: () => { closeModal(); show('levels'); } },
    { label: 'RETRY', action: () => { closeModal(); startGame(game.mapIndex); } },
  ];
  if (won) buttons.push({ label: 'ENDLESS MODE ▶', primary: true, action: () => { closeModal(); game.continueEndless(); toast('ENDLESS MODE // SURVIVE AS LONG AS YOU CAN', '#ff2bd6'); audio.say('endless'); buildNextWave(); } });
  openModal(won ? 'CORE SECURED' : 'SYSTEM BREACHED', body, buttons, won ? 'win' : 'lose');
}

const fmtNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const chevrons = (rank) => '›'.repeat(rank);
// A tower's display name: its capstone once a path reaches tier 5.
const towerTitle = (t) => (Math.max(...t.tiers) === 5 ? t.def.paths[t.tiers.indexOf(5)].tiers[4].name : t.def.name);

// End-of-run breakdown: every tower that did damage (sold ones included), plus combos and data couriers.
function damageReport() {
  const rows = [...game.towers.map((t) => ({ type: t.type, tiers: t.tiers, rank: t.rank, dmg: t.dmgDealt, kills: t.kills, def: t.def })),
    ...game.retired.map((r) => ({ ...r, def: TOWERS[r.type] }))]
    .filter((r) => r.dmg > 0 || r.kills > 0).sort((a, b) => b.dmg - a.dmg);
  if (!rows.length) return '';
  const total = rows.reduce((a, r) => a + r.dmg, 0) || 1;
  const top = rows.slice(0, 8);
  const html = top.map((r, i) => {
    const title = Math.max(...r.tiers) === 5 ? r.def.paths[r.tiers.indexOf(5)].tiers[4].name : r.def.name;
    return `<div class="rep-row${r.sold ? ' sold' : ''}" style="--c:${r.def.color}">
      <img src="${towerIcon(r.type)}" alt="">
      <div class="rep-name">${title}${i === 0 ? '<span class="mvp">MVP</span>' : ''}<small>${r.tiers.join('-')}${r.rank ? ` · RANK ${VET.numerals[r.rank]}` : ''}${r.sold ? ' · SOLD' : ''}</small></div>
      <div class="rep-bar"><i style="width:${(r.dmg / top[0].dmg) * 100}%"></i></div>
      <b>${fmtNum(r.dmg)}<small>${Math.round((r.dmg / total) * 100)}% · ${r.kills} kill${r.kills === 1 ? '' : 's'}</small></b></div>`;
  }).join('');
  const st = game.stats;
  const combos = Object.entries(st.reactions).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span><b style="color:${REACTIONS[k].color}">${REACTIONS[k].name}</b> ×${fmtNum(n)}</span>`).join('');
  const data = st.stolen ? `<span>DATA PACKETS: ${st.stolen} stolen · ${st.recovered} recovered · <b style="color:${st.escaped ? 'var(--red)' : 'var(--green)'}">${st.escaped} lost</b></span>` : '';
  return `<h4>DAMAGE REPORT</h4><div class="report">${html}</div>
    ${combos ? `<div class="rep-sum">${combos}</div>` : ''}${data ? `<div class="rep-sum">${data}</div>` : ''}`;
}

// ---------------------------------------------------------------- boss bars
let bossKey = '';
function updateBossBars(force) {
  const wrap = $('#boss-bars');
  const bosses = game ? game.enemies.filter((e) => e.def.boss && !e.dead).slice(0, 3) : [];
  const key = bosses.map((e) => e.id).join(',');
  if (key !== bossKey || force) {
    bossKey = key;
    wrap.innerHTML = bosses.map((e) => `<div class="boss-bar" data-id="${e.id}" style="--c:${e.def.color}">
      <div class="bb-head"><span>${e.def.name}</span><small class="bb-skulls"></small></div>
      <div class="bb-track"><div class="bb-fill"></div>${e.def.phases.map((f) => `<i style="left:${f * 100}%"></i>`).join('')}</div>
      ${e.maxShield ? '<div class="bb-shield"><div></div></div>' : ''}</div>`).join('');
  }
  bosses.forEach((e, i) => {
    const el = wrap.children[i];
    if (!el) return;
    const fill = el.querySelector('.bb-fill');
    fill.style.width = `${Math.max(0, e.hp / e.maxHp) * 100}%`;
    fill.classList.toggle('phase', e.phaseT > 0);
    el.querySelectorAll('.bb-track i').forEach((tick, k) => tick.classList.toggle('done', k < e.phase));
    const skulls = e.def.phases.map((_, k) => `<span class="${k < e.phase ? 'done' : ''}">☠\uFE0E</span>`).join('');
    const sk = el.querySelector('.bb-skulls');
    if (sk.dataset.p !== String(e.phase)) { sk.dataset.p = String(e.phase); sk.innerHTML = `${skulls} ${fmtNum(Math.max(0, e.hp))}`; }
    else sk.lastChild.textContent = ` ${fmtNum(Math.max(0, e.hp))}`;
    const sh = el.querySelector('.bb-shield div');
    if (sh) sh.style.width = `${(e.shield / e.maxShield) * 100}%`;
  });
}

// ---------------------------------------------------------------- HUD
const hudCache = {};
function setText(id, value) {
  if (hudCache[id] === value) return;
  hudCache[id] = value;
  document.getElementById(id).textContent = value;
}

function updateHud() {
  setText('hud-credits', String(Math.floor(game.credits)));
  setText('hud-lives', String(game.lives));
  setText('hud-wave', String(game.wave));
  setText('hud-total', game.endless ? '∞' : String(game.totalWaves));
  setText('hud-enemies', String(game.enemies.length));
  const k = game.lives / game.maxLives;
  const bar = $('#hud-lives-bar');
  bar.style.width = `${k * 100}%`;
  bar.style.background = k > 0.5 ? 'var(--cyan)' : k > 0.25 ? 'var(--yellow)' : 'var(--red)';

  const btn = $('#btn-wave');
  let label, cls = '';
  if (game.state === 'won' || game.state === 'lost') { label = 'SIMULATION ENDED'; }
  else if (game.campaignDone) { label = 'FINAL WAVE ACTIVE'; }
  else if (game.busy && game.wave > 0) { label = `CALL WAVE ${game.wave + 1} EARLY`; cls = 'early'; }
  else if (autoT > 0) { label = `AUTO-LAUNCH ${game.wave + 1} IN ${Math.ceil(autoT)}`; cls = 'pulse'; }
  else { label = `LAUNCH WAVE ${game.wave + 1}`; cls = 'pulse'; }
  setText('btn-wave-label', label);
  btn.disabled = game.state === 'won' || game.state === 'lost' || game.campaignDone;
  btn.classList.toggle('pulse', cls === 'pulse');
  btn.classList.toggle('early', cls === 'early');

  for (const el of document.querySelectorAll('.shop-item')) {
    const t = el.dataset.type;
    el.classList.toggle('poor', game.credits < TOWERS[t].cost);
    el.classList.toggle('active', ui.placing === t);
  }
  for (const el of document.querySelectorAll('.ability')) {
    const key = el.dataset.key;
    const cd = game.cooldowns[key];
    const max = ABILITIES[key].cd;
    el.querySelector('.cdv').style.height = `${(cd / max) * 100}%`;
    el.querySelector('.cdt').textContent = cd > 0 ? Math.ceil(cd) : '';
    el.classList.toggle('armed', ui.ability === key || (key === 'overclock' && game.overclockT > 0));
  }
  renderInfo(false);
  updateBossBars(false);
  // Placement heat map readout for the hovered spot.
  const hl = $('#heat-line');
  if (hl && ui.placing) {
    const h = ui.hover;
    const size = TOWERS[ui.placing].size || 1;
    const a = h && h.tx >= 0 ? footprintAnchor(size, h.x, h.y) : null;
    const v = a && r3d.heatAt(ui.placing, a.tx, a.ty);
    const unit = ui.placing === 'uplink' ? 'tower levels in range' : 'tiles of road in view';
    // Anti-air towers also score the sky lane they'd cover (at a lower weight: only drones fly it).
    const air = v && v.air > 0 ? ` + <b style="color:${ENEMIES.drone.color}">${v.air.toFixed(1)}</b> of sky lane` : '';
    const html = !settings.heatmap ? 'Heat map off (H)' : v
      ? `<b style="color:${v.k > 0.66 ? 'var(--green)' : v.k > 0.33 ? 'var(--yellow)' : 'var(--red)'}">${v.road.toFixed(1)}</b> ${unit}${air} · ${Math.round(v.k * 100)}% of the best spot`
      : TOWERS[ui.placing].air && game.airPaths.length
        ? `Heat map: green pads cover the most road (sky lane counts ×${AIR_HEAT_WEIGHT})`
        : 'Heat map: green pads cover the most road';
    if (hl.dataset.h !== html) { hl.dataset.h = html; hl.innerHTML = html; }
  }
}

function buildShop() {
  const shop = $('#shop');
  shop.innerHTML = '';
  TOWER_ORDER.forEach((type, i) => {
    const def = TOWERS[type];
    const el = document.createElement('button');
    el.className = 'shop-item';
    el.dataset.type = type;
    el.style.setProperty('--c', def.color);
    el.innerHTML = `<img src="${towerIcon(type)}" alt=""><div><div class="nm">${def.name}</div><div class="cost">${def.cost}¢${def.size > 1 ? ` <span class="fp">${def.size}×${def.size}</span>` : ''}</div></div><kbd>${i + 1}</kbd>`;
    el.addEventListener('click', () => selectBuild(type));
    el.addEventListener('mouseenter', () => { ui.shopHover = type; renderInfo(true); });
    el.addEventListener('mouseleave', () => { ui.shopHover = null; renderInfo(true); });
    shop.appendChild(el);
  });
}

function buildAbilities() {
  const wrap = $('#abilities');
  wrap.innerHTML = '';
  for (const [key, ab] of Object.entries(ABILITIES)) {
    const el = document.createElement('button');
    el.className = 'ability';
    el.dataset.key = key;
    el.style.setProperty('--c', ab.color);
    el.title = `${ab.name} — ${ab.desc} (cooldown ${ab.cd}s)`;
    el.innerHTML = `<span class="ico">${ABILITY_ICONS[key]}</span>${ab.name}<kbd>${ab.key}</kbd><div class="cdv"></div><div class="cdt"></div>`;
    el.addEventListener('click', () => armAbility(key));
    wrap.appendChild(el);
  }
}

function buildNextWave() {
  const wrap = $('#next-wave');
  wrap.innerHTML = '';
  if (!game) return;
  const n = game.wave + 1;
  if (game.campaignDone) {
    $('#next-wave-num').textContent = '';
    wrap.innerHTML = '<div class="nw-empty">FINAL WAVE — HOLD THE LINE</div>';
    return;
  }
  $('#next-wave-num').textContent = `// ${n}`;
  // One chip per enemy type and variant combination.
  const counts = new Map();
  for (const grp of game.waveDef(n)) {
    const key = `${grp.type}|${(grp.mods || []).join('+')}`;
    const c = counts.get(key) || { type: grp.type, mods: grp.mods || [], count: 0 };
    c.count += grp.count;
    counts.set(key, c);
  }
  for (const { type, mods, count } of counts.values()) {
    const def = ENEMIES[type];
    const el = document.createElement('div');
    el.className = `nw-item${def.boss ? ' boss' : ''}`;
    el.title = [`${def.name} — ${def.desc || ''}`, ...mods.map((m) => `${MODS[m].name}: ${MODS[m].desc}`)].join('\n');
    const badges = mods.length ? `<span class="mods">${mods.map((m) => `<span class="mod" style="--vc:${MODS[m].color}">${MODS[m].name}</span>`).join('')}</span>` : '';
    el.innerHTML = `<img src="${enemyIcon(type)}" alt="">×${count}${badges}`;
    wrap.appendChild(el);
  }
  const muts = endlessMutators(n);
  if (muts.length) {
    const el = document.createElement('div');
    el.className = 'nw-mutators';
    el.innerHTML = `MUTATORS: ${muts.map((m) => `<b style="color:${MODS[m].color}" title="${MODS[m].desc}">${MODS[m].name}</b>`).join(' · ')}`;
    wrap.appendChild(el);
  }
}

// ---------------------------------------------------------------- info / inspector panel
let infoKey = '';
const PATH_KEYS = [',', '.', '/'];

// Stat block for a tower; `n` (optional) is the stat set after a hovered upgrade, shown as "→ new".
function statRows(def, s, n = null, placed = false) {
  const r1 = (v) => Math.round(v * 10) / 10;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const row = (label, key, fmt, show) => {
    const v = s[key], nv = n ? n[key] : v;
    if (!show(v) && !show(nv)) return '';
    const up = n && nv !== v ? ` <span class="up">→ ${fmt(nv, n)}</span>` : '';
    return `<dt>${label}</dt><dd>${fmt(v, s)}${up}</dd>`;
  };
  const always = () => true, pos = (v) => v > 0, multi = (v) => v > 1;
  const air = def.air || s.air || n?.air;
  return `<dl class="stat-grid">
    ${def.base.dmg != null ? row('DAMAGE', 'dmg', (v) => Math.round(v), always) : ''}
    ${def.base.rate != null ? row('RATE', 'rate', (v) => `${r1(v)}/s`, always) : ''}
    ${row('RANGE', 'range', (v, st) => (st.global ? '∞' : r1(v)), always)}
    ${row('TARGETS', 'targets', (v) => v, multi)}
    ${row('PIERCE', 'pierce', (v) => v, multi)}
    ${row('SLUGS', 'slugs', (v) => v, multi)}
    ${row('SPLASH', 'splash', r1, pos)}
    ${row('CHAINS', 'chains', (v) => v, pos)}
    ${row('SLOW', 'slow', pct, pos)}
    ${row('FIELD', 'auraDps', (v, st) => `${Math.round(v * st.dmg)}/s`, pos)}
    ${row('DMG BUFF', 'buffDmg', (v) => `+${pct(v)}`, pos)}
    ${row('RATE BUFF', 'buffRate', (v) => `+${pct(v)}`, pos)}
    ${row('INCOME', 'income', (v) => `+${v}¢/wave`, pos)}
    <dt>HITS</dt><dd>${def === TOWERS.uplink ? 'SUPPORT' : air && def.ground ? 'AIR + GROUND' : def.ground ? 'GROUND' : 'AIR'}</dd>
    ${placed ? '' : `<dt>FOOTPRINT</dt><dd>${def.size || 1}×${def.size || 1}</dd>`}
  </dl>${traitChips(s, n)}`;
}

const TRAITS = [
  ['CAMO', (s) => s.camo || s.grantCamo], ['REVEAL', (s) => s.reveal], ['BURN', (s) => s.burn > 0], ['SHRED', (s) => s.shred > 0],
  ['STUN', (s) => s.stunChance > 0], ['MARK', (s) => s.markAmp > 0], ['CLUSTER', (s) => s.cluster > 0], ['FIRE', (s) => s.fireZone > 0],
  ['KNOCKBACK', (s) => s.knockback > 0], ['FREEZE', (s) => s.freezeChance > 0 || s.freezeEvery > 0], ['BRITTLE', (s) => s.brittle > 0],
  ['SHARDS', (s) => s.shards > 0], ['SHATTER', (s) => s.shatter > 0], ['BLIZZARD', (s) => s.globalSlow > 0], ['BOSS ×', (s) => s.bossMul > 1],
  ['GLOBAL', (s) => s.global], ['THROUGH WALLS', (s) => s.xray], ['BURST', (s) => s.burstEvery > 0], ['NO FALLOFF', (s) => s.falloff >= 1 && s.chains > 0], ['FULL PIERCE', (s) => s.slugFalloff === 0],
  ['FIREWALL', (s) => s.firewall],
  ['ARMOR ↓', (s) => s.auraArmorDown > 0], ['DMG AMP', (s) => s.auraAmp > 0], ['LEECH', (s) => s.auraShieldDrain > 0],
  ['SLOW FIELD', (s) => s.auraSlow > 0], ['BOUNTY', (s) => s.bounty > 0 || s.killBounty > 0], ['AIR', (s) => s.air],
];

function traitChips(s, n) {
  const chips = TRAITS.filter(([, f]) => f(s) || (n && f(n)))
    .map(([label, f]) => `<span class="chip${!f(s) ? ' new' : ''}">${label}</span>`);
  return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
}

function pathCard(t, p, i) {
  const path = t.def.paths[i];
  const tier = t.tiers[i];
  const next = t.nextTier(i);
  const allowed = t.canUpgrade(i);
  const pips = [0, 1, 2, 3, 4].map((k) => `<i class="${k < tier ? 'on' : ''}"></i>`).join('');
  let body;
  if (!next) body = `<div class="pnext"><b>${path.tiers[4].name}</b> — path complete</div>`;
  else if (!allowed) body = `<div class="pnext locked">🔒 ${tier >= 2 ? 'Another path is past tier 2' : 'Two paths already in use'}</div>`;
  else body = `<div class="pnext"><b>${next.name}</b> ${next.desc}</div>
    <button class="btn up" data-up="${i}" ${game.credits < next.cost ? 'disabled' : ''}><span>${next.cost}¢</span><kbd>${PATH_KEYS[i]}</kbd></button>`;
  return `<div class="path${tier ? ' active' : ''}" style="--pc:${path.color}">
    <div class="path-head"><span>${path.name}</span><span class="pips">${pips}</span></div>${body}</div>`;
}

const COUNTERS = {
  runner: 'Anything works — Pulse Lasers are the most cost-efficient answer.',
  drone: 'Airborne: Lasers, Tesla, Cryo and Railguns hit it. Plasma Mortars cannot.',
  brute: 'Armor blunts weak hits. Railguns ignore armor; heavy Plasma shells punch through.',
  aegis: 'Shield regenerates after 2s without damage. Tesla deals 3× to shields; EMP strips them; Railgun slugs do half.',
  phantom: 'Always cloaked: needs camo detection (Laser Hack, Rail Thermal Scope, Hive Mind) or a Netrunner Uplink field. EMP and freezes expose it; cryo and splash still hit it.',
  splitter: 'Bursts into 3 Nano-Mites — keep splash or chain damage behind it.',
  mite: 'Fast and fragile — Tesla chains and Cryo pulses sweep them up.',
  medic: 'Heals everything around it. Kill it first: STRONG/CLOSE targeting or a Railgun line.',
  jammer: 'Knocks out towers within 1.8 tiles. Out-range it (Railgun, Mortar), stun it (EMP, freezes) to drop the field, or firewall towers with an Uplink on the Intrusion path.',
  courier: 'Only hurts you if it escapes with a packet: towers near the exit get a second shot. FIRST targeting prioritises carriers about to escape.',
  titan: 'Boss with heavy armor. Railguns, Orbital Strike and EMP (1s stun on bosses).',
  overmind: 'Shielded, armored and launches drones. Tesla for the shield, Railguns for the hull, save the Orbital Strike.',
};

function enemyTags(e) {
  const d = e.def, tags = [];
  if (d.boss) tags.push(['BOSS', '#ff2bd6']);
  if (d.flying) tags.push(['AIR', '#00f0ff']);
  if (d.armor) tags.push([`ARMOR ${d.armor}`, '#ff8a00']);
  if (e.maxShield) tags.push(['SHIELD', '#5aa0ff']);
  if (e.cloaked) tags.push(['CLOAK', '#a855ff']);
  if (d.heal) tags.push(['HEALER', '#39ff14']);
  if (d.splits) tags.push(['SPLITS', '#39ff14']);
  if (d.spawns) tags.push(['SPAWNER', '#ffe600']);
  if (d.jam) tags.push(['JAMMER', d.color]);
  if (d.courier) tags.push(['THIEF', d.color]);
  if (d.phases) tags.push([`${d.phases.length} SKULLS`, '#ffffff']);
  const html = tags.map(([t, c]) => `<span class="tag" style="--c:${c}">${t}</span>`);
  for (const m of e.mods) html.push(`<span class="tag mod" style="--c:${MODS[m].color}">${MODS[m].name}</span>`);
  return html.join('');
}

function enemyPanelHtml(e) {
  const d = e.def;
  return `
    <div class="enemy-head"><img src="${enemyIcon(e.type)}" alt=""><div>
      <h3 style="color:${d.color}">${d.name}</h3>
      <div class="lvl">HOSTILE · WAVE ${e.waveId}</div>
      <div class="tags">${enemyTags(e)}</div></div></div>
    <div class="bar-row"><span>HULL</span><div class="ebar"><div id="ei-hp" class="efill"></div></div><b id="ei-hpv"></b></div>
    ${e.maxShield ? '<div class="bar-row"><span>SHIELD</span><div class="ebar"><div id="ei-sh" class="efill sh"></div></div><b id="ei-shv"></b></div>' : ''}
    <dl class="stat-grid">
      <dt>SPEED</dt><dd id="ei-speed"></dd>
      <dt>BOUNTY</dt><dd>${e.reward}¢</dd>
      <dt>CORE DMG</dt><dd id="ei-core"></dd>
      <dt>TO CORE</dt><dd id="ei-dist"></dd>
      <dt>STATUS</dt><dd id="ei-status"></dd>
    </dl>
    <p>${d.desc || ''}</p>
    ${e.mods.map((m) => `<div class="variant-line" style="--vc:${MODS[m].color}"><b>${MODS[m].name}</b> ${MODS[m].desc}</div>`).join('')}
    ${d.phases ? `<div class="variant-line" style="--vc:${d.color}"><b>${d.phaseName}</b> ${d.phaseDesc}</div>` : ''}
    <p class="tip">▸ ${COUNTERS[e.type] || ''}</p>`;
}

function updateEnemyPanel(e) {
  const panel = $('#info');
  const hp = Math.max(0, e.hp);
  const k = hp / e.maxHp;
  const fill = panel.querySelector('#ei-hp');
  if (!fill) return;
  fill.style.width = `${k * 100}%`;
  fill.style.background = k > 0.5 ? 'var(--green)' : k > 0.25 ? 'var(--yellow)' : 'var(--red)';
  panel.querySelector('#ei-hpv').textContent = `${Math.ceil(hp)}/${Math.round(e.maxHp)}`;
  const sh = panel.querySelector('#ei-sh');
  if (sh) {
    sh.style.width = `${(e.shield / e.maxShield) * 100}%`;
    panel.querySelector('#ei-shv').textContent = `${Math.ceil(e.shield)}/${Math.round(e.maxShield)}`;
  }
  const slow = e.slowT > 0 ? e.slowAmt * (e.def.boss ? 0.5 : 1) : 0;
  const speed = e.stunT > 0 ? 0 : e.speed * (1 - slow);
  panel.querySelector('#ei-speed').textContent = `${speed.toFixed(2)} tiles/s${slow ? ` (−${Math.round(slow * 100)}%)` : ''}`;
  panel.querySelector('#ei-dist').textContent = e.carrying ? `${Math.max(0, e.remaining / TILE).toFixed(1)} tiles to the exit` : e.def.courier ? `${Math.max(0, e.remaining / TILE).toFixed(1)} tiles (then runs back out)` : `${Math.max(0, e.remaining / TILE).toFixed(1)} tiles`;
  // Live breach cost: hull + whatever shield layer is still up (+ unspawned Nano-Mites).
  const extra = [];
  if (e.def.shieldLives && e.shield > 0) extra.push('shield');
  if (e.def.splits) extra.push(`${e.def.splits.count} mites`);
  panel.querySelector('#ei-core').textContent = `${coreDamage(e)}${extra.length ? ` (incl. ${extra.join(' + ')})` : ''}`;
  const st = [];
  if (e.phaseT > 0) st.push('<span style="color:#fff">PHASE SHIFT</span>');
  if (e.stunT > 0) st.push('<span style="color:var(--cyan)">STUNNED</span>');
  if (e.slowT > 0) st.push('<span style="color:#5aa0ff">SLOWED</span>');
  if (e.burnT > 0) st.push('<span style="color:#ff8a00">BURNING</span>');
  if (e.crackT > 0) st.push('<span style="color:#ffb070">CRACKED</span>');
  if (e.carrying) st.push('<span style="color:#3dffc5">CARRYING DATA</span>');
  if (e.def.jam && e.stunT <= 0) st.push(`<span style="color:${e.def.color}">JAMMING</span>`);
  if (e.cloaked) st.push(e.revealed ? '<span style="color:var(--green)">REVEALED</span>' : '<span style="color:#b98cff">CLOAKED</span>');
  if (e.flash > 0) st.push('<span style="color:var(--red)">UNDER FIRE</span>');
  panel.querySelector('#ei-status').innerHTML = st.join(' · ') || 'NOMINAL';
}

function cycleTargeting() {
  const t = ui.selected;
  if (!t || t.type === 'uplink' || t.type === 'cryo') return;
  const modes = modesFor(t);
  const next = modes[(modes.findIndex(([m]) => m === t.mode) + 1) % modes.length][0];
  // AIM needs a spot first: cycling onto it without one asks for a click.
  if (next === 'aim' && !t.aim) { beginAim(t); return; }
  t.mode = next;
  ui.aiming = null;
  audio.play('click');
}

// Manual aim (G): the next click on the board sets the Mortar's target spot or the Railgun's firing line.
function beginAim(t = ui.selected) {
  if (!t || !t.aimable) return;
  if (ui.aiming === t) { ui.aiming = null; renderInfo(true); return; }
  ui.aiming = t;
  ui.placing = null;
  ui.ability = null;
  audio.play('click');
  toast(t.type === 'plasma' ? 'CLICK A SPOT FOR THE MORTAR TO SHELL' : 'CLICK TO SET THE RAILGUN\'S FIRING LINE', t.def.color, 2000);
  renderInfo(true);
}

function renderInfo(force) {
  if (!game) return;
  const panel = $('#info');
  if (ui.selectedEnemy && (ui.selectedEnemy.dead || !game.enemies.includes(ui.selectedEnemy))) {
    const gone = ui.selectedEnemy;
    ui.selectedEnemy = null;
    if (!gone.leaked) toast(`${gone.def.name} ELIMINATED`, gone.def.color, 1400);
  }
  const foe = ui.selectedEnemy;
  if (foe) {
    const key = `enemy|${foe.id}`;
    if (key !== infoKey || force) {
      infoKey = key;
      panel.style.setProperty('--c', foe.def.color);
      panel.innerHTML = enemyPanelHtml(foe);
    }
    updateEnemyPanel(foe);
    return;
  }
  const sel = ui.selected;
  const previewType = ui.shopHover || ui.placing;
  const afford = sel ? [0, 1, 2].map((i) => (sel.nextTier(i) && game.credits >= sel.nextTier(i).cost ? 1 : 0)).join('') : '';
  const key = sel
    ? `sel|${sel.id}|${sel.tiers.join('')}|${sel.mode}|${afford}|${ui.previewPath}|${sel.rank}|${sel.fresh}|${ui.aiming === sel}`
    : previewType ? `prev|${previewType}` : 'empty';
  if (key !== infoKey || force) {
    infoKey = key;
    if (sel) {
      const def = sel.def;
      let preview = null;
      if (ui.previewPath != null && sel.nextTier(ui.previewPath) && sel.canUpgrade(ui.previewPath)) {
        const tiers = [...sel.tiers];
        tiers[ui.previewPath]++;
        preview = computeStats(def, tiers, sel.rank);
      }
      const title = towerTitle(sel);
      const aims = sel.type !== 'uplink' && sel.type !== 'cryo';
      const sellTip = sel.fresh ? 'Bought this build phase: full refund' : `70% refund${sel.rank ? ` · loses RANK ${VET.numerals[sel.rank]}` : ''}`;
      panel.style.setProperty('--c', def.color);
      panel.innerHTML = `
        <h3>${title}</h3>
        <div class="lvl">${def.name} · PATHS ${sel.tiers.join('-')}</div>
        <div class="lvl">KILLS <b id="info-kills">${sel.kills}</b> · DEALT <b id="info-dmg">${fmtNum(sel.dmgDealt)}</b></div>
        <div class="rank-row" id="rank-row">${rankRow(sel)}</div>
        ${statRows(def, sel.stats, preview, true)}
        ${comboChips(sel.type)}
        <div class="paths">${def.paths.map((p, i) => pathCard(sel, p, i)).join('')}</div>
        <div class="actions${aims ? '' : ' one'}${sel.aimable ? ' aimable' : ''}">
          ${aims ? `<button class="btn target" id="btn-target" title="Targeting priority (T)"><span>◎ ${modesFor(sel).find(([m]) => m === sel.mode)[1]}</span></button>` : ''}
          ${sel.aimable ? `<button class="btn target aim${ui.aiming === sel ? ' on' : ''}" id="btn-aim" title="${sel.type === 'plasma' ? 'Shell a ground spot of your choice (G)' : 'Fire down a line of your choice (G)'}"><span>⌖ SET AIM</span></button>` : ''}
          <button class="btn sell" id="btn-sell" title="${sellTip}"><span>SELL +${sel.sellValue}¢${sel.fresh ? ' <i class="fresh">FULL</i>' : ''}</span></button>
        </div>
        ${ui.aiming === sel ? `<div class="aim-hint">${sel.type === 'plasma' ? 'Click a spot in range: shells land there whenever an enemy is about to be in the blast.' : 'Click a direction: slugs fire down that line whenever an enemy is on it.'} Right-click cancels.</div>` : ''}`;
      panel.querySelector('#btn-sell').addEventListener('click', () => doSell());
      panel.querySelector('#btn-target')?.addEventListener('click', () => { cycleTargeting(); renderInfo(true); });
      panel.querySelector('#btn-aim')?.addEventListener('click', () => beginAim(sel));
      panel.querySelectorAll('[data-up]').forEach((b) => {
        const i = Number(b.dataset.up);
        b.addEventListener('click', () => doUpgrade(i));
        b.addEventListener('mouseenter', () => { ui.previewPath = i; renderInfo(false); });
        b.addEventListener('mouseleave', () => { ui.previewPath = null; renderInfo(false); });
      });
    } else if (previewType) {
      const def = TOWERS[previewType];
      panel.style.setProperty('--c', def.color);
      panel.innerHTML = `<h3>${def.name}</h3><div class="lvl">${def.cost}¢ · HOTKEY ${TOWER_ORDER.indexOf(previewType) + 1}</div><p>${def.desc}</p>${statRows(def, computeStats(def, [0, 0, 0]))}
        ${comboChips(previewType)}
        <div class="path-preview">${def.paths.map((p) => `<span style="color:${p.color}">${p.name}</span>`).join(' · ')}</div>
        ${ui.placing ? '<div class="heat-line" id="heat-line"></div>' : ''}`;
    } else {
      panel.style.removeProperty('--c');
      panel.innerHTML = `<div class="panel-title">SYSTEM</div><div class="info-empty">
        Select a defense (<b>1–6</b>) and click an empty tile to deploy — the heat map shows where it sees the most road.<br>
        Click a tower to inspect · <b>, . /</b> upgrade its 3 paths · <b>S</b> sell · <b>T</b> retarget · <b>G</b> aim a Mortar / Railgun by hand.<br>
        Drones leave the gates but cut the corners on <b>sky lanes</b> (the dashed lines), over the low blocks.<br>
        Buildings block line of sight — a tower's range area only covers what it can see.<br>
        <b>SPACE</b> launches waves — calling early pays a bonus · <b>A</b> auto-launch.<br>
        <b>Q W E</b> abilities · <b>F</b> speed (up to 4×) · <b>H</b> heat map · <b>P</b> pause · <b>RMB/ESC</b> cancel.<br>
        Camera: <b>RMB drag</b>/<b>arrows</b> pan · <b>wheel</b> zoom · <b>MMB</b>/<b>Z X</b> turn · <b>C</b> reset.</div>`;
    }
  } else if (sel) {
    const k = panel.querySelector('#info-kills');
    const d = panel.querySelector('#info-dmg');
    const r = panel.querySelector('#rank-row');
    if (k) k.textContent = sel.kills;
    if (d) d.textContent = fmtNum(sel.dmgDealt);
    if (r) { const html = rankRow(sel); if (r.dataset.h !== html) { r.dataset.h = html; r.innerHTML = html; } }
  }
}

// Veterancy readout: chevrons, rank name and progress to the next rank.
function rankRow(t) {
  const next = VET.xp[t.rank];
  const prev = t.rank ? VET.xp[t.rank - 1] : 0;
  const k = next ? Math.min(1, (t.xp - prev) / (next - prev)) : 1;
  const bonus = t.rank ? ` +${Math.round(VET.dmg * t.rank * 100)}% DMG` : '';
  return `<span class="chev">${t.rank ? chevrons(t.rank) : '·'}</span><div class="xpbar"><div style="width:${Math.round(k * 100)}%"></div></div>
    <span>${t.rank ? `${VET.names[t.rank]}` : 'RECRUIT'}<small>${bonus}${next ? ` · ${Math.floor(t.xp)}/${next} XP` : ' · MAX'}</small></span>`;
}

// Combos a tower type takes part in (hover for the rule).
const COMBO_ROLES = {
  laser: [['thermal', 'Focus: Burn Beam + Cryo'], ['exposed', 'Hack: Armor Shred sets up Railguns']],
  plasma: [['fracture', 'on frozen enemies'], ['thermal', 'Tactical: Napalm + Cryo']],
  tesla: [['superconduct', 'on chilled enemies'], ['overload', 'on burning enemies']],
  cryo: [['thermal', 'chill meets burn'], ['superconduct', 'chill sets up Tesla'], ['fracture', 'freezes set up Mortars']],
  rail: [['exposed', 'on armor-stripped enemies'], ['thermal', 'Caliber: Plasma Jacket + Cryo']],
  uplink: [['exposed', 'Intrusion: ICE Breaker sets up Railguns']],
};
function comboChips(type) {
  const roles = COMBO_ROLES[type] || [];
  if (!roles.length) return '';
  return `<div class="combo-chips">${roles.map(([k, how]) => `<span class="combo-chip" style="--rc:${REACTIONS[k].color}" title="${REACTIONS[k].name} (${how}): ${REACTIONS[k].desc}">⚡ ${REACTIONS[k].name}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- actions
function selectBuild(type) {
  audio.play('click');
  ui.ability = null;
  ui.selected = null;
  ui.selectedEnemy = null;
  ui.aiming = null;
  ui.placing = ui.placing === type ? null : type;
  if (ui.placing && game.credits < TOWERS[type].cost) toast('INSUFFICIENT CREDITS', '#ff3355');
  renderInfo(true);
}

function armAbility(key) {
  if (!game) return;
  if (game.cooldowns[key] > 0) { audio.play('error'); return; }
  if (!ABILITIES[key].targeted) {
    if (game.useAbility(key)) toast('OVERCLOCK ENGAGED', '#ffe600');
    return;
  }
  ui.placing = null;
  ui.selected = null;
  ui.aiming = null;
  ui.ability = ui.ability === key ? null : key;
  audio.play('click');
  renderInfo(true);
}

function doUpgrade(p) {
  const t = ui.selected;
  if (!t) return;
  if (p == null) p = t.mainPath >= 0 ? t.mainPath : 0;
  const tierDef = t.nextTier(p);
  if (!game.upgrade(t, p)) audio.play('error');
  else if (t.tiers[p] === 5) {
    banner(tierDef.name, `${t.def.paths[p].name} // EVOLUTION COMPLETE`, false);
    toast(`${tierDef.name} ONLINE`, t.def.paths[p].color);
  }
  ui.previewPath = null;
  renderInfo(true);
}

function doSell() {
  const t = ui.selected;
  if (!t) return;
  if (t.fresh) toast(`FULL REFUND +${t.sellValue}¢`, '#39ff14', 1400);
  game.sell(t);
  ui.selected = null;
  ui.aiming = null;
  renderInfo(true);
}

function launch() {
  if (!game || paused) return;
  if (game.launchWave()) audio.play('click');
}

function setSpeed(s) {
  speed = s;
  document.querySelectorAll('.speed').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s));
}

function toggleAuto() {
  settings.autoStart = !settings.autoStart;
  autoT = 0;
  applySettings();
  toast(settings.autoStart ? 'AUTO-LAUNCH ON // NEXT WAVE STARTS 3s AFTER A CLEAR' : 'AUTO-LAUNCH OFF', '#39ff14', 1600);
}

function toggleHeat() {
  settings.heatmap = !settings.heatmap;
  applySettings();
  toast(`PLACEMENT HEAT MAP ${settings.heatmap ? 'ON' : 'OFF'}`, '#00f0ff', 1200);
}

function setPaused(p) {
  paused = p;
  $('#btn-pause').textContent = p ? '▶' : '❚❚';
  if (p && !modalOpen) {
    openModal('PAUSED', '<p>Simulation suspended. The corps are waiting.</p>', [
      { label: 'QUIT TO MENU', action: () => { closeModal(); paused = false; audio.clearVoice(); r3d.endCinematic(true); game = null; show('levels'); } },
      { label: 'SETTINGS', action: () => { closeModal(); showSettings(() => setPaused(true)); } },
      { label: 'RESUME', primary: true, action: () => { closeModal(); setPaused(false); } },
    ]);
  }
}

function toggleMute() {
  audio.set('muted', !audio.settings.muted);
  $('#btn-mute').classList.toggle('off', audio.settings.muted);
}
$('#btn-mute').classList.toggle('off', audio.settings.muted);

$('#btn-wave').addEventListener('click', launch);
$('#btn-pause').addEventListener('click', () => setPaused(!paused));
$('#btn-mute').addEventListener('click', toggleMute);
$('#btn-auto').addEventListener('click', () => { toggleAuto(); audio.play('click'); });
$('#btn-settings').addEventListener('click', () => { audio.play('click'); if (game && !paused) { paused = true; $('#btn-pause').textContent = '▶'; } showSettings(() => { if (game) setPaused(false); }); });
$('#cine').addEventListener('pointerdown', (ev) => { ev.stopPropagation(); skipIntro(); });
document.querySelectorAll('.speed').forEach((b) => b.addEventListener('click', () => { setSpeed(Number(b.dataset.speed)); audio.play('click'); }));

// ---------------------------------------------------------------- canvas input
const canvas = $('#game');
function toWorld(ev) {
  return r3d.pick(ev.clientX, ev.clientY) || { x: -1, y: -1, tx: -1, ty: -1 };
}
let rmbDown = null;
canvas.addEventListener('pointermove', (ev) => { ui.hover = toWorld(ev); });
canvas.addEventListener('pointerleave', () => { ui.hover = null; });
canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  // Right-drag pans the camera; only a click without a drag cancels.
  if (!rmbDown || Math.hypot(ev.clientX - rmbDown.x, ev.clientY - rmbDown.y) < 6) cancel();
});
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2) rmbDown = { x: ev.clientX, y: ev.clientY };
  if (!game || ev.button !== 0) return;
  const p = toWorld(ev);
  ui.hover = p;
  if (ui.ability) {
    if (game.useAbility(ui.ability, p.x, p.y)) ui.ability = null;
    else audio.play('error');
    return;
  }
  if (ui.aiming) {
    const t = ui.aiming;
    if (p.tx < 0 || !t.setAim(p.x, p.y)) { audio.play('error'); return; }
    ui.aiming = null;
    ui.selected = t;
    audio.play('click');
    renderInfo(true);
    return;
  }
  if (ui.placing) {
    const type = ui.placing;
    const size = TOWERS[type].size || 1;
    const existing = game.towerAt(p.tx, p.ty);
    if (existing) { ui.placing = null; ui.selected = existing; audio.play('click'); renderInfo(true); return; }
    const a = footprintAnchor(size, p.x, p.y);
    if (!game.canPlace(a.tx, a.ty, size)) { audio.play('error'); if (size > 1) toast(`NEEDS A CLEAR ${size}×${size} AREA`, '#ff3355'); return; }
    if (game.credits < TOWERS[type].cost) { audio.play('error'); toast('INSUFFICIENT CREDITS', '#ff3355'); return; }
    game.build(type, a.tx, a.ty);
    if (!ev.shiftKey || game.credits < TOWERS[type].cost) ui.placing = null;
    renderInfo(true);
    return;
  }
  const foe = r3d.pickEnemy(ev.clientX, ev.clientY, game);
  if (foe) {
    ui.selectedEnemy = foe;
    ui.selected = null;
    audio.play('click');
    renderInfo(true);
    return;
  }
  const t = game.towerAt(p.tx, p.ty);
  ui.selected = t;
  ui.selectedEnemy = null;
  if (t) audio.play('click');
  renderInfo(true);
});

function cancel() {
  // Picking an aim point: back out of just that, keeping the tower selected.
  if (ui.aiming) { ui.aiming = null; renderInfo(true); return true; }
  if (ui.ability || ui.placing || ui.selected || ui.selectedEnemy) {
    ui.ability = null;
    ui.placing = null;
    ui.selected = null;
    ui.selectedEnemy = null;
    renderInfo(true);
    return true;
  }
  return false;
}

window.addEventListener('keyup', (ev) => r3d.cameraKey(ev.key.toLowerCase(), false));
window.addEventListener('blur', () => r3d.panKeys.clear());
window.addEventListener('keydown', (ev) => {
  if (ev.repeat && ev.key !== ' ') return;
  if (modalOpen) {
    if (ev.key === 'Escape') {
      if (paused) { closeModal(); setPaused(false); }
      else if (!game || game.state === 'build' || game.state === 'playing') closeModal();
    }
    return;
  }
  if (screen !== 'game' || !game) return;
  const k = ev.key.toLowerCase();
  if ((k === ' ' || k === 'escape' || k === 'enter') && skipIntro()) { ev.preventDefault(); return; }
  if (r3d.cinematic) return;
  if (r3d.cameraKey(k, true)) { ev.preventDefault(); return; }
  if (k >= '1' && k <= '6') { selectBuild(TOWER_ORDER[Number(k) - 1]); return; }
  switch (k) {
    case ' ': ev.preventDefault(); launch(); break;
    case 'escape': if (!cancel()) setPaused(true); break;
    case 'p': setPaused(!paused); break;
    case 'u': doUpgrade(); break;
    case ',': doUpgrade(0); break;
    case '.': doUpgrade(1); break;
    case '/': ev.preventDefault(); doUpgrade(2); break;
    case 's': case 'delete': case 'backspace': doSell(); break;
    case 't': cycleTargeting(); renderInfo(true); break;
    case 'g': beginAim(); break;
    case 'z': r3d.turnView(-1); break;
    case 'x': r3d.turnView(1); break;
    case 'c': r3d.resetView(); break;
    case 'f': setSpeed(speed % 4 + 1); break;
    case 'a': toggleAuto(); break;
    case 'h': toggleHeat(); break;
    case 'm': toggleMute(); break;
    case 'q': armAbility('emp'); break;
    case 'w': armAbility('orbital'); break;
    case 'e': armAbility('overclock'); break;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'game' && game && game.state === 'playing' && !paused) setPaused(true);
});

// ---------------------------------------------------------------- toasts, banner, modal
function toast(text, color = '#00f0ff', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', color);
  el.textContent = text;
  pushToast(el, ms);
}

function pushToast(el, ms) {
  const wrap = $('#toasts');
  wrap.appendChild(el);
  while (wrap.children.length > 4) wrap.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}

function threatCard(type) {
  const def = ENEMIES[type];
  const el = document.createElement('div');
  el.className = 'toast threat';
  el.style.setProperty('--c', def.color);
  el.innerHTML = `<img src="${enemyIcon(type)}" alt=""><div><div class="tt">${def.boss ? '⚠ BOSS SIGNATURE' : 'NEW THREAT DETECTED'}</div><div class="tn">${def.name}</div><div class="td">${def.desc}</div></div>`;
  pushToast(el, 7000);
}

function variantCard(mod) {
  const m = MODS[mod];
  const el = document.createElement('div');
  el.className = 'toast threat';
  el.style.setProperty('--c', m.color);
  el.innerHTML = `<div><div class="tt">VARIANT DETECTED</div><div class="tn">${m.name}</div><div class="td">${m.desc}</div></div>`;
  pushToast(el, 6000);
}

// Handler subtitles, shown for as long as the line plays (or would play, when muted).
let commsTimer = null;
audio.onLine = (key, text, secs) => {
  if (screen !== 'game') return;
  $('#comms-text').textContent = text;
  $('#comms').classList.add('show');
  clearTimeout(commsTimer);
  commsTimer = setTimeout(() => $('#comms').classList.remove('show'), secs * 1000);
};

function banner(text, sub, boss) {
  const el = $('#banner');
  el.className = 'banner';
  el.innerHTML = `${text}<small>${sub}</small>`;
  void el.offsetWidth;
  el.className = `banner show${boss ? ' boss' : ''}`;
}

let modalOnClose = null;
function openModal(title, html, buttons = [], variant = '') {
  modalOpen = true;
  $('#modal').classList.remove('hidden');
  $('.modal-box').className = `modal-box ${variant}`;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  const bw = $('#modal-buttons');
  bw.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = `btn${b.primary ? ' btn-primary' : ''}`;
    el.innerHTML = `<span>${b.label}</span>`;
    el.addEventListener('click', () => { audio.play('click'); b.action(); });
    bw.appendChild(el);
  }
}

function closeModal() {
  modalOpen = false;
  $('#modal').classList.add('hidden');
  const cb = modalOnClose;
  modalOnClose = null;
  if (cb) cb();
}

function showSettings(after) {
  const a = audio.settings;
  const slider = (key, label) => `<div class="slider"><span>${label}</span><input type="range" id="vol-${key}" min="0" max="1" step="0.05" value="${a[key]}"><span id="vol-${key}-v">${Math.round(a[key] * 100)}</span></div>`;
  const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${settings[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const onOff = (key) => seg(key, [[true, 'ON'], [false, 'OFF']]);
  const row = (label, sub, ctl) => `<div class="set-row"><div>${label}<small>${sub}</small></div>${ctl}</div>`;
  openModal('SETTINGS', `
    <h4>AUDIO</h4>
    <div class="set-group">${slider('music', 'MUSIC')}${slider('sfx', 'SFX')}${slider('voice', 'HANDLER')}</div>
    <h4>GAMEPLAY</h4>
    <div class="set-group">
      ${row('Auto-launch waves', 'The next wave starts 3s after the last one clears (A)', onOff('autoStart'))}
      ${row('Boss intros', 'Camera fly-in and name card when a boss arrives', onOff('intros'))}
      ${row('Placement heat map', 'Tint pads by how much road a tower would cover (H)', onOff('heatmap'))}
    </div>
    <h4>DISPLAY</h4>
    <div class="set-group">
      ${row('Screen shake', 'Explosions, boss phases, railgun recoil', seg('shake', [[0, 'OFF'], [0.5, 'LOW'], [1, 'FULL']]))}
      ${row('CRT scanlines', 'Scanline and vignette overlay', onOff('crt'))}
      ${row('Floating text', 'Bounty and combo pop-ups', onOff('texts'))}
    </div>
    <p style="color:var(--dim);font-size:12px">Soundtrack, sound effects and the handler's voice generated with ElevenLabs Music, Sound Effects and Text to Speech.</p>`,
  [{ label: 'DONE', primary: true, action: () => { closeModal(); if (after) after(); } }]);
  for (const key of ['music', 'sfx', 'voice']) {
    const input = $(`#vol-${key}`);
    input.addEventListener('input', () => {
      audio.set(key, Number(input.value));
      $(`#vol-${key}-v`).textContent = Math.round(input.value * 100);
      if (key === 'sfx') audio.play('laser');
    });
    if (key === 'voice') input.addEventListener('change', () => audio.say('wave_clear_1'));
  }
  document.querySelectorAll('#modal .seg').forEach((el) => {
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const raw = b.dataset.v;
      settings[el.dataset.key] = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
      el.querySelectorAll('button').forEach((o) => o.classList.toggle('on', o === b));
      applySettings();
      audio.play('click');
    });
  });
}

function showHowTo() {
  const towerRows = TOWER_ORDER.map((t) => `<img src="${towerIcon(t)}" alt=""><div><b style="--c:${TOWERS[t].color};color:${TOWERS[t].color}">${TOWERS[t].name}</b> — ${TOWERS[t].desc}</div>`).join('');
  const enemyRows = Object.entries(ENEMIES).filter(([, d]) => !d.hidden).map(([k, d]) => `<img src="${enemyIcon(k)}" alt=""><div><b style="color:${d.color}">${d.name}</b> — ${d.desc}</div>`).join('');
  openModal('OPERATOR MANUAL', `
    <p>Rogue drones and corporate cyborgs are pushing toward the <b>data core</b>. Build defenses along the neon roads. Every hostile that reaches the core drains integrity — lose it all and the district falls. Survive 20 waves to secure it.</p>
    <h4>CONTROLS</h4>
    <ul>
      <li><b>1–6</b> pick a defense, click a tile to deploy (hold <b>Shift</b> to place several)</li>
      <li>Click a tower to inspect · <b>,</b> <b>.</b> <b>/</b> buy the next tier on paths 1–3 · <b>S</b> sell (70% refund) · <b>T</b> target mode</li>
      <li><b>Manual aim</b> (<b>G</b>, or <b>T</b> round to AIM): a Plasma Mortar shells a ground spot you pick whenever an enemy is about to be in the blast; a Railgun holds a firing line and shoots whenever an enemy is on it — line one up along a straight road or sky lane</li>
      <li><b>Sky lanes</b>: Hunter Drones leave the same gates but don't keep to the road: they cut straight across its corners (the dashed lines, brighter when drones are inbound), cruising over the low-rise blocks — only the tall towers hide them from your defenses. While placing or inspecting an anti-air tower, the stretch of lane it covers lights up</li>
      <li>Every tower has <b>3 upgrade paths × 5 tiers</b>. Crosspathing: you can invest in two paths, and only one may go past tier 2 (e.g. 5-2-0)</li>
      <li><b>Space</b> launch next wave — calling it early pays bonus credits</li>
      <li><b>Loading</b>: towers only load while an enemy is in view, so each engagement opens with a load (a Railgun takes almost 3s, a Pulse Laser a quarter second). Slow weapons glow at the muzzle as the charge builds</li>
      <li><b>Buildings block line of sight</b>: lasers, tesla arcs, railgun slugs and cryo pulses can't reach what's behind them. While placing or inspecting a tower, its range area only covers the ground it can see. Plasma mortars lob over buildings; the Railgun's Thermal Scope punches through them</li>
      <li><b>Phantoms are always cloaked</b>: you need camo detection or a Netrunner Uplink field to hit them</li>
      <li><b>Q</b> EMP Burst · <b>W</b> Orbital Strike · <b>E</b> Overclock — cooldowns only recharge while a wave is running</li>
      <li><b>Heat map</b>: while placing, pads are tinted by how much road that tower would see from there (<b>H</b> toggles it). A tower sold in the same build phase it was bought refunds in full</li>
      <li><b>F</b> cycle speed (1–4×) · <b>A</b> auto-launch waves · <b>P</b>/<b>Esc</b> pause · <b>M</b> mute · Right-click cancels</li>
      <li><b>Right-drag</b> or <b>arrow keys</b> pan the camera · <b>Mouse wheel</b> zooms toward the cursor · <b>Middle-drag</b> (or <b>Shift</b> + right-drag) or <b>Z</b> / <b>X</b> turn it · <b>C</b> resets the view</li>
    </ul>
    <h4>VETERANCY</h4>
    <p>Towers earn XP for the damage they deal (Cryo also for every enemy it chills; an Uplink takes a quarter of what the towers it buffs earn). Ranks I–V each add +${Math.round(VET.dmg * 100)}% damage and +${Math.round(VET.rate * 100)}% fire rate. Selling a tower loses its rank.</p>
    <h4>COMBOS</h4>
    <ul>${Object.values(REACTIONS).map((r) => `<li><b style="color:${r.color}">${r.name}</b> — ${r.desc}</li>`).join('')}</ul>
    <h4>BOSSES</h4>
    <p>Bosses have <b>skulls</b> on their health bar. At each one the hull locks for a moment and the boss triggers its protocol — the Titan vents an EMP that knocks out nearby towers, the Overmind hijacks your most valuable towers.</p>
    <h4>VARIANTS</h4>
    <ul>${Object.values(MODS).map((m) => `<li><b style="color:${m.color}">${m.name}</b> — ${m.desc}</li>`).join('')}</ul>
    <p>Late campaign waves field the first three (Mirror-Plated heavies most waves from 13 on, some also Warded), so mix your defenses; in endless mode every wave rolls mutators from the whole list.</p>
    <h4>DEFENSES</h4><div class="legend">${towerRows}</div>
    <h4>HOSTILES</h4><div class="legend">${enemyRows}</div>`,
  [{ label: 'GOT IT', primary: true, action: closeModal }]);
}

// ---------------------------------------------------------------- layout & loop
function fitCanvas() {
  const wrap = $('#canvas-wrap');
  r3d.resize(Math.max(1, wrap.clientWidth), Math.max(1, wrap.clientHeight));
}
window.addEventListener('resize', () => { if (screen === 'game') fitCanvas(); });

let musicCheck = 0;
function updateMusic(dt) {
  musicCheck -= dt;
  if (musicCheck > 0) return;
  musicCheck = 0.5;
  const bossActive = game.enemies.some((e) => e.def.boss) ||
    game.spawners.some((s) => s.groups.some((grp) => ENEMIES[grp.type].boss && grp.spawned < grp.count));
  audio.playMusic(bossActive ? 'boss' : 'battle');
}

// Auto-launch: 3s after a wave clears (never the first wave: that one waits for the player's build).
function updateAuto(dt) {
  const ready = settings.autoStart && game.state === 'build' && game.wave > 0 && !game.campaignDone && !r3d.cinematic;
  if (!ready) { autoT = 0; return; }
  if (autoT <= 0) autoT = 3;
  autoT -= dt;
  if (autoT <= 0) { autoT = 0; launch(); }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen === 'game' && game) {
    let simDt = 0;
    if (!paused && !modalOpen) {
      // Boss intros run the simulation in slow motion.
      const cine = r3d.cinematic;
      const step = Math.min(dt, 1 / 30) * (cine ? 0.25 : 1);
      const n = cine ? 1 : speed;
      for (let i = 0; i < n; i++) game.update(step);
      simDt = step * n;
      updateMusic(dt);
      updateAuto(dt);
      checkIntro();
    }
    r3d.render(game, ui, dt, simDt);
    $('#cine').classList.toggle('show', r3d.cinematic);
    updateHud();
  } else {
    titleFx.render(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

applySettings();

// Debug handle for automated testing in the browser console.
window.__neon = { get game() { return game; }, startGame, ui, audio, setSpeed, r3d, assets, settings };

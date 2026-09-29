// Music: ElevenLabs-generated tracks with crossfaded loop regions.
// SFX: ElevenLabs-generated samples (several variations for rapid-fire sounds), trimmed and
// loudness-normalized at load. Procedural Web Audio synthesis remains as a fallback per sound.
import { W } from './config.js';
import { VOICE_LINES } from './voice.js';

const TRACKS = {
  menu: { file: 'assets/audio/music_menu.mp3', loopStart: 10.4, loopEnd: 53.2, xfade: 2.0 },
  battle: { file: 'assets/audio/music_battle.mp3', loopStart: 0, loopEnd: 119.95, xfade: 0.12 },
  boss: { file: 'assets/audio/music_boss.mp3', loopStart: 0, loopEnd: 89.95, xfade: 0.12 },
};

// Sample bank: files are assets/audio/sfx/<key>_<1..n>.mp3.
//   gain: mix level after peak normalization   maxDur: cut + fade (keeps rapid fire tight)
//   throttle: min seconds between plays        poly: max simultaneous copies   jitter: +- playback rate
const SFX = {
  laser: { key: 'laser', n: 3, gain: 0.22, maxDur: 0.35, throttle: 0.06, poly: 5, jitter: 0.06 },
  // Photon Storm's rotary cannon: the laser shot, pitched down and clipped short so it rattles like a gatling.
  gatling: { key: 'laser', n: 3, gain: 0.2, maxDur: 0.09, throttle: 0.035, poly: 6, jitter: 0.1, rate: 0.72 },
  plasma: { key: 'plasma_launch', n: 2, gain: 0.4, maxDur: 0.7, throttle: 0.08, poly: 3, jitter: 0.05 },
  plasmahit: { key: 'plasma_hit', n: 2, gain: 0.42, maxDur: 1.0, throttle: 0.08, poly: 3, jitter: 0.06 },
  tesla: { key: 'tesla', n: 3, gain: 0.3, maxDur: 0.5, throttle: 0.07, poly: 4, jitter: 0.06 },
  cryo: { key: 'cryo', n: 2, gain: 0.24, maxDur: 0.8, throttle: 0.2, poly: 2, jitter: 0.05 },
  rail: { key: 'rail', n: 2, gain: 0.5, maxDur: 1.2, throttle: 0.06, poly: 3, jitter: 0.04 },
  pop: { key: 'pop', n: 3, gain: 0.3, maxDur: 0.5, throttle: 0.035, poly: 5, jitter: 0.1 },
  explode: { key: 'explosion', n: 3, gain: 0.42, maxDur: 1.1, throttle: 0.07, poly: 4, jitter: 0.08 },
  bossdeath: { key: 'bossdeath', n: 1, gain: 0.9 },
  shieldbreak: { key: 'shieldbreak', n: 1, gain: 0.35, throttle: 0.08, poly: 3, jitter: 0.06 },
  shieldhit: { key: 'shieldhit', n: 3, gain: 0.26, maxDur: 0.4, throttle: 0.05, poly: 4, jitter: 0.08 },
  build: { key: 'build', n: 2, gain: 0.5, jitter: 0.03 },
  upgrade: { key: 'upgrade', n: 1, gain: 0.5 },
  sell: { key: 'sell', n: 1, gain: 0.45 },
  error: { key: 'error', n: 1, gain: 0.4, throttle: 0.15 },
  click: { key: 'click', n: 1, gain: 0.2, throttle: 0.03, jitter: 0.04 },
  leak: { key: 'leak', n: 1, gain: 0.55, throttle: 0.15 },
  emp: { key: 'emp', n: 1, gain: 0.7 },
  orbital: { key: 'orbital', n: 1, gain: 0.6 },
  orbitalhit: { key: 'orbitalhit', n: 1, gain: 0.9 },
  overclock: { key: 'overclock', n: 1, gain: 0.6 },
  wave_start: { key: 'wave_start', n: 2, gain: 0.32 },
  wave_clear: { key: 'wave_clear', n: 1, gain: 0.38 },
  boss_warning: { key: 'boss_warning', n: 1, gain: 0.7 },
  victory: { key: 'victory', n: 1, gain: 0.8 },
  game_over: { key: 'game_over', n: 1, gain: 0.8 },
  // Hero war bot.
  heroshot: { key: 'hero_shot', n: 3, gain: 0.26, maxDur: 0.4, throttle: 0.05, poly: 4, jitter: 0.06 },
  herohack: { key: 'hero_hack', n: 2, gain: 0.42, maxDur: 0.9, throttle: 0.2, poly: 2, jitter: 0.04 },
  herohijack: { key: 'hero_hijack', n: 1, gain: 0.5, throttle: 0.2, poly: 2 },
  trapset: { key: 'trap_set', n: 2, gain: 0.3, throttle: 0.15, poly: 2, jitter: 0.05 },
  mineblast: { key: 'mine_blast', n: 2, gain: 0.45, maxDur: 1.0, throttle: 0.08, poly: 3, jitter: 0.06 },
  emptrap: { key: 'emp_trap', n: 1, gain: 0.45, throttle: 0.1, poly: 2 },
  missile: { key: 'missile_salvo', n: 2, gain: 0.4, throttle: 0.3, poly: 2, jitter: 0.04 },
  herohit: { key: 'hero_hit', n: 2, gain: 0.2, maxDur: 0.4, throttle: 0.12, poly: 2, jitter: 0.1 },
  herodown: { key: 'hero_down', n: 1, gain: 0.7 },
  heroreboot: { key: 'hero_reboot', n: 1, gain: 0.55 },
  herodeploy: { key: 'hero_deploy', n: 1, gain: 0.6 },
  heromove: { key: 'hero_move', n: 1, gain: 0.3, throttle: 0.2 },
};

// Throttles for sounds that only exist as synthesis (or when a sample failed to load).
const SYNTH_THROTTLE = { hover: 0.04 };

const SETTINGS_KEY = 'neonbreach.audio';
const WEAPONS = new Set(['laser', 'plasma', 'plasmahit', 'tesla', 'cryo', 'rail', 'pop', 'heroshot', 'mineblast', 'herohit']);

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.current = null;
    this.wanted = null;
    this.last = {};
    this.lastVariant = {};
    this.active = {};
    this.bank = {};
    this.voices = 0;
    this.voice = { buffers: {}, current: null, queue: [], last: {} };
    this.onLine = null; // (key, text, seconds) => void: subtitle hook, called even when muted
    this.settings = { music: 0.55, sfx: 0.7, voice: 0.9, muted: false };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* ignore */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.ratio.value = 3;
    this.comp.knee.value = 12;
    this.master.connect(this.comp).connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // Turret shots are synthesized quietly; give them their own bus so they cut through the soundtrack.
    this.weaponBus = this.ctx.createGain();
    this.weaponBus.gain.value = 2.6;
    this.weaponBus.connect(this.sfxBus);
    // Handler voice over a comms channel: band-limited, lightly driven, compressed.
    this.voiceBus = this.ctx.createGain();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 260;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4200;
    const drive = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    drive.curve = curve;
    const vcomp = this.ctx.createDynamicsCompressor();
    vcomp.threshold.value = -18; vcomp.ratio.value = 4;
    this.voiceIn = this.ctx.createGain();
    this.voiceIn.connect(hp).connect(lp).connect(drive).connect(vcomp).connect(this.voiceBus);
    this.voiceBus.connect(this.master);
    this.applyVolumes();
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.loading = this.loadAll();
  }

  async loadAll() {
    const load = async (key, url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        this.buffers[key] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        console.warn(`[audio] could not load ${url}:`, err.message || err);
      }
    };
    const loadSfx = async (key, i) => {
      try {
        const res = await fetch(`assets/audio/sfx/${key}_${i}.mp3`);
        if (!res.ok) throw new Error(res.status);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        (this.bank[key] ||= []).push(this.analyse(buf));
      } catch { /* missing variation: synthesis fallback covers it */ }
    };
    const sfxJobs = [];
    for (const spec of Object.values(SFX)) for (let i = 1; i <= spec.n; i++) sfxJobs.push(loadSfx(spec.key, i));
    await Promise.all([...Object.entries(TRACKS).map(([k, t]) => load(k, t.file)), ...sfxJobs]);
    if (this.wanted && !this.current) this.playMusic(this.wanted);
    this.loadVoice();
  }

  // Peak-normalize and skip leading silence so every variation hits at the same moment and level.
  analyse(buf) {
    let peak = 1e-4;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    const d0 = buf.getChannelData(0);
    let start = 0;
    while (start < d0.length && Math.abs(d0[start]) < peak * 0.04) start++;
    return { buf, offset: Math.max(0, start / buf.sampleRate - 0.003), norm: Math.min(6, 0.9 / peak) };
  }

  unlock() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const m = this.settings.muted ? 0 : 1;
    const now = this.ctx.currentTime;
    const duck = this.voice?.current?.src ? 0.45 : 1; // music dips under the handler's voice
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.6 * m * duck, now, duck < 1 ? 0.08 : 0.4);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx * m, now, 0.05);
    this.voiceBus?.gain.setTargetAtTime(this.settings.voice * 1.4 * m, now, 0.05);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  set(key, value) { this.settings[key] = value; this.applyVolumes(); }

  // ---------- Handler voice ----------
  async loadVoice() {
    if (!this.ctx) return;
    await Promise.all(Object.keys(VOICE_LINES).map(async (key) => {
      try {
        const res = await fetch(`assets/audio/voice/${key}.mp3`);
        if (!res.ok) throw new Error(res.status);
        this.voice.buffers[key] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* no clip: the subtitle still shows */ }
    }));
  }

  // Queue a handler line. Higher priority interrupts; otherwise it waits (two at most) or is dropped.
  say(key) {
    const line = VOICE_LINES[key];
    if (!line) return;
    const now = performance.now() / 1000;
    const vs = this.voice;
    if (line.cd && now - (vs.last[key] ?? -1e9) < line.cd) return;
    const cur = vs.current;
    if (cur && cur.key === key) return;
    if (!cur) this.startLine(key);
    else if ((line.pri || 0) > cur.pri) { this.stopLine(); this.startLine(key); }
    else if (vs.queue.length < 2 && !vs.queue.includes(key)) {
      vs.queue.push(key);
      vs.queue.sort((a, b) => (VOICE_LINES[b].pri || 0) - (VOICE_LINES[a].pri || 0));
    }
  }

  startLine(key) {
    const line = VOICE_LINES[key];
    const vs = this.voice;
    vs.last[key] = performance.now() / 1000;
    const buf = vs.buffers[key];
    const dur = buf ? buf.duration : 1 + line.text.length * 0.06;
    const cur = { key, pri: line.pri || 0, src: null, timer: null };
    vs.current = cur;
    const audible = buf && this.ctx && this.ctx.state === 'running' && !this.settings.muted;
    if (audible) {
      const t = this.ctx.currentTime + 0.08;
      // Squelch clicks at the start and end of the transmission.
      this.noiseSrc(this.env(this.voiceIn, this.ctx.currentTime, 0.002, 0.06, 0.05), this.ctx.currentTime, 0.07, 'bandpass', 2500, 1800, 2);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceIn);
      src.start(t);
      cur.src = src;
      this.noiseSrc(this.env(this.voiceIn, t + dur, 0.002, 0.08, 0.04), t + dur, 0.09, 'bandpass', 2200, 1500, 2);
      this.applyVolumes();
    }
    this.onLine?.(key, line.text, dur + 0.3);
    cur.timer = setTimeout(() => { if (vs.current === cur) this.nextLine(); }, (dur + 0.35) * 1000);
  }

  stopLine() {
    const cur = this.voice.current;
    if (!cur) return;
    clearTimeout(cur.timer);
    try { cur.src?.stop(); } catch { /* not started */ }
    this.voice.current = null;
  }

  nextLine() {
    this.voice.current = null;
    this.applyVolumes();
    const next = this.voice.queue.shift();
    if (next) this.startLine(next);
  }

  // Drop anything pending (leaving a match, restarting).
  clearVoice() {
    this.voice.queue = [];
    this.stopLine();
    this.applyVolumes();
  }

  // ---------- Music ----------
  playMusic(name) {
    this.wanted = name;
    if (!this.ctx || this.current?.name === name) return;
    const buf = this.buffers[name];
    if (!buf) return; // loadAll() retries once buffers arrive
    const now = this.ctx.currentTime;
    const old = this.current;
    if (old) {
      old.alive = false;
      clearTimeout(old.timer);
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 1.2);
      setTimeout(() => { old.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } }); old.gain.disconnect(); }, 1500);
    }
    const gain = this.ctx.createGain();
    gain.connect(this.musicBus);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + (old ? 1.0 : 0.3));
    const track = { name, gain, sources: [], alive: true, timer: null };
    this.current = track;
    this.scheduleSegment(track, buf, TRACKS[name], 0, now + 0.05);
  }

  scheduleSegment(track, buf, cfg, offset, when) {
    if (!track.alive) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    src.connect(g).connect(track.gain);
    const loopEnd = Math.min(cfg.loopEnd, buf.duration);
    const fadeStart = when + (loopEnd - offset) - cfg.xfade;
    if (offset > 0) {
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + cfg.xfade);
    }
    g.gain.setValueAtTime(1, fadeStart);
    g.gain.linearRampToValueAtTime(0, fadeStart + cfg.xfade);
    src.start(when, offset);
    src.stop(fadeStart + cfg.xfade + 0.05);
    track.sources.push(src);
    src.onended = () => { track.sources = track.sources.filter((s) => s !== src); };
    const lead = Math.max(0, (fadeStart - this.ctx.currentTime - 6) * 1000);
    track.timer = setTimeout(() => this.scheduleSegment(track, buf, cfg, cfg.loopStart, fadeStart), lead);
  }

  // ---------- SFX ----------
  pan(x, bus = this.sfxBus) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = x == null ? 0 : Math.max(-1, Math.min(1, (x / W) * 2 - 1)) * 0.6;
    p.connect(bus);
    return p;
  }

  env(dest, t, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  osc(dest, type, f0, f1, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(o);
    return o;
  }

  noiseSrc(dest, t, dur, filterType, f0, f1, q = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    s.connect(f).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
    this.track(s);
    return s;
  }

  sample(name, dest, { rate = 1, gain = 1 } = {}) {
    const buf = this.bank[name]?.[0]?.buf;
    if (!buf) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start();
    this.track(s);
    return true;
  }

  track(node) {
    this.voices++;
    node.addEventListener('ended', () => { this.voices--; });
  }

  play(name, src) {
    if (!this.ctx || this.ctx.state !== 'running' || this.settings.muted) return;
    const now = this.ctx.currentTime;
    const spec = SFX[name];
    const gap = spec?.throttle ?? SYNTH_THROTTLE[name];
    if (gap && now - (this.last[name] || 0) < gap) return;
    const variants = spec && this.bank[spec.key];
    if (variants?.length) {
      if (spec.poly && (this.active[name] || 0) >= spec.poly) return;
      this.last[name] = now;
      this.playSample(name, spec, variants, src);
      return;
    }
    if (this.voices > 64 && gap) return;
    this.last[name] = now;
    this.synth(name, src);
  }

  playSample(name, spec, variants, src) {
    let i = Math.floor(Math.random() * variants.length);
    if (variants.length > 1 && i === this.lastVariant[name]) i = (i + 1) % variants.length;
    this.lastVariant[name] = i;
    const v = variants[i];
    const t = this.ctx.currentTime + 0.005;
    const s = this.ctx.createBufferSource();
    s.buffer = v.buf;
    s.playbackRate.value = (spec.rate || 1) + (Math.random() * 2 - 1) * (spec.jitter || 0);
    const g = this.ctx.createGain();
    g.gain.value = v.norm * spec.gain;
    s.connect(g).connect(this.pan(src?.x));
    const dur = v.buf.duration - v.offset;
    if (spec.maxDur && dur > spec.maxDur) {
      g.gain.setValueAtTime(v.norm * spec.gain, t + spec.maxDur - 0.06);
      g.gain.linearRampToValueAtTime(0, t + spec.maxDur);
      s.start(t, v.offset, spec.maxDur);
    } else {
      s.start(t, v.offset);
    }
    this.active[name] = (this.active[name] || 0) + 1;
    s.addEventListener('ended', () => { this.active[name]--; });
  }

  // Procedural fallback voices (used when a sample is missing).
  synth(name, src) {
    const now = this.ctx.currentTime;
    const t = now + 0.005;
    const out = this.pan(src?.x, WEAPONS.has(name) ? this.weaponBus : this.sfxBus);
    const r = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'laser': {
        const lv = src?.level || 0;
        this.osc(this.env(out, t, 0.002, 0.07, 0.05), 'square', 1500 * r + lv * 120, 260, t, 0.08);
        this.osc(this.env(out, t, 0.002, 0.05, 0.03), 'sawtooth', 3000 * r, 900, t, 0.05);
        this.osc(this.env(out, t, 0.002, 0.06, 0.05), 'sine', 190, 80, t, 0.06);
        break;
      }
      case 'plasma':
        this.osc(this.env(out, t, 0.005, 0.18, 0.14), 'sine', 260 * r, 70, t, 0.18);
        this.noiseSrc(this.env(out, t, 0.003, 0.1, 0.06), t, 0.1, 'lowpass', 1800, 300);
        break;
      case 'plasmahit':
        this.noiseSrc(this.env(out, t, 0.004, 0.3, 0.16), t, 0.3, 'lowpass', 2400, 180);
        this.osc(this.env(out, t, 0.004, 0.25, 0.2), 'sine', 120, 38, t, 0.25);
        break;
      case 'tesla': {
        this.osc(this.env(out, t, 0.002, 0.1, 0.06), 'sine', 140, 60, t, 0.1);
        const g = this.env(out, t, 0.003, 0.18, 0.09);
        this.noiseSrc(g, t, 0.18, 'bandpass', 3200 * r, 1400, 3);
        this.osc(this.env(out, t, 0.003, 0.14, 0.035), 'sawtooth', 95, 80, t, 0.14);
        this.osc(this.env(out, t, 0.002, 0.06, 0.04), 'square', 2400 * r, 1800, t, 0.06);
        break;
      }
      case 'cryo':
        this.noiseSrc(this.env(out, t, 0.03, 0.35, 0.05), t, 0.4, 'bandpass', 6000, 1500, 2);
        this.osc(this.env(out, t, 0.01, 0.3, 0.02), 'sine', 1800, 2600, t, 0.3);
        break;
      case 'rail':
        this.osc(this.env(out, t, 0.002, 0.35, 0.09), 'sawtooth', 2400 * r, 60, t, 0.35);
        this.noiseSrc(this.env(out, t, 0.001, 0.12, 0.18), t, 0.12, 'highpass', 5000, 1200);
        this.osc(this.env(out, t, 0.004, 0.3, 0.22), 'sine', 90, 30, t, 0.3);
        break;
      case 'pop':
        this.osc(this.env(out, t, 0.002, 0.07, 0.07), 'square', 700 * r, 1400 * r, t, 0.07);
        this.noiseSrc(this.env(out, t, 0.001, 0.05, 0.05), t, 0.05, 'highpass', 3000, 3000);
        break;
      case 'explode':
        if (!this.sample('explosion', out, { rate: 1.1 + Math.random() * 0.3, gain: 0.4 })) {
          this.noiseSrc(this.env(out, t, 0.003, 0.4, 0.2), t, 0.4, 'lowpass', 3000, 150);
        }
        break;
      case 'bossdeath':
        this.sample('explosion', out, { rate: 0.6, gain: 1 });
        this.noiseSrc(this.env(out, t, 0.01, 1.8, 0.25), t, 1.8, 'lowpass', 4000, 60);
        this.osc(this.env(out, t, 0.01, 1.4, 0.35), 'sine', 110, 25, t, 1.4);
        break;
      case 'shieldhit':
        this.osc(this.env(out, t, 0.001, 0.18, 0.05), 'triangle', 2600 * r, 2200, t, 0.18);
        this.osc(this.env(out, t, 0.004, 0.25, 0.03), 'sine', 880 * r, 900, t, 0.25);
        break;
      case 'shieldbreak':
        this.osc(this.env(out, t, 0.002, 0.2, 0.05), 'triangle', 2200 * r, 3400, t, 0.2);
        this.osc(this.env(out, t + 0.03, 0.002, 0.2, 0.04), 'triangle', 2900 * r, 1800, t + 0.03, 0.2);
        this.noiseSrc(this.env(out, t, 0.001, 0.12, 0.05), t, 0.12, 'highpass', 6000, 6000);
        break;
      case 'build':
        if (!this.sample('build', out, { gain: 0.55, rate: r })) {
          [520, 780, 1040].forEach((f, i) => this.osc(this.env(out, t + i * 0.05, 0.002, 0.1, 0.05), 'square', f, f, t + i * 0.05, 0.1));
        }
        break;
      case 'upgrade':
        [440, 554, 659, 880].forEach((f, i) => {
          this.osc(this.env(out, t + i * 0.06, 0.003, 0.14, 0.05), 'square', f, f * 1.01, t + i * 0.06, 0.14);
          this.osc(this.env(out, t + i * 0.06, 0.003, 0.2, 0.03), 'sawtooth', f * 2, f * 2, t + i * 0.06, 0.2);
        });
        this.sample('build', out, { gain: 0.3, rate: 1.4 });
        break;
      case 'sell':
        [900, 700, 520].forEach((f, i) => this.osc(this.env(out, t + i * 0.05, 0.002, 0.08, 0.05), 'square', f, f, t + i * 0.05, 0.08));
        break;
      case 'leak': {
        const g = this.env(out, t, 0.01, 0.5, 0.16);
        this.osc(g, 'sawtooth', 160, 80, t, 0.5);
        this.osc(g, 'square', 164, 82, t, 0.5);
        this.noiseSrc(this.env(out, t, 0.002, 0.2, 0.12), t, 0.2, 'lowpass', 1600, 200);
        break;
      }
      case 'emp':
        this.osc(this.env(out, t, 0.005, 0.8, 0.18), 'sawtooth', 1800, 40, t, 0.8);
        this.noiseSrc(this.env(out, t, 0.002, 0.6, 0.2), t, 0.6, 'bandpass', 5000, 200, 1.5);
        this.osc(this.env(out, t, 0.01, 0.6, 0.3), 'sine', 80, 30, t, 0.6);
        break;
      case 'orbital':
        this.osc(this.env(out, t, 0.6, 0.35, 0.08), 'sawtooth', 150, 3000, t, 0.95);
        this.osc(this.env(out, t, 0.6, 0.35, 0.05), 'square', 300, 6000, t, 0.95);
        break;
      case 'orbitalhit':
        this.sample('explosion', out, { rate: 0.75, gain: 0.9 });
        this.osc(this.env(out, t, 0.004, 0.9, 0.35), 'sine', 140, 28, t, 0.9);
        this.noiseSrc(this.env(out, t, 0.002, 0.9, 0.25), t, 0.9, 'lowpass', 6000, 100);
        break;
      case 'overclock':
        this.osc(this.env(out, t, 0.02, 0.6, 0.08), 'sawtooth', 220, 1760, t, 0.6);
        [440, 660, 880, 1320].forEach((f, i) => this.osc(this.env(out, t + 0.08 * i, 0.003, 0.25, 0.04), 'square', f, f, t + 0.08 * i, 0.25));
        break;
      case 'click':
        this.osc(this.env(out, t, 0.001, 0.035, 0.05), 'square', 1900, 1500, t, 0.035);
        break;
      case 'hover':
        this.osc(this.env(out, t, 0.001, 0.02, 0.015), 'sine', 2600, 2600, t, 0.02);
        break;
      case 'error':
        this.osc(this.env(out, t, 0.002, 0.09, 0.07), 'square', 150, 140, t, 0.09);
        this.osc(this.env(out, t + 0.11, 0.002, 0.09, 0.07), 'square', 120, 110, t + 0.11, 0.09);
        break;
      case 'wave_start':
        if (!this.sample('wave_start', out, { gain: 0.6 })) this.play('overclock');
        break;
      case 'boss_warning':
        this.sample('boss_warning', out, { gain: 0.9 });
        break;
      case 'victory':
        this.sample('victory', out, { gain: 0.9 });
        break;
      case 'game_over':
        this.sample('game_over', out, { gain: 0.9 });
        break;
    }
  }
}

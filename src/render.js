import { TILE, COLS, ROWS, W, H, TOWERS, ABILITIES } from './config.js';
import { pathTiles, seededRandom } from './game.js';

const TAU = Math.PI * 2;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

const glowCache = new Map();
function glowSprite(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, rgba(color, 1));
  grd.addColorStop(0.25, rgba(color, 0.45));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

export function glow(ctx, x, y, r, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function poly(ctx, n, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.rain = Array.from({ length: 110 }, () => this.newDrop(true));
    this.time = 0;
  }

  newDrop(anywhere) {
    return { x: Math.random() * (W + 200) - 100, y: anywhere ? Math.random() * H : -20, len: 8 + Math.random() * 14, v: 500 + Math.random() * 300 };
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scale = Math.min(cssW / W, cssH / H);
    const w = Math.floor(W * this.scale), h = Math.floor(H * this.scale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.pixelScale = this.scale * dpr;
  }

  setGame(game) {
    this.game = game;
    this.bg = this.renderBackground(game);
  }

  // ---------- Static background ----------
  renderBackground(game) {
    const S = 2;
    const c = document.createElement('canvas');
    c.width = W * S;
    c.height = H * S;
    const ctx = c.getContext('2d');
    ctx.scale(S, S);
    const theme = game.map.theme;
    const rnd = seededRandom(game.map.seed * 104729);

    const grd = ctx.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, theme.ground);
    grd.addColorStop(1, '#0c0618');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // Ground plating with circuit traces
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (game.grid[y][x] !== 0) continue;
        const px = x * TILE, py = y * TILE;
        ctx.fillStyle = `rgba(255,255,255,${0.006 + rnd() * 0.014})`;
        ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        if (rnd() < 0.35) {
          ctx.strokeStyle = rgba(theme.accent, 0.07 + rnd() * 0.06);
          ctx.lineWidth = 1;
          ctx.beginPath();
          let cx = px + 6 + Math.floor(rnd() * 4) * 9, cy = py + 6 + Math.floor(rnd() * 4) * 9;
          ctx.moveTo(cx, cy);
          for (let k = 0; k < 3; k++) {
            if (rnd() < 0.5) cx = px + 6 + Math.floor(rnd() * 4) * 9; else cy = py + 6 + Math.floor(rnd() * 4) * 9;
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
          ctx.fillStyle = rgba(theme.accent, 0.18);
          ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
        }
      }
    }

    // Grid
    ctx.strokeStyle = rgba(theme.accent, 0.05);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) { ctx.moveTo(x * TILE + 0.5, 0); ctx.lineTo(x * TILE + 0.5, H); }
    for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y * TILE + 0.5); ctx.lineTo(W, y * TILE + 0.5); }
    ctx.stroke();

    // Blocked scenery: rooftops with lit windows and antennae
    const neon = ['#ff2bd6', '#00f0ff', '#a855ff', '#ffe600', '#ff8a00'];
    for (const [x, y, size = 1] of game.blocked) {
      const px = x * TILE, py = y * TILE;
      if (size > 1) {
        ctx.fillStyle = '#120d24';
        ctx.fillRect(px + 2, py + 2, TILE * size - 6, TILE * size - 6);
      }
      const col = neon[Math.floor(rnd() * neon.length)];
      ctx.fillStyle = '#05030b';
      ctx.fillRect(px + 3, py + 6, TILE - 4, TILE - 4);
      ctx.fillStyle = '#120d24';
      ctx.fillRect(px + 2, py + 2, TILE - 6, TILE - 6);
      ctx.strokeStyle = rgba(col, 0.7);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 2.5, py + 2.5, TILE - 7, TILE - 7);
      for (let i = 0; i < 9; i++) {
        if (rnd() < 0.5) continue;
        ctx.fillStyle = rgba(rnd() < 0.7 ? '#ffe7a3' : col, 0.35 + rnd() * 0.4);
        ctx.fillRect(px + 7 + (i % 3) * 11, py + 7 + Math.floor(i / 3) * 11, 5, 3);
      }
      if (rnd() < 0.6) {
        ctx.strokeStyle = 'rgba(200,200,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(px + TILE - 12, py + 6);
        ctx.lineTo(px + TILE - 12, py - 6);
        ctx.stroke();
        ctx.drawImage(glowSprite('#ff3355'), px + TILE - 18, py - 12, 12, 12);
      }
    }

    // Road surface
    const isPath = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && game.grid[y][x] === 1;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!isPath(x, y)) continue;
        ctx.fillStyle = '#16102b';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.fillStyle = rgba(theme.path, 0.035);
        ctx.fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6);
      }
    }
    // Neon road edges
    const edges = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!isPath(x, y)) continue;
        const px = x * TILE, py = y * TILE;
        if (y > 0 && !isPath(x, y - 1)) edges.push([px, py, px + TILE, py]);
        if (y < ROWS - 1 && !isPath(x, y + 1)) edges.push([px, py + TILE, px + TILE, py + TILE]);
        if (x > 0 && !isPath(x - 1, y)) edges.push([px, py, px, py + TILE]);
        if (x < COLS - 1 && !isPath(x + 1, y)) edges.push([px + TILE, py, px + TILE, py + TILE]);
      }
    }
    const strokeEdges = (width, alpha, color) => {
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of edges) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    strokeEdges(10, 0.06, theme.path);
    strokeEdges(5, 0.14, theme.path);
    strokeEdges(1.6, 0.9, theme.path);

    // Core pad
    const core = game.core;
    ctx.fillStyle = '#0a0716';
    ctx.beginPath();
    ctx.arc(core.x, core.y, TILE * 0.9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(theme.accent, 0.4);
    ctx.lineWidth = 2;
    ctx.stroke();
    return c;
  }

  // ---------- Frame ----------
  render(game, ui, realDt) {
    const ctx = this.ctx;
    this.time += realDt;
    const t = this.time;
    ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    ctx.drawImage(this.bg, 0, 0, W, H);

    this.drawPathFlow(ctx, game, t);
    this.drawPortals(ctx, game, t);
    this.drawCore(ctx, game, t);
    this.drawRanges(ctx, game, ui, t);

    for (const tw of game.towers) this.drawTowerBase(ctx, tw, ui.selected === tw);
    for (const e of game.enemies) if (!e.flying) this.drawEnemy(ctx, e, t);
    for (const tw of game.towers) this.drawTurret(ctx, tw, game, t);
    for (const e of game.enemies) if (e.flying) this.drawEnemy(ctx, e, t);

    ctx.globalCompositeOperation = 'lighter';
    this.drawProjectiles(ctx, game, t);
    this.drawFx(ctx, game, t);
    ctx.globalCompositeOperation = 'source-over';

    for (const e of game.enemies) this.drawBars(ctx, e);
    this.drawTexts(ctx, game);
    this.drawCursor(ctx, game, ui, t);
    ctx.restore();

    this.drawRain(ctx, realDt);
    if (game.coreHit > 0) {
      ctx.fillStyle = `rgba(255,30,60,${game.coreHit * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (game.overclockT > 0) {
      ctx.strokeStyle = rgba('#ffe600', 0.25 + 0.15 * Math.sin(t * 12));
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }
  }

  drawPathFlow(ctx, game, t) {
    ctx.save();
    ctx.setLineDash([4, 20]);
    ctx.lineDashOffset = -t * 36;
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(game.map.theme.path, 0.4);
    for (const p of game.paths) {
      ctx.beginPath();
      p.pts.forEach((pt, i) => ctx[i ? 'lineTo' : 'moveTo'](pt.x, pt.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPortals(ctx, game, t) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.paths) {
      const a = p.pts[0], b = p.pts[1];
      const x = Math.max(4, Math.min(W - 4, a.x)), y = Math.max(4, Math.min(H - 4, a.y));
      const vertical = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
      glow(ctx, x, y, 46, '#ff3355', 0.5 + 0.2 * Math.sin(t * 6));
      ctx.strokeStyle = rgba('#ff3355', 0.9);
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const o = ((t * 30 + i * 9) % 36) - 18;
        ctx.globalAlpha = 1 - Math.abs(o) / 18;
        ctx.beginPath();
        if (vertical) { ctx.moveTo(x + o * 0.3, y - 22); ctx.lineTo(x + o * 0.3, y + 22); }
        else { ctx.moveTo(x - 22, y + o * 0.3); ctx.lineTo(x + 22, y + o * 0.3); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawCore(ctx, game, t) {
    const c = game.core;
    const hp = game.lives / game.maxLives;
    const col = hp > 0.5 ? game.map.theme.accent : hp > 0.25 ? '#ffe600' : '#ff3355';
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, c.x, c.y, 70 + Math.sin(t * 3) * 6, col, 0.55);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = col;
    ctx.rotate(t * 0.6);
    poly(ctx, 6, 30);
    ctx.stroke();
    ctx.rotate(-t * 1.5);
    ctx.strokeStyle = rgba(col, 0.7);
    poly(ctx, 6, 21);
    ctx.stroke();
    ctx.rotate(t * 2.2);
    ctx.fillStyle = rgba(col, 0.25 + 0.15 * Math.sin(t * 5));
    poly(ctx, 4, 12);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  drawRanges(ctx, game, ui, t) {
    for (const tw of game.towers) {
      if (tw.type !== 'uplink') continue;
      ctx.fillStyle = rgba('#39ff14', 0.035 + 0.015 * Math.sin(t * 2 + tw.id));
      ctx.beginPath();
      ctx.arc(tw.x, tw.y, tw.range, 0, TAU);
      ctx.fill();
    }
    const sel = ui.selected;
    if (sel) {
      ctx.fillStyle = rgba(sel.def.color, 0.07);
      ctx.strokeStyle = rgba(sel.def.color, 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, sel.range, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawTowerBase(ctx, tw, selected) {
    const s = TILE * 0.42 * (0.6 + 0.4 * tw.built);
    ctx.save();
    ctx.translate(tw.x, tw.y);
    ctx.fillStyle = '#0b0d1c';
    ctx.strokeStyle = rgba(tw.def.color, selected ? 1 : 0.55);
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(-s + 6, -s); ctx.lineTo(s, -s); ctx.lineTo(s, s - 6); ctx.lineTo(s - 6, s); ctx.lineTo(-s, s); ctx.lineTo(-s, -s + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < tw.level ? tw.def.color : 'rgba(255,255,255,0.12)';
      ctx.fillRect(-9 + i * 7, s - 5, 5, 3);
    }
    ctx.restore();
  }

  drawTurret(ctx, tw, game, t) {
    const c = tw.def.color;
    const lv = tw.level;
    ctx.save();
    ctx.translate(tw.x, tw.y);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, 26 + lv * 4 + tw.fireFlash * 60, c, 0.25 + tw.fireFlash * 2);
    if (tw.buffDmg > 0) glow(ctx, 0, 0, 30, '#39ff14', 0.12);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 2;
    ctx.strokeStyle = c;
    ctx.fillStyle = '#0d1022';
    switch (tw.type) {
      case 'laser': {
        ctx.rotate(tw.angle);
        ctx.fillRect(0, -3 - lv * 0.5, 20 + lv * 2, 6 + lv);
        ctx.strokeRect(0, -3 - lv * 0.5, 20 + lv * 2, 6 + lv);
        if (lv >= 2) { ctx.strokeRect(2, -8, 12, 3); ctx.strokeRect(2, 5, 12, 3); }
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
        break;
      }
      case 'plasma': {
        ctx.rotate(tw.angle);
        ctx.fillRect(2, -6, 14 + lv * 2, 12);
        ctx.strokeRect(2, -6, 14 + lv * 2, 12);
        poly(ctx, 6, 12 + lv);
        ctx.fill(); ctx.stroke();
        const pulse = 4 + Math.sin(t * 6 + tw.id) * 1.5 + lv;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, pulse, 0, TAU); ctx.fill();
        break;
      }
      case 'tesla': {
        for (let i = 0; i < 3 + lv; i++) {
          ctx.strokeStyle = rgba(c, 0.5 + i * 0.12);
          ctx.beginPath(); ctx.arc(0, 0, 14 - i * 3, 0, TAU); ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, 3.5 + Math.random() * 1.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(c, 0.8);
        ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * TAU;
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * 8 + (Math.random() - 0.5) * 4, Math.sin(a) * 8);
          ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
          ctx.stroke();
        }
        break;
      }
      case 'cryo': {
        ctx.rotate(tw.angle);
        for (let i = 0; i < 3; i++) {
          ctx.rotate(TAU / 3);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -15 - lv); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(0, -6); ctx.lineTo(4, -10); ctx.stroke();
        }
        poly(ctx, 6, 7);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = rgba('#bfe3ff', 0.8 + tw.fireFlash);
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
        break;
      }
      case 'rail': {
        ctx.rotate(tw.angle);
        const len = 24 + lv * 2;
        ctx.fillRect(-8, -7, len + 8, 14);
        ctx.beginPath();
        ctx.moveTo(-6, -5); ctx.lineTo(len, -5);
        ctx.moveTo(-6, 5); ctx.lineTo(len, 5);
        ctx.stroke();
        const charge = 1 - Math.min(1, Math.max(0, tw.cd) * tw.stats.rate);
        ctx.fillStyle = rgba(c, 0.3 + charge * 0.7);
        ctx.fillRect(-4, -2, (len - 2) * charge, 4);
        ctx.strokeRect(-11, -9, 10, 18);
        break;
      }
      case 'uplink': {
        ctx.strokeStyle = rgba(c, 0.8);
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.stroke();
        ctx.rotate(tw.angle);
        ctx.fillStyle = rgba(c, 0.25);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 12, 0, 0.9); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = c;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 0); ctx.stroke();
        ctx.fillStyle = c;
        ctx.fillRect(-2.5, -2.5, 5, 5);
        break;
      }
    }
    ctx.restore();

    if (tw.type === 'uplink') {
      ctx.save();
      ctx.setLineDash([2, 6]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = rgba('#39ff14', 0.35);
      ctx.lineWidth = 1;
      for (const o of game.towers) {
        if (o === tw || o.type === 'uplink') continue;
        if ((o.x - tw.x) ** 2 + (o.y - tw.y) ** 2 > (tw.range + 1) ** 2) continue;
        ctx.beginPath(); ctx.moveTo(tw.x, tw.y); ctx.lineTo(o.x, o.y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawEnemy(ctx, e, t) {
    const r = e.radius;
    const c = e.def.color;
    const cloaked = !e.revealed;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.flying) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(6, 12, r * 0.9, r * 0.45, 0, 0, TAU); ctx.fill();
      ctx.translate(0, -4 + Math.sin(e.anim * 5) * 1.5);
    }
    if (cloaked) ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 20 + e.id);
    if (!cloaked) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, 0, r * (e.def.boss ? 2.6 : 2.2), c, e.def.boss ? 0.5 : 0.3);
      ctx.globalCompositeOperation = 'source-over';
    }
    const stroke = e.flash > 0 ? '#ffffff' : c;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = '#0a0814';
    ctx.lineWidth = 2;
    ctx.rotate(e.angle);
    switch (e.type) {
      case 'runner': {
        const step = Math.sin(e.anim * 14) * 3;
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.8, -r * 0.8); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.8, r * 0.8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = c;
        ctx.fillRect(-2 + step * 0.3, -2, 4, 4);
        break;
      }
      case 'drone': {
        ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(-r, r); ctx.lineTo(r, -r); ctx.stroke();
        for (const [dx, dy] of [[-r, -r], [r, r], [-r, r], [r, -r]]) {
          ctx.beginPath(); ctx.arc(dx, dy, r * 0.42, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.save(); ctx.translate(dx, dy); ctx.rotate(e.anim * 40);
          ctx.beginPath(); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * 0.4, 0); ctx.stroke(); ctx.restore();
        }
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
        break;
      }
      case 'brute': {
        const s = Math.sin(e.anim * 6) * 3;
        ctx.fillRect(-r * 0.4, -r - 2 + s, r * 0.8, 6);
        ctx.fillRect(-r * 0.4, r - 4 - s, r * 0.8, 6);
        ctx.strokeRect(-r * 0.4, -r - 2 + s, r * 0.8, 6);
        ctx.strokeRect(-r * 0.4, r - 4 - s, r * 0.8, 6);
        ctx.fillStyle = '#0a0814';
        ctx.fillRect(-r * 0.75, -r * 0.7, r * 1.5, r * 1.4);
        ctx.strokeRect(-r * 0.75, -r * 0.7, r * 1.5, r * 1.4);
        ctx.fillStyle = c;
        ctx.fillRect(r * 0.35, -4, 6, 8);
        ctx.strokeRect(-r * 0.45, -r * 0.4, r * 0.6, r * 0.8);
        break;
      }
      case 'aegis': {
        poly(ctx, 6, r * 0.85);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = c;
        poly(ctx, 3, r * 0.35);
        ctx.fill();
        if (e.shield > 0) {
          const k = e.shield / e.maxShield;
          ctx.strokeStyle = rgba('#7fb2ff', 0.25 + 0.5 * k);
          ctx.fillStyle = rgba('#3d8bff', 0.08 + 0.1 * k);
          ctx.lineWidth = 1.5;
          poly(ctx, 6, r * 1.45, t * 0.8);
          ctx.fill(); ctx.stroke();
        }
        break;
      }
      case 'phantom': {
        ctx.beginPath(); ctx.moveTo(r * 1.1, 0); ctx.lineTo(-r * 0.7, -r * 0.9); ctx.lineTo(-r * 0.2, 0); ctx.lineTo(-r * 0.7, r * 0.9); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = rgba(c, 0.5);
        ctx.beginPath(); ctx.moveTo(-r * 1.4, -4); ctx.lineTo(-r * 0.6, -4); ctx.moveTo(-r * 1.6, 4); ctx.lineTo(-r * 0.7, 4); ctx.stroke();
        break;
      }
      case 'splitter':
      case 'mite': {
        const wob = e.type === 'splitter' ? 3 : 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * TAU;
          const rr = r * (0.85 + 0.15 * Math.sin(a * 3 + e.anim * 6)) + (i % 2 ? wob * 0.3 : 0);
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        if (e.type === 'splitter') {
          ctx.fillStyle = rgba(c, 0.7);
          for (let i = 0; i < 3; i++) {
            const a = e.anim * 2 + (i / 3) * TAU;
            ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.2, 0, TAU); ctx.fill();
          }
        }
        break;
      }
      case 'medic': {
        ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#39ff14';
        ctx.fillRect(-2, -r * 0.55, 4, r * 1.1);
        ctx.fillRect(-r * 0.55, -2, r * 1.1, 4);
        const ph = (e.anim * 0.8) % 1;
        ctx.strokeStyle = rgba('#39ff14', 0.4 * (1 - ph));
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, e.def.heal.radius * TILE * ph, 0, TAU); ctx.stroke();
        break;
      }
      case 'titan': {
        ctx.lineWidth = 3;
        poly(ctx, 8, r);
        ctx.fill(); ctx.stroke();
        ctx.rotate(-e.angle + e.anim * 0.8);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(TAU / 4);
          ctx.strokeRect(r * 0.3, -6, r * 0.45, 12);
        }
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 7 + Math.sin(t * 6) * 2, 0, TAU); ctx.fill();
        break;
      }
      case 'overmind': {
        ctx.lineWidth = 3;
        ctx.rotate(-e.angle);
        ctx.save(); ctx.rotate(e.anim * 0.6); poly(ctx, 3, r); ctx.fill(); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.rotate(-e.anim * 0.9); poly(ctx, 3, r * 0.9); ctx.stroke(); ctx.restore();
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r * 0.3, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff3355';
        ctx.beginPath(); ctx.arc(Math.sin(t * 2) * 6, 0, 6, 0, TAU); ctx.fill();
        if (e.shield > 0) {
          ctx.strokeStyle = rgba('#7fb2ff', 0.3 + 0.4 * (e.shield / e.maxShield));
          ctx.beginPath(); ctx.arc(0, 0, r * 1.25, 0, TAU); ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
    if (e.slowT > 0 || e.stunT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      if (e.slowT > 0) glow(ctx, e.x, e.y, r * 1.8, '#3d8bff', 0.35);
      if (e.stunT > 0) {
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * TAU;
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(a) * r * 0.5, e.y + Math.sin(a) * r * 0.5);
          ctx.lineTo(e.x + Math.cos(a + 0.4) * r * 1.4, e.y + Math.sin(a + 0.4) * r * 1.4);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawBars(ctx, e) {
    if (!e.revealed) return;
    const damaged = e.hp < e.maxHp - 0.5 || (e.maxShield && e.shield < e.maxShield - 0.5);
    if (!damaged && !e.def.boss) return;
    const w = Math.max(22, e.radius * 2.4);
    const x = e.x - w / 2, y = e.y - e.radius - (e.flying ? 14 : 9);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    const k = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = k > 0.5 ? '#39ff14' : k > 0.25 ? '#ffe600' : '#ff3355';
    ctx.fillRect(x, y, w * k, 3);
    if (e.maxShield) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 1, y - 5, w + 2, 4);
      ctx.fillStyle = '#5aa0ff';
      ctx.fillRect(x, y - 4, w * (e.shield / e.maxShield), 2);
    }
  }

  drawProjectiles(ctx, game) {
    for (const p of game.projectiles) {
      const k = p.t / p.dur;
      const x = p.x0 + (p.tx - p.x0) * k;
      const y = p.y0 + (p.ty - p.y0) * k - Math.sin(k * Math.PI) * 38;
      glow(ctx, x, y, 16, p.color, 0.9);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(p.color, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.tx, p.ty, p.splash * (0.3 + 0.7 * k), 0, TAU); ctx.stroke();
    }
    for (const s of game.fx.strikes) {
      const k = Math.min(1, s.t / s.delay);
      if (s.t < s.delay) {
        ctx.strokeStyle = rgba('#ff2bd6', 0.3 + 0.6 * k);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1.4 - 0.4 * k), 0, TAU); ctx.stroke();
        ctx.lineWidth = 1 + k * 4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - H); ctx.stroke();
      } else {
        const f = 1 - (s.t - s.delay) / 0.5;
        glow(ctx, s.x, s.y - 100, 120, '#ff2bd6', f * 0.6);
        ctx.fillStyle = rgba('#ffffff', f * 0.8);
        ctx.fillRect(s.x - 10 * f, 0, 20 * f, s.y);
        glow(ctx, s.x, s.y, s.r * 2, '#ff2bd6', f);
      }
    }
  }

  drawFx(ctx, game) {
    const fx = game.fx;
    ctx.lineCap = 'round';
    for (const b of fx.beams) {
      const k = b.life / b.max;
      ctx.strokeStyle = rgba(b.color, 0.35 * k);
      ctx.lineWidth = b.width * 3;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.9 * k);
      ctx.lineWidth = b.width * 0.6;
      ctx.stroke();
      glow(ctx, b.x2, b.y2, 10 + b.width * 2, b.color, k);
    }
    for (const b of fx.bolts) {
      const k = b.life / b.max;
      const path = () => { ctx.beginPath(); b.pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); };
      ctx.strokeStyle = rgba(b.color, 0.4 * k);
      ctx.lineWidth = 6;
      path(); ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', k);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      for (const n of b.nodes) glow(ctx, n.x, n.y, 16, b.color, k);
    }
    for (const r of fx.rings) {
      const k = r.life / r.max;
      const rad = r.r1 + (r.r0 - r.r1) * k;
      ctx.strokeStyle = rgba(r.color, k * 0.9);
      ctx.lineWidth = r.width;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
    }
    for (const p of fx.parts) {
      const k = Math.min(1, p.life / 0.4);
      ctx.fillStyle = rgba(p.color, k);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }

  drawTexts(ctx, game) {
    ctx.textAlign = 'center';
    for (const tx of game.fx.texts) {
      ctx.globalAlpha = Math.min(1, tx.life * 2);
      ctx.font = `700 ${tx.size}px "Share Tech Mono", monospace`;
      ctx.fillStyle = '#000';
      ctx.fillText(tx.text, tx.x + 1, tx.y + 1);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  }

  drawCursor(ctx, game, ui, t) {
    if (!ui.hover) return;
    const { x, y, tx, ty } = ui.hover;
    if (ui.ability) {
      const ab = ABILITIES[ui.ability];
      const r = ab.radius * TILE;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = ab.color;
      ctx.fillStyle = rgba(ab.color, 0.08);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.rotate(t);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-t * 2);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(TAU / 4);
        ctx.beginPath(); ctx.moveTo(r * 0.3, 0); ctx.lineTo(r * 0.55, 0); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (ui.placing) {
      const def = TOWERS[ui.placing];
      const ok = game.canPlace(tx, ty) && game.credits >= def.cost;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      ctx.fillStyle = ok ? 'rgba(57,255,20,0.14)' : 'rgba(255,51,85,0.2)';
      ctx.strokeStyle = ok ? '#39ff14' : '#ff3355';
      ctx.lineWidth = 1.5;
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
      const r = def.stats[0].range * TILE;
      ctx.fillStyle = rgba(def.color, 0.06);
      ctx.strokeStyle = rgba(def.color, ok ? 0.7 : 0.3);
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.6;
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, cx, cy, 30, def.color, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else if (tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && game.grid[ty][tx] !== 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
    }
  }

  drawRain(ctx, dt) {
    ctx.strokeStyle = 'rgba(160,200,255,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.rain.length; i++) {
      const d = this.rain[i];
      d.y += d.v * dt;
      d.x -= d.v * 0.25 * dt;
      if (d.y > H + 20) this.rain[i] = this.newDrop(false);
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * 0.25, d.y - d.len);
    }
    ctx.stroke();
  }
}

// Small icon renderer used by the shop / threat cards.
export function drawTowerIcon(canvas, type) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width / 48;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 48, 48);
  const fake = {
    type, def: TOWERS[type], x: 24, y: 24, level: 1, angle: -Math.PI / 4, fireFlash: 0, buffDmg: 0, built: 1, id: 0, cd: 0,
    stats: TOWERS[type].stats[1], range: 0,
  };
  const r = new Renderer(canvas);
  r.drawTowerBase(ctx, fake, false);
  r.drawTurret(ctx, fake, { towers: [] }, 0.5);
}

export function drawEnemyIcon(canvas, type, def) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width / 64;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 64, 64);
  const scale = def.boss ? 0.55 : 1;
  ctx.translate(32, 32);
  ctx.scale(scale, scale);
  ctx.translate(-32, -32);
  const fake = {
    type, def, x: 32, y: 32, radius: def.radius * TILE * 1.2, flying: !!def.flying, revealed: true, angle: 0,
    anim: 0.3, flash: 0, shield: def.shield || 0, maxShield: def.shield || 0, slowT: 0, stunT: 0, id: 1,
  };
  new Renderer(canvas).drawEnemy(ctx, fake, 0.3);
}

// Animated synthwave skyline behind the menus: sun, parallax towers, perspective grid, rain, flying cars.
import { seededRandom } from './game.js';

export class TitleFx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.layers = [];
    this.cars = [];
    this.drops = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.horizon = this.h * 0.62;
    this.layers = [0, 1, 2].map((i) => this.makeLayer(i));
    this.drops = Array.from({ length: 160 }, () => this.drop(true));
  }

  makeLayer(depth) {
    const rnd = seededRandom(1337 + depth * 17);
    const width = this.w * 2;
    const c = document.createElement('canvas');
    const maxH = this.horizon * (0.26 + depth * 0.13);
    c.width = width;
    c.height = Math.ceil(maxH) + 40;
    const g = c.getContext('2d');
    const base = ['#1a0b33', '#10071f', '#07030f'][depth];
    let x = 0;
    while (x < width) {
      const bw = 30 + rnd() * (60 + depth * 30);
      const bh = maxH * (0.3 + rnd() * 0.7);
      const top = c.height - bh;
      g.fillStyle = base;
      g.fillRect(x, top, bw, bh);
      if (rnd() < 0.3) {
        g.fillRect(x + bw * 0.4, top - 20 - rnd() * 30, 2, 40);
      }
      const winColor = ['#ff2bd6', '#00f0ff', '#ffe7a3', '#a855ff'][Math.floor(rnd() * 4)];
      for (let wy = top + 8; wy < c.height - 6; wy += 7 + depth) {
        for (let wx = x + 4; wx < x + bw - 4; wx += 6 + depth) {
          if (rnd() < 0.18 + depth * 0.06) {
            g.fillStyle = winColor;
            g.globalAlpha = (0.2 + rnd() * 0.5) * (1 - depth * 0.15);
            g.fillRect(wx, wy, 2 + depth * 0.5, 2);
          }
        }
      }
      g.globalAlpha = 1;
      if (depth === 2 && rnd() < 0.25) {
        const col = ['#ff2bd6', '#00f0ff', '#ffe600'][Math.floor(rnd() * 3)];
        g.shadowColor = col;
        g.shadowBlur = 12;
        g.fillStyle = col;
        g.fillRect(x + 6, top + 14 + rnd() * 30, bw * 0.5, 4);
        g.shadowBlur = 0;
      }
      x += bw + rnd() * 6;
    }
    return { c, speed: [4, 9, 16][depth], y: this.horizon - c.height + 6 };
  }

  drop(anywhere) {
    return { x: Math.random() * (this.w + 200), y: anywhere ? Math.random() * this.h : -20, l: 10 + Math.random() * 16, v: 600 + Math.random() * 400 };
  }

  render(dt) {
    this.t += dt;
    const { ctx, w, h, horizon, t } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#05010f');
    sky.addColorStop(0.55, '#1b0634');
    sky.addColorStop(1, '#4a0b4f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    const drawLayer = (L) => {
      const off = (t * L.speed) % (L.c.width / 2);
      ctx.drawImage(L.c, -off, L.y);
      ctx.drawImage(L.c, -off + L.c.width, L.y);
    };
    drawLayer(this.layers[0]);

    // Sun
    const sr = Math.min(w, h) * 0.22;
    const sx = w / 2, sy = horizon - sr * 0.45;
    const sun = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
    sun.addColorStop(0, '#ffe600');
    sun.addColorStop(0.5, '#ff5ea8');
    sun.addColorStop(1, '#ff2bd6');
    ctx.save();
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 60;
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Horizontal cut-outs drifting down through the lower half, classic outrun style.
    ctx.fillStyle = '#2a0842';
    const drift = (t * 0.25) % 1;
    for (let i = 0; i < 8; i++) {
      const k = (i + drift) / 8;
      ctx.fillRect(sx - sr, sy + sr * (k * 1.05 - 0.05), sr * 2, 1 + k * 8);
    }

    drawLayer(this.layers[1]);
    drawLayer(this.layers[2]);

    // Flying cars
    if (Math.random() < dt * 0.8) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.cars.push({ x: dir > 0 ? -40 : w + 40, y: horizon * (0.25 + Math.random() * 0.5), v: dir * (60 + Math.random() * 120), c: Math.random() < 0.5 ? '#ff3355' : '#00f0ff' });
    }
    this.cars = this.cars.filter((c) => c.x > -60 && c.x < w + 60);
    for (const c of this.cars) {
      c.x += c.v * dt;
      ctx.fillStyle = c.c;
      ctx.shadowColor = c.c;
      ctx.shadowBlur = 10;
      ctx.fillRect(c.x, c.y, 10, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(c.x + (c.v > 0 ? 9 : -1), c.y, 3, 2);
    }
    ctx.shadowBlur = 0;

    // Ground + perspective grid
    const gnd = ctx.createLinearGradient(0, horizon, 0, h);
    gnd.addColorStop(0, '#12031f');
    gnd.addColorStop(1, '#05010a');
    ctx.fillStyle = gnd;
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.strokeStyle = 'rgba(255,43,214,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = 26;
    for (let i = -n; i <= n; i++) {
      ctx.moveTo(w / 2 + i * 8, horizon);
      ctx.lineTo(w / 2 + i * (w / 10), h);
    }
    const phase = (t * 0.6) % 1;
    for (let i = 0; i < 14; i++) {
      const z = (i + phase) / 14;
      const yy = horizon + (h - horizon) * z * z;
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
    }
    ctx.stroke();
    const haze = ctx.createLinearGradient(0, horizon - 30, 0, horizon + 40);
    haze.addColorStop(0, 'rgba(255,43,214,0)');
    haze.addColorStop(0.5, 'rgba(255,43,214,0.35)');
    haze.addColorStop(1, 'rgba(255,43,214,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 30, w, 70);

    // Rain
    ctx.strokeStyle = 'rgba(170,200,255,0.18)';
    ctx.beginPath();
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y += d.v * dt;
      d.x -= d.v * 0.2 * dt;
      if (d.y > h) this.drops[i] = this.drop(false);
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.l * 0.2, d.y - d.l);
    }
    ctx.stroke();

    // Scanlines + vignette
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }
}

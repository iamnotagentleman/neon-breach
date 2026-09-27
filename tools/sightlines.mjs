// Level-design aid: how much road a tower on each buildable tile can actually see, with buildings blocking sight.
// Usage: node tools/sightlines.mjs [mapIndex] [range=3]
//        BUILDINGS='[[x,y,size],...]' node tools/sightlines.mjs 0   (try a layout without editing config)
import { MAPS, TILE, COLS, ROWS } from '../src/config.js';
import { Game, buildGrid, losRects, segmentBlock } from '../src/game.js';

const idx = Number(process.argv[2] || 0);
const range = Number(process.argv[3] || 3) * TILE;
const map = { ...MAPS[idx] };
if (process.env.BUILDINGS) map.buildings = JSON.parse(process.env.BUILDINGS);

// Road sample points every 8px, like the balance sim uses.
const game = new Game(idx, {});
const pts = [];
for (const p of game.paths) {
  for (let d = 0; d < p.length; d += 8) {
    let i = 0;
    while (i < p.pts.length - 2 && d > p.cum[i + 1]) i++;
    const a = p.pts[i], b = p.pts[i + 1], t = (d - p.cum[i]) / (p.cum[i + 1] - p.cum[i]);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x >= 0 && y >= 0 && x <= COLS * TILE && y <= ROWS * TILE) pts.push({ x, y });
  }
}

function coverage(grid, rects) {
  const out = [];
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (grid[ty][tx] !== 0) continue;
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    let n = 0;
    for (const p of pts) {
      if ((p.x - x) ** 2 + (p.y - y) ** 2 > range * range) continue;
      if (segmentBlock(rects, x, y, p.x, p.y) === Infinity) n++;
    }
    out.push({ tx, ty, n });
  }
  return out;
}

const open = buildGrid({ ...map, buildings: [] });
const walled = buildGrid(map);
const before = coverage(open.grid, []);
const after = coverage(walled.grid, losRects(walled.blocked));
const top = (c, k) => [...c].sort((a, b) => b.n - a.n).slice(0, k);
const avg = (c) => c.reduce((a, b) => a + b.n, 0) / c.length;

console.log(`${map.name}  range ${range / TILE}  buildings: ${walled.blocked.map((b) => b.join(',')).join('  ')}`);
console.log(`best spot   open ${top(before, 1)[0].n}  →  with buildings ${top(after, 1)[0].n}`);
console.log(`top-10 avg  open ${avg(top(before, 10)).toFixed(0)}  →  with buildings ${avg(top(after, 10)).toFixed(0)}`);
console.log(`buildable   open ${before.length}  →  with buildings ${after.length}`);
const max = top(after, 1)[0].n || 1;
const cell = new Map(after.map((c) => [c.ty * COLS + c.tx, c.n]));
console.log('\n    ' + [...Array(COLS).keys()].map((x) => x % 10).join(''));
for (let y = 0; y < ROWS; y++) {
  let row = '';
  for (let x = 0; x < COLS; x++) {
    const g = walled.grid[y][x];
    if (g === 1) row += '·';
    else if (g === 2) row += '█';
    else row += Math.min(9, Math.floor((cell.get(y * COLS + x) / max) * 9.99));
  }
  console.log(String(y).padStart(3) + ' ' + row);
}
console.log('\n· road   █ building   0-9 share of the best spot\'s visible road');

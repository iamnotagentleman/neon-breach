// Concept art for the image-to-3D pipeline via eachlabs (EACHLABS_API_KEY in .env).
// Usage: node tools/concept.mjs <name> <prompt | @prompt.txt> [--model seedream|gpt|gpt-flare] [--ref <path|url>]...
//        [--n 1] [--ratio 1:1] [--res 2K] [--quality high] [--bg opaque|transparent]   (quality/bg: GPT Image only)
// Without --ref it runs text-to-image; with --ref the edit model gets those images as references.
// Writes concept/generated/<name>.png (then <name>_v2.png, ...) and appends every prompt to concept/prompts.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const API = 'https://api.eachlabs.ai/v1';
// Seedream 5.0 Pro, and GPT Image 2.5 Sunburst (quality) / Flare (fast). Their inputs are named differently.
const GPT_SIZES = { '1:1': '2048x2048', '16:9': '2048x1152', '3:2': '1536x1024', '2:3': '1024x1536' };
const MODELS = {
  seedream: {
    t2i: 'bytedance-seedream-v5-pro-text-to-image', edit: 'bytedance-seedream-v5-pro-edit',
    input: (o, refs) => ({ aspect_ratio: o.ratio, resolution: o.res, output_format: 'png', ...(refs.length && { image: refs }) }),
  },
  gpt: { t2i: 'gpt-image-v2-5-sunburst-text-to-image', edit: 'gpt-image-v2-5-sunburst-edit' },
  'gpt-flare': { t2i: 'gpt-image-v2-5-flare-text-to-image', edit: 'gpt-image-v2-5-flare-edit' },
};
MODELS.gpt.input = MODELS['gpt-flare'].input = (o, refs) => {
  const size = o.res === '1K' ? '1024x1024' : GPT_SIZES[o.ratio] || 'auto';
  return { quality: o.quality, background: o.bg, output_format: 'png', num_images: 1, ...(refs.length ? { image_urls: refs, image_size: size } : { size }) };
};
const OUT = 'concept/generated/';
const LOG = 'concept/prompts.json';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const KEY = process.env.EACHLABS_API_KEY || env.EACHLABS_API_KEY;
if (!KEY) throw new Error('EACHLABS_API_KEY missing (.env)');
const auth = { Authorization: `Bearer ${KEY}` };

const args = process.argv.slice(2);
const opt = { model: 'seedream', ref: [], n: 1, ratio: '1:1', res: '2K', quality: 'high', bg: 'opaque' };
const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ref') opt.ref.push(args[++i]);
  else if (a.startsWith('--')) opt[a.slice(2)] = args[++i];
  else pos.push(a);
}
const [name, promptArg] = pos;
if (!name || !promptArg) {
  console.error('usage: node tools/concept.mjs <name> <prompt | @file> [--model seedream|gpt|gpt-flare] [--ref img]... [--n 1]');
  process.exit(1);
}
const prompt = (promptArg.startsWith('@') ? readFileSync(promptArg.slice(1), 'utf8') : promptArg).trim();

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { 'Content-Type': 'application/json', ...auth, ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// Local reference images go up to eachlabs storage (kept 30 days); URLs are passed through.
async function upload(src) {
  if (/^https?:\/\//.test(src)) return src;
  const type = MIME[extname(src).toLowerCase()];
  if (!type) throw new Error(`unsupported reference type: ${src}`);
  const { presigned_url, public_url, required_headers } = await api('/upload/presign', {
    method: 'POST', body: JSON.stringify({ content_type: type, file_type: 'image', expires_in_seconds: 30 * 86400 }),
  });
  const put = await fetch(presigned_url, { method: 'PUT', headers: { 'Content-Type': type, ...required_headers }, body: readFileSync(src) });
  if (!put.ok) throw new Error(`upload ${src}: ${put.status}`);
  return public_url;
}

async function generate(model, input) {
  const created = await api('/prediction', { method: 'POST', body: JSON.stringify({ model, input }) });
  const id = created.predictionID || created.id;
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const p = await api(`/prediction/${id}`);
    if (p.status === 'success') return { id, url: [p.output].flat()[0], cost: p.metrics?.cost };
    if (['failed', 'error', 'cancelled'].includes(p.status)) throw new Error(`${id} ${p.status}: ${JSON.stringify(p.output ?? p.error)}`);
  }
}

function freePaths(count) {
  const paths = [];
  for (let v = 1; paths.length < count; v++) {
    const p = `${OUT}${name}${v === 1 ? '' : `_v${v}`}.png`;
    if (!existsSync(p)) paths.push(p);
  }
  return paths;
}

const refs = await Promise.all(opt.ref.map(upload));
const spec = MODELS[opt.model];
if (!spec) throw new Error(`unknown --model ${opt.model} (${Object.keys(MODELS).join(', ')})`);
const model = refs.length ? spec.edit : spec.t2i;
const input = { prompt, ...spec.input(opt, refs) };
const paths = freePaths(Number(opt.n));
const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];

await Promise.all(paths.map(async (file) => {
  const { id, url, cost } = await generate(model, input);
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  log.push({ file, model, prediction: id, refs: opt.ref, input: { ...input, prompt: undefined, image: undefined, image_urls: undefined }, prompt, cost, date: new Date().toISOString() });
  console.log(`${file}  (${id}, $${cost ?? '?'})`);
}));
writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');

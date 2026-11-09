// Concept-art generator with a hard budget and a spend log.
//
//   node scripts/art/generate.mjs --name launcher-bg --prompt "..."            -> estimate only, no API call
//   node scripts/art/generate.mjs --name launcher-bg --prompt "..." --yes      -> generates (costs money)
//
// Options: --model gpt-image-2.5-sunburst  --quality low|medium|high  --size 1536x1024
//          --n 1  --transparent  --budget 3.00 (USD, total for the project; default from ART_BUDGET_USD or 3.00)
// Images go to art/drafts/<name>-<n>.png, every call is logged to art/spend.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'art', 'drafts');
const LEDGER = path.join(ROOT, 'art', 'spend.json');

// USD per 1M tokens (developers.openai.com/api/docs/pricing, checked 2026-11-10)
const PRICES = {
  'gpt-image-2.5-sunburst': { textIn: 5, imageIn: 8, imageOut: 30 },
  'gpt-image-2.5-flare': { textIn: 5, imageIn: 8, imageOut: 30 },
  'gpt-image-2.6-sunburst': { textIn: 5, imageIn: 8, imageOut: 30 },
  'gpt-image-2': { textIn: 5, imageIn: 8, imageOut: 30 },
  'gpt-image-1-mini': { textIn: 2, imageIn: 2.5, imageOut: 8 },
};
// rough output-token guesses per image (refined automatically from the ledger after real calls)
const GUESS_OUT_TOKENS = { low: 200, medium: 1800, high: 7000, xhigh: 12000, max: 16000 };

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = k => argv.includes(`--${k}`);
const model = opt('model', 'gpt-image-2.5-sunburst');
const quality = opt('quality', 'medium');
const size = opt('size', '1536x1024');
const n = Number(opt('n', 1));
const name = opt('name', 'draft');
const prompt = opt('prompt');
const budget = Number(opt('budget', process.env.ART_BUDGET_USD || 3));
if (!prompt) { console.error('missing --prompt'); process.exit(1); }
const price = PRICES[model];
if (!price) { console.error(`unknown model ${model}`); process.exit(1); }

const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { totalUSD: 0, calls: [] };
const sameKind = ledger.calls.filter(c => c.model === model && c.quality === quality && c.size === size);
const outGuess = sameKind.length
  ? sameKind.reduce((s, c) => s + c.usage.output_tokens / c.n, 0) / sameKind.length
  : GUESS_OUT_TOKENS[quality] ?? 2000;
const promptTokens = Math.ceil(prompt.length / 3.5);
const estimate = n * (outGuess * price.imageOut + promptTokens * price.textIn) / 1e6;
console.log(`model=${model} quality=${quality} size=${size} n=${n}`);
console.log(`estimate ≈ $${estimate.toFixed(3)} (${sameKind.length ? 'from past calls' : 'rough guess'}) · spent so far $${ledger.totalUSD.toFixed(3)} of $${budget.toFixed(2)} budget`);
if (ledger.totalUSD + estimate > budget) { console.error('BUDGET: this call would exceed the project art budget — not sent.'); process.exit(2); }
if (!flag('yes')) { console.log('dry run — add --yes to generate'); process.exit(0); }

const env = loadEnv();
const body = { model, prompt, size, quality, n, output_format: 'png' };
if (flag('transparent')) body.background = 'transparent';
const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await res.json();
if (!res.ok) { console.error('API error:', res.status, j.error?.message || j.error?.code); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
const files = j.data.map((d, i) => {
  const f = path.join(OUT, `${name}-${Date.now()}-${i + 1}.png`);
  fs.writeFileSync(f, Buffer.from(d.b64_json, 'base64'));
  return path.relative(ROOT, f);
});
const u = j.usage || {};
const textIn = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
const imageIn = u.input_tokens_details?.image_tokens ?? 0;
const cost = (textIn * price.textIn + imageIn * price.imageIn + (u.output_tokens ?? 0) * price.imageOut) / 1e6;
ledger.totalUSD += cost;
ledger.calls.push({ at: new Date().toISOString(), name, model, quality, size, n, usage: u, costUSD: +cost.toFixed(4), files, prompt });
fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
console.log(`done: $${cost.toFixed(4)} (tokens out ${u.output_tokens}) · total spent $${ledger.totalUSD.toFixed(3)}`);
for (const f of files) console.log('  ', f);

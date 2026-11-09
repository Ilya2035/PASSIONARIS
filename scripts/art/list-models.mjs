// Free call: lists models available to the key (no generation, no cost).
import { loadEnv } from './env.mjs';
const env = loadEnv();
const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
console.log('status', res.status);
const j = await res.json();
if (!res.ok) { console.log(j.error?.code || j.error?.type || 'error'); process.exit(1); }
const ids = j.data.map(m => m.id).sort();
console.log('total models:', ids.length);
console.log('image-ish:', ids.filter(id => /image|dall|sora|sun|vision|nano/i.test(id)).join(', '));
console.log('gpt-5 / mini family:', ids.filter(id => /gpt-5|mini|nano/i.test(id)).slice(0, 40).join(', '));

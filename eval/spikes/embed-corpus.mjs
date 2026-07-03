import { pipeline } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'node:fs';
const papers = JSON.parse(readFileSync('/tmp/papers-for-embed.json', 'utf8'));
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const t0 = performance.now();
const vecs = [];
const B = 64;
for (let i = 0; i < papers.length; i += B) {
  const batch = papers.slice(i, i + B);
  const out = await embed(batch.map((p) => p.text), { pooling: 'mean', normalize: true });
  for (const v of out.tolist()) vecs.push(v);
  if (i % (B * 8) === 0) process.stdout.write(`\r  embedded ${Math.min(i + B, papers.length)}/${papers.length}`);
}
console.log(`\nembedded ${papers.length} in ${Math.round((performance.now() - t0) / 1000)}s`);
writeFileSync('/tmp/embeddings.json', JSON.stringify({
  meta: papers.map((p) => ({ id: p.id, title: p.title, topic: p.topic })),
  vecs,
}));
console.log('wrote /tmp/embeddings.json');

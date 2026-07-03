// Does @huggingface/transformers feature-extraction run in Node (CPU)? If so we
// can embed the corpus here (deterministic; same model as the in-browser path).
import { pipeline } from '@huggingface/transformers';
console.log('loading all-MiniLM-L6-v2 (feature-extraction)…');
const t0 = performance.now();
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
console.log(`loaded in ${Math.round(performance.now() - t0)}ms`);
const texts = [
  'Deep residual learning for image recognition',
  'Generative adversarial networks for image synthesis',
  'A deep learning system for detecting diabetic retinopathy',
];
const t1 = performance.now();
const out = await embed(texts, { pooling: 'mean', normalize: true });
const vecs = out.tolist();
console.log(`embedded ${texts.length} in ${Math.round(performance.now() - t1)}ms · dim=${vecs[0].length}`);
// sanity: cosine(resnet, gan) vs cosine(resnet, resnet)=1; retinopathy should be least similar to resnet
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
console.log('cos(resnet,gan)      =', dot(vecs[0], vecs[1]).toFixed(3));
console.log('cos(resnet,retino)   =', dot(vecs[0], vecs[2]).toFixed(3));
console.log('allFinite=', vecs.every((v) => v.every(Number.isFinite)));

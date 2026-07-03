import { build } from 'esbuild';
await build({ bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
  entryPoints: ['eval/spikes/network-spike.mjs'], outfile: 'eval/spikes/network-spike.js', logLevel: 'info' });
console.log('built eval/spikes/network-spike.js');

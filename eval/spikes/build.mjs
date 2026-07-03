import { build } from 'esbuild';
for (const name of ['network-spike', 'embedding-spike']) {
  await build({ bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
    entryPoints: [`eval/spikes/${name}.mjs`], outfile: `eval/spikes/${name}.js`, logLevel: 'error' });
  console.log(`built ${name}.js`);
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'],
  { cwd: new URL('..', import.meta.url), maxBuffer: 16 * 1024 * 1024 },
);
const sbom = JSON.parse(stdout);
if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) {
  throw new Error('npm did not emit a CycloneDX component inventory.');
}
const names = new Set(sbom.components.map((component) => component?.name).filter(Boolean));
for (const dependency of ['apache-arrow', 'node-sql-parser']) {
  if (!names.has(dependency)) throw new Error(`SBOM is missing production dependency ${dependency}.`);
}
console.log(`[compute-bridge-sbom] CycloneDX inventory contains ${names.size} named components`);

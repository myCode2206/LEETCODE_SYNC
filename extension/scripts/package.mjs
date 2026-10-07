// Zips extension/dist into extension/release/lcsync-<version>.zip for the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const outDir = resolve(root, 'release');
const out = resolve(outDir, `lcsync-${version}.zip`);
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', out, '.'], { cwd: resolve(root, 'dist'), stdio: 'inherit' });
console.log(`Packaged → ${out}`);

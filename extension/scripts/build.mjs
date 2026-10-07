// Builds the extension into dist/:
//   1. popup + options pages and the module service worker (one Vite build, shared chunks)
//   2. each content script as a self-contained IIFE (MV3 content scripts cannot be ES modules)
//   3. manifest.json
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const apiBaseUrl = process.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const define = { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl) };

await build({
  root: resolve(root, 'src'),
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  define,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome111',
    watch: watch ? {} : null,
    rollupOptions: {
      input: {
        popup: resolve(root, 'src/popup/index.html'),
        options: resolve(root, 'src/options/index.html'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});

for (const name of ['page-hook', 'leetcode-bridge']) {
  await build({
    root,
    configFile: false,
    define,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome111',
      watch: watch ? {} : null,
      lib: {
        entry: resolve(root, `src/content/${name}.ts`),
        formats: ['iife'],
        name: name.replace(/-/g, '_'),
        fileName: () => `content/${name}.js`,
      },
    },
  });
}

// manifest.ts is plain, erasable TypeScript: Node >= 22.18 imports it directly.
const { buildManifest } = await import('../src/manifest.ts');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const manifest = buildManifest({
  version: pkg.version,
  apiBaseUrl,
  publicKey: process.env.EXTENSION_PUBLIC_KEY,
});
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built extension → ${outDir} (API: ${apiBaseUrl})`);

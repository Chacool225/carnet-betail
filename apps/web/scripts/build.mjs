// Compile l'application avec esbuild : dist/app.js, dist/app.css, index.html, manifest, service worker.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

export const options = (extra = {}) => ({
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: join(dist, 'app.js'),
  jsx: 'automatic',
  sourcemap: true,
  loader: { '.css': 'css' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    __API_URL__: JSON.stringify(process.env.API_URL ?? '/api'),
  },
  logLevel: 'info',
  ...extra,
});

export function prepare() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(join(root, 'public'), dist, { recursive: true });
  const stamp = Date.now().toString(36);
  writeFileSync(join(dist, 'sw.js'), readFileSync(join(dist, 'sw.js'), 'utf8').replace('__BUILD__', stamp));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepare();
  await build(options({ minify: true }));
}
export { context };

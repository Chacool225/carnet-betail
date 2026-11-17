// Serveur de développement : recompile à chaque modification et relaie /api vers l'API (par défaut http://localhost:3000).
import { createServer, request } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import { options, prepare } from './build.mjs';

const PORT = Number(process.env.WEB_PORT ?? 5173);
const API = new URL(process.env.API_TARGET ?? 'http://127.0.0.1:3001');
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };

prepare();
const ctx = await context(options({ sourcemap: true, define: { 'process.env.NODE_ENV': '"development"', __API_URL__: '"/api"' } }));
await ctx.watch();

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    const proxied = request({ hostname: API.hostname, port: API.port, path: req.url.slice(4), method: req.method, headers: { ...req.headers, host: API.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    proxied.on('error', () => { res.writeHead(502); res.end('API injoignable'); });
    req.pipe(proxied);
    return;
  }
  let file = normalize(join(dist, decodeURIComponent((req.url ?? '/').split('?')[0])));
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Application : http://localhost:${PORT}  (API : ${API.origin})`));

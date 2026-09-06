import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  await import('./build.mjs');
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const safeFile = (pathname) => {
  let relative = pathname.replace(/^\/manager\/?/, '/').replace(/^\/+/, '');
  if (pathname.startsWith('/assets/')) relative = pathname.slice(1);
  const candidate = path.resolve(dist, relative);
  return candidate.startsWith(dist + path.sep) || candidate === dist ? candidate : null;
};

http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let file = safeFile(url.pathname);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  const ext = path.extname(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  if (file.endsWith('runtime-config.js')) res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log(`Connect|API Manager dev server: http://127.0.0.1:${port}/manager/login`);
});

/**
 * Servidor local para desenvolvimento e teste — `npm run dev`.
 *
 * Reproduz o comportamento do Vercel: serve `public/` como estatico e roteia
 * `/api/*` para as mesmas funcoes serverless que rodam em producao.
 *
 * Se nao houver Upstash configurado, sobe um Redis REST falso em memoria no
 * proprio processo. Assim da para exercitar exatamente o mesmo codigo de
 * gravacao sem depender de nenhuma conta externa.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

/* --- Redis REST falso ---------------------------------------------------- */

const fakeHashes = new Map();

function fakeRedis(command) {
  const [op, key, ...rest] = command;
  const name = String(op).toUpperCase();
  const hash = fakeHashes.get(key) || new Map();
  fakeHashes.set(key, hash);

  switch (name) {
    case 'HSET': {
      let written = 0;
      for (let i = 0; i < rest.length; i += 2) {
        if (!hash.has(rest[i])) written += 1;
        hash.set(rest[i], rest[i + 1]);
      }
      return written;
    }
    case 'HGETALL': {
      const flat = [];
      for (const [field, value] of hash) flat.push(field, value);
      return flat;
    }
    case 'HDEL': {
      let removed = 0;
      for (const field of rest) if (hash.delete(field)) removed += 1;
      return removed;
    }
    case 'HLEN':
      return hash.size;
    default:
      throw new Error(`comando nao suportado no mock: ${name}`);
  }
}

if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) {
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${PORT}/__dev-redis`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'dev-token';
  console.log('· Redis em memoria ativo (dados somem ao reiniciar).');
}
if (!process.env.ADMIN_PIN) {
  process.env.ADMIN_PIN = '1234';
  console.log('· ADMIN_PIN padrao de desenvolvimento: 1234');
}
if (!process.env.EVENT_NAME) process.env.EVENT_NAME = 'Adapta Summit';

/* --- Roteamento ---------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const handlers = new Map();

async function loadHandler(name) {
  if (!handlers.has(name)) {
    const mod = await import(`../api/${name}.js`);
    handlers.set(name, mod.default);
  }
  return handlers.get(name);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const candidates = [pathname, `${pathname}.html`, path.join(pathname, 'index.html')];
  if (pathname === '/') candidates.unshift('/index.html');

  for (const candidate of candidates) {
    const file = path.join(PUBLIC, path.normalize(candidate).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
      return true;
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // Redis falso
  if (url.pathname === '/__dev-redis') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = Array.isArray(body[0]) ? body.map(fakeRedis) : fakeRedis(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  // Funcoes serverless
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '');
    try {
      const handler = await loadHandler(name);
      await handler(req, res);
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Rota inexistente.' }));
      } else {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
      }
    }
    return;
  }

  if (serveStatic(req, res, url.pathname)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
});

server.listen(PORT, () => {
  console.log(`\n  Formulario  →  http://localhost:${PORT}/`);
  console.log(`  Painel      →  http://localhost:${PORT}/admin`);
  console.log(`  Diagnostico →  http://localhost:${PORT}/api/health\n`);
});

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(process.env.SAIYAN_PREVIEW_DIR || resolve(root, 'site'));
const port = Number(process.argv[2] || process.env.PORT || 3192);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    const config = JSON.parse(await readFile(resolve(root, 'edgeone.json'), 'utf8'));
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (['/competitions', '/competitions/', '/workspaces', '/canvas', '/image'].includes(path)) path = '/index.html';
    if (path === '/comfyart') path = '/comfyart/';
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(site, '.' + path);
    const rel = relative(site, file);
    if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    for (const rule of config.headers || []) if (rule.source === '/*' || rule.source === path) {
      for (const {key, value} of rule.headers) res.setHeader(key, value);
    }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', 'no-cache');
    res.writeHead(200);
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Saiyan: http://127.0.0.1:${port}/`));

// 本地服务：静态页 + graph.json 接口。默认 http://127.0.0.1:8791
//   node serve.mjs [--port 8791] [--memory ../../工作台/记忆图/graph.json]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('--port', 8791));
const ROOT = import.meta.dirname;
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');
const MEMORY = path.resolve(opt('--memory', process.env.MEMORY_GRAPH || path.join(ROOT, '../../工作台/记忆图/graph.json')));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };   // 工作台(8788)要跨端口探活+取图，放开只读 CORS
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...CORS }); res.end(body); };

const sources = () => {
  const map = {};
  if (fs.existsSync(path.join(DATA, 'spider-graph.json'))) map.spider = path.join(DATA, 'spider-graph.json');
  if (fs.existsSync(path.join(DATA, 'merged.json'))) map.merged = path.join(DATA, 'merged.json');
  if (fs.existsSync(MEMORY)) map.memory = MEMORY;
  return map;
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/api/graphs') return send(res, 200, JSON.stringify({ available: Object.keys(sources()), memory: MEMORY }));
  if (u.pathname === '/api/graph') {
    const which = u.searchParams.get('which') || 'spider';
    const file = sources()[which];
    if (!file) return send(res, 404, JSON.stringify({ error: 'no such graph: ' + which, available: Object.keys(sources()) }));
    return send(res, 200, fs.readFileSync(file));
  }
  if (u.pathname === '/api/prompts') {
    const f = path.join(DATA, 'prompts.json');
    if (!fs.existsSync(f)) return send(res, 404, JSON.stringify({ error: 'run npm run extract first' }));
    return send(res, 200, fs.readFileSync(f));
  }
  const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
  const file = path.join(WEB, rel.replace(/^\/+/, ''));
  if (!file.startsWith(WEB)) return send(res, 403, 'forbidden', 'text/plain');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`prompt-spider-ui → http://127.0.0.1:${PORT}/  (memory graph: ${MEMORY})`);
  console.log('graphs:', Object.keys(sources()).join(', ') || '(空，先跑 npm run all)');
});

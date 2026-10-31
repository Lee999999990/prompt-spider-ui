// 合并：prompt-spider 图 × 工作台「记忆图」graph.json → 一张图（同一套 schema）
//   node src/merge.mjs ../../工作台/记忆图/graph.json data/spider-graph.json -o data/merged.json
//   可选 --compat memory：把本工具独有的 prompt/tool 映射成记忆图老渲染器认识的 milestone/artifact
//   可选 --preserve-a：坐标以第一张图为准（默认按 b 的坐标 + a 平移，避免两坨重叠）
import fs from 'node:fs';
import path from 'node:path';
import { assertGraph, keyOf } from './schema.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const files = argv.filter((a, i) => a.endsWith('.json') && !['-o', '--out', '--compat', '--in'].includes(argv[i - 1]));
const OUT = opt('-o', path.join(import.meta.dirname, '../data/merged.json'));
const COMPAT = opt('--compat', null);
if (files.length < 2) { console.error('用法: node src/merge.mjs A.json B.json [-o out.json] [--compat memory]'); process.exit(2); }

const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const [A, B] = files.map(load);

// 兼容映射：给只会画老 type 的渲染器用
const COMPAT_MAP = { prompt: 'milestone', tool: 'artifact' };
const mapType = (t) => (COMPAT === 'memory' ? COMPAT_MAP[t] || t : t);

const nodes = [];
const edges = [];
const index = new Map();     // key → 新 id
let id = 0;
const shift = { x: 0, y: 0 };

// A 图（通常是你新做的图）：原坐标；B 图整体右移，避免叠在一起
const HUB_MERGE = !flag('--no-hub-merge');   // 两个中心都是"这次会话"，合成一个，图不会出现两个太阳
const push = (n, dx = 0, dy = 0) => {
  const type = mapType(n.type);
  const key = type === 'session' && HUB_MERGE ? 'session::__hub__' : `${type}::${String(n.label).trim().toLowerCase()}`;
  if (index.has(key)) {
    const hit = nodes[index.get(key)];
    hit.weight = (hit.weight || 0) + (n.weight || 0);
    if (n.sub && !hit.sub) hit.sub = n.sub;
    if (type === 'session' && HUB_MERGE) {
      hit.label = '这次会话 · 记忆图 × 提问蛛网';
      hit.sub = n.sub || hit.sub;
    }
    return index.get(key);
  }
  const nid = id++;
  nodes.push({ ...n, id: nid, type, x: n.x + dx, y: n.y + dy });
  index.set(key, nid);
  return nid;
};
const idMapA = new Map(), idMapB = new Map();
for (const n of A.nodes) idMapA.set(n.id, push(n, 0, 0));
shift.x = (A.W || 1920) * 0.0; // 默认同坐标系叠加（记忆图与蛛网都按 1920×1080 布局，中心对齐正好）
shift.y = 0;
for (const n of B.nodes) idMapB.set(n.id, push(n, shift.x, shift.y));

for (const e of A.edges) {
  const s = idMapA.get(e.s), t = idMapA.get(e.t);
  if (s !== undefined && t !== undefined) edges.push({ s, t, w: e.w ?? 1, src: 'spider' });
}
for (const e of B.edges) {
  const s = idMapB.get(e.s), t = idMapB.get(e.t);
  if (s !== undefined && t !== undefined) edges.push({ s, t, w: e.w ?? 1, src: 'memory' });
}
// 同名节点被合并后可能出现自环 → 去掉（自环不表达信息，还会把渲染撑歪）
const cleaned = edges.filter((e) => e.s !== e.t);

const lists = {};
for (const g of [A, B]) for (const [k, v] of Object.entries(g.lists || {})) {
  if (!Array.isArray(v)) { lists[k] = lists[k] || v; continue; }
  const bag = lists[k] = lists[k] || [];
  const seen = new Set(bag.map((x) => JSON.stringify(x?.name ?? x?.text ?? x?.id ?? x)));
  for (const item of v) {
    const sig = JSON.stringify(item?.name ?? item?.text ?? item?.id ?? item);
    if (seen.has(sig)) continue;
    seen.add(sig); bag.push(item);
  }
}

const meta = {
  ...A.meta,
  generatedAt: new Date().toISOString(),
  kind: 'merged',
  schema: 'memory-graph/v1+prompt',
  merged: {
    sources: files,
    a: { nodes: A.nodes.length, edges: A.edges.length, kind: A.meta?.kind || 'graph' },
    b: { nodes: B.nodes.length, edges: B.edges.length, kind: B.meta?.kind || 'graph' },
    sharedNodes: A.nodes.length + B.nodes.length - nodes.length,
    droppedSelfLoops: edges.length - cleaned.length,
    compat: COMPAT,
  },
};
const out = { W: Math.max(A.W || 1920, B.W || 1920), H: Math.max(A.H || 1080, B.H || 1080), meta, nodes, edges: cleaned, lists };
const errs = assertGraph(out, { name: 'merged' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify({ out: OUT, nodes: nodes.length, edges: cleaned.length, meta: meta.merged, schemaErrs: errs }, null, 1));
if (errs.length) process.exit(1);

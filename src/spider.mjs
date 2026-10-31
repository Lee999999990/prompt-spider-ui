// 布局：prompts.json → graph.json（与工作台「记忆图」同一套 schema 的超集）
//   记忆图原有 type: session/project/artifact/service/schedule/agent/memory/milestone
//   本工具新增 type: prompt（提问）/ tool（工具家族）—— 记忆图渲染器读到未知 type 会自动忽略，不会崩
// 用法：node src/spider.mjs [--in data/prompts.json] [--out data/spider-graph.json] [--w 1920 --h 1080]
import fs from 'node:fs';
import path from 'node:path';
import { assertGraph } from './schema.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const IN = opt('--in', path.join(import.meta.dirname, '../data/prompts.json'));
const OUT = opt('--out', path.join(import.meta.dirname, '../data/spider-graph.json'));
const W = Number(opt('--w', 1920));
const H = Number(opt('--h', 1080));

const d = JSON.parse(fs.readFileSync(IN, 'utf8'));
const CX = W * 0.46, CY = H * 0.5;
const nodes = [];
const edges = [];
let id = 0;
const add = (n) => { nodes.push({ id: id++, ...n }); return id - 1; };

// ---- 中心：会话 hub（多个会话时只画主会话，其余进 lists）
const main = d.sessions?.[0] || { id: d.meta.sessions?.[0] || 'session-unknown' };
const hub = add({
  type: 'session',
  label: '提问蛛网 · ' + (d.meta.sessionCount > 1 ? `${d.meta.sessionCount} 个会话` : '本会话'),
  sub: `${d.meta.prompts} 个提问 / ${d.meta.toolCalls} 次工具调用`,
  x: CX, y: CY, r: 18, weight: d.meta.prompts,
});

// ---- 提问：黄金角螺旋（时间顺序 = 螺旋外扩），线宽 = 这一问触发了多少工具
const prompts = d.prompts.slice(0, 400);
const GA = Math.PI * (3 - Math.sqrt(5)); // 137.5°
const pid = [];
prompts.forEach((p, i) => {
  const rad = 64 + 24 * Math.sqrt(i);
  const a = i * GA;
  const nx = CX + Math.cos(a) * rad * 1.18;
  const ny = CY + Math.sin(a) * rad * 0.86;
  const r = 3.2 + Math.min(3.4, Math.log2(1 + (p.tools || 0)));
  pid.push(add({
    type: 'prompt', label: p.label, sub: `${p.tools || 0} 次工具 · ${Object.keys(p.projects || {}).length} 个项目`,
    x: nx, y: ny, r, weight: p.tools || 0, anchor: 'spiral', turn: p.turn, promptIndex: p.i,
    scheduled: !!p.scheduled,
  }));
  edges.push({ s: pid[i], t: hub, w: 0.35 + (p.tools || 0) / 12 });
});

// ---- 项目：外圈（按被操作次数定角位）
const projects = d.projects.slice(0, 12);
const maxP = Math.max(1, ...projects.map((p) => p.weight));
const projNode = new Map();
projects.forEach((p, i) => {
  const a = -Math.PI / 2 + (Math.PI * 2 * i) / projects.length;
  const rad = 372 + 26 * ((i * 0.618) % 1);
  const n = add({ type: 'project', label: p.name, sub: `${p.weight} 次操作`, x: CX + Math.cos(a) * rad * 1.12, y: CY + Math.sin(a) * rad * 0.92, r: 5 + 9 * (p.weight / maxP), weight: p.weight });
  projNode.set(p.name, n);
  edges.push({ s: n, t: hub, w: 1 + p.weight / maxP });
});

// ---- 提问 → 项目：这条边就是「蛛丝」
for (const p of prompts) {
  const n = pid[p.i];
  for (const [proj, cnt] of p.projectsTop || []) {
    const t = projNode.get(proj);
    if (t !== undefined && n !== undefined) edges.push({ s: n, t, w: 0.5 + cnt / 3 });
  }
}

// ---- 产物：挂到最匹配的项目旁边（名字包含项目名→归该项目，否则挂 hub 外环）
const arts = d.artifacts.slice(0, 24);
arts.forEach((a, i) => {
  const low = a.name.toLowerCase();
  const hit = projects.find((p) => low.includes(p.name.toLowerCase().replace(/-/g, '')) || low.includes(p.name.toLowerCase()));
  const base = hit ? nodes[projNode.get(hit.name)] : { id: hub, x: CX, y: CY };
  const ang = Math.PI * 2 * ((i * 0.618) % 1);
  const rad = hit ? 46 + 34 * ((i * 0.37) % 1) : 120;
  const n = add({ type: 'artifact', label: a.name, sub: `${a.weight}×`, x: base.x + Math.cos(ang) * rad * 1.15, y: base.y + Math.sin(ang) * rad * 0.85, r: 2.6 + Math.min(2.6, Math.log2(1 + a.weight)), weight: a.weight });
  edges.push({ s: n, t: base.id, w: 0.6 });
});

// ---- 工具家族：内圈小节点（看"谁在干活"）
const tools = d.tools.slice(0, 10);
const maxT = Math.max(1, ...tools.map((t) => t.weight));
tools.forEach((t, i) => {
  const a = -Math.PI / 2 + (Math.PI * 2 * i) / tools.length;
  const rad = 232;
  const n = add({ type: 'tool', label: t.name, sub: `${t.weight} 次调用`, x: CX + Math.cos(a) * rad, y: CY + Math.sin(a) * rad * 0.95, r: 3.4 + 4 * (t.weight / maxT), weight: t.weight });
  edges.push({ s: n, t: hub, w: 0.4 + t.weight / maxT });
});

// ---- meta：保留记忆图同名键（可直接被记忆图脚本读），另加蛛网自己的字段
const meta = {
  session: main.id,
  generatedAt: new Date().toISOString(),
  records: d.meta.records,
  turns: d.meta.turns,
  userMsgs: d.meta.prompts,
  milestones: d.meta.prompts,
  toolCalls: d.meta.toolCalls,
  assistantMsgs: d.sessions?.reduce((s, x) => s + (x.assistantMsgs || 0), 0) || 0,
  deliverables: 0,
  peakContextTokens: d.meta.peakContextTokens,
  logBytes: d.sessions?.reduce((s, x) => s + (x.logBytes || 0), 0) || 0,
  // 蛛网自有
  kind: 'prompt-spider',
  schema: 'memory-graph/v1+prompt',
  sessions: d.meta.sessions,
  sessionCount: d.meta.sessionCount,
  prompts: d.meta.prompts,
  scheduledPrompts: d.meta.scheduledPrompts,
  layout: 'spiral',
};

const graph = {
  W, H, meta, nodes, edges,
  lists: {
    prompts: d.prompts,
    sessions: d.sessions,
    projects: d.projects,
    artifacts: d.artifacts,
    tools: d.tools,
    services: [], schedules: [], agents: [], memory: [], milestones: [],
  },
};
const errs = assertGraph(graph, { name: 'spider-graph' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(graph));
console.log(JSON.stringify({
  out: OUT, nodes: nodes.length, edges: edges.length,
  byType: nodes.reduce((m, n) => (m[n.type] = (m[n.type] || 0) + 1, m), {}),
  schemaErrs: errs, W, H,
}, null, 1));
if (errs.length) process.exit(1);

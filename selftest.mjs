// 自测：schema 契约 / 系统注入过滤 / 与记忆图双向往返。任何一条不成立就 exit 1。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertGraph, MEMORY_GRAPH_TYPES } from './src/schema.mjs';
import { unzstdAll, frameOffsets } from './src/zstd-frames.mjs';
const require_zlib = () => createRequire(import.meta.url)('node:zlib');

const D = (f) => path.join(import.meta.dirname, 'data', f);
const read = (f) => JSON.parse(fs.readFileSync(D(f), 'utf8'));
const passed = [], failed = [];
const t = (name, fn) => { try { fn(); passed.push(name); } catch (e) { failed.push(name + ' :: ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const prompts = read('prompts.json');
const spider = read('spider-graph.json');
const merged = read('merged.json');

t('T1 prompts.json 有 meta/prompts/projects/tools', () => {
  for (const k of ['meta', 'sessions', 'prompts', 'projects', 'artifacts', 'tools']) ok(k in prompts, '缺 ' + k);
  ok(prompts.prompts.length > 0, '一个提问都没抽到');
});

t('T2 系统注入没被当成提问', () => {
  const bad = prompts.prompts.filter((p) => /^(\[SCHEDULE|Team message from|Background subagent|Current runtime context|A skill is a reusable|This repository has a Hi)/i.test(p.text));
  ok(bad.length === 0, `${bad.length} 条系统注入混进提问：${bad[0]?.text.slice(0, 60)}`);
});

t('T3 每个提问都有 label/turn/tools 字段', () => {
  for (const p of prompts.prompts) { ok(typeof p.label === 'string' && p.label, 'label 缺失'); ok(typeof p.turn === 'number', 'turn 缺失'); ok(typeof p.tools === 'number', 'tools 缺失'); }
});

t('T4 蛛网图符合记忆图 schema（记忆图能直接打开）', () => {
  const errs = assertGraph(spider, { name: 'spider' });
  ok(errs.length === 0, errs.slice(0, 3).join(' | '));
  for (const k of ['W', 'H', 'meta', 'nodes', 'edges', 'lists']) ok(k in spider, '缺顶层键 ' + k);
  for (const k of ['session', 'records', 'turns', 'userMsgs', 'toolCalls', 'peakContextTokens']) ok(k in spider.meta, 'meta 缺记忆图同名键 ' + k);
});

t('T5 提问节点都连到会话 hub（蛛网不断丝）', () => {
  const hub = spider.nodes.find((n) => n.type === 'session');
  ok(hub, '没有 session 节点');
  const linked = new Set(spider.edges.filter((e) => e.t === hub.id || e.s === hub.id).map((e) => (e.t === hub.id ? e.s : e.t)));
  const loose = spider.nodes.filter((n) => n.type === 'prompt' && !linked.has(n.id));
  ok(loose.length === 0, `${loose.length} 个提问没连线`);
});

t('T6 合并图节点数 = A + B − 交集，且无自环/悬空边', () => {
  const m = merged.meta.merged;
  ok(merged.nodes.length === m.a.nodes + m.b.nodes - m.sharedNodes, `节点数不符：${merged.nodes.length} vs ${m.a.nodes}+${m.b.nodes}-${m.sharedNodes}`);
  ok(merged.edges.every((e) => e.s !== e.t), '合并后仍有自环');
  ok(assertGraph(merged, { name: 'merged' }).length === 0, '合并图 schema 不合法');
});

t('T7 合并保留记忆图原有类型（project/service/schedule/agent/memory）', () => {
  const ts = new Set(merged.nodes.map((n) => n.type));
  for (const k of ['project', 'service', 'schedule', 'agent', 'memory']) ok(ts.has(k), '合并后丢了 ' + k);
  ok(ts.has('prompt'), '合并后丢了 prompt');
});

t('T8 兼容模式只产记忆图认识的类型', () => {
  const f = D('merged-compat.json');
  if (!fs.existsSync(f)) return; // 没跑兼容模式就跳过
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const bad = [...new Set(c.nodes.map((n) => n.type))].filter((x) => !MEMORY_GRAPH_TYPES.includes(x));
  ok(bad.length === 0, '兼容模式仍有未知类型：' + bad.join(','));
});

t('T9 蛛丝权重能区分"大提问"（存在 w>1 的 prompt 边）', () => {
  const hits = spider.edges.filter((e) => e.w > 1.2).length;
  ok(hits > 0, '所有边权重都 <=1.2，说明没按工具调用量拉开差距');
});

t('T10 合并图里 prompt 与 project 之间确有边（两图真的搭上了）', () => {
  const byId = new Map(merged.nodes.map((n) => [n.id, n]));
  const cross = merged.edges.filter((e) => {
    const a = byId.get(e.s)?.type, b = byId.get(e.t)?.type;
    return (a === 'prompt' && b === 'project') || (a === 'project' && b === 'prompt');
  });
  ok(cross.length > 0, 'prompt 与 project 之间没有任何边，说明两张图只是并排摆放');
});

t('T11 多帧 zstd 会话日志能整段解开（DSH 一条记录一个帧）', () => {
  // 线上事故：zstdDecompressSync 只解第一帧 → 2064 帧的日志只读出 1 条记录、0 个提问。
  const zlib = require_zlib();
  const a = zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","seq":1}\n'));
  const b = zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","seq":2}\n'));
  const raw = unzstdAll(Buffer.concat([a, b])).toString('utf8');
  ok(frameOffsets(Buffer.concat([a, b])).length === 2, '帧头定位失败');
  const lines = raw.split('\n').filter(Boolean);
  ok(lines.length === 2, `多帧日志只解出 ${lines.length} 条，应为 2 条`);
  ok(lines[1].includes('"seq":2'), '第二帧的内容丢了');
});

console.log(`\n${passed.length} passed, ${failed.length} failed`);
for (const p of passed) console.log('  PASS ' + p);
for (const f of failed) console.log('  FAIL ' + f);
process.exit(failed.length ? 1 : 0);

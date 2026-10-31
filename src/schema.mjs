// 记忆图（工作台/记忆图/graph.json）契约，prompt-spider-ui 只做超集：新增 type = prompt | tool，其余字段一一对应。
export const MEMORY_GRAPH_TYPES = ['session', 'project', 'artifact', 'service', 'schedule', 'agent', 'memory', 'milestone'];
export const SPIDER_TYPES = ['prompt', 'tool'];
export const ALL_TYPES = [...MEMORY_GRAPH_TYPES, ...SPIDER_TYPES];

export function assertGraph(g, { name = 'graph' } = {}) {
  const errs = [];
  if (typeof g?.W !== 'number' || typeof g?.H !== 'number') errs.push(`${name}: 缺 W/H`);
  if (!Array.isArray(g?.nodes)) errs.push(`${name}: nodes 不是数组`);
  if (!Array.isArray(g?.edges)) errs.push(`${name}: edges 不是数组`);
  if (errs.length) return errs;
  const ids = new Set();
  for (const n of g.nodes) {
    if (typeof n.id !== 'number') errs.push(`${name}: node 缺 id`);
    if (ids.has(n.id)) errs.push(`${name}: node id 重复 ${n.id}`);
    ids.add(n.id);
    if (!n.type) errs.push(`${name}: node ${n.id} 缺 type`);
    if (typeof n.label !== 'string' || !n.label) errs.push(`${name}: node ${n.id} 缺 label`);
    if (typeof n.x !== 'number' || typeof n.y !== 'number') errs.push(`${name}: node ${n.id} 缺 x/y`);
  }
  for (const e of g.edges) {
    if (!ids.has(e.s) || !ids.has(e.t)) errs.push(`${name}: edge ${e.s}->${e.t} 指向不存在的节点`);
    if (e.s === e.t) errs.push(`${name}: edge ${e.s} 自环`);
  }
  const types = [...new Set(g.nodes.map((n) => n.type))];
  for (const t of types) if (!ALL_TYPES.includes(t)) errs.push(`${name}: 未知 type ${t}（契约外，记忆图渲染会忽略）`);
  return errs;
}

export const keyOf = (n) => `${n.type}::${n.label}`;

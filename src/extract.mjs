// 抽取：DSH 会话日志（session.v4.jsonl.zstd）→ 提问谱系（prompts.json）
// 用法：
//   node src/extract.mjs                # 最近还在写的那份会话
//   node src/extract.mjs --all          # 全部会话（每份单独成节）
//   node src/extract.mjs --session 890f # 指定会话 id 片段
//   node src/extract.mjs --out data/prompts.json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HOME = process.env.HOME;
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const SESS_ROOT = opt('--sessions-root', path.join(HOME, '.dsh/sessions/--Users-lixuefeng-Desktop-leeee--'));
const OUT = opt('--out', path.join(import.meta.dirname, '../data/prompts.json'));

// 系统注入：不是用户提问，必须滤掉，否则蛛网里全是噪声
const SYS_HEAD = /^(\[SCHEDULE REMINDER|Team message from|Background subagent|Background job|Its closing message|\[hindsight|Time sampled|The following workspace|Current runtime context|A skill is a reusable|This repository has a Hi|Reminder|\[acp|<system-reminder)/i;
const SYS_BODY = /(runtime context|workspace instructions|reusable set of task-specific|Hindsight memory|SENTINEL|antml|system-reminder|available_skills|injected prompt|<\/?[a-z-]+>)/i;
const CMD_LIKE = /^(bash-|dsh |codex |npm |node |curl |cd |ls |\/)/;

const textOf = (r) => (r?.data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();

function listSessions() {
  if (!fs.existsSync(SESS_ROOT)) return [];
  return fs.readdirSync(SESS_ROOT)
    .filter((d) => d.startsWith('session-'))
    .map((d) => ({ id: d, file: path.join(SESS_ROOT, d, 'session.v4.jsonl.zstd') }))
    .filter((x) => fs.existsSync(x.file))
    .sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
}

function readRecs(file) {
  const raw = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8');
  const recs = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { recs.push(JSON.parse(line)); } catch { /* 半行截断，跳过 */ }
  }
  return recs;
}

const uniqPush = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);

function analyse(recs) {
  let turn = 0;
  const prompts = [];
  const toolTotals = new Map();
  const projTotals = new Map();
  const artTotals = new Map();
  const projPat = /项目\/([A-Za-z0-9_\u4e00-\u9fa5-]{2,40})/g;
  const artPat = /([A-Za-z0-9_\u4e00-\u9fa5·\-—（）()]{2,44}\.(?:md|mp4|pptx|command|py|json|mjs|js|swift|html|css|png|jpg|txt|env|plist|sql|yaml|yml|asar|log))/g;

  for (const r of recs) {
    if (r.type === 'turn/start') { turn += 1; continue; }
    if (r.type === 'user/message') {
      const t = textOf(r);
      if (!t || t.length < 2) continue;
      if (SYS_HEAD.test(t) || SYS_BODY.test(t) || CMD_LIKE.test(t.trim())) continue;
      const scheduled = /^\[SCHEDULE|^这?是?定时|提醒：/.test(t);
      prompts.push({ i: prompts.length, turn, at: r.time || '', text: t, chars: t.length, scheduled });
      continue;
    }
    if (r.type !== 'tool/call') continue;
    const p = prompts[prompts.length - 1] || null;
    const name = r.data?.name || 'unknown';
    const args = typeof r.data?.arguments === 'string' ? r.data.arguments : JSON.stringify(r.data?.arguments || {});
    uniqPush(toolTotals, name);
    if (p) { p.tools = (p.tools || 0) + 1; p.toolKinds = p.toolKinds || {}; p.toolKinds[name] = (p.toolKinds[name] || 0) + 1; }
    for (const m of args.matchAll(projPat)) {
      const proj = m[1].replace(/[.。，,；;：:）)]+$/, '');
      if (!/^[a-z0-9][a-z0-9-]+$/i.test(proj)) continue;
      uniqPush(projTotals, proj);
      if (p) { p.projects = p.projects || {}; p.projects[proj] = (p.projects[proj] || 0) + 1; }
    }
    for (const m of args.matchAll(artPat)) {
      const f = m[1];
      if (f.length < 6) continue;
      uniqPush(artTotals, f);
      if (p) { p.files = p.files || {}; p.files[f] = (p.files[f] || 0) + 1; }
    }
  }

  const usage = recs.filter((r) => r.type === 'assistant/message').map((r) => r.data?.usage).filter(Boolean);
  const peak = usage.reduce((a, u) => Math.max(a, (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)), 0);

  for (const p of prompts) {
    p.tools = p.tools || 0;
    p.text = p.text.replace(/\s+/g, ' ').trim();
    p.label = p.text.slice(0, 46) + (p.text.length > 46 ? '…' : '');
    p.projectsTop = Object.entries(p.projects || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    p.filesTop = Object.entries(p.files || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }
  return {
    prompts,
    projects: [...projTotals.entries()].sort((a, b) => b[1] - a[1]),
    artifacts: [...artTotals.entries()].sort((a, b) => b[1] - a[1]),
    tools: [...toolTotals.entries()].sort((a, b) => b[1] - a[1]),
    stats: {
      records: recs.length,
      turns: recs.filter((r) => r.type === 'turn/start').length,
      toolCalls: recs.filter((r) => r.type === 'tool/call').length,
      assistantMsgs: recs.filter((r) => r.type === 'assistant/message').length,
      peakContextTokens: peak,
    },
  };
}

const all = listSessions();
const picked = flag('--all') ? all : (() => {
  const s = opt('--session');
  const hit = s ? all.filter((x) => x.id.includes(s)) : all.slice(0, 1);
  return hit.length ? hit : all.slice(0, 1);
})();
if (!picked.length) { console.error('没找到会话日志：' + SESS_ROOT); process.exit(2); }

const sessions = [], promptBag = [], projBag = new Map(), artBag = new Map(), toolBag = new Map();
let recSum = 0, turnSum = 0, toolSum = 0, peak = 0;
for (const s of picked) {
  const recs = readRecs(s.file);
  const a = analyse(recs);
  recSum += a.stats.records; turnSum += a.stats.turns; toolSum += a.stats.toolCalls;
  peak = Math.max(peak, a.stats.peakContextTokens);
  sessions.push({ id: s.id, logBytes: fs.statSync(s.file).size, ...a.stats, prompts: a.prompts.length });
  for (const p of a.prompts) promptBag.push({ ...p, session: s.id });
  for (const [k, v] of a.projects) uniqPush(projBag, k, v);
  for (const [k, v] of a.artifacts) uniqPush(artBag, k, v);
  for (const [k, v] of a.tools) uniqPush(toolBag, k, v);
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    sessions: sessions.map((s) => s.id),
    sessionCount: sessions.length,
    records: recSum,
    turns: turnSum,
    toolCalls: toolSum,
    prompts: promptBag.length,
    scheduledPrompts: promptBag.filter((p) => p.scheduled).length,
    peakContextTokens: peak,
    source: SESS_ROOT,
  },
  sessions,
  prompts: promptBag,
  projects: [...projBag.entries()].sort((a, b) => b[1] - a[1]).map(([name, weight]) => ({ name, weight })),
  artifacts: [...artBag.entries()].sort((a, b) => b[1] - a[1]).map(([name, weight]) => ({ name, weight })),
  tools: [...toolBag.entries()].sort((a, b) => b[1] - a[1]).map(([name, weight]) => ({ name, weight })),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify({
  out: OUT, sessions: out.meta.sessionCount, prompts: out.meta.prompts, scheduled: out.meta.scheduledPrompts,
  toolCalls: out.meta.toolCalls, projects: out.projects.length, artifacts: out.artifacts.length, tools: out.tools.length,
  topProject: out.projects.slice(0, 3), topTool: out.tools.slice(0, 4), peakContextTokens: out.meta.peakContextTokens,
}, null, 1));

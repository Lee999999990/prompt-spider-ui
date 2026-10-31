// Prompt Spider UI —— 只读 graph.json（记忆图同款 schema 的超集），不写任何数据。
const $ = (s) => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const TYPE = {
  session:   { label: '会话',   color: '#ff6b35' },
  prompt:    { label: '提问',   color: '#f59e0b' },
  project:   { label: '项目',   color: '#e8e6df' },
  artifact:  { label: '产物',   color: '#8b8880' },
  tool:      { label: '工具',   color: '#34d399' },
  service:   { label: '服务',   color: '#38bdf8' },
  schedule:  { label: '定时',   color: '#fbbf24' },
  agent:     { label: '子代理', color: '#a78bfa' },
  memory:    { label: '记忆',   color: '#f472b6' },
  milestone: { label: '里程碑', color: '#fb7185' },
};
const colorOf = (t) => (TYPE[t]?.color || '#9ca3af');

let G = null, sim = { on: true, running: false }, types = [], hidden = new Set();
let hover = null, sel = null, query = '', view = { x: 0, y: 0, k: 1 };
let W = 0, H = 0, dpr = 1;

async function fetchGraph(which) {
  const r = await fetch(`/api/graph?which=${encodeURIComponent(which)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function prepare(g) {
  G = g; W = g.W || 1920; H = g.H || 1080;
  for (const n of G.nodes) { n.vx = 0; n.vy = 0; }
  G.adj = new Map();
  for (const n of G.nodes) G.adj.set(n.id, new Set([n.id]));
  for (const e of G.edges) { G.adj.get(e.s)?.add(e.t); G.adj.get(e.t)?.add(e.s); }
  types = [...new Set(G.nodes.map((n) => n.type))];
  buildLegend();
  $('#src').textContent = `${G.meta?.kind || 'graph'} · ${G.meta?.session ? G.meta.session.slice(0, 20) + '…' : ''} · ${G.nodes.length} 节点`;
  $('#kNode').textContent = G.nodes.length;
  $('#kThread').textContent = G.edges.length;
  $('#kPrompt').textContent = (G.lists?.prompts || []).length || G.nodes.filter((n) => n.type === 'prompt').length;
  $('#kTool').textContent = G.meta?.toolCalls ?? '—';
  simulate(360);
  fit();
  draw();
}

function buildLegend() {
  const box = $('#legend');
  box.innerHTML = '';
  for (const t of types.sort((a, b) => (TYPE[b] ? 1 : 0) - (TYPE[a] ? 1 : 0))) {
    const id = 'chk-' + t;
    const el = document.createElement('label');
    el.className = 'on';
    el.innerHTML = `<input type="checkbox" id="${id}" checked><i style="background:${colorOf(t)}"></i>${TYPE[t]?.label || t} <span style="opacity:.45">${G.nodes.filter((n) => n.type === t).length}</span>`;
    el.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) hidden.delete(t); else hidden.add(t);
      el.classList.toggle('on', e.target.checked);
      draw();
    });
    box.appendChild(el);
  }
}

function visible(n) {
  if (hidden.has(n.type)) return false;
  if (query && !(`${n.label} ${n.sub || ''}`.toLowerCase().includes(query))) return false;
  return true;
}

// ---- 力导向：只求"像蛛网"，不追求完美图论布局
function simulate(ticks = 1) {
  const CX = W / 2, CY = H / 2;
  const nodes = G.nodes;
  for (let t = 0; t < ticks; t++) {
    const cool = 1 - t / (ticks * 1.15);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.type === 'session') { a.x += (CX - a.x) * 0.2; a.y += (CY - a.y) * 0.2; continue; }
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue;
        const f = 900 / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      // 轻微向心，防止飞散
      a.vx += (CX - a.x) * 0.0012; a.vy += (CY - a.y) * 0.0012;
    }
    for (const e of G.edges) {
      const a = nodes[e.s], b = nodes[e.t];
      if (!a || !b) continue;
      const rest = a.type === 'session' || b.type === 'session' ? 150 : 78;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - rest) * 0.014 * (e.w > 1.6 ? 1.35 : 1);
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const n of nodes) {
      n.vx *= 0.84; n.vy *= 0.84;
      n.x += n.vx * cool; n.y += n.vy * cool;
      n.x = Math.max(40, Math.min(W - 40, n.x));
      n.y = Math.max(40, Math.min(H - 40, n.y));
    }
  }
}

function fit() {
  const vis = G.nodes.filter(visible);
  if (!vis.length) return;
  const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
  const minX = Math.min(...xs) - 70, maxX = Math.max(...xs) + 70;
  const minY = Math.min(...ys) - 70, maxY = Math.max(...ys) + 70;
  const k = Math.min(cv.clientWidth / (maxX - minX), cv.clientHeight / (maxY - minY));
  view.k = Math.max(0.18, Math.min(2.2, k));
  view.x = cv.clientWidth / 2 - ((minX + maxX) / 2) * view.k;
  view.y = cv.clientHeight / 2 - ((minY + maxY) / 2) * view.k;
}

const toScreen = (x, y) => [x * view.k + view.x, y * view.k + view.y];

function draw() {
  if (!G) return;
  const t = getComputedStyle(document.documentElement);
  const ink = t.getPropertyValue('--ink').trim() || '#eee';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);

  const focus = hover ?? sel;
  const near = focus ? G.adj.get(focus.id) : null;
  const alphaOf = (id) => (!near ? 1 : near.has(id) ? 1 : 0.07);

  // 蛛丝
  for (const e of G.edges) {
    const a = G.nodes[e.s], b = G.nodes[e.t];
    if (!a || !b || !visible(a) || !visible(b)) continue;
    const [ax, ay] = toScreen(a.x, a.y), [bx, by] = toScreen(b.x, b.y);
    const dim = Math.min(alphaOf(a.id), alphaOf(b.id));
    const sessionEdge = a.type === 'session' || b.type === 'session';
    ctx.beginPath();
    if (sessionEdge) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const nx = -(by - ay), ny = bx - ax;
      const L = Math.hypot(nx, ny) || 1;
      const bend = 0.10 * view.k;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx + (nx / L) * L * bend, my + (ny / L) * L * bend, bx, by);
    } else {
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = a.type === 'prompt' || b.type === 'prompt'
      ? `rgba(245,158,11,${0.16 + 0.5 * dim})`
      : `${ink}${Math.round((0.06 + 0.18 * dim) * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = Math.max(0.35, Math.min(3.4, (e.w || 0.5) * 0.55 * view.k));
    ctx.stroke();
  }

  // 节点
  for (const n of G.nodes) {
    if (!visible(n)) continue;
    const [x, y] = toScreen(n.x, n.y);
    const r = Math.max(1.6, (n.r || 4) * view.k);
    const al = alphaOf(n.id);
    const c = colorOf(n.type);
    ctx.globalAlpha = al;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    if (n.type === 'session' || n.type === 'project' || n.type === 'prompt') {
      ctx.strokeStyle = `${ink}55`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    if (n.id === sel?.id || n.id === hover?.id) {
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if ((n.type === 'session' || n.type === 'project') && view.k > 0.42) {
      ctx.globalAlpha = al * 0.95;
      ctx.fillStyle = ink;
      ctx.font = `${n.type === 'session' ? 10.5 : 9.5}px ui-monospace,Menlo,monospace`;
      ctx.fillText(n.label.length > 26 ? n.label.slice(0, 26) + '…' : n.label, x + r + 5, y + 3);
    }
    ctx.globalAlpha = 1;
  }
}

function pick(mx, my) {
  let best = null, bestD = 15 * 15;
  for (const n of G.nodes) {
    if (!visible(n)) continue;
    const [x, y] = toScreen(n.x, n.y);
    const d = (x - mx) ** 2 + (y - my) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function promptDetail(n) {
  const list = G.lists?.prompts || [];
  const p = list.find((x) => x.i === n.promptIndex) || null;
  if (!p) return '';
  const tools = Object.entries(p.toolKinds || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${k} ×${v}</span>`).join('');
  const projs = (p.projectsTop || []).map(([k, v]) => `<span class="chip">${k} ×${v}</span>`).join('');
  const files = (p.filesTop || []).map(([k, v]) => `<span class="chip">${k} ${v}×</span>`).join('');
  return `
    <p class="full">${escapeHtml(p.text)}</p>
    <dl>
      <dt>轮次</dt><dd>turn ${p.turn}${p.scheduled ? ' · 定时任务触发' : ''}</dd>
      <dt>长度</dt><dd>${p.chars} 字</dd>
      <dt>工具调用</dt><dd>${p.tools} 次</dd>
    </dl>
    ${tools ? `<h2 style="font-size:9px;letter-spacing:.16em;color:var(--soft);margin:0 0 5px">用到的工具</h2><div class="chips">${tools}</div>` : ''}
    ${projs ? `<h2 style="font-size:9px;letter-spacing:.16em;color:var(--soft);margin:12px 0 5px">牵动的项目</h2><div class="chips">${projs}</div>` : ''}
    ${files ? `<h2 style="font-size:9px;letter-spacing:.16em;color:var(--soft);margin:12px 0 5px">碰到的文件</h2><div class="chips">${files}</div>` : ''}
  `;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function openPanel(n) {
  sel = n;
  $('#pTitle').textContent = (TYPE[n.type]?.label || n.type) + ' · ' + n.label;
  $('#pSub').textContent = n.sub || '';
  $('#pBody').innerHTML = n.type === 'prompt' ? promptDetail(n) : `
    <dl>
      <dt>类型</dt><dd>${n.type}</dd>
      <dt>连着</dt><dd>${G.adj.get(n.id).size - 1} 个节点</dd>
      ${n.weight ? `<dt>权重</dt><dd>${n.weight}</dd>` : ''}
    </dl>
    <p class="full">${escapeHtml(n.label)}</p>`;
  $('#panel').classList.add('open');
  draw();
}

// ---- 交互
cv.addEventListener('mousemove', (e) => {
  const mx = e.clientX - cv.getBoundingClientRect().left, my = e.clientY - cv.getBoundingClientRect().top;
  const n = pick(mx, my);
  if (n !== hover) { hover = n; draw(); }
  const tip = $('#tip');
  if (n) {
    tip.innerHTML = `<b>${TYPE[n.type]?.label || n.type}</b> · ${escapeHtml(n.label)}${n.sub ? '<br>' + escapeHtml(n.sub) : ''}`;
    tip.style.left = Math.min(mx + 14, cv.clientWidth - 350) + 'px';
    tip.style.top = my + 16 + 'px';
    tip.style.opacity = 1;
    cv.style.cursor = 'pointer';
  } else { tip.style.opacity = 0; cv.style.cursor = 'crosshair'; }
});
cv.addEventListener('click', (e) => {
  const r = cv.getBoundingClientRect();
  const n = pick(e.clientX - r.left, e.clientY - r.top);
  if (n) openPanel(n); else { $('#panel').classList.remove('open'); sel = null; draw(); }
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [mx, my] = [e.clientX, e.clientY];
  const k2 = Math.max(0.15, Math.min(4, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
  view.x = mx - ((mx - view.x) / view.k) * k2;
  view.y = my - ((my - view.y) / view.k) * k2;
  view.k = k2;
  draw();
}, { passive: false });

let drag = null;
cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; });
addEventListener('mouseup', () => { drag = null; });
addEventListener('mousemove', (e) => {
  if (!drag) return;
  view.x = drag.vx + (e.clientX - drag.x);
  view.y = drag.vy + (e.clientY - drag.y);
  draw();
});

$('#q').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); draw(); });
$('#q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !query) return;
  const hit = G.nodes.find((n) => visible(n) && `${n.label}`.toLowerCase().includes(query));
  if (hit) { openPanel(hit); view.x = cv.clientWidth / 2 - hit.x * view.k; view.y = cv.clientHeight / 2 - hit.y * view.k; draw(); }
});
$('#bFit').addEventListener('click', () => { fit(); draw(); });
$('#bTheme').addEventListener('click', () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
  draw();
});
$('#bLayout').addEventListener('click', (e) => {
  sim.on = !sim.on;
  e.target.setAttribute('aria-pressed', String(sim.on));
  if (sim.on) { simulate(240); fit(); draw(); }
});
$('#bExport').addEventListener('click', () => {
  const clone = { ...G, meta: { ...G.meta, exportedAt: new Date().toISOString(), exportedBy: 'prompt-spider-ui' } };
  delete clone.adj;
  const blob = new Blob([JSON.stringify(clone)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `graph-${(G.meta?.kind || 'spider')}-${Date.now()}.json`;
  a.click();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#panel').classList.remove('open'); sel = null; draw(); }
  if (e.key.toLowerCase() === 't') $('#bTheme').click();
  if (e.key.toLowerCase() === 'f') { fit(); draw(); }
});

function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  draw();
}
addEventListener('resize', resize);

// ---- 启动
(async () => {
  resize();
  $('#clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); }, 1000);
  let sources = ['spider', 'merged', 'memory'];
  try {
    const r = await fetch('/api/graphs', { cache: 'no-store' });
    if (r.ok) sources = (await r.json()).available || sources;
  } catch { /* 静态托管时没有这个接口，退回默认 */ }
  const box = $('#srcBtns');
  for (const s of sources) {
    const b = document.createElement('button');
    b.textContent = s; b.dataset.which = s;
    b.addEventListener('click', async () => {
      [...box.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      prepare(await fetchGraph(s));
    });
    box.appendChild(b);
  }
  box.firstChild?.setAttribute('aria-pressed', 'true');
  try { prepare(await fetchGraph(sources[0])); }
  catch (err) { $('#src').textContent = '加载失败：' + err.message + '（请用 npm run serve 启动）'; }
})();

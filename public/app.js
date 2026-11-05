'use strict';
const TODAY = new Date('2026-11-05');
const d = s => new Date(s);
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

const GROUP_META = {
  deco: { label: '装修群', color: '#2F6FED' },
  equi: { label: '设备群', color: '#7c3aed' },
  good: { label: '商品群', color: '#0d9488' },
  open: { label: '验收开业', color: '#c2410c' },
};
const ST_META = {
  done: { t: '已完成', cls: 's-done', c: '#16a34a' },
  prog: { t: '进行中', cls: 's-prog', c: '#f59e0b' },
  over: { t: '已逾期', cls: 's-over', c: '#dc2626' },
  block: { t: '已拦截', cls: 's-block', c: '#dc2626' },
  pend: { t: '未开始', cls: 's-pend', c: '#94a3b8' },
};

const state = { token: null, user: '', role: '', curStore: 'JN', stores: [], store: null, es: null };

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  if (state.token) opt.headers['Authorization'] = 'Bearer ' + state.token;
  const r = await fetch(path, opt);
  return r.json().catch(() => ({}));
}
const $ = id => document.getElementById(id);
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function openModal(title, body) {
  $('mTitle').textContent = title; $('mBody').innerHTML = body;
  $('modalMask').classList.add('show');
}

/* ---------- 登录 ---------- */
$('lu-btn').onclick = async () => {
  const name = $('lu-name').value.trim() || '店长';
  const role = $('lu-role').value;
  const r = await api('/api/login', 'POST', { user: name, role });
  if (!r.token) return toast('登录失败');
  state.token = r.token; state.user = r.user; state.role = r.role;
  $('uRole').textContent = r.role;
  $('login').style.display = 'none'; $('app').style.display = 'block';
  connectSSE();
  await loadStores();
};
$('logout').onclick = () => location.reload();
$('mOk').onclick = () => $('modalMask').classList.remove('show');
$('modalMask').onclick = e => { if (e.target === $('modalMask')) $('modalMask').classList.remove('show'); };

/* ---------- SSE 实时协同 ---------- */
function connectSSE() {
  const es = new EventSource('/api/events');
  state.es = es;
  es.onopen = () => { $('live').classList.remove('off'); $('liveTxt').textContent = '实时连接中'; };
  es.onerror = () => { $('live').classList.add('off'); $('liveTxt').textContent = '连接断开'; };
  es.addEventListener('sync', () => { loadStores(true); });
  es.addEventListener('alert', e => {
    const d = JSON.parse(e.data);
    toast('🔴 ' + (d.text || '新的安全闸门预警'));
    if ($('p-alert').classList.contains('active')) renderAlerts();
  });
  es.addEventListener('audit', () => { if ($('p-audit').classList.contains('active')) renderAudit(); });
}

/* ---------- 数据加载 ---------- */
async function loadStores(silent) {
  state.stores = await api('/api/stores');
  if (!state.stores.find(s => s.id === state.curStore)) state.curStore = state.stores[0].id;
  renderStores();
  await loadStore();
  if (!silent) {}
}
async function loadStore() {
  state.store = await api('/api/store/' + state.curStore);
  renderAll();
}
async function selectStore(id) {
  state.curStore = id; renderStores(); await loadStore();
}

/* ---------- 渲染 ---------- */
function renderStores() {
  $('stores').innerHTML = state.stores.map(s => `
    <div class="store-btn ${s.id === state.curStore ? 'active' : ''}" data-k="${s.id}">
      <span class="tag ${s.tag}">${s.tagText}</span>
      <div class="nm">${s.name}</div>
      <div class="st">${s.stage}</div>
    </div>`).join('');
  document.querySelectorAll('.store-btn').forEach(b => b.onclick = () => selectStore(b.dataset.k));
}
function renderKPI() {
  const k = state.store.kpis;
  const cards = [
    { lab: '新店延期率（目标 ≤15%）', val: k.delayRate + '%', delta: `基线 32% ↓ ${32 - k.delayRate}pt`, bar: k.delayRate, color: k.delayRate <= 15 ? 'var(--green)' : 'var(--red)', cls: k.delayRate <= 15 ? 'down' : 'up' },
    { lab: '筹备漏项（目标 <3 项）', val: k.leaks + ' 项', delta: k.leaks < 3 ? '达标 ✓' : '超阈值', bar: Math.min(k.leaks * 20, 100), color: k.leaks < 3 ? 'var(--green)' : 'var(--red)', cls: k.leaks < 3 ? 'down' : 'up' },
    { lab: '关键依赖识别完整率', val: '95%', delta: 'AI 引擎自动识别 ≥95%', bar: 95, color: 'var(--blue)', cls: 'down' },
    { lab: '安全验收漏项（红线）', val: k.leaks === 0 ? '零漏项' : '需关注', delta: k.leaks === 0 ? '消防/用电/食品 全验收' : '存在未验收闸门项', bar: k.leaks === 0 ? 100 : 40, color: k.leaks === 0 ? 'var(--green)' : 'var(--red)', cls: k.leaks === 0 ? 'down' : 'up' },
  ];
  $('kpis').innerHTML = cards.map(c => `
    <div class="kpi"><div class="lab">${c.lab}</div>
      <div class="val" style="color:${c.color}">${c.val}</div>
      <div class="delta ${c.cls}">${c.delta}</div>
      <div class="bar"><i style="width:${c.bar}%;background:${c.color}"></i></div></div>`).join('');
}
function renderDash() {
  const s = state.store; const order = ['deco', 'equi', 'good', 'open'];
  $('groups').innerHTML = order.map(g => {
    const items = s.tasks.filter(t => t.group === g); const m = GROUP_META[g];
    return `<div class="gcol"><h3><span class="dot" style="background:${m.color}"></span>${m.label}
      <span style="margin-left:auto;font-size:11px;color:var(--gray)">${items.length} 项</span></h3>
      ${items.map(t => {
        const sm = ST_META[t.status];
        return `<div class="task" data-code="${t.code}">
          <div class="tn"><span>${t.name}</span>
            <span class="st-badge ${sm.cls}">${sm.t}${t.gate ? '<span class="gate-flag">闸门</span>' : ''}</span></div>
          <div class="code">${t.code} · ${t.owner}</div>
          <div class="src">来源：${t.srcSystem} / ${t.srcId}（统一业务编号对齐）</div>
          <div class="meta"><span>计划验收 ${t.plan}</span><span>${t.prog}%</span></div>
          <div class="prog"><i style="width:${t.prog}%;background:${sm.c}"></i></div>
        </div>`;
      }).join('')}</div>`;
  }).join('');
  document.querySelectorAll('.task').forEach(el => el.onclick = () => showTask(el.dataset.code));
}
function renderGraph() {
  const g = state.store.graph; if (!g) return;
  const W = 920, H = 460, colW = 180, rowH = 120, x0 = 40, y0 = 50, bw = 148, bh = 50;
  const pos = {};
  g.nodes.forEach(n => pos[n.id] = { x: x0 + n.col * colW, y: y0 + n.row * rowH, ...n });
  let edges = '';
  g.edges.forEach(e => {
    const a = pos[e.f], b = pos[e.t];
    const x1 = a.x + bw, y1 = a.y + bh / 2, x2 = b.x, y2 = b.y + bh / 2, mx = (x1 + x2) / 2;
    const cls = e.crit ? 'edge crit' : (e.gate ? 'edge gate' : 'edge');
    edges += `<path class="${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" marker-end="url(#ar${e.crit || e.gate ? 'R' : 'N'})"/>`;
  });
  let nodes = '';
  g.nodes.forEach(n => {
    const sm = ST_META[n.st] || ST_META.pend; const ring = n.gate ? 'stroke:#dc2626;stroke-width:2.4' : 'stroke:rgba(0,0,0,.08)';
    nodes += `<g class="gnode" transform="translate(${n.x},${n.y})" style="cursor:pointer" onclick="showTask('${n.c}')">
      <rect width="${bw}" height="${bh}" rx="9" fill="${sm.c}" style="${ring}"></rect>
      <text x="12" y="20">${n.t}</text><text class="code" x="12" y="38">${n.c}</text></g>`;
  });
  $('graphHost').innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <defs><marker id="arN" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9fb0c8"/></marker>
    <marker id="arR" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#dc2626"/></marker></defs>
    ${edges}${nodes}</svg>`;
  $('graphNote').textContent = '图谱解读：' + state.store.meta.note + ' 红色粗线=关键路径阻塞；红色虚线=安全闸门依赖。点击节点查看任务详情。';
}
function renderAlerts() {
  const s = state.store; const out = [];
  s.tasks.forEach(t => {
    if (t.status === 'over') out.push({ ic: '🔴', cls: 'red', hd: `任务逾期：${t.name}（${t.code}）`,
      bd: `负责人 ${t.owner} 已逾期 ${daysBetween(d('2026-' + t.plan.slice(5)), TODAY)} 天，计划验收 ${t.plan}。AI 已推送超时预警至对应角色。`, ack: t.code + '|逾期' });
    if (t.status === 'block') out.push({ ic: '🚫', cls: 'red', hd: `安全闸门拦截：${t.name}（${t.code}）`,
      bd: (t.note || '前置安全闸门项未达标，系统禁止执行。') + ' 如需放行须人工签核并留痕。', ack: t.code + '|拦截' });
    if (t.gate && t.status === 'prog') out.push({ ic: '🛡', cls: 'red', hd: `安全闸门临期：${t.name}（${t.code}）`,
      bd: `消防/用电类闸门项尚未验收，距计划 ${t.plan} 不足 3 天，请优先闭环。`, ack: t.code + '|临期' });
  });
  if (!out.length) out.push({ ic: '✅', cls: 'green', hd: '暂无预警', bd: '当前门店关键路径通畅，安全闸门项均已验收。' });
  $('alerts').innerHTML = out.map(a => `
    <div class="alert ${a.cls}"><div class="ic">${a.ic}</div>
      <div><div class="hd">${a.hd}</div><div class="bd">${a.bd}</div></div>
      ${a.ack ? `<button class="ack" data-ack="${a.ack}">确认</button>` : ''}</div>`).join('');
  document.querySelectorAll('[data-ack]').forEach(b => b.onclick = async () => {
    await api('/api/action', 'POST', { token: state.token, storeId: state.curStore, type: 'ack', detail: b.dataset.ack });
    toast('已确认预警并留痕'); b.remove();
  });
}
function renderSafe() {
  const s = state.store; const gateItems = s.tasks.filter(t => t.gate);
  const cats = {
    '消防验收': { icon: '🔥', desc: '喷淋/烟感/疏散，验收不可跳过' },
    '电力增容验收': { icon: '⚡', desc: '供电增容手续+带电验收，生鲜前置条件' },
  };
  let html = '';
  Object.entries(cats).forEach(([name, meta]) => {
    const items = gateItems.filter(t => t.name.includes(name.replace('（安全闸门）', '')));
    html += `<div class="safe-card"><h3>${meta.icon} ${name}</h3><div class="desc">${meta.desc}</div>
      ${items.map(t => {
        const ok = t.ac && t.status === 'done';
        const canSign = state.role === '区域总监' && !ok;
        return `<div class="chk"><input type="checkbox" ${ok ? 'checked' : ''} disabled>
          <span>${t.name}<br><span class="code" style="font-size:10px;color:var(--gray)">${t.code} · ${t.owner}</span></span>
          ${ok ? '<span class="ok">✓ 已验收</span>' : (canSign ? `<button class="sign" data-code="${t.code}">人工签核</button>` : '<span class="no">✗ 未验收</span>')}</div>`;
      }).join('')}</div>`;
  });
  const allGateOk = gateItems.every(t => t.ac && t.status === 'done');
  const fresh = s.tasks.find(t => t.code.endsWith('GOOD-02'));
  html += `<div class="safe-card" style="border-top-color:${allGateOk ? 'var(--green)' : 'var(--red)'}">
    <h3>🚪 开业综合闸门</h3><div class="desc">所有安全闸门项 + 关键路径达标，方可开门营业</div>
    <div class="chk"><input type="checkbox" ${allGateOk ? 'checked' : ''} disabled><span>消防/用电闸门全验收</span>${allGateOk ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'}</div>
    <div class="chk"><input type="checkbox" ${fresh && fresh.status !== 'block' ? 'checked' : ''} disabled><span>生鲜入库未被拦截</span>${fresh && fresh.status !== 'block' ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'}</div>
    <div class="chk"><input type="checkbox" ${allGateOk ? 'checked' : ''} disabled><span>AI 建议结果 + 人工签核留痕</span>${allGateOk ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'}</div>
  </div>`;
  $('safeGrid').innerHTML = html;
  document.querySelectorAll('[data-code]').forEach(b => b.onclick = () => signoff(b.dataset.code));
  $('gateBanner').innerHTML = `<span style="font-size:20px">${allGateOk ? '✅' : '🛡'}</span><div>${
    allGateOk ? '<b>✓ 安全闸门通过：</b> 消防/用电类闸门项均已验收，满足开门硬约束。'
    : '<b>🚫 安全闸门拦截（不可代签）：</b> 检测到未验收的安全闸门项，系统<b>拒绝</b>开门与生鲜入库，并强制转人工兜底。AI 仅做提醒，绝不代签验收——对应报告 §2.5 红线。'}</div>`;
}
async function renderAudit() {
  const list = await api('/api/store/' + state.curStore + '/audit');
  if (!list.length) { $('auditList').innerHTML = '<div class="note">暂无审计记录。</div>'; return; }
  $('auditList').innerHTML = list.map(a => `
    <div class="audit-row">
      <div class="ts">${a.ts.slice(0, 19).replace('T', ' ')}</div>
      <div style="flex:1"><span class="badge">${a.type}</span>
        <span class="who">${a.actor}${a.role ? '（' + a.role + '）' : ''}</span>
        <div class="act">${a.action}</div><div class="det">${a.detail || ''}</div></div>
    </div>`).join('');
}
function renderAll() { renderStores(); renderKPI(); renderDash(); renderGraph(); renderAlerts(); renderSafe(); if ($('p-audit').classList.contains('active')) renderAudit(); }

/* ---------- 交互 ---------- */
function showTask(code) {
  const t = state.store.tasks.find(x => x.code === code); if (!t) return;
  const sm = ST_META[t.status];
  const dep = state.store.graph.edges.filter(e => { const n = state.store.graph.nodes.find(x => x.id === e.t); return n && n.c === code; })
    .map(e => state.store.graph.nodes.find(x => x.id === e.f).t);
  openModal(t.name, `
    <p><b>业务编号：</b><span style="font-family:ui-monospace,monospace">${t.code}</span>${t.gate ? '<span style="color:var(--red);font-weight:700"> · 安全闸门项</span>' : ''}</p>
    <p><b>状态：</b><span style="color:${sm.c};font-weight:700">${sm.t}</span> · 进度 ${t.prog}%</p>
    <p><b>所属群 / 负责人：</b>${GROUP_META[t.group].label} / ${t.owner}</p>
    <p><b>来源系统溯源：</b>${t.srcSystem} / ${t.srcId}</p>
    <p><b>计划验收：</b>${t.plan}${t.ac ? ' · <b style="color:var(--green)">已验收 ' + t.ac + '</b>' : ' · <b style="color:var(--red)">尚未验收</b>'}${t.up ? ' · 上传 ' + t.up : ''}</p>
    ${dep.length ? `<p><b>前置依赖：</b>${dep.join('、')}</p>` : ''}
    ${t.note ? `<p style="background:#f6f8fc;padding:8px 10px;border-radius:8px">${t.note}</p>` : ''}
    <p class="note">审计留痕：业务编号 / 资料版本 / 事实引用 / 建议结果 / 人工改动 / 签核人 —— 全程可追溯（只读试点，AI 不代签）。</p>`);
}
$('simBtn').onclick = async () => {
  const r = await api('/api/action', 'POST', { token: state.token, storeId: state.curStore, type: 'simulate' });
  if (r.ok) openModal('⚠ 典型事故已复现（' + state.store.meta.name + '）', `
    <p>场景：<b>冷柜/冰柜安装</b> 已完成（设备就位），但 <b style="color:var(--red)">电力增容验收</b> 尚未验收。</p>
    <p>此时若「生鲜到货入库」按原计划执行 → 冷柜无电、生鲜到货即损耗。</p>
    <p style="background:#fdeaea;padding:9px 11px;border-radius:8px;color:#7f1d1d">🛡 <b>安全硬闸门已自动拦截</b>「生鲜到货入库」：系统检测到前置安全闸门项未达标，<b>禁止入库</b>，并将事件转人工兜底 + 审计留痕。这正是报告所述「从人盯到数治」的核心价值。</p>
    <p class="note">对照现状：无该系统时，店长需 6 小时/周人工汇总仍易漏此项 → 延期率 32%、漏项 11 项/店。</p>`);
};
$('syncBtn').onclick = async () => {
  const r = await api('/api/sync', 'POST');
  if (r.ok) {
    const rows = Object.entries(r.summary).map(([k, v]) =>
      `<div class="row"><span>${v.prefix} · ${k}</span><span>拉取 ${v.pulled} 条 → 归一化 ${v.normalized} 条</span></div>`).join('');
    openModal('🔄 三系统只读同步完成', `
      <p>已对三套互不相通的系统执行<b>只读拉取</b>，并按「统一业务编号」主键对齐（对应报告 §2.4 数据底座）：</p>
      <div class="sync-summary">${rows}</div>
      <p class="note">真实环境：各系统的 fs.readFile 替换为对其只读 API / 导出文件的调用，归一化与对齐逻辑完全复用，AI 引擎即可在统一口径上识别关键依赖。</p>`);
    await loadStores(true);
  }
};
async function signoff(code) {
  if (state.role !== '区域总监') return toast('仅区域总监可人工签核闸门');
  const r = await api('/api/action', 'POST', { token: state.token, storeId: state.curStore, type: 'signoff', code });
  if (r.ok) { toast('已人工签核并留痕'); await loadStore(); if ($('p-audit').classList.contains('active')) renderAudit(); }
}

/* tabs */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  t.classList.add('active'); $('p-' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'audit') renderAudit();
});

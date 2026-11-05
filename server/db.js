'use strict';
const fs = require('fs');
const path = require('path');
const { runAdapters, GRAPH } = require('./adapters');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const STORE_META = {
  JN: { name: '青杉·江南路店', stage: '试营业前 12 天', tag: 'risk', tagText: '⚠ 关键路径阻塞',
        note: '典型事故场景：冷柜已安装、但「电力增容验收」未完成 → 生鲜到货被安全闸门拦截。' },
  CX: { name: '青杉·城西店', stage: '筹备中 · 进度健康', tag: 'ok', tagText: '✓ 关键路径通畅',
        note: '对照门店：依赖识别完整率达标，无逾期，安全闸门项均已验收。' },
  GX: { name: '青杉·高新店', stage: '筹备中 · 消防待验', tag: 'risk', tagText: '⚠ 消防闸门临期',
        note: '另一风险场景：冷柜安装逾期，叠加消防验收尚未验收 → 双重闸门压力。' },
};

const ST_META = { done:{t:'已完成'}, prog:{t:'进行中'}, over:{t:'已逾期'}, block:{t:'已拦截'}, pend:{t:'未开始'} };

let state = { stores: {}, audit: [] };

function load() {
  try { state = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch (e) { state = { stores: {}, audit: [] }; }
  if (!state.stores) state.stores = {};
  if (!state.audit) state.audit = [];
}
function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
}

// 运行三系统只读适配器，刷新门店任务（对应报告 §2.4 数据底座对齐）
function syncStores() {
  const { stores, summary } = runAdapters();
  state.stores = stores;
  save();
  return summary;
}

function computeKPI(tasks) {
  const total = tasks.length;
  const overdue = tasks.filter(t => t.status === 'over' || t.status === 'block').length;
  const delayRate = Math.round(overdue / total * 100);
  const leaks = tasks.filter(t => t.gate && !t.ac).length;
  const done = tasks.filter(t => t.status === 'done').length;
  const compRate = Math.round(done / total * 100);
  return { total, overdue, delayRate, leaks, compRate };
}

function storeList() {
  return Object.keys(STORE_META).map(id => ({
    id, ...STORE_META[id],
    kpis: computeKPI((state.stores[id] && state.stores[id].tasks) || []),
  }));
}

function getStore(id) {
  const meta = STORE_META[id];
  if (!meta) return null;
  const tasks = (state.stores[id] && state.stores[id].tasks) || [];
  // 让依赖图谱节点带上实时状态
  const g = GRAPH[id];
  let liveGraph = null;
  if (g) {
    const byCode = {};
    tasks.forEach(t => byCode[t.code] = t);
    liveGraph = {
      edges: g.edges,
      nodes: g.nodes.map(n => ({ ...n, st: (byCode[n.c] && byCode[n.c].status) || 'pend', ac: byCode[n.c] ? byCode[n.c].ac : null })),
    };
  }
  return { id, meta, tasks, kpis: computeKPI(tasks), graph: liveGraph };
}

function pushAudit(entry) {
  entry.ts = new Date().toISOString();
  state.audit.unshift(entry);
  if (state.audit.length > 500) state.audit.length = 500;
  save();
  return entry;
}
function getAudit(storeId) {
  if (!storeId) return state.audit;
  return state.audit.filter(a => a.storeId === storeId);
}

// 业务动作：模拟典型事故（电力增容未验收 -> 生鲜被拦截）
function simulateAccident(storeId) {
  const s = state.stores[storeId];
  if (!s) return null;
  const power = s.tasks.find(t => t.code.endsWith('DECO-04'));
  const fresh = s.tasks.find(t => t.code.endsWith('GOOD-02'));
  if (!fresh) {
    pushAudit({ storeId, type: 'simulate', actor: '系统', action: '模拟典型事故', detail: '该门店无生鲜入库任务' });
    save(); return { power, fresh };
  }
  if (fresh.status === 'block') {
    pushAudit({ storeId, type: 'simulate', actor: '系统', action: '模拟典型事故',
      detail: `「${fresh.name}」已处于安全闸门拦截状态（前置「${power.name}」未验收），系统拒绝入库` });
  } else {
    fresh.status = 'block'; fresh.prog = 0;
    pushAudit({ storeId, type: 'simulate', actor: '系统', action: '模拟典型事故',
      detail: `检测到「${power.name}」未验收，安全闸门自动拦截「${fresh.name}」` });
  }
  save();
  return { power, fresh };
}

// 人工签核闸门后复盘：若前置安全闸门项均已验收，解除生鲜拦截（对应报告“异常转人工兜底”）
function recheckFresh(storeId) {
  const s = state.stores[storeId]; if (!s) return;
  const fresh = s.tasks.find(t => t.code.endsWith('GOOD-02'));
  if (!fresh || fresh.status !== 'block') return;
  const power = s.tasks.find(t => t.code.endsWith('DECO-04'));
  const cold = s.tasks.find(t => t.code.endsWith('EQUI-02'));
  if (power && power.ac && cold && cold.status === 'done') {
    fresh.status = 'pend'; fresh.prog = 0;
    pushAudit({ storeId, type: 'recheck', actor: '系统', action: '解除拦截',
      detail: `前置「${power.name}」已签核、「${cold.name}」已安装，「${fresh.name}」解除安全闸门拦截，可继续` });
  }
}

module.exports = {
  load, save, syncStores, storeList, getStore, pushAudit, getAudit, simulateAccident, recheckFresh, STORE_META, ST_META,
};

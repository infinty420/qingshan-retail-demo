'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');

// 三套互不相通的系统，各自原始字段命名不同 —— 这是“数据底座·跨系统对齐”要解决的真实问题。
const SYSTEMS = {
  project:   { file: 'extract_project.json',   label: '项目管理表', prefix: 'PM' },
  equipment: { file: 'extract_equipment.json', label: '设备台账',   prefix: 'EQ' },
  supplier:  { file: 'extract_supplier.json',  label: '供应商平台', prefix: 'SP' },
};

const GROUP_CODE = { deco: 'DECO', equi: 'EQUI', good: 'GOOD', open: 'OPEN' };
const PROG = { done: 100, prog: 55, over: 70, block: 0, pend: 0 };

// ---- 各系统原始状态 -> 统一状态 ----
function normStatus(sys, raw) {
  if (sys === 'project') {
    return { done: 'done', doing: 'prog', overdue: 'over', pending: 'pend', blocked: 'block' }[raw] || 'pend';
  }
  if (sys === 'equipment') {
    return { '已安装': 'done', '安装中': 'prog', '逾期': 'over', '未开始': 'pend' }[raw] || 'pend';
  }
  if (sys === 'supplier') {
    return { '已到货': 'done', '运输中': 'pending', '未下单': 'pend', '已逾期': 'over', '被拦截': 'block' }[raw] || 'pend';
  }
  return 'pend';
}

// ---- 将单条原始记录映射为统一 Task（含来源溯源）----
function mapProject(r) {
  const st = normStatus('project', r.p_status);
  return {
    name: r.p_name, group: r.p_group, owner: r.p_owner, status: st,
    plan: r.p_plan, up: r.p_upload, ac: r.p_accept, gate: !!r.p_gate, note: r.note || '',
    srcSystem: '项目管理表', srcId: r.p_id,
  };
}
function mapEquipment(r) {
  const st = normStatus('equipment', r.install_st);
  return {
    name: r.device, group: r.grp, owner: r.owner, status: st,
    plan: r.plan_dt, up: null, ac: r.accept_dt, gate: false, note: r.note || '',
    srcSystem: '设备台账', srcId: r.asset_no,
  };
}
function mapSupplier(r) {
  const st = normStatus('supplier', r.ship_st);
  return {
    name: r.item, group: 'good', owner: r.owner, status: st,
    plan: r.eta_dt, up: r.recv_dt, ac: r.recv_dt, gate: false, note: r.note || '',
    srcSystem: '供应商平台', srcId: r.po_no,
  };
}

/**
 * 运行三个只读适配器：拉取 -> 统一业务编号 -> 归一化。
 * 返回 { stores, summary }，stores: { JN:{tasks:[...]}, ... }
 * 在真实环境，各 map* 函数里的 fs.readFile 会替换为对三套系统的只读 API/导出的调用，
 * 归一化与「业务编号」主键对齐逻辑完全复用。
 */
function runAdapters() {
  const summary = {};
  const buckets = {}; // store -> group -> counter
  const stores = {};

  for (const [key, conf] of Object.entries(SYSTEMS)) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, conf.file), 'utf-8'));
    let mapped = raw.map((r) => {
      if (key === 'project') return mapProject(r);
      if (key === 'equipment') return mapEquipment(r);
      if (key === 'supplier') return mapSupplier(r);
    });
    summary[conf.label] = {
      prefix: conf.prefix, pulled: raw.length, normalized: mapped.length,
      sampleId: raw[0] ? raw[0].p_id || raw[0].asset_no || raw[0].po_no : '',
    };
    // 跨系统对齐：统一“业务编号”主键 = 门店-群-序号
    mapped.forEach((t) => {
      const store = (t.srcId.split('-')[1]); // PM-JN-01 -> JN
      if (!store) return;
      buckets[store] = buckets[store] || {};
      buckets[store][t.group] = (buckets[store][t.group] || 0) + 1;
      const code = `${store}-${GROUP_CODE[t.group]}-${String(buckets[store][t.group]).padStart(2, '0')}`;
      t.code = code;
      t.prog = PROG[t.status];
      stores[store] = stores[store] || { tasks: [] };
      stores[store].tasks.push(t);
    });
  }
  return { stores, summary };
}

// 依赖图谱（可视化布局，与报告关键路径一致：电力增容->冷柜->生鲜）
const GRAPH = {
  JN: { nodes: [
    { id:'N1', t:'选址签约', c:'JN-DECO-01', col:0, row:1 },
    { id:'N2', t:'门店装修', c:'JN-DECO-02', col:1, row:1 },
    { id:'N3', t:'消防验收', c:'JN-DECO-03', col:2, row:0, gate:true },
    { id:'N4', t:'电力增容', c:'JN-DECO-04', col:2, row:1, gate:true },
    { id:'N5', t:'冷柜安装', c:'JN-EQUI-02', col:3, row:1 },
    { id:'N6', t:'货架陈列', c:'JN-GOOD-01', col:3, row:2 },
    { id:'N7', t:'生鲜入库', c:'JN-GOOD-02', col:4, row:1 },
    { id:'N8', t:'开业验收', c:'JN-OPEN-01', col:4, row:2 },
  ], edges: [
    {f:'N1',t:'N2'},{f:'N2',t:'N3'},{f:'N2',t:'N4'},{f:'N2',t:'N5'},
    {f:'N4',t:'N5',gate:true},{f:'N4',t:'N7',crit:true,gate:true},
    {f:'N5',t:'N7',crit:true},{f:'N6',t:'N7'},{f:'N3',t:'N8'},{f:'N7',t:'N8',crit:true},
  ]},
  CX: { nodes: [
    { id:'N1', t:'选址签约', c:'CX-DECO-01', col:0, row:1 },
    { id:'N2', t:'门店装修', c:'CX-DECO-02', col:1, row:1 },
    { id:'N3', t:'消防验收', c:'CX-DECO-03', col:2, row:0, gate:true },
    { id:'N4', t:'电力增容', c:'CX-DECO-04', col:2, row:1, gate:true },
    { id:'N5', t:'冷柜安装', c:'CX-EQUI-02', col:3, row:1 },
    { id:'N6', t:'货架陈列', c:'CX-GOOD-01', col:3, row:2 },
    { id:'N7', t:'生鲜入库', c:'CX-GOOD-02', col:4, row:1 },
    { id:'N8', t:'开业验收', c:'CX-OPEN-01', col:4, row:2 },
  ], edges: [
    {f:'N1',t:'N2'},{f:'N2',t:'N3'},{f:'N2',t:'N4'},{f:'N2',t:'N5'},
    {f:'N4',t:'N5',gate:true},{f:'N4',t:'N7',crit:true,gate:true},
    {f:'N5',t:'N7',crit:true},{f:'N6',t:'N7'},{f:'N3',t:'N8'},{f:'N7',t:'N8',crit:true},
  ]},
  GX: { nodes: [
    { id:'N1', t:'选址签约', c:'GX-DECO-01', col:0, row:1 },
    { id:'N2', t:'门店装修', c:'GX-DECO-02', col:1, row:1 },
    { id:'N3', t:'消防验收', c:'GX-DECO-03', col:2, row:0, gate:true },
    { id:'N4', t:'电力增容', c:'GX-DECO-04', col:2, row:1, gate:true },
    { id:'N5', t:'冷柜安装', c:'GX-EQUI-02', col:3, row:1 },
    { id:'N6', t:'货架陈列', c:'GX-GOOD-01', col:3, row:2 },
    { id:'N7', t:'生鲜入库', c:'GX-GOOD-02', col:4, row:1 },
    { id:'N8', t:'开业验收', c:'GX-OPEN-01', col:4, row:2 },
  ], edges: [
    {f:'N1',t:'N2'},{f:'N2',t:'N3',crit:true,gate:true},{f:'N2',t:'N4'},{f:'N2',t:'N5'},
    {f:'N4',t:'N5',gate:true},{f:'N4',t:'N7',crit:true,gate:true},
    {f:'N5',t:'N7',crit:true},{f:'N6',t:'N7'},{f:'N3',t:'N8'},{f:'N7',t:'N8',crit:true},
  ]},
};

module.exports = { runAdapters, GRAPH, SYSTEMS };

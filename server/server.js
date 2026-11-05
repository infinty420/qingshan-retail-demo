'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, '..', 'public');

db.load();
db.syncStores(); // 首次启动即做一次三系统只读同步，保证有数据

// ---- 会话（演示用，真实环境替换为云 Auth / 企业身份）----
const sessions = new Map();
function newToken() { return crypto.randomBytes(16).toString('hex'); }

// ---- SSE 客户端 ----
const clients = new Set();
function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => { try { res.write(payload); } catch (e) {} });
}
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

// ---- 工具 ----
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function staticHandler(req, res) {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const fp = path.join(PUBLIC, path.normalize(url));
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- 路由 ----
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // SSE
  if (url === '/api/events' && req.method === 'GET') return sseHandler(req, res);

  // API
  if (url.startsWith('/api/')) {
    // 登录
    if (url === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const token = newToken();
      sessions.set(token, { user: body.user || '店长', role: body.role || '店长', token });
      return sendJSON(res, 200, { token, user: body.user || '店长', role: body.role || '店长' });
    }
    // 当前用户
    if (url === '/api/me' && req.method === 'GET') {
      const token = (req.url.split('token=')[1] || '').split('&')[0];
      const s = sessions.get(token);
      return sendJSON(res, 200, s ? { user: s.user, role: s.role } : null);
    }
    // 三系统只读同步（选项2：接真实数据）
    if (url === '/api/sync' && req.method === 'POST') {
      const summary = db.syncStores();
      db.pushAudit({ storeId: '*', type: 'sync', actor: '系统', action: '三系统只读同步', detail: `项目管理表/设备台账/供应商平台 已对齐，统一业务编号主键` });
      broadcast('sync', { summary, stores: db.storeList() });
      return sendJSON(res, 200, { ok: true, summary });
    }
    // 门店列表
    if (url === '/api/stores' && req.method === 'GET') {
      return sendJSON(res, 200, db.storeList());
    }
    // 单店
    let m = url.match(/^\/api\/store\/([A-Z]{2})$/);
    if (m && req.method === 'GET') {
      const s = db.getStore(m[1]);
      return s ? sendJSON(res, 200, s) : sendJSON(res, 404, { error: 'store not found' });
    }
    // 审计留痕
    m = url.match(/^\/api\/store\/([A-Z]{2})\/audit$/);
    if (m && req.method === 'GET') {
      return sendJSON(res, 200, db.getAudit(m[1]));
    }
    // 业务动作
    if (url === '/api/action' && req.method === 'POST') {
      const body = await readBody(req);
      const token = body.token;
      const me = sessions.get(token) || { user: '匿名', role: '店长' };
      const storeId = body.storeId;
      if (body.type === 'simulate') {
        const r = db.simulateAccident(storeId);
        broadcast('alert', { storeId, text: `安全闸门拦截：电力增容未验收 → 生鲜入库被拦截（${db.STORE_META[storeId].name}）` });
        broadcast('sync', { stores: db.storeList(), store: db.getStore(storeId) });
        return sendJSON(res, 200, { ok: true, r });
      }
      if (body.type === 'signoff') {
        const s = db.getStore(storeId);
        const t = s.tasks.find(x => x.code === body.code);
        if (t) {
          const today = new Date().toISOString().slice(0, 10);
          t.ac = today; t.status = 'done'; t.prog = 100;
          db.pushAudit({ storeId, type: 'signoff', actor: me.user, role: me.role, action: '人工签核(闸门)', detail: `${t.name} [${t.code}] 由 ${me.user}(${me.role}) 签核，来源=${t.srcSystem}/${t.srcId}` });
          db.recheckFresh(storeId);
          db.save();
          broadcast('sync', { stores: db.storeList(), store: db.getStore(storeId) });
          return sendJSON(res, 200, { ok: true, task: t });
        }
        return sendJSON(res, 404, { error: 'task not found' });
      }
      if (body.type === 'ack') {
        db.pushAudit({ storeId, type: 'ack', actor: me.user, role: me.role, action: '确认预警', detail: body.detail || '' });
        broadcast('audit', { entry: db.getAudit(storeId)[0] });
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 400, { error: 'unknown action' });
    }
    return sendJSON(res, 404, { error: 'api not found' });
  }

  // 静态资源
  return staticHandler(req, res);
});

server.listen(PORT, () => {
  console.log(`[青杉开店筹备平台] 后端已启动: http://localhost:${PORT}`);
  console.log(`  模块: 三系统只读适配器 / SSE实时推送 / 审计留痕 / 演示鉴权`);
});

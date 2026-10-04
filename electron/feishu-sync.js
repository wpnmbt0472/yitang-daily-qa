'use strict';
/**
 * feishu-sync.js —— 与飞书双向同步（需求第 1 条：每日问答与飞书同步）
 *
 * 通道：飞书开放平台自建应用 → 多维表格（Bitable）OpenAPI
 *   POST /open-apis/auth/v3/tenant_access_token/internal     获取 tenant_access_token
 *   POST /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records   写入一行
 *   GET  /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records   读回校验
 *
 * 依赖飞书多维表格中存在以下**同名列**（类型见括号），字段名可通过 cfg.fields 覆盖：
 *   日期（日期）· 答题数（数字）· 正确数（数字）· 正确率（数字，小数）· 时长分钟（数字）· 连续打卡（数字）
 *
 * 未配置 appId/appSecret 时不会抛错，只返回 {ok:false, reason:'未配置'}，
 * 因此首次运行即使没配飞书，App 也能正常用。
 */

const BASE = 'https://open.feishu.cn/open-apis';
const TIMEOUT_MS = 15000;

const DEFAULT_FIELDS = {
  date: '日期',
  answered: '答题数',
  correct: '正确数',
  accuracy: '正确率',
  minutes: '时长分钟',
  streak: '连续打卡'
};

function hasCredentials(cfg) {
  const f = (cfg && cfg.feishu) || {};
  return Boolean(f.enabled && f.appId && f.appSecret && f.appToken && f.tableId);
}

async function req(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({ signal: ctl.signal }, init));
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* 保留原文 */ }
    return { httpStatus: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getTenantToken(cfg) {
  const r = await req(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: cfg.feishu.appId, app_secret: cfg.feishu.appSecret })
  });
  const j = r.json || {};
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败：code=${j.code} msg=${j.msg || r.text.slice(0, 200)}`);
  }
  return j.tenant_access_token;
}

/** 把本地一天的记录转成飞书多维表格的一行 */
function toRecordFields(day, dateKeyStr, streak, cfg) {
  const f = Object.assign({}, DEFAULT_FIELDS, (cfg && cfg.feishu && cfg.feishu.fields) || {});
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const accuracy = day.answered > 0 ? Number((day.correct / day.answered).toFixed(4)) : 0;
  const fields = {};
  fields[f.date] = Date.UTC(y, m - 1, d);   // 飞书日期字段：毫秒时间戳
  fields[f.answered] = day.answered;
  fields[f.correct] = day.correct;
  fields[f.accuracy] = accuracy;
  fields[f.minutes] = day.minutes;
  fields[f.streak] = streak;
  return fields;
}

/**
 * 找出该日期已存在的记录 id（找不到就返回 null）
 *
 * 为什么要这步：飞书多维表格的写入接口只有「新增」，没有「按条件覆盖」。
 * 如果同一天点两次同步，就会写进两行重复记录。
 * 所以先按「日期」列在本地比对一遍已有记录，能对上就改成更新那一条。
 *
 * 注意：日期字段读回来可能是毫秒时间戳、ISO 字符串、或 {value:...} 包装，
 * 这里全部兼容；比对用「同一天」容差，避免时区解释差异导致匹配失败。
 * 任何一步失败都返回 null —— 退化成原来的「新增」行为，不会更糟。
 */
async function findRecordIdByDate({ dateKeyStr, config, token }) {
  const f = Object.assign({}, DEFAULT_FIELDS, (config.feishu && config.feishu.fields) || {});
  const dateField = f.date;
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const ts = Date.UTC(y, m - 1, d);
  const appToken = encodeURIComponent(config.feishu.appToken);
  const tableId = encodeURIComponent(config.feishu.tableId);

  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = `${BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`
      + `?page_size=500${pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''}`;
    let r;
    try {
      r = await req(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    } catch (_) { return null; }

    const j = r.json || {};
    if (j.code !== 0) return null;
    const items = (j.data && j.data.items) || [];

    for (const it of items) {
      const v = it.fields && it.fields[dateField];
      if (v === undefined || v === null) continue;
      let n = null;
      if (typeof v === 'number') n = v;
      else if (typeof v === 'string') { const p = Date.parse(v); if (!Number.isNaN(p)) n = p; }
      else if (Array.isArray(v) && typeof v[0] === 'number') n = v[0];
      else if (typeof v === 'object' && typeof v.value === 'number') n = v.value;
      if (n !== null && Math.abs(n - ts) < 86400000) return it.record_id;
    }

    if (!j.data || !j.data.has_more || !j.data.page_token) break;
    pageToken = j.data.page_token;
  }
  return null;
}

/**
 * 写入指定日期的一行：当天已有记录就更新，没有才新建。
 * 返回值里的 mode 标明这次是 'created' 还是 'updated'。
 */
async function pushDay({ dateKeyStr, day, streak, config }) {
  if (!hasCredentials(config)) {
    return { ok: false, reason: '未配置飞书应用凭据', detail: '请在 App 内「设置 → 飞书同步」填入 App ID / App Secret / app_token / table_id' };
  }
  try {
    const token = await getTenantToken(config);
    const fields = toRecordFields(day, dateKeyStr, streak, config);
    const base = `${BASE}/bitable/v1/apps/${encodeURIComponent(config.feishu.appToken)}/tables/${encodeURIComponent(config.feishu.tableId)}/records`;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` };

    // 先查当天是否已有记录
    const existingId = await findRecordIdByDate({ dateKeyStr, config, token });

    if (existingId) {
      const r = await req(`${base}/${encodeURIComponent(existingId)}`, {
        method: 'PUT', headers, body: JSON.stringify({ fields })
      });
      const j = r.json || {};
      if (j.code !== 0) {
        return { ok: false, reason: `更新失败 code=${j.code}`, detail: j.msg || r.text.slice(0, 300) };
      }
      return { ok: true, mode: 'updated', recordId: existingId, fields };
    }

    const r = await req(base, { method: 'POST', headers, body: JSON.stringify({ fields }) });
    const j = r.json || {};
    if (j.code !== 0) {
      return { ok: false, reason: `写入失败 code=${j.code}`, detail: j.msg || r.text.slice(0, 300) };
    }
    return { ok: true, mode: 'created', recordId: (j.data && j.data.record && j.data.record.record_id) || '', fields };
  } catch (e) {
    return { ok: false, reason: '网络或鉴权异常', detail: String(e.message || e) };
  }
}

/** 读回最近 N 行，用于「连接测试」 */
async function pullRecent({ config, limit = 5 }) {
  if (!hasCredentials(config)) {
    return { ok: false, reason: '未配置飞书应用凭据' };
  }
  try {
    const token = await getTenantToken(config);
    const url = `${BASE}/bitable/v1/apps/${encodeURIComponent(config.feishu.appToken)}/tables/${encodeURIComponent(config.feishu.tableId)}/records?page_size=${limit}`;
    const r = await req(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    const j = r.json || {};
    if (j.code !== 0) return { ok: false, reason: `读取失败 code=${j.code}`, detail: j.msg || r.text.slice(0, 300) };
    const items = (j.data && j.data.items) || [];
    return { ok: true, count: items.length, sample: items.slice(0, 2) };
  } catch (e) {
    return { ok: false, reason: '网络或鉴权异常', detail: String(e.message || e) };
  }
}

module.exports = { hasCredentials, pushDay, pullRecent, DEFAULT_FIELDS };

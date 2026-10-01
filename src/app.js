'use strict';
/**
 * app.js —— 渲染层
 * 纯 vanilla JS，无第三方依赖；所有数据来自 window.desktop（主进程 / 浏览器降级实现）。
 */

const api = window.desktop;
let SNAP = null;
let activeView = 'daily';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (key) => { const [y, m, d] = key.split('-'); return `${Number(m)}/${Number(d)}`; };
const fmtTime = (iso) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('is-hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('is-hidden'), ms);
}

/* ============================== 视图切换 ============================== */

const VIEW_META = {
  daily: { title: '今日问答', sub: '读完不一定记住，答对才算拿到' },
  stats: { title: '学习统计', sub: '过去 30 天的答题表现' },
  achv:  { title: '成就记录', sub: '把坚持变成看得见的进度' }
};

function switchView(name) {
  activeView = name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  ['daily', 'stats', 'achv'].forEach((v) => $('view-' + v).classList.toggle('is-hidden', v !== name));
  $('viewTitle').textContent = VIEW_META[name].title;
  $('viewSub').textContent = VIEW_META[name].sub;
  document.querySelector('.scroll').scrollTop = 0;

  const btn = $('btnPrimary');
  if (name === 'daily') { btn.classList.remove('is-hidden'); syncPrimaryButton(); }
  else if (name === 'stats') { btn.textContent = '导出数据'; btn.classList.remove('is-hidden'); }
  else { btn.textContent = '查看全部成就'; btn.classList.remove('is-hidden'); }
}

/* ============================== 视图 1 ============================== */

function renderDaily() {
  const s = SNAP.summary;
  $('todayAnswered').textContent = s.today.answered;
  $('todayTotal').textContent = s.today.total;
  $('mStreak').textContent = s.streak;
  $('mAcc').textContent = Math.round(s.last30.accuracy * 100);
  $('mMonth').textContent = s.monthActive;
  $('mCorrect').textContent = s.last30.correct;

  const left = s.today.total - s.today.answered;
  $('todayHint').textContent = s.today.answered === 0
    ? '今天还没开始，先答一题热热身'
    : (left === 0 ? '今天的题目已全部完成，明天见' : `还剩 ${left} 题，答完就打卡成功`);

  const answers = SNAP.state.answers || {};
  const list = $('questionList');
  list.innerHTML = SNAP.questions.map((q, i) => {
    const picked = answers[q.id];
    const done = picked !== undefined;
    const opts = q.options.map((text, idx) => {
      let cls = 'opt';
      if (done) {
        if (idx === q.answer) cls += ' is-right';
        else if (idx === picked) cls += ' is-wrong';
      }
      const key = String.fromCharCode(65 + idx);
      return `<button class="${cls}" data-qid="${q.id}" data-idx="${idx}" ${done ? 'disabled' : ''}>
        <span class="key">${key}</span><span>${text}</span></button>`;
    }).join('');
    return `<div class="q" id="q-${q.id}">
      <div class="q-top"><span class="q-tag">${q.tag}</span>
        <span class="q-no">第 ${i + 1} / ${SNAP.questions.length} 题</span></div>
      <div class="q-stem">${q.stem}</div>
      <div class="opts">${opts}</div>
      ${done ? `<div class="q-done">${picked === q.answer ? '✓ 回答正确' : '✗ 回答错误，正确答案已标出'}</div>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.opt:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => onAnswer(btn.dataset.qid, Number(btn.dataset.idx)));
  });

  $('qPager').innerHTML = SNAP.questions.map((q) => {
    const p = answers[q.id];
    const cls = p === undefined ? '' : (p === q.answer ? 'ok' : 'bad');
    return `<i class="${cls}"></i>`;
  }).join('');

  $('todayMeta').textContent = `共 ${SNAP.questions.length} 题 · 已答 ${s.today.answered} 题`;
  syncPrimaryButton();
}

function syncPrimaryButton() {
  const btn = $('btnPrimary');
  if (activeView !== 'daily') return;
  const left = SNAP.summary.today.total - SNAP.summary.today.answered;
  btn.textContent = left > 0 ? (SNAP.summary.today.answered ? `继续答题（剩 ${left}）` : '开始答题') : '今日已完成 ✓';
}

async function onAnswer(qid, idx) {
  const r = await api.submitAnswer(qid, idx);
  if (!r.ok) { toast(r.error || '提交失败'); return; }
  SNAP = r.snapshot;
  renderDaily();
  renderStats();
  renderAchievements();
  renderSyncChip();
  toast(r.correct ? '答对了 ✓' : '这题答错了，看看解析思路');
  if (SNAP.summary.today.answered === SNAP.summary.today.total) {
    setTimeout(() => toast('今日 5 题全部完成，打卡成功 🎉'), 1200);
  }
}

/* ============================== 视图 2 ============================== */

function lastNDays(n) {
  const out = [];
  const t = new Date();
  const base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(d.getDate() - i);
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }
  return out;
}

function renderBarChart(keys) {
  const W = 760, H = 220, padL = 6, padR = 6, top = 22, bottom = 34;
  const plotH = H - top - bottom;
  const maxV = Math.max(1, ...keys.map((k) => (SNAP.state.days[k] || {}).answered || 0));
  const step = (W - padL - padR) / keys.length;
  const barW = Math.max(6, step - 6);

  let svg = '';
  // 网格线
  for (let g = 0; g <= 3; g++) {
    const y = top + (plotH / 3) * g;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef0f3" stroke-width="1"/>`;
  }
  const todayKey = SNAP.state.todayKey;

  keys.forEach((k, i) => {
    const rec = SNAP.state.days[k] || { answered: 0, correct: 0 };
    const x = padL + i * step + 3;
    const h = rec.answered === 0 ? 3 : Math.max(6, (rec.answered / maxV) * plotH);
    const y = top + plotH - h;
    const isToday = k === todayKey;
    const color = isToday ? '#ff6a2b' : (rec.answered === 0 ? '#e6e9ee' : '#ffb082');
    const label = `${fmtDate(k)} 周${WEEK[new Date(k + 'T00:00:00').getDay()]}｜答 ${rec.answered} 题，对 ${rec.correct} 题`;
    svg += `<g><title>${label}</title>
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${color}"/>
      <rect x="${x}" y="${top}" width="${barW}" height="${plotH}" fill="transparent"/></g>`;
  });

  // 横轴标签：只标首、中、末
  const ticks = [0, Math.floor(keys.length / 2), keys.length - 1];
  ticks.forEach((i) => {
    const x = padL + i * step + 3 + barW / 2;
    svg += `<text x="${x}" y="${H - 12}" font-size="11" fill="#9aa1ac" text-anchor="middle">${fmtDate(keys[i])}</text>`;
  });
  $('barChart').setAttribute('preserveAspectRatio', 'none');
  $('barChart').innerHTML = svg;
  $('barRange').textContent = `${fmtDate(keys[0])} ~ ${fmtDate(keys[keys.length - 1])}`;
}

function renderLineChart(keys) {
  // 按「周一」分桶，统计每周平均正确率
  const buckets = [];
  keys.forEach((k) => {
    const d = new Date(k + 'T00:00:00');
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const wk = `${mon.getFullYear()}-${pad2(mon.getMonth() + 1)}-${pad2(mon.getDate())}`;
    let b = buckets.find((x) => x.wk === wk);
    if (!b) { b = { wk, a: 0, c: 0 }; buckets.push(b); }
    const r = SNAP.state.days[k] || { answered: 0, correct: 0 };
    b.a += r.answered; b.c += r.correct;
  });

  const W = 420, H = 200, padL = 30, padR = 16, top = 18, bottom = 30;
  const plotW = W - padL - padR, plotH = H - top - bottom;
  const pts = buckets.map((b, i) => {
    const v = b.a > 0 ? b.c / b.a : 0;
    const x = buckets.length === 1 ? padL + plotW / 2 : padL + (plotW / (buckets.length - 1)) * i;
    const y = top + plotH - v * plotH;
    return { x, y, v, b };
  });

  let svg = '';
  [0, 0.5, 1].forEach((p) => {
    const y = top + plotH - p * plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef0f3"/>
      <text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#9aa1ac" text-anchor="end">${Math.round(p * 100)}%</text>`;
  });
  if (pts.length) {
    svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"
      fill="none" stroke="#ff6a2b" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += `<path d="M${pts[0].x},${top + plotH} ${pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${pts[pts.length - 1].x},${top + plotH} Z" fill="#ff6a2b" opacity="0.08"/>`;
    pts.forEach((p) => {
      svg += `<g><title>${fmtDate(p.b.wk)} 那周｜正确率 ${Math.round(p.v * 100)}%</title>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#fff" stroke="#ff6a2b" stroke-width="2"/></g>`;
    });
  }
  $('lineChart').setAttribute('preserveAspectRatio', 'none');
  $('lineChart').innerHTML = svg;
}

function renderHeatmap(keys) {
  const startDow = new Date(keys[0] + 'T00:00:00').getDay();
  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="heat-cell" style="background:transparent"></div>';
  keys.forEach((k) => {
    const r = SNAP.state.days[k] || { answered: 0 };
    const lvl = r.answered === 0 ? 0 : (r.answered <= 2 ? 1 : r.answered === 3 ? 2 : r.answered === 4 ? 3 : 4);
    html += `<div class="heat-cell h${lvl}" title="${fmtDate(k)} 周${WEEK[new Date(k + 'T00:00:00').getDay()]}｜${r.answered} 题"></div>`;
  });
  $('heatmap').innerHTML = html;
}

function renderStats() {
  const s = SNAP.summary;
  $('kTotal').innerHTML = `${s.last30.answered}<i>题</i>`;
  $('kAcc').innerHTML = `${Math.round(s.last30.accuracy * 100)}<i>%</i>`;
  $('kMin').innerHTML = `${s.last30.minutes}<i>分钟</i>`;
  $('kDays').innerHTML = `${s.last30.activeDays}<i>天</i>`;
  const keys = lastNDays(30);
  renderBarChart(keys);
  renderHeatmap(keys);
  renderLineChart(keys);
}

/* ============================== 视图 3 ============================== */

function renderAchievements() {
  const list = SNAP.achievements;
  const unlocked = list.filter((a) => a.unlocked);
  $('achvTitle').textContent = '成就进度';
  $('achvSub').textContent = `已解锁 ${unlocked.length} / ${list.length}`;
  $('achvBar').style.width = `${Math.round((unlocked.length / list.length) * 100)}%`;

  $('achvGrid').innerHTML = list.map((a) => {
    const cur = Math.min(a.value, a.target);
    const when = a.unlocked && a.unlockedAt ? ` · ${new Date(a.unlockedAt).toLocaleDateString('zh-CN')} 达成` : '';
    return `<div class="achv ${a.unlocked ? 'is-unlocked' : 'is-locked'}">
      <div class="achv-top">
        <div class="achv-ico">${a.icon}</div>
        <div style="min-width:0">
          <div class="achv-name">${a.name}</div>
          <div class="achv-desc">${a.desc}${when}</div>
        </div>
        ${a.unlocked ? '<span class="achv-badge" style="margin-left:auto">已达成</span>' : ''}
      </div>
      <div class="achv-track"><div class="achv-fill" style="width:${Math.round(a.progress * 100)}%"></div></div>
      <div class="achv-foot"><span>${cur} / ${a.target} ${a.unit}</span><span>${Math.round(a.progress * 100)}%</span></div>
    </div>`;
  }).join('');
}

/* ============================== 同步状态 ============================== */

function renderSyncChip() {
  const f = SNAP.config.feishu;
  const chip = $('syncChip');
  const txt = $('syncChipText');
  const last = SNAP.syncLog && SNAP.syncLog.length ? SNAP.syncLog[SNAP.syncLog.length - 1] : null;
  chip.classList.remove('is-on', 'is-err');

  const configured = f.enabled && f.appId && f.appToken && f.tableId;
  if (!configured) { txt.textContent = '飞书未配置'; return; }
  if (last && last.ok) { chip.classList.add('is-on'); txt.textContent = `飞书已同步 ${fmtTime(last.ts)}`; return; }
  if (last && !last.ok) { chip.classList.add('is-err'); txt.textContent = '上次同步失败'; return; }
  txt.textContent = '飞书待同步';
}

/* ============================== 设置弹窗 ============================== */

function openSettings() {
  const f = SNAP.config.feishu;
  $('fsEnabled').checked = !!f.enabled;
  $('fsAppId').value = f.appId || '';
  $('fsAppSecret').value = '';
  $('fsAppSecret').placeholder = f.hasSecret ? '已保存（留空表示不修改）' : '请输入 App Secret';
  $('fsAppToken').value = f.appToken || '';
  $('fsTableId').value = f.tableId || '';
  $('dataPath').textContent = '数据目录：' + SNAP.env.statePath;
  $('envLine').textContent =
    `运行环境：${SNAP.env.platform} · Electron ${SNAP.env.versions.electron} · Node ${SNAP.env.versions.node} · 打包版：${SNAP.env.packaged ? '是' : '否（开发模式）'}`;
  $('settingsModal').classList.remove('is-hidden');
}

function collectSettings() {
  const secret = $('fsAppSecret').value.trim();
  return {
    enabled: $('fsEnabled').checked,
    appId: $('fsAppId').value.trim(),
    appSecret: secret || '__KEEP__',
    appToken: $('fsAppToken').value.trim(),
    tableId: $('fsTableId').value.trim()
  };
}

/* ============================== 事件绑定 ============================== */

function bind() {
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  $('btnPrimary').addEventListener('click', () => {
    if (activeView === 'stats') { exportData(); return; }
    if (activeView === 'achv') { toast(`已解锁 ${SNAP.achievements.filter((a) => a.unlocked).length} / ${SNAP.achievements.length} 项成就`); return; }
    const first = SNAP.questions.find((q) => (SNAP.state.answers || {})[q.id] === undefined);
    if (first) $('q-' + first.id).scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast('今日题目已全部完成 ✓');
  });

  $('btnSync').addEventListener('click', async () => {
    const btn = $('btnSync');
    btn.disabled = true; btn.textContent = '同步中…';
    const r = await api.syncFeishu();
    btn.disabled = false; btn.textContent = '同步飞书';
    SNAP = r.snapshot;
    renderSyncChip();
    if (r.result.ok) toast('已写入飞书多维表格');
    else toast(`同步未完成：${r.result.reason}`, 3200);
  });

  $('btnSettings').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', () => $('settingsModal').classList.add('is-hidden'));
  $('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.add('is-hidden'); });

  $('btnSaveFeishu').addEventListener('click', async () => {
    const r = await api.saveConfig(collectSettings());
    SNAP = r.snapshot;
    renderSyncChip();
    $('fsAppSecret').value = '';
    $('fsAppSecret').placeholder = SNAP.config.feishu.hasSecret ? '已保存（留空表示不修改）' : '请输入 App Secret';
    toast('设置已保存');
  });

  $('btnTestFeishu').addEventListener('click', async () => {
    await api.saveConfig(collectSettings());
    SNAP = (await api.bootstrap());
    $('btnTestFeishu').disabled = true;
    $('btnTestFeishu').textContent = '测试中…';
    const r = await api.testFeishu();
    $('btnTestFeishu').disabled = false;
    $('btnTestFeishu').textContent = '测试连接';
    toast(r.ok ? `连接成功，已读到 ${r.count} 条记录` : `连接失败：${r.reason}${r.detail ? ' · ' + r.detail : ''}`, 4200);
    renderSyncChip();
  });

  $('btnOpenDir').addEventListener('click', () => api.openDataDir());
  $('btnReset').addEventListener('click', async () => {
    const yes = await api.confirm('重新生成数据', '将丢弃当前所有答题记录，重新编造过去 30 天的历史数据。确定继续？');
    if (!yes) return;
    const r = await api.resetState();
    SNAP = r.snapshot;
    renderAll();
    toast('数据已重新生成');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('settingsModal').classList.add('is-hidden');
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  });
}

function exportData() {
  const rows = ['日期,答题数,正确数,正确率,时长分钟'];
  Object.keys(SNAP.state.days).sort().forEach((k) => {
    const r = SNAP.state.days[k];
    rows.push([k, r.answered, r.correct, r.answered ? (r.correct / r.answered).toFixed(4) : 0, r.minutes].join(','));
  });
  const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `学习数据_${SNAP.state.todayKey}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出 CSV');
}

/* ============================== 启动 ============================== */

function renderAll() {
  renderDaily();
  renderStats();
  renderAchievements();
  renderSyncChip();
}

(async function boot() {
  SNAP = await api.bootstrap();
  // macOS 上标题栏是 hiddenInset（红绿灯悬浮），需要额外留白与拖拽区
  if (SNAP.env.platform === 'darwin' || /Mac/.test(navigator.platform || '')) {
    document.body.classList.add('is-mac');
  }
  bind();
  switchView('daily');
  renderAll();
})();

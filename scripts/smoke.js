'use strict';
/**
 * smoke.js —— 端到端冒烟测试（Windows / macOS / Linux 都能跑）
 *
 * 做法：直接加载**真实的** electron/main.js（含全部 IPC 处理器与窗口创建），
 *      然后重新加载页面并捕获所有 JS 错误、资源加载失败、渲染进程崩溃，
 *      最后模拟「答一题」和「三个视图来回切」，验证整条链路。
 *
 * 用法：npm run smoke
 * 退出码：0 = 全绿；1 = 发现问题
 */

process.env.YDQ_SMOKE = '1';

const path = require('path');
const { app, BrowserWindow } = require('electron');

// 无头环境（CI / 沙箱）里没有可用的 GPU，必须先关掉硬件加速再初始化。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// 隔离测试数据：用临时目录做 userData，既避免与真实数据互相污染，
// 也避免与本机其它 Electron 应用（如宿主 IDE）抢 Chromium 的 GPU 缓存目录。
// 每次运行前清空，保证从「今天 0 题」的干净状态开始。
const smokeDir = path.join(app.getPath('temp'), 'yitang-daily-qa-smoke');
try { require('fs').rmSync(smokeDir, { recursive: true, force: true }); } catch (_) { /* 首次不存在 */ }
app.setPath('userData', smokeDir);

// 加载真实主进程（它会在 app.whenReady 里注册 IPC 并创建窗口）
require(path.join(__dirname, '..', 'electron', 'main.js'));

const problems = [];
const log = (s) => console.log(s);

function attach(w) {
  w.webContents.on('console-message', (...args) => {
    const e = args[0];
    const isObj = e && typeof e === 'object' && 'message' in e;
    const level = isObj ? e.level : args[1];
    const message = isObj ? e.message : args[2];
    const src = isObj ? `${e.sourceId}:${e.lineNumber}` : `${args[4]}:${args[3]}`;
    const line = `[console:${level}] ${message}  (${src})`;
    log(line);
    if (String(level) === 'error' || level === 3) problems.push(line);
  });
  w.webContents.on('preload-error', (_e, p, err) => {
    const line = `[preload-error] ${p}: ${err && err.message}`;
    log(line); problems.push(line);
  });
  w.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    const line = `[did-fail-load] ${code} ${desc} ${url} main=${isMainFrame}`;
    log(line); if (isMainFrame) problems.push(line);
  });
  w.webContents.on('render-process-gone', (_e, d) => {
    const line = `[render-process-gone] ${JSON.stringify(d)}`;
    log(line); problems.push(line);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {};
const evalJs = async (w, code, key) => {
  try {
    const v = await w.webContents.executeJavaScript(code, true);
    report[key] = v;
    return v;
  } catch (e) {
    const msg = 'JS-ERROR: ' + (e && e.message ? e.message : String(e));
    report[key] = msg;
    problems.push(`[${key}] ${msg}`);
    return msg;
  }
};

app.whenReady().then(async () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (!w) { log('未拿到窗口，主进程可能初始化失败'); app.exit(1); return; }

  attach(w);                     // 先挂监听
  await w.webContents.reload();  // 再重载，确保捕获首屏错误
  await sleep(2500);

  await evalJs(w, `!!(window.desktop && window.desktop.bootstrap)`, 'ipcBridge');

  await evalJs(w, `(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      todayTotal: document.getElementById('todayTotal')?.textContent,
      todayAnswered: document.getElementById('todayAnswered')?.textContent,
      streak: document.getElementById('mStreak')?.textContent,
      acc: document.getElementById('mAcc')?.textContent,
      questions: q('.q'), options: q('.opt'), pagerDots: q('#qPager i'),
      heatCells: q('.heat-cell'), bars: q('#barChart rect'), lineDots: q('#lineChart circle'),
      achievements: q('.achv'), unlocked: q('.achv.is-unlocked'),
      syncChip: document.getElementById('syncChipText')?.textContent,
      title: document.getElementById('viewTitle')?.textContent
    };
  })()`, 'firstPaint');

  await evalJs(w, `(async () => {
    const before = document.getElementById('todayAnswered').textContent;
    const btn = document.querySelector('.opt:not(:disabled)');
    if (!btn) return { error: 'NO_BUTTON' };
    btn.click();
    await new Promise(r => setTimeout(r, 1200));
    return {
      before,
      after: document.getElementById('todayAnswered').textContent,
      marked: document.querySelectorAll('.opt.is-right, .opt.is-wrong').length,
      doneRows: document.querySelectorAll('.q-done').length,
      lockedOpts: document.querySelectorAll('.opt:disabled').length
    };
  })()`, 'answerFlow');

  await evalJs(w, `(async () => {
    const out = {};
    for (const v of ['stats', 'achv', 'daily']) {
      document.querySelector('.nav-item[data-view="' + v + '"]').click();
      await new Promise(r => setTimeout(r, 300));
      out[v] = document.getElementById('view-' + v).classList.contains('is-hidden') ? 'HIDDEN(异常)' : 'OK';
    }
    return out;
  })()`, 'viewSwitch');

  await evalJs(w, `(async () => {
    document.getElementById('btnSettings').click();
    await new Promise(r => setTimeout(r, 300));
    const opened = !document.getElementById('settingsModal').classList.contains('is-hidden');
    const pathText = document.getElementById('dataPath').textContent;
    document.getElementById('btnCloseSettings').click();
    return { opened, pathText };
  })()`, 'settingsModal');

  report.problems = problems;
  report.verdict = problems.length ? `FAILED (${problems.length})` : 'PASSED';

  const outFile = path.join(__dirname, '..', 'smoke-report.json');
  require('fs').writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  log('SMOKE_REPORT ' + JSON.stringify(report));
  log(problems.length ? `发现 ${problems.length} 个问题` : '✓ 未发现 JS 错误 / 加载失败 / 渲染进程崩溃');
  log('报告已写入 ' + outFile);

  setTimeout(() => app.exit(problems.length ? 1 : 0), 300);
});

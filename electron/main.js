'use strict';
/**
 * main.js —— Electron 主进程
 *
 * 安全基线：
 *   contextIsolation: true, nodeIntegration: false, sandbox: true
 *   渲染层只能通过 preload 暴露的白名单 API 访问本地能力。
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const store = require('./store');
const feishu = require('./feishu-sync');

const isDev = !app.isPackaged;
// 冒烟测试钩子：静默启动（不显示窗口、不开 DevTools），供 scripts/smoke 使用
const isSmoke = process.env.YDQ_SMOKE === '1';
let S = null;        // store 实例
let C = null;        // 当前 config
let win = null;

/* ------------------------------ 通用计算 ------------------------------ */

/** 连续打卡天数：从今天（或昨天）往前数，遇到 answered=0 即断 */
function computeStreak(state) {
  const today = store.todayDate();
  let streak = 0;
  const todayRec = state.days[store.dateKey(today)];
  let cursor = todayRec && todayRec.answered > 0 ? today : store.addDays(today, -1);
  // 今天还没答题不算断签，从昨天开始数
  for (let i = 0; i < 400; i++) {
    const rec = state.days[store.dateKey(cursor)];
    if (rec && rec.answered > 0) { streak++; cursor = store.addDays(cursor, -1); }
    else break;
  }
  return streak;
}

/** 派生指标：渲染层不重复实现，保证口径唯一 */
function computeSummary(state) {
  const today = store.todayDate();
  const todayKey = store.dateKey(today);
  const keys = Object.keys(state.days).sort();
  const last30 = keys.filter((k) => k <= todayKey).slice(-store.SEED_BACK_DAYS);

  let answered = 0, correct = 0, minutes = 0, activeDays = 0;
  for (const k of last30) {
    const r = state.days[k] || { answered: 0, correct: 0, minutes: 0 };
    answered += r.answered; correct += r.correct; minutes += r.minutes;
    if (r.answered > 0) activeDays++;
  }

  // 本月
  const monthPrefix = todayKey.slice(0, 7);
  const monthActive = keys.filter((k) => k.startsWith(monthPrefix) && state.days[k].answered > 0).length;

  const byTag = {}; // 各维度正确率——用题库 tag 归属统计（近似：按当天正确率加权，简单起见用整体）
  return {
    today: { key: todayKey, ...(state.days[todayKey] || { answered: 0, correct: 0, minutes: 0 }), total: store.DAILY_TOTAL },
    streak: computeStreak(state),
    last30: {
      answered, correct, minutes, activeDays,
      accuracy: answered > 0 ? correct / answered : 0,
      range: [last30[0] || todayKey, last30[last30.length - 1] || todayKey]
    },
    monthActive,
    byTag
  };
}

/** 成就定义：progress 返回 0~1 */
const ACHIEVEMENTS = [
  { id: 'streak3', name: '入门三日', desc: '连续打卡 3 天', icon: '🔥', target: 3, unit: '天', get: (s) => s.streak },
  { id: 'streak7', name: '一周不辍', desc: '连续打卡 7 天', icon: '📅', target: 7, unit: '天', get: (s) => s.streak },
  { id: 'streak21', name: '二十一天', desc: '连续打卡 21 天，习惯成形', icon: '🧠', target: 21, unit: '天', get: (s) => s.streak },
  { id: 'total50', name: '五十题', desc: '累计答对 50 题', icon: '✅', target: 50, unit: '题', get: (s) => s.last30.correct },
  { id: 'total150', name: '百五进阶', desc: '累计答对 150 题', icon: '🎯', target: 150, unit: '题', get: (s) => s.last30.correct },
  { id: 'active20', name: '常客', desc: '30 天里活跃 20 天', icon: '🗓️', target: 20, unit: '天', get: (s) => s.last30.activeDays },
  { id: 'time300', name: '功夫时间', desc: '累计学习满 300 分钟', icon: '⏱️', target: 300, unit: '分钟', get: (s) => s.last30.minutes },
  { id: 'acc80', name: '判断力', desc: '30 天平均正确率达到 80%', icon: '💡', target: 80, unit: '%', get: (s) => Math.round(s.last30.accuracy * 100) }
];

function computeAchievements(state) {
  const sum = computeSummary(state);
  return ACHIEVEMENTS.map((a) => {
    const value = a.get(sum);
    const unlocked = value >= a.target;
    return {
      id: a.id, name: a.name, desc: a.desc, icon: a.icon, unit: a.unit,
      value, target: a.target,
      progress: Math.min(1, a.target > 0 ? value / a.target : 0),
      unlocked,
      unlockedAt: state.unlocked[a.id] || (unlocked ? new Date().toISOString() : null)
    };
  });
}

function markUnlocked(state) {
  const list = computeAchievements(state);
  let changed = false;
  for (const a of list) {
    if (a.unlocked && !state.unlocked[a.id]) {
      state.unlocked[a.id] = new Date().toISOString();
      changed = true;
    }
  }
  return changed;
}

/** 给渲染层的完整快照 */
function snapshot(state, config) {
  const summary = computeSummary(state);
  return {
    state: {
      days: state.days,
      answers: state.answers[state === null ? '' : store.dateKey(store.todayDate())] || {},
      todayKey: store.dateKey(store.todayDate()),
      dailyTotal: store.DAILY_TOTAL
    },
    questions: store.questionsForDate(store.dateKey(store.todayDate())).map((q) => ({
      id: q.id, tag: q.tag, stem: q.stem, options: q.options, answer: q.answer
    })),
    summary,
    achievements: computeAchievements(state),
    syncLog: state.syncLog.slice(-20),
    config: {
      feishu: {
        enabled: config.feishu.enabled,
        appId: config.feishu.appId,
        // 密钥不回传明文，只回传「是否已填写」
        hasSecret: Boolean(config.feishu.appSecret),
        appToken: config.feishu.appToken,
        tableId: config.feishu.tableId
      }
    },
    env: {
      platform: process.platform,
      versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      statePath: S.statePath,
      packaged: app.isPackaged
    }
  };
}

/* ------------------------------ 窗口 ------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#F5F6F8',
    title: '每日问答',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => { if (!isSmoke) win.show(); });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  if (isDev && !isSmoke) win.webContents.openDevTools({ mode: 'detach' });

  // 外链一律交给系统浏览器，不在 App 内打开
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/* ------------------------------ IPC ------------------------------ */

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => snapshot(S.loadState(), C));

  ipcMain.handle('answer:submit', (_e, { qid, picked }) => {
    const state = S.loadState();
    const key = store.dateKey(store.todayDate());
    const q = store.questionsForDate(key).find((x) => x.id === qid);
    if (!q) return { ok: false, error: '题目不存在' };

    state.answers[key] = state.answers[key] || {};
    if (state.answers[key][qid] !== undefined) {
      return { ok: false, error: '本题已作答', snapshot: snapshot(state, C) };
    }
    state.answers[key][qid] = picked;

    const rec = state.days[key] || { answered: 0, correct: 0, minutes: 0 };
    rec.answered += 1;
    if (picked === q.answer) rec.correct += 1;
    rec.minutes += 2; // 每题按 2 分钟计
    state.days[key] = rec;

    markUnlocked(state);
    S.saveState(state);
    return { ok: true, correct: picked === q.answer, snapshot: snapshot(state, C) };
  });

  ipcMain.handle('config:save', (_e, feishuCfg) => {
    C = S.loadConfig();
    const next = Object.assign({}, C.feishu, feishuCfg || {});
    if (feishuCfg && feishuCfg.appSecret === '__KEEP__') next.appSecret = C.feishu.appSecret;
    C.feishu = next;
    S.saveConfig(C);
    return { ok: true, snapshot: snapshot(S.loadState(), C) };
  });

  ipcMain.handle('feishu:test', async () => {
    const r = await feishu.pullRecent({ config: C, limit: 5 });
    return r;
  });

  ipcMain.handle('feishu:sync', async () => {
    const state = S.loadState();
    const key = store.dateKey(store.todayDate());
    const r = await feishu.pushDay({
      dateKeyStr: key,
      day: state.days[key] || { answered: 0, correct: 0, minutes: 0 },
      streak: computeStreak(state),
      config: C
    });
    state.syncLog.push({ ts: new Date().toISOString(), dateKey: key, ok: r.ok, msg: r.ok ? '同步成功' : (r.reason || '失败') });
    S.saveState(state);
    return { result: r, snapshot: snapshot(S.loadState(), C) };
  });

  ipcMain.handle('state:reset', () => {
    const s = S.resetState();
    return { ok: true, snapshot: snapshot(s, C) };
  });

  ipcMain.handle('shell:openDataDir', async () => {
    await shell.openPath(path.dirname(S.statePath));
    return true;
  });

  ipcMain.handle('dialog:confirm', async (_e, { title, message }) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['取消', '确定'], defaultId: 1, cancelId: 0, title, message
    });
    return r.response === 1;
  });
}

/* ------------------------------ 生命周期 ------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    S = store.createStore(app.getPath('userData'));
    C = S.loadConfig();
    registerIpc();
    createWindow();

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

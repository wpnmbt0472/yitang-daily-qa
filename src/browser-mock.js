'use strict';
/**
 * browser-mock.js —— 浏览器预览用的降级实现
 *
 * 只有当页面**不在 Electron 里**运行时才会生效（Electron 会先由 preload 注入 window.desktop）。
 * 用途：改 UI 时直接双击 src/index.html 就能看效果，不必装 Electron、不必打包。
 * 数据落在 localStorage，逻辑与 electron/store.js 保持一致（口径相同：每天 5 题、回填 30 天）。
 */
(function () {
  if (window.desktop) return;

  const DAILY_TOTAL = 5;
  const BACK = 30;
  const LS_KEY = 'yitang-daily-qa.preview';

  const BANK = [
    { id: 'q01', tag: '认知', stem: '「双三角」模型里，第一个三角描述的是什么关系？', options: ['用户—需求—产品', '趋势—能力—资源', '目标—路径—节奏', '输入—加工—输出'], answer: 0 },
    { id: 'q02', tag: '认知', stem: '判断一个机会是否值得投入，最先要问的是？', options: ['需要多少人', '有没有人在为它付费', '竞品做没做', '技术难不难'], answer: 1 },
    { id: 'q03', tag: '认知', stem: '「饱和建模」的核心动作是？', options: ['先写结论再找论据', '把同类样本穷尽后再归纳规律', '只挑最容易验证的样本', '听专家口述经验'], answer: 1 },
    { id: 'q04', tag: '判断', stem: '客户说「再考虑考虑」，最有效的下一步是？', options: ['继续降价', '追问他在考虑的具体哪一条', '换一个对接人', '等他自己回来'], answer: 1 },
    { id: 'q05', tag: '判断', stem: '增长停滞时，优先排查的顺序应是？', options: ['渠道 → 转化 → 产品', '产品 → 渠道 → 转化', '团队 → 预算 → 渠道', '竞品 → 政策 → 预算'], answer: 1 },
    { id: 'q06', tag: '判断', stem: '「最小可行验证」的最低标准是？', options: ['做得好看', '能拿到真实反馈', '功能大而全', '拿到融资'], answer: 1 },
    { id: 'q07', tag: '经营', stem: '毛利为正但现金流为负，最可能的原因是？', options: ['定价太低', '应收账款回收慢', '员工太多', '税负太重'], answer: 1 },
    { id: 'q08', tag: '经营', stem: '衡量一个 ToB 客户质量，首先要看？', options: ['公司规模', '决策链长度与预算归属', '行业名气', '是否国企'], answer: 1 },
    { id: 'q09', tag: '经营', stem: '把「一次性项目」变成「可持续业务」的关键动作是？', options: ['加大投放', '沉淀可复用的标准交付单元', '扩充销售团队', '多接同类项目'], answer: 1 },
    { id: 'q10', tag: '组织', stem: '小团队里决策慢的真正原因通常是？', options: ['人不够', '责任边界不清', '会议太少', '工具不好'], answer: 1 },
    { id: 'q11', tag: '组织', stem: '「说了不听」最常见的隐性原因是？', options: ['员工能力差', '他没参与目标的制定', '工资太低', '性格不合'], answer: 1 },
    { id: 'q12', tag: '组织', stem: '招人时最该先想清楚的是？', options: ['给多少钱', '这个岗位必须产出什么结果', '从哪招', '什么学历'], answer: 1 },
    { id: 'q13', tag: '认知', stem: '「规律」与「结论」的区别在于？', options: ['规律更短', '规律可迁移，结论只对特定情境成立', '结论更可靠', '两者等价'], answer: 1 },
    { id: 'q14', tag: '认知', stem: '要推翻一个判断，最高效的方式是？', options: ['多找支持它的例子', '主动寻找反面样本', '请更多人投票', '搁置不管'], answer: 1 },
    { id: 'q15', tag: '判断', stem: '报价被压时，能守住价格的前提是？', options: ['态度强硬', '你能清晰量化对方获得的价值', '竞品更贵', '量大'], answer: 1 },
    { id: 'q16', tag: '判断', stem: '一个方案无法落地，先怀疑哪一环？', options: ['执行的人', '方案的隐含前提是否成立', '预算是否够', '时间是否紧'], answer: 1 },
    { id: 'q17', tag: '经营', stem: '客户复购率低，最该先看的数据是？', options: ['客单价', '首单到二单的间隔时间', '市场占有率', '员工人数'], answer: 1 },
    { id: 'q18', tag: '经营', stem: '「投入产出比」早期最容易被忽略的是？', options: ['显性成本', '机会成本与决策者的时间', '税费', '折旧'], answer: 1 },
    { id: 'q19', tag: '组织', stem: '复盘会上最有价值的环节是？', options: ['表扬做得好的人', '把「为什么没做成」追到可改的动作', '公布业绩排名', '确定 KPI'], answer: 1 },
    { id: 'q20', tag: '认知', stem: '长期进步最快的人通常具备哪个习惯？', options: ['每天看资讯', '把每次判断的对错记录下来回看', '多参加饭局', '换赛道'], answer: 1 }
  ];

  function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h >>> 0; }
  function mulberry32(a) { return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function dateKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

  /** 按当天种子确定性打乱选项（与 electron/store.js 口径一致） */
  function shuffleQuestion(q, rnd) {
    const idx = q.options.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    return { id: q.id, tag: q.tag, stem: q.stem, options: idx.map((i) => q.options[i]), answer: idx.indexOf(q.answer) };
  }

  function questionsForDate(key) {
    const rnd = mulberry32(fnv1a('q:' + key));
    const pool = BANK.slice(); const out = [];
    while (out.length < DAILY_TOTAL && pool.length) out.push(shuffleQuestion(pool.splice(Math.floor(rnd() * pool.length), 1)[0], rnd));
    return out;
  }

  function fabricate(key) {
    const dow = new Date(key + 'T00:00:00').getDay();
    const rnd = mulberry32(fnv1a('d:' + key));
    const weekend = dow === 0 || dow === 6;
    if (rnd() < (weekend ? 0.3 : 0.08)) return { answered: 0, correct: 0, minutes: 0 };
    const accuracy = Math.min(1, Math.max(0.4, (weekend ? 0.68 : 0.78) + (rnd() - 0.5) * 0.32));
    return { answered: DAILY_TOTAL, correct: Math.round(DAILY_TOTAL * accuracy), minutes: 6 + Math.round(rnd() * 16) };
  }

  function buildState() {
    const t = today(); const s = { days: {}, answers: {}, unlocked: {} };
    for (let i = BACK; i >= 1; i--) { const k = dateKey(addDays(t, -i)); s.days[k] = fabricate(k); }
    s.days[dateKey(t)] = { answered: 0, correct: 0, minutes: 0 };
    s.answers[dateKey(t)] = {};
    return s;
  }

  let state = (function () {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) { const p = JSON.parse(raw); if (p && p.days && p.days[dateKey(today())]) return p; } } catch (_) {}
    return buildState();
  })();
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {} }

  function streak() {
    const t = today(); let n = 0;
    let cur = (state.days[dateKey(t)] || {}).answered > 0 ? t : addDays(t, -1);
    for (let i = 0; i < 400; i++) { const r = state.days[dateKey(cur)]; if (r && r.answered > 0) { n++; cur = addDays(cur, -1); } else break; }
    return n;
  }

  function summary() {
    const tk = dateKey(today());
    const keys = Object.keys(state.days).sort().filter((k) => k <= tk).slice(-BACK);
    let a = 0, c = 0, m = 0, d = 0;
    keys.forEach((k) => { const r = state.days[k]; a += r.answered; c += r.correct; m += r.minutes; if (r.answered > 0) d++; });
    const mp = tk.slice(0, 7);
    return {
      today: Object.assign({ key: tk, total: DAILY_TOTAL }, state.days[tk]),
      streak: streak(),
      last30: { answered: a, correct: c, minutes: m, activeDays: d, accuracy: a ? c / a : 0, range: [keys[0], keys[keys.length - 1]] },
      monthActive: Object.keys(state.days).filter((k) => k.startsWith(mp) && state.days[k].answered > 0).length,
      byTag: {}
    };
  }

  const ACH = [
    { id: 'streak3', name: '入门三日', desc: '连续打卡 3 天', icon: '🔥', target: 3, unit: '天', get: (s) => s.streak },
    { id: 'streak7', name: '一周不辍', desc: '连续打卡 7 天', icon: '📅', target: 7, unit: '天', get: (s) => s.streak },
    { id: 'streak21', name: '二十一天', desc: '连续打卡 21 天，习惯成形', icon: '🧠', target: 21, unit: '天', get: (s) => s.streak },
    { id: 'total50', name: '五十题', desc: '累计答对 50 题', icon: '✅', target: 50, unit: '题', get: (s) => s.last30.correct },
    { id: 'total150', name: '百五进阶', desc: '累计答对 150 题', icon: '🎯', target: 150, unit: '题', get: (s) => s.last30.correct },
    { id: 'active20', name: '常客', desc: '30 天里活跃 20 天', icon: '🗓️', target: 20, unit: '天', get: (s) => s.last30.activeDays },
    { id: 'time300', name: '功夫时间', desc: '累计学习满 300 分钟', icon: '⏱️', target: 300, unit: '分钟', get: (s) => s.last30.minutes },
    { id: 'acc80', name: '判断力', desc: '30 天平均正确率达到 80%', icon: '💡', target: 80, unit: '%', get: (s) => Math.round(s.last30.accuracy * 100) }
  ];

  function achievements() {
    const s = summary();
    return ACH.map((a) => {
      const v = a.get(s); const unlocked = v >= a.target;
      return { id: a.id, name: a.name, desc: a.desc, icon: a.icon, unit: a.unit, value: v, target: a.target,
        progress: Math.min(1, v / a.target), unlocked, unlockedAt: unlocked ? new Date().toISOString() : null };
    });
  }

  function snapshot(config) {
    const tk = dateKey(today());
    return {
      state: { days: state.days, answers: state.answers[tk] || {}, todayKey: tk, dailyTotal: DAILY_TOTAL },
      questions: questionsForDate(tk),
      summary: summary(),
      achievements: achievements(),
      syncLog: [],
      config: config || { feishu: { enabled: false, appId: '', hasSecret: false, appToken: '', tableId: '' } },
      env: { platform: 'browser', versions: { electron: '—', node: '—', chrome: '—' }, statePath: 'localStorage://' + LS_KEY, packaged: false }
    };
  }

  let cfg = { feishu: { enabled: false, appId: '', appSecret: '', appToken: '', tableId: '' } };

  window.desktop = {
    bootstrap: async () => snapshot(cfg),
    submitAnswer: async (qid, picked) => {
      const tk = dateKey(today());
      const q = questionsForDate(tk).find((x) => x.id === qid);
      if (!q) return { ok: false, error: '题目不存在' };
      state.answers[tk] = state.answers[tk] || {};
      if (state.answers[tk][qid] !== undefined) return { ok: false, error: '本题已作答', snapshot: snapshot(cfg) };
      state.answers[tk][qid] = picked;
      const r = state.days[tk]; r.answered += 1; r.minutes += 2;
      if (picked === q.answer) r.correct += 1;
      persist();
      return { ok: true, correct: picked === q.answer, snapshot: snapshot(cfg) };
    },
    saveConfig: async (feishu) => {
      Object.assign(cfg.feishu, feishu || {});
      if (cfg.feishu.appSecret === '__KEEP__') cfg.feishu.appSecret = '';
      return { ok: true, snapshot: snapshot(cfg) };
    },
    testFeishu: async () => ({ ok: false, reason: '浏览器预览模式不支持联网同步', detail: '请在打包后的 App 内测试' }),
    syncFeishu: async () => ({ result: { ok: false, reason: '浏览器预览模式不支持联网同步' }, snapshot: snapshot(cfg) }),
    resetState: async () => { state = buildState(); persist(); return { ok: true, snapshot: snapshot(cfg) }; },
    openDataDir: async () => { alert('浏览器预览模式下数据存在 localStorage，无本地目录。'); return true; },
    confirm: async (title, message) => window.confirm(title + '\n\n' + message)
  };
})();

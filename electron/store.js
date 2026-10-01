'use strict';
/**
 * store.js —— 本地数据真相源
 *
 * 职责：
 *   1. 首次启动时「杜撰」过去 30 天的历史答题数据（需求第 3 条）
 *   2. 每次启动补齐「上次运行到今天」之间缺失的日期
 *   3. 提供读写 state.json / config.json 的能力
 *
 * 数据全部落在 Electron 的 userData 目录，不写注册表、不碰系统目录。
 */

const fs = require('fs');
const path = require('path');

const STATE_VERSION = 1;
const SEED_BACK_DAYS = 30;   // 首次启动回填的天数
const DAILY_TOTAL = 5;       // 每天出题数（对应「今日进度 n/5」）

/* ------------------------------------------------------------------ *
 * 题库：20 道，每天按日期确定性抽 5 道（同一天任何时候打开题目一致）
 * ------------------------------------------------------------------ */
const QUESTION_BANK = [
  { id: 'q01', tag: '认知', stem: '「双三角」模型里，第一个三角描述的是什么关系？', options: ['用户—需求—产品', '趋势—能力—资源', '目标—路径—节奏', '输入—加工—输出'], answer: 0 },
  { id: 'q02', tag: '认知', stem: '判断一个机会是否值得投入，最先要问的是？', options: ['需要多少人', '有没有人在为它付费', '竞品做没做', '技术难不难'], answer: 1 },
  { id: 'q03', tag: '认知', stem: '「饱和建模」的核心动作是？', options: ['先写结论再找论据', '把同类样本穷尽后再归纳规律', '只挑最容易验证的样本', '听专家口述经验'], answer: 1 },
  { id: 'q04', tag: '判断', stem: '一个客户说「再考虑考虑」，最有效的下一步是？', options: ['继续降价', '追问他在考虑的具体是哪一条', '换一个对接人', '等他自己回来'], answer: 1 },
  { id: 'q05', tag: '判断', stem: '增长停滞时，优先排查的顺序应是？', options: ['渠道 → 转化 → 产品', '产品 → 渠道 → 转化', '团队 → 预算 → 渠道', '竞品 → 政策 → 预算'], answer: 1 },
  { id: 'q06', tag: '判断', stem: '「最小可行验证」的最低标准是？', options: ['做得好看', '能拿到真实反馈', '功能大而全', '拿到融资'], answer: 1 },
  { id: 'q07', tag: '经营', stem: '毛利为正但现金流为负，最可能的原因是？', options: ['定价太低', '应收账款回收慢', '员工太多', '税负太重'], answer: 1 },
  { id: 'q08', tag: '经营', stem: '衡量一个 ToB 客户质量，首先要看？', options: ['公司规模', '决策链长度与预算归属', '行业名气', '是否是国企'], answer: 1 },
  { id: 'q09', tag: '经营', stem: '把「一次性项目」变成「可持续业务」的关键动作是？', options: ['加大投放', '沉淀可复用的标准交付单元', '扩充销售团队', '多接同类项目'], answer: 1 },
  { id: 'q10', tag: '组织', stem: '小团队里，决策慢通常的真正原因是？', options: ['人不够', '责任边界不清', '会议太少', '工具不好'], answer: 1 },
  { id: 'q11', tag: '组织', stem: '「说了不听」最常见的隐性原因是？', options: ['员工能力差', '他没参与目标的制定', '工资太低', '性格不合'], answer: 1 },
  { id: 'q12', tag: '组织', stem: '招人时最该先想清楚的是？', options: ['给多少钱', '这个岗位上必须产出什么结果', '从哪招', '什么学历'], answer: 1 },
  { id: 'q13', tag: '认知', stem: '「规律」与「结论」的区别在于？', options: ['规律更短', '规律可迁移，结论只对特定情境成立', '结论更可靠', '两者等价'], answer: 1 },
  { id: 'q14', tag: '认知', stem: '要推翻一个判断，最高效的方式是？', options: ['再多找几个支持它的例子', '主动寻找反面样本', '请更多人投票', '搁置不管'], answer: 1 },
  { id: 'q15', tag: '判断', stem: '报价被压时，能守住价格的前提是？', options: ['态度强硬', '你能清晰量化对方获得的价值', '竞品更贵', '量大'], answer: 1 },
  { id: 'q16', tag: '判断', stem: '一个方案无法落地，先怀疑哪一环？', options: ['执行的人', '方案的隐含前提是否成立', '预算是否够', '时间是否紧'], answer: 1 },
  { id: 'q17', tag: '经营', stem: '客户复购率低，最该先看的数据是？', options: ['客单价', '首单到二单的间隔时间', '市场占有率', '员工人数'], answer: 1 },
  { id: 'q18', tag: '经营', stem: '「投入产出比」在早期项目里最容易被忽略的是？', options: ['投入的显性成本', '机会成本与决策者的时间', '税费', '折旧'], answer: 1 },
  { id: 'q19', tag: '组织', stem: '复盘会上最有价值的环节是？', options: ['表扬做得好的人', '把「为什么没做成」追到可改的具体动作', '公布业绩排名', '确定下一步 KPI'], answer: 1 },
  { id: 'q20', tag: '认知', stem: '长期进步最快的人，通常具备哪个习惯？', options: ['每天看资讯', '把每次判断的对错都记录下来回看', '多参加饭局', '换赛道'], answer: 1 }
];

/* ------------------------------------------------------------------ *
 * 确定性随机：同一天永远生成同一份「历史数据」
 * ------------------------------------------------------------------ */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 日期工具（一律使用本地时区，避免 UTC 跨日出错）
 * ------------------------------------------------------------------ */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function todayDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 按当天种子确定性打乱选项，避免「正确答案永远在 B」被蒙对 */
function shuffleQuestion(q, rnd) {
  const idx = q.options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return {
    id: q.id,
    tag: q.tag,
    stem: q.stem,
    options: idx.map((i) => q.options[i]),
    answer: idx.indexOf(q.answer)
  };
}

/** 给定日期，确定性抽 5 道题（同一天任何时候打开，题目与选项顺序都一致） */
function questionsForDate(key) {
  const rnd = mulberry32(fnv1a('q:' + key));
  const pool = QUESTION_BANK.slice();
  const picked = [];
  while (picked.length < DAILY_TOTAL && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    picked.push(shuffleQuestion(pool.splice(i, 1)[0], rnd));
  }
  return picked;
}

/* ------------------------------------------------------------------ *
 * 历史数据编造：weekday 更活跃，周末偶尔断签
 * ------------------------------------------------------------------ */
function fabricateDay(key) {
  const dow = new Date(key + 'T00:00:00').getDay(); // 0=周日
  const rnd = mulberry32(fnv1a('d:' + key));
  const isWeekend = dow === 0 || dow === 6;

  // 约 12% 概率断签（周末提高到 30%）
  const restChance = isWeekend ? 0.3 : 0.08;
  const isRest = rnd() < restChance;
  if (isRest) return { answered: 0, correct: 0, minutes: 0 };

  const answered = DAILY_TOTAL;                       // 过去的日子按全部答完算
  const accBase = isWeekend ? 0.68 : 0.78;            // 周末状态略差
  const accuracy = Math.min(1, Math.max(0.4, accBase + (rnd() - 0.5) * 0.32));
  const correct = Math.round(answered * accuracy);
  const minutes = 6 + Math.round(rnd() * 16);         // 6 ~ 22 分钟
  return { answered, correct, minutes };
}

/* ------------------------------------------------------------------ *
 * state 的构造与补齐
 * ------------------------------------------------------------------ */
function buildInitialState() {
  const today = todayDate();
  const state = {
    version: STATE_VERSION,
    createdAt: new Date().toISOString(),
    seededThrough: null,   // 已编造到哪一天（含）
    days: {},              // 'YYYY-MM-DD' -> {answered, correct, minutes}
    answers: {},           // 'YYYY-MM-DD' -> { [qid]: optionIndex }
    unlocked: {},          // 成就 id -> ISO 时间
    syncLog: []            // 飞书同步记录（最多保留 50 条）
  };

  for (let i = SEED_BACK_DAYS; i >= 1; i--) {
    const key = dateKey(addDays(today, -i));
    state.days[key] = fabricateDay(key);
  }
  state.seededThrough = dateKey(addDays(today, -1));
  state.days[dateKey(today)] = { answered: 0, correct: 0, minutes: 0 };
  state.answers[dateKey(today)] = {};
  return state;
}

/** 若 App 隔了几天才打开，把中间空缺的日期补上 */
function ensureUpToToday(state) {
  const today = todayDate();
  const todayKey = dateKey(today);
  let cursor = state.seededThrough ? new Date(state.seededThrough + 'T00:00:00') : addDays(today, -1);
  let changed = false;

  while (dateKey(cursor) < todayKey) {
    const key = dateKey(cursor);
    if (!state.days[key]) {
      state.days[key] = fabricateDay(key);
      changed = true;
    }
    cursor = addDays(cursor, 1);
    state.seededThrough = dateKey(addDays(cursor, -1));
    changed = true;
  }
  if (!state.days[todayKey]) {
    state.days[todayKey] = { answered: 0, correct: 0, minutes: 0 };
    changed = true;
  }
  if (!state.answers[todayKey]) {
    state.answers[todayKey] = {};
    changed = true;
  }
  return changed;
}

/* ------------------------------------------------------------------ *
 * 文件读写
 * ------------------------------------------------------------------ */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file); // 原子替换，避免写一半断电损坏
}

const DEFAULT_CONFIG = {
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
    appToken: '',   // 多维表格 app_token
    tableId: ''     // 数据表 table_id
  }
};

function createStore(userDataDir) {
  const statePath = path.join(userDataDir, 'state.json');
  const configPath = path.join(userDataDir, 'config.json');

  return {
    statePath,
    configPath,

    loadState() {
      let s = readJson(statePath, null);
      if (!s || s.version !== STATE_VERSION) {
        s = buildInitialState();
        writeJson(statePath, s);
        return s;
      }
      if (ensureUpToToday(s)) writeJson(statePath, s);
      return s;
    },

    saveState(s) {
      s.savedAt = new Date().toISOString();
      writeJson(statePath, s);
      return true;
    },

    loadConfig() {
      const c = readJson(configPath, null);
      return Object.assign({}, DEFAULT_CONFIG, c || {}, {
        feishu: Object.assign({}, DEFAULT_CONFIG.feishu, (c && c.feishu) || {})
      });
    },

    saveConfig(c) {
      writeJson(configPath, c);
      return true;
    },

    resetState() {
      const s = buildInitialState();
      writeJson(statePath, s);
      return s;
    }
  };
}

module.exports = {
  STATE_VERSION,
  DAILY_TOTAL,
  SEED_BACK_DAYS,
  QUESTION_BANK,
  DEFAULT_CONFIG,
  createStore,
  questionsForDate,
  buildInitialState,
  ensureUpToToday,
  dateKey,
  addDays,
  todayDate
};

/* ============================================================
 * 一念 · 统一输入原型 V1
 * 解析引擎（纯函数，L0 规则层原型）+ 交互逻辑
 * 真实产品中 L1 端侧模型 / L2 云端兜底会替代或增强 L0
 * ============================================================ */

const TYPES = {
  event:    { name: '日程' },
  todo:     { name: '待办' },
  reminder: { name: '提醒' },
  note:     { name: '笔记' }
};

const WEEK_CN = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

/* ---------- 日期解析 ---------- */
function parseDate(text) {
  // 大后天 / 后天 / 明天 / 今天
  const fixed = [
    { re: /大后天(?:之?前)?/, offset: 3 },
    { re: /后天(?:之?前)?/, offset: 2 },
    { re: /明[天日](?:之?前)?/, offset: 1 },
    { re: /今[天日]|今晚|今早/, offset: 0 }
  ];
  for (const f of fixed) {
    const m = text.match(f.re);
    if (m) return { days: f.offset, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  // 下周X / 下星期X
  let m = text.match(/下(?:个)?(?:周|星期)([一二三四五六日天])/);
  if (m) {
    const today = new Date().getDay();
    const target = WEEK_CN[m[1]];
    const days = ((7 - today) % 7) + target || 7; // 下周一 = 跨到下一周
    return { days, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  // 周X / 星期X（最近的一个，含今天），兼容"周五前/周五之前"
  m = text.match(/(?<!下)(?:这?周|星期|礼拜)([一二三四五六日天])(?:之?前)?/);
  if (m) {
    const today = new Date().getDay();
    const target = WEEK_CN[m[1]];
    let days = target - today;
    if (days < 0) days += 7;
    return { days, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  // X月X日/号
  m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (m) {
    const now = new Date();
    let d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      d = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
    }
    const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return { days, label: m[0], start: m.index, end: m.index + m[0].length, explicit: true };
  }
  return null;
}

/* ---------- 时间解析 ---------- */
function parseTime(text) {
  // 相对时间：X分钟后 / X小时后 / 半小时后
  let m = text.match(/(半|\d+)\s*(分钟|小时|天)后/);
  if (m) {
    const n = m[1] === '半' ? 0.5 : Number(m[1]);
    const mins = m[2] === '分钟' ? n : m[2] === '小时' ? n * 60 : n * 1440;
    return { relative: mins, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  // 上午/下午/晚上…X点(半) / X:XX
  m = text.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间)?\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*(点|时)(半)?/);
  if (m) {
    let h = Number(m[2]);
    const min = m[3] ? Number(m[3]) : (m[5] ? 30 : 0);
    if (/下午|傍晚|晚上|晚间/.test(m[1] || '') && h < 12) h += 12;
    if (m[1] === '中午' && h < 6) h += 12;
    // 无时段词时，用上下文推断："今晚8点"→20点，"明早8点"→8点
    if (!m[1] && h < 12 && /今晚|晚上|晚间|夜里/.test(text)) h += 12;
    if (h >= 24) h -= 24;
    return { minutes: h * 60 + min, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  // 裸 X:XX
  m = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 24 && min < 60) return { minutes: h * 60 + min, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/* ---------- 类型信号 ---------- */
const REMINDER_RE = /^提醒我?|提醒我|别忘了|别忘/;
const EVENT_RE = /会议|开会|约(?!会?谈)|见面|聚餐|午餐|晚饭|晚餐|早餐|午饭|咖啡|面试|电话会|视频会|门诊|看牙|上课|健身|瑜伽|电影|航班|高铁|火车|飞机|演讲|汇报|评审|拜访|饭局|打球/;
const TODO_RE = /买|写|交|缴|付|订(?!婚)|整理|准备|提交|打印|取|寄|洗|修|报名|预约|还书|还|读完|看完|背|复习|完成|处理|回复|做(?!梦)/;

/* ---------- 学习层（localStorage 持久化的个人偏好） ---------- */
function learnKey(title) { return title.slice(0, 4); }
function getLearned(title) {
  try {
    const map = JSON.parse(localStorage.getItem('yinian-learn') || '{}');
    return map[learnKey(title)] || null;
  } catch (e) { return null; }
}
function learn(title, type) {
  try {
    const map = JSON.parse(localStorage.getItem('yinian-learn') || '{}');
    map[learnKey(title)] = type;
    localStorage.setItem('yinian-learn', JSON.stringify(map));
  } catch (e) {}
}

/* ---------- 主解析函数 ---------- */
function parse(raw) {
  const text = raw.trim();
  const date = parseDate(text);
  const time = parseTime(text);
  const spans = [];
  if (date) spans.push({ start: date.start, end: date.end, kind: 'date' });
  if (time) spans.push({ start: time.start, end: time.end, kind: 'time' });

  const isReminder = REMINDER_RE.test(text) || !!(time && time.relative);
  const isEvent = EVENT_RE.test(text);
  const isTodo = TODO_RE.test(text);

  let type, confidence, reason;
  if (isReminder) {
    type = 'reminder';
    confidence = 0.9;
    reason = '含提醒语义';
  } else if (isEvent && (date || time)) {
    type = 'event'; confidence = 0.9; reason = '含日程行为 + 时间';
  } else if (date && time) {
    type = 'event'; confidence = 0.8; reason = '含日期与具体时刻';
  } else if (isEvent) {
    type = 'event'; confidence = 0.7; reason = '含日程行为';
  } else if (isTodo && date) {
    type = 'todo'; confidence = 0.85; reason = '含动作 + 期限';
  } else if (isTodo) {
    type = 'todo'; confidence = 0.72; reason = '含动作词';
  } else if (date) {
    type = 'todo'; confidence = 0.62; reason = '仅含日期，按待办处理（低置信）';
  } else {
    type = 'note'; confidence = 0.45; reason = '无时间与动作信号，按笔记处理（低置信）';
  }

  // 清理标题：去掉已解析的日期/时间片段和提醒前缀
  let title = text;
  spans.sort((a, b) => b.start - a.start).forEach(s => {
    title = title.slice(0, s.start) + ' '.repeat(s.end - s.start) + title.slice(s.end);
  });
  title = title.replace(/^提醒我?/, ' ').replace(/\s+/g, ' ').trim();
  if (!title) title = text; // 全文都是时间，保留原文

  // 学习层命中：覆盖判断
  let learned = false;
  const hit = getLearned(title);
  if (hit && hit !== type) { type = hit; confidence = 0.92; learned = true; reason = '已按你的习惯归类'; }

  return { type, confidence, reason, learned, date, time, title, spans, text };
}

/* ---------- 日期标签 ---------- */
function dateLabel(days) {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  const d = new Date(Date.now() + days * 86400000);
  const wk = '日一二三四五六'[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wk}`;
}
function timeLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ============================================================
 * 以下为 DOM 交互（浏览器环境才执行）
 * ============================================================ */
if (typeof document !== 'undefined') {

  const $ = id => document.getElementById(id);
  const input = $('omniInput');
  const captureBox = $('captureBox');
  const mirror = $('mirror');
  const preview = $('preview');

  let items = [];
  try { items = JSON.parse(localStorage.getItem('yinian-items') || '[]'); } catch (e) {}
  let lastFiled = null;
  let snackTimer = null;
  let manualType = null; // 用户在预览卡上手动改判的类型

  const save = () => localStorage.setItem('yinian-items', JSON.stringify(items));

  /* ----- 输入即解析 ----- */
  input.addEventListener('input', () => {
    manualType = null;
    renderPreview();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') { input.value = ''; manualType = null; renderPreview(); }
  });

  // 全局唤起
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); input.focus(); input.select();
    }
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault(); input.focus();
    }
  });

  document.querySelectorAll('.chip-example').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.textContent;
      manualType = null;
      input.focus();
      renderPreview();
    });
  });

  $('clearData').addEventListener('click', () => {
    items = []; save();
    localStorage.removeItem('yinian-learn');
    renderAll();
  });

  $('typeSwitch').addEventListener('click', e => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    manualType = btn.dataset.type;
    renderPreview();
  });

  $('snackUndo').addEventListener('click', () => {
    if (lastFiled) {
      items = items.filter(it => it.id !== lastFiled);
      lastFiled = null; save(); renderAll();
    }
    hideSnack();
  });

  /* ----- 预览渲染 ----- */
  function renderPreview() {
    const raw = input.value;
    captureBox.classList.toggle('has-text', !!raw.trim());
    if (!raw.trim()) { preview.hidden = true; mirror.innerHTML = ''; return; }

    const p = parse(raw);
    if (manualType) { p.type = manualType; p.confidence = 1; p.reason = '你指定的类型'; }
    preview.hidden = false;

    // 镜像层高亮（行内反馈）
    mirror.innerHTML = highlightHTML(raw, p.spans, true);

    // 预览卡
    const badge = $('typeBadge');
    badge.className = 'type-badge t-' + p.type;
    $('typeName').textContent = TYPES[p.type].name;
    $('confidenceMark').textContent =
      p.learned ? '· 已学习' :
      p.confidence >= 0.7 ? '· 高置信' : '· 待确认';

    document.querySelectorAll('#typeSwitch button').forEach(b =>
      b.classList.toggle('active', b.dataset.type === p.type));

    $('previewTitle').innerHTML = highlightHTML(p.title, [], false);

    const meta = [];
    if (p.date) meta.push(`<span class="meta-chip"><span class="meta-label">日期</span>${dateLabel(p.date.days)}</span>`);
    if (p.time && p.time.minutes != null) meta.push(`<span class="meta-chip"><span class="meta-label">时间</span>${timeLabel(p.time.minutes)}</span>`);
    if (p.time && p.time.relative) meta.push(`<span class="meta-chip"><span class="meta-label">相对</span>${p.time.label}</span>`);
    $('previewMeta').innerHTML = meta.join('');

    $('previewFoot').innerHTML = p.confidence >= 0.7
      ? `判断依据：${p.reason} · <b>回车直接归入「${TYPES[p.type].name}」</b>，8 秒内可撤销`
      : `依据较弱（${p.reason}）· <b>回车先放「收集箱」</b>，确认后归位`;
  }

  function highlightHTML(text, spans, isMirror) {
    if (!spans.length) return escapeHTML(text);
    let html = '', cursor = 0;
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    for (const s of sorted) {
      if (s.start < cursor) continue;
      html += escapeHTML(text.slice(cursor, s.start));
      html += `<mark class="m-${s.kind}">${escapeHTML(text.slice(s.start, s.end))}</mark>`;
      cursor = s.end;
    }
    html += escapeHTML(text.slice(cursor));
    return html;
  }
  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ----- 归位 ----- */
  function commit() {
    const p = parse(input.value);
    if (manualType) { p.type = manualType; p.confidence = 1; }
    const low = p.confidence < 0.7 && !manualType;

    const item = {
      id: 'i' + Date.now() + Math.random().toString(36).slice(2, 6),
      type: low ? 'inbox' : p.type,
      guess: p.type,
      title: p.title,
      dateDays: p.date ? p.date.days : null,
      timeMin: (p.time && p.time.minutes != null) ? p.time.minutes : null,
      relLabel: (p.time && p.time.relative) ? p.time.label : null,
      done: false,
      createdAt: Date.now()
    };
    items.unshift(item);
    save();
    lastFiled = item.id;
    input.value = ''; manualType = null;
    renderPreview(); renderAll();

    showSnack(low
      ? `拿不准，先放 <b class="snack-type">收集箱</b> 了`
      : `已归入 <b class="snack-type">${TYPES[item.type].name}</b>`);
  }

  function showSnack(html) {
    $('snackText').innerHTML = html;
    $('snackbar').hidden = false;
    clearTimeout(snackTimer);
    snackTimer = setTimeout(hideSnack, 8000); // 8 秒撤销窗口
  }
  function hideSnack() { $('snackbar').hidden = true; lastFiled = null; }

  /* ----- 面板渲染 ----- */
  function renderAll() {
    const filed = items.filter(i => i.type !== 'inbox');
    const inbox = items.filter(i => i.type === 'inbox');
    const todayEv = filed.filter(i => i.type === 'event' && (i.dateDays === 0 || i.dateDays === null))
                         .sort((a, b) => (a.timeMin ?? 9999) - (b.timeMin ?? 9999));
    const todos = filed.filter(i => i.type === 'todo');
    const events = filed.filter(i => i.type === 'event' && !(i.dateDays === 0 || i.dateDays === null));
    const reminders = filed.filter(i => i.type === 'reminder');
    const notes = filed.filter(i => i.type === 'note');

    $('todayLabel').textContent = dateLabel(0) + ' ' + new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).replace(/^\d+月/, '');

    $('todayEvents').innerHTML = todayEv.map(it => `
      <div class="timeline-item" data-id="${it.id}" draggable="true">
        <div class="timeline-time">${it.timeMin != null ? timeLabel(it.timeMin) : '全天'}</div>
        <div class="timeline-body">
          <div class="timeline-title">${escapeHTML(it.title)}</div>
          ${it.relLabel ? `<div class="timeline-sub">${escapeHTML(it.relLabel)}</div>` : ''}
        </div>
        <span class="item-badge t-event">日程</span>
      </div>`).join('');

    $('todayTodos').innerHTML = todos.map(it => `
      <div class="todo-item ${it.done ? 'done' : ''}" data-id="${it.id}" draggable="true">
        <div class="todo-check"></div>
        <div class="todo-title">${escapeHTML(it.title)}</div>
        ${it.dateDays != null ? `<span class="todo-date">${dateLabel(it.dateDays)}</span>` : ''}
      </div>`).join('');
    $('todayEmpty').style.display = (todayEv.length || todos.length) ? 'none' : '';

    $('inboxList').innerHTML = inbox.map(it => `
      <div class="inbox-item" data-id="${it.id}">
        <div class="inbox-title">${escapeHTML(it.title)}</div>
        <div class="inbox-actions">
          <span class="inbox-q">这是</span>
          <button data-type="event">日程</button>
          <button data-type="todo">待办</button>
          <button data-type="reminder">提醒</button>
          <button data-type="note">笔记</button>
        </div>
      </div>`).join('');
    $('inboxEmpty').style.display = inbox.length ? 'none' : '';
    $('inboxCount').textContent = inbox.length || '';
    const tabBadge = $('tabInboxCount');
    if (tabBadge) {
      tabBadge.textContent = inbox.length || '';
      tabBadge.style.display = inbox.length ? '' : 'none';
    }

    $('eventList').innerHTML = events.map(miniItem).join('');
    $('eventEmpty').style.display = events.length ? 'none' : '';
    $('eventCount').textContent = (events.length + todayEv.length) || '';

    $('reminderList').innerHTML = reminders.map(miniItem).join('');
    $('reminderEmpty').style.display = reminders.length ? 'none' : '';
    $('reminderCount').textContent = reminders.length || '';

    $('noteList').innerHTML = notes.map(miniItem).join('');
    $('noteEmpty').style.display = notes.length ? 'none' : '';
    $('noteCount').textContent = notes.length || '';

    if (window.YinianCal) window.YinianCal.render();
  }

  function miniItem(it) {
    const meta = [
      it.dateDays != null ? dateLabel(it.dateDays) : '',
      it.timeMin != null ? timeLabel(it.timeMin) : '',
      it.relLabel || ''
    ].filter(Boolean).join(' ');
    return `<div class="mini-item" data-id="${it.id}" draggable="true">
      <span class="item-badge t-${it.type}">${TYPES[it.type].name}</span>
      <div class="mini-title">${escapeHTML(it.title)}</div>
      <div class="mini-meta">${meta}</div>
    </div>`;
  }

  // 待办勾选
  $('todayTodos').addEventListener('click', e => {
    const row = e.target.closest('.todo-item');
    if (!row) return;
    const it = items.find(i => i.id === row.dataset.id);
    if (it) { it.done = !it.done; save(); renderAll(); }
  });

  // 收集箱一键归位 + 学习
  $('inboxList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    const row = btn.closest('.inbox-item');
    const it = items.find(i => i.id === row.dataset.id);
    if (!it) return;
    it.type = btn.dataset.type;
    learn(it.title, it.type);          // 改类行为回流为学习信号
    save(); renderAll();
    showSnack(`已归入 <b class="snack-type">${TYPES[it.type].name}</b>，下次类似内容会记住`);
  });

  // 拖拽源：待办/日程/迷你条目均可拖上日历
  document.addEventListener('dragstart', e => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    e.dataTransfer.setData('text/plain', row.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  document.addEventListener('dragend', e => {
    const row = e.target.closest && e.target.closest('[data-id]');
    if (row) row.classList.remove('dragging');
  });

  // 底部标签导航：单视图切换，页面永远只有一屏内容
  document.querySelectorAll('.tabbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + btn.dataset.view; });
      if (btn.dataset.view === 'cal' && window.YinianCal) window.YinianCal.render();
      window.scrollTo({ top: 0 });
    });
  });

  // 暴露给日历模块（calendar.js）
  window.Yinian = {
    get items() { return items; },
    save, renderAll, showSnack, dateLabel, timeLabel,
    focusCapture(prefill) {
      if (prefill != null) { input.value = prefill; manualType = null; renderPreview(); }
      input.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  input.focus();
  renderAll();
}

/* ---------- 导出给 Node 做语法/逻辑自测 ---------- */
if (typeof module !== 'undefined') {
  module.exports = { parse, parseDate, parseTime, dateLabel, timeLabel };
}

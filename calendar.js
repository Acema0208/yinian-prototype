/* ============================================================
 * 一念 · 日历模块（calendar.js）
 * 月历视图 + Open-Meteo 实时天气 + 拖拽排期/改期
 * 依赖 app.js 暴露的 window.Yinian
 * ============================================================ */
(function () {
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const grid = $('calGrid');
  const detail = $('calDayDetail');

  /* ---------- 状态 ---------- */
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-based
  let selected = null;            // 'YYYY-MM-DD'

  /* ---------- 城市与天气 ---------- */
  const CITIES = {
    '北京': [39.90, 116.40], '上海': [31.23, 121.47], '广州': [23.13, 113.26],
    '深圳': [22.54, 114.06], '杭州': [30.27, 120.16], '成都': [30.57, 104.07],
    '东京': [35.68, 139.69], '纽约': [40.71, -74.01], '伦敦': [51.51, -0.13]
  };
  let city = localStorage.getItem('yinian-city') || '北京';
  let weather = null; // { 'YYYY-MM-DD': {icon, label, max, min} }
  try { weather = JSON.parse(localStorage.getItem('yinian-weather') || 'null'); } catch (e) {}

  const WMO = [
    [[0], '☀️', '晴'], [[1], '🌤', '少云'], [[2], '⛅', '多云'], [[3], '☁️', '阴'],
    [[45, 48], '🌫', '雾'], [[51, 53, 55, 56, 57], '🌦', '毛毛雨'],
    [[61, 63, 65, 66, 67], '🌧', '雨'], [[71, 73, 75, 77], '❄️', '雪'],
    [[80, 81, 82], '🌧', '阵雨'], [[85, 86], '🌨', '阵雪'], [[95, 96, 99], '⛈', '雷雨']
  ];
  function wmoIcon(code) {
    for (const [codes, icon, label] of WMO) if (codes.includes(code)) return { icon, label };
    return { icon: '🌡', label: '' };
  }

  async function fetchWeather() {
    const day = new Date().toISOString().slice(0, 10);
    if (weather && weather._day === day && weather._city === city) { applyCityLabel(); return; }
    const [lat, lon] = CITIES[city] || CITIES['北京'];
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=weathercode,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto`;
      const res = await fetch(url);
      const j = await res.json();
      const map = { _day: day, _city: city };
      j.daily.time.forEach((d, i) => {
        const w = wmoIcon(j.daily.weathercode[i]);
        map[d] = {
          icon: w.icon, label: w.label,
          max: Math.round(j.daily.temperature_2m_max[i]),
          min: Math.round(j.daily.temperature_2m_min[i])
        };
      });
      weather = map;
      localStorage.setItem('yinian-weather', JSON.stringify(map));
      applyCityLabel();
      render();
    } catch (e) { /* 离线时静默降级：无天气图标 */ }
  }

  function applyCityLabel() {
    const today = new Date().toISOString().slice(0, 10);
    const w = weather && weather[today];
    $('calCity').textContent = w ? `${city} ${w.icon} ${w.min}~${w.max}°` : city;
    const tw = $('todayWeather');
    if (tw) tw.textContent = w ? `${city} ${w.icon} ${w.label} ${w.min}~${w.max}°` : '';
  }

  $('calCity').addEventListener('click', () => {
    const names = Object.keys(CITIES);
    city = names[(names.indexOf(city) + 1) % names.length];
    localStorage.setItem('yinian-city', city);
    weather = null;
    fetchWeather();
  });

  /* ---------- 日期工具 ---------- */
  function str(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function todayStr() { return str(new Date()); }
  function itemDateStr(it) {
    if (it.dateDays == null) return null;
    return str(new Date(Date.now() + it.dateDays * 86400000));
  }
  function diffFromToday(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const a = new Date(y, m - 1, d);
    const b = new Date(); b.setHours(0, 0, 0, 0);
    return Math.round((a - b) / 86400000);
  }
  function itemsOn(dateStr) {
    const Y = window.Yinian;
    return Y.items.filter(it => {
      if (it.type === 'inbox' || it.type === 'note') return false;
      const ds = itemDateStr(it);
      if (ds) return ds === dateStr;
      // 无日期的日程/提醒落在今天；无日期待办落在今天
      return dateStr === todayStr();
    });
  }

  /* ---------- 渲染月历 ---------- */
  function render() {
    if (!window.Yinian) return;
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = (first.getDay() + 6) % 7; // 周一开头
    const start = new Date(viewYear, viewMonth, 1 - startOffset);
    $('calMonthLabel').textContent = `${viewYear} 年 ${viewMonth + 1} 月`;

    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const ds = str(d);
      const inMonth = d.getMonth() === viewMonth;
      const dayItems = itemsOn(ds).slice(0, 3);
      const more = itemsOn(ds).length - dayItems.length;
      const w = weather && weather[ds];
      const cls = ['cal-cell',
        inMonth ? '' : 'other-month',
        ds === todayStr() ? 'today' : '',
        ds === selected ? 'selected' : ''
      ].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${ds}">
        <div class="cal-cell-top">
          <span class="cal-date">${d.getDate()}</span>
          ${w ? `<span class="cal-weather">${w.icon}<span class="cal-weather-temp">${w.min}~${w.max}°</span></span>` : ''}
        </div>
        ${dayItems.map(it => {
          const t = window.Yinian;
          const time = it.timeMin != null ? t.timeLabel(it.timeMin) + ' ' : '';
          return `<div class="cal-ev t-${it.type}" draggable="true" data-id="${it.id}">${time}${escapeH(it.title)}</div>`;
        }).join('')}
        ${more > 0 ? `<div class="cal-more">+${more}</div>` : ''}
      </div>`;
    }
    grid.innerHTML = html;
    renderDetail();
  }

  /* ---------- 某日详情（点选日期） ---------- */
  function renderDetail() {
    if (!selected) { detail.hidden = true; return; }
    const Y = window.Yinian;
    const list = itemsOn(selected);
    detail.hidden = false;
    detail.innerHTML = `
      <h3>${selected} · ${diffFromToday(selected) === 0 ? '今天' : diffFromToday(selected) === 1 ? '明天' : ''}</h3>
      ${list.length ? list.map(it => `
        <div class="mini-item" data-id="${it.id}" draggable="true">
          <span class="item-badge t-${it.type}">${{ event: '日程', todo: '待办', reminder: '提醒' }[it.type] || it.type}</span>
          <div class="mini-title">${escapeH(it.title)}</div>
          <div class="mini-meta">${it.timeMin != null ? Y.timeLabel(it.timeMin) : ''}</div>
        </div>`).join('') : '<div class="empty">这一天还没有安排</div>'}
      <button class="cal-add-btn" id="calAddBtn">＋ 在这一天添加（唤起统一输入）</button>`;
    $('calAddBtn').addEventListener('click', () => {
      const [y, m, d] = selected.split('-').map(Number);
      Y.focusCapture(`${m}月${d}日 `);
    });
  }

  /* ---------- 交互：点选 / 翻页 / 拖放 ---------- */
  grid.addEventListener('click', e => {
    const cell = e.target.closest('.cal-cell');
    if (!cell || e.target.closest('.cal-ev')) return;
    selected = cell.dataset.date;
    render();
  });

  grid.addEventListener('dblclick', e => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    const [y, m, d] = cell.dataset.date.split('-').map(Number);
    window.Yinian.focusCapture(`${m}月${d}日 `);
  });

  grid.addEventListener('dragover', e => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    grid.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target'));
    cell.classList.add('drop-target');
  });
  grid.addEventListener('dragleave', e => {
    if (!grid.contains(e.relatedTarget)) {
      grid.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target'));
    }
  });
  grid.addEventListener('drop', e => {
    e.preventDefault();
    const cell = e.target.closest('.cal-cell');
    const id = e.dataTransfer.getData('text/plain');
    grid.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target'));
    if (!cell || !id) return;
    const Y = window.Yinian;
    const it = Y.items.find(i => i.id === id);
    if (!it) return;
    it.dateDays = diffFromToday(cell.dataset.date);
    if (it.type === 'inbox') it.type = it.guess && it.guess !== 'inbox' ? it.guess : 'todo';
    Y.save(); Y.renderAll();
    Y.showSnack(`已排到 <b class="snack-type">${cell.dataset.date}</b>`);
  });

  $('calPrev').addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
  $('calNext').addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });
  $('calTodayBtn').addEventListener('click', () => {
    const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth();
    selected = todayStr(); render();
  });

  function escapeH(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.YinianCal = { render };
  applyCityLabel();
  fetchWeather();
  render();
})();

// 面試行程總表：所有職缺的面試排在同一張表，看哪個時段、哪個職缺、哪位應徵者
//  - 週曆：像 Excel，橫軸日期、直軸時間，格子裡是「職缺＋應徵者」
//  - 清單：每一場面試一列，可以下載成 CSV 用 Excel 打開
//  - 等待選時段：邀請了但同學還沒選的
import { api, $, $$, esc } from '/shared/api.js';

const WEEK = '日一二三四五六';
const COLORS = ['#06c755', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const dayText = (date) => `${md(date)}（${WEEK[new Date(`${date}T00:00:00`).getDay()]}）`;
const nowLocal = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16);
const endOf = (start, minutes) => {
  if (!minutes) return '';
  const [h, m] = start.slice(11).split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
};
const timeText = (x) => `${x.start.slice(11)}${x.minutes ? `–${endOf(x.start, x.minutes)}` : ''}`;
function weekDays(offset) {
  const t = new Date(`${nowLocal().slice(0, 10)}T00:00:00`);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(t); d.setDate(t.getDate() + i); return ymd(d); });
}

export async function showSchedule(main, { openApp }) {
  main.innerHTML = '<div class="panel empty"><span class="spinner dark"></span> 載入面試行程…</div>';
  const data = await api('/company/schedule');
  const color = Object.fromEntries(data.jobs.map((j, i) => [j.id, COLORS[i % COLORS.length]]));
  const title = Object.fromEntries(data.jobs.map((j) => [j.id, j.title]));
  const ui = { job: '', view: 'week', week: 0, open: true, past: false };

  main.innerHTML = `
    <div class="panel sch-head">
      <div class="grow"><h2 class="panel-title" style="margin:0">🗓 面試行程</h2>
        <div class="muted small">所有職缺的面試都在這裡：哪個時段、哪個職缺、哪位應徵者。點名字可以看他的履歷。</div></div>
      <select class="input sch-job"><option value="">全部職缺</option>${data.jobs.map((j) => `<option value="${esc(j.id)}">${esc(j.title)}</option>`).join('')}</select>
      <div class="seg-tabs"><button data-view="week" class="on">週曆</button><button data-view="list">清單</button></div>
      <button class="btn" data-csv>⬇ 下載 Excel（CSV）</button>
    </div>
    <div class="sch-stats"></div>
    <div class="panel sch-body"></div>
    <div class="panel sch-waiting"></div>`;

  const inJob = (x) => !ui.job || x.jobId === ui.job;
  const person = (p) => `<button class="sch-name" data-job="${esc(p.jobId)}" data-app="${esc(p.appId)}" title="${esc(p.school || '')}">${esc(p.name)}</button>`;

  const renderStats = () => {
    const now = nowLocal();
    const days = weekDays(0);
    const upcoming = data.booked.filter((x) => inJob(x) && x.start > now);
    const waiting = data.waiting.filter(inJob);
    $('.sch-stats', main).innerHTML = `
      <div class="stat"><span>即將面試</span><b>${upcoming.length}</b></div>
      <div class="stat"><span>本週面試</span><b>${upcoming.filter((x) => days.includes(x.start.slice(0, 10))).length}</b></div>
      <div class="stat"><span>等待選時段</span><b>${waiting.length}</b></div>
      <div class="stat"><span>可預約空位</span><b>${data.open.filter((x) => inJob(x) && x.start > now).reduce((n, x) => n + x.left, 0)}</b></div>`;
  };

  // 週曆：只列出這週有排的時間，避免一整片空白
  const renderWeek = () => {
    const days = weekDays(ui.week);
    const booked = data.booked.filter((x) => inJob(x) && days.includes(x.start.slice(0, 10)));
    const open = ui.open ? data.open.filter((x) => inJob(x) && days.includes(x.start.slice(0, 10)) && x.start > nowLocal()) : [];
    const times = [...new Set([...booked, ...open].map((x) => x.start.slice(11)))].sort();
    const today = nowLocal().slice(0, 10);
    const cell = (d, t) => {
      const key = `${d}T${t}`;
      // 同一職缺、同一時段的應徵者放在同一張卡
      const groups = {};
      booked.filter((x) => x.start === key).forEach((x) => (groups[x.jobId] ||= []).push(x));
      const cards = Object.entries(groups).map(([jobId, people]) => `
        <div class="sch-card" style="--c:${color[jobId]}">
          <div class="sch-job-t">${esc(title[jobId])}</div>
          <div class="sch-time">${timeText(people[0])}${people[0].mode ? `・${esc(people[0].mode)}` : ''}</div>
          <div>${people.map(person).join('')}</div>
        </div>`);
      const free = open.filter((x) => x.start === key && !groups[x.jobId]).map((x) => `
        <div class="sch-free" style="--c:${color[x.jobId]}">空檔・剩 ${x.left}<span>${esc(title[x.jobId])}</span></div>`);
      return [...cards, ...free].join('');
    };
    return `
      <div class="slot-bar">
        <button class="btn" data-week="-1">‹ 上一週</button><b>${md(days[0])} – ${md(days[6])}</b><button class="btn" data-week="1">下一週 ›</button>
        ${ui.week ? '<button class="btn ghost" data-week="0">回到本週</button>' : ''}
        <span class="grow"></span>
        <label class="small"><input type="checkbox" data-open ${ui.open ? 'checked' : ''}> 顯示還沒人預約的空檔</label>
      </div>
      ${times.length ? `
      <div class="sch-wrap"><table class="sch-grid">
        <thead><tr><th></th>${days.map((d) => `<th class="${d === today ? 'today' : ''}">${WEEK[new Date(`${d}T00:00:00`).getDay()]}<small>${md(d)}</small></th>`).join('')}</tr></thead>
        <tbody>${times.map((t) => `<tr><th>${t}</th>${days.map((d) => `<td>${cell(d, t)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">這週沒有排面試</div>'}`;
  };

  const listRows = () => data.booked.filter((x) => inJob(x) && (ui.past || x.start > nowLocal()));
  const renderList = () => {
    const rows = listRows();
    return `
      <div class="slot-bar"><span class="grow"></span><label class="small"><input type="checkbox" data-past ${ui.past ? 'checked' : ''}> 包含已經過去的面試</label></div>
      ${rows.length ? `<div class="sch-wrap"><table class="sch-table">
        <thead><tr><th>日期</th><th>時間</th><th>職缺</th><th>應徵者</th><th>學校科系</th><th>方式・地點</th><th>時間來源</th></tr></thead>
        <tbody>${rows.map((x) => `<tr class="${x.start <= nowLocal() ? 'past' : ''}">
          <td>${dayText(x.start.slice(0, 10))}</td><td>${timeText(x)}</td>
          <td><span class="dot" style="--c:${color[x.jobId]}"></span>${esc(title[x.jobId])}</td>
          <td>${person(x)}</td><td class="muted">${esc(x.school || '—')}</td>
          <td>${esc(x.mode || '—')}${x.place ? `<div class="muted small">${esc(x.place)}</div>` : ''}</td>
          <td class="muted small">${x.byStudent ? '同學自選' : '企業指定'}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">目前沒有排定的面試</div>'}`;
  };

  const renderWaiting = () => {
    const today = nowLocal().slice(0, 10);
    const rows = data.waiting.filter(inJob).sort((a, b) => (a.replyBy || '').localeCompare(b.replyBy || ''));
    $('.sch-waiting', main).innerHTML = `
      <div class="analytics-head"><b>⏳ 等待同學選時段</b><span class="muted small">${rows.length} 位</span></div>
      ${rows.length ? `<table class="sch-table">
        <thead><tr><th>職缺</th><th>應徵者</th><th>回覆期限</th><th>狀態</th></tr></thead>
        <tbody>${rows.map((w) => `<tr>
          <td><span class="dot" style="--c:${color[w.jobId]}"></span>${esc(title[w.jobId])}</td><td>${person(w)}</td>
          <td>${w.replyBy ? dayText(w.replyBy) : '—'}</td>
          <td>${w.unavailable ? `<span class="warn-text">時段都不方便${w.unavailable.note ? `：「${esc(w.unavailable.note)}」` : ''}</span>`
            : today > w.replyBy ? '<span class="warn-text">已超過期限</span>' : '等待中'}</td></tr>`).join('')}</tbody>
      </table>` : '<div class="muted small">沒有等待中的同學</div>'}`;
  };

  const render = () => {
    renderStats();
    $('.sch-body', main).innerHTML = ui.view === 'week' ? renderWeek() : renderList();
    renderWaiting();
    $$('[data-view]', main).forEach((b) => b.classList.toggle('on', b.dataset.view === ui.view));
    $$('[data-week]', main).forEach((b) => (b.onclick = () => { ui.week = b.dataset.week === '0' ? 0 : ui.week + Number(b.dataset.week); render(); }));
    const openBox = $('[data-open]', main);
    if (openBox) openBox.onchange = () => { ui.open = openBox.checked; render(); };
    const pastBox = $('[data-past]', main);
    if (pastBox) pastBox.onchange = () => { ui.past = pastBox.checked; render(); };
    $$('.sch-name', main).forEach((b) => (b.onclick = () => openApp(b.dataset.job, b.dataset.app)));
  };

  $('.sch-job', main).onchange = (e) => { ui.job = e.target.value; render(); };
  $$('[data-view]', main).forEach((b) => (b.onclick = () => { ui.view = b.dataset.view; render(); }));
  $('[data-csv]', main).onclick = () => downloadCsv(data.booked.filter(inJob), title);
  // 預設跳到下一場面試所在的那一週
  const next = data.booked.find((x) => x.start > nowLocal());
  if (next) for (let w = 0; w < 12 && !weekDays(w).includes(next.start.slice(0, 10)); w++) ui.week = w + 1;
  render();
}

// 下載 CSV（加 BOM，Excel 打開中文才不會亂碼）
function downloadCsv(rows, title) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['日期', '開始', '結束', '職缺', '應徵者', '學校科系', '面試方式', '地點／連結', '時間來源']]
    .concat(rows.map((x) => [x.start.slice(0, 10), x.start.slice(11), endOf(x.start, x.minutes), title[x.jobId], x.name, x.school, x.mode, x.place, x.byStudent ? '同學自選' : '企業指定']));
  const blob = new Blob([`﻿${lines.map((l) => l.map(q).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `面試行程_${nowLocal().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

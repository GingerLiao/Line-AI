// 面試時段設定：像 Excel 一樣的週曆表格，點一下或拖曳選取可以面試的時段
//   const editor = slotEditor(container, { settings, slots });
//   editor.value() → { settings, starts: ['2026-10-20T14:00', …] }
import { $, $$, esc, toast, confirmDialog } from '/shared/api.js';

export const SLOT_MINUTES = [15, 20, 30, 45, 60, 90, 120];
const REPLY_DAYS = [2, 3, 5, 7, 10, 14];
const WEEKS_AHEAD = 8;
const WEEK = '日一二三四五六';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const nowLocal = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16);

// 這週一（台北時間）
function mondayOf(offsetWeeks = 0) {
  const t = new Date(`${nowLocal().slice(0, 10)}T00:00:00`);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + offsetWeeks * 7);
  return t;
}
const weekDays = (offset) => Array.from({ length: 7 }, (_, i) => {
  const d = mondayOf(offset);
  d.setDate(d.getDate() + i);
  return ymd(d);
});
const timesOf = ({ minutes, startHour, endHour }) => {
  const out = [];
  for (let t = startHour * 60; t + minutes <= endHour * 60; t += minutes) out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  return out;
};
const endOf = (start, minutes) => {
  const [h, m] = start.slice(11).split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
};
export const slotText = (start, minutes) => `${md(start)}（${WEEK[new Date(start.slice(0, 10)).getDay()]}）${start.slice(11)}–${endOf(start, minutes)}`;

export function slotEditor(root, { settings, slots = [] }) {
  let s = { ...settings };
  const now = nowLocal();
  const selected = new Set(slots.filter((x) => x.start > now && !x.closed).map((x) => x.start));
  const booked = new Map(slots.filter((x) => x.booked).map((x) => [x.start, x]));
  let week = 0;

  root.innerHTML = `
    <div class="slot-settings">
      <label class="field"><span>每個時段長度</span><select class="input" data-set="minutes">${SLOT_MINUTES.map((m) => `<option value="${m}" ${m === s.minutes ? 'selected' : ''}>${m} 分鐘</option>`).join('')}</select></label>
      <label class="field"><span>每個時段可預約人數</span><input class="input" type="number" min="1" max="50" data-set="capacity" value="${s.capacity}"></label>
      <label class="field"><span>同學回覆期限</span><select class="input" data-set="replyDays">${REPLY_DAYS.map((d) => `<option value="${d}" ${d === s.replyDays ? 'selected' : ''}>收到邀請後 ${d} 天內</option>`).join('')}</select></label>
      <label class="field"><span>表格顯示時間</span><div class="hour-range">
        <select class="input" data-set="startHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === s.startHour ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select>
        <span>–</span>
        <select class="input" data-set="endHour">${Array.from({ length: 24 }, (_, h) => h + 1).map((h) => `<option value="${h}" ${h === s.endHour ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select></div></label>
    </div>
    <div class="slot-bar">
      <button type="button" class="btn" data-week="-1">‹ 上一週</button>
      <b class="slot-week"></b>
      <button type="button" class="btn" data-week="1">下一週 ›</button>
      <span class="grow"></span>
      <span class="muted small slot-count"></span>
      <button type="button" class="btn" data-copy>複製本週到下一週</button>
      <button type="button" class="btn" data-clear>清除本週</button>
    </div>
    <p class="muted small slot-tip">點一下或按住拖曳，選取可以面試的時段（綠色）。深綠色是已有同學預約的時段：取消勾選後不再開放給其他人，但已預約的同學仍保留。</p>
    <div class="slot-grid-wrap"><table class="slot-grid"></table></div>
    <div class="slot-booked"></div>`;

  const table = $('.slot-grid', root);
  const render = () => {
    const days = weekDays(week);
    $('.slot-week', root).textContent = `${md(days[0])} – ${md(days[6])}`;
    $('[data-week="-1"]', root).disabled = week <= 0;
    $('[data-week="1"]', root).disabled = week >= WEEKS_AHEAD;
    const future = [...selected].filter((x) => x > nowLocal());
    $('.slot-count', root).textContent = `已開放 ${future.length} 個時段`;
    table.innerHTML = `
      <thead><tr><th></th>${days.map((d) => `<th class="${d.slice(0, 10) === now.slice(0, 10) ? 'today' : ''}">${WEEK[new Date(d).getDay()]}<small>${md(d)}</small></th>`).join('')}</tr></thead>
      <tbody>${timesOf(s).map((t) => `<tr><th>${t}</th>${days.map((d) => {
        const key = `${d}T${t}`;
        const b = booked.get(key);
        const on = selected.has(key);
        const cls = key <= now ? 'past' : b ? `booked ${on ? '' : 'closed'}` : on ? 'on' : '';
        const tip = b ? `已預約：${b.names.join('、')}${on ? '' : '（已取消開放，只保留給已預約的同學）'}` : '';
        return `<td data-s="${key}" class="${cls}" title="${esc(tip)}">${b ? `${b.booked}/${b.capacity}` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody>`;
    const list = [...booked.values()].filter((b) => b.start > now).sort((a, b) => a.start.localeCompare(b.start));
    $('.slot-booked', root).innerHTML = list.length
      ? `<div class="section-title">已預約的同學</div>${list.map((b) => `<div class="small">📅 ${slotText(b.start, b.minutes)}　${esc(b.names.join('、'))}（${b.booked}/${b.capacity}）${selected.has(b.start) ? '' : '<span class="muted">・不再開放</span>'}</div>`).join('')}`
      : '';
  };

  // 點選／拖曳選取
  let painting = null; // true＝加入、false＝移除
  const paint = (td) => {
    const key = td?.dataset.s;
    if (!key || td.classList.contains('past')) return;
    if (painting) selected.add(key);
    else selected.delete(key);
    if (td.classList.contains('booked')) td.classList.toggle('closed', !painting);
    else td.classList.toggle('on', painting);
  };
  table.addEventListener('pointerdown', (e) => {
    const td = e.target.closest('td[data-s]');
    if (!td || td.classList.contains('past')) return;
    e.preventDefault();
    painting = !selected.has(td.dataset.s);
    paint(td);
  });
  table.addEventListener('pointermove', (e) => {
    if (painting === null) return;
    paint(document.elementFromPoint(e.clientX, e.clientY)?.closest('td[data-s]'));
  });
  document.addEventListener('pointerup', () => { if (painting !== null) { painting = null; render(); } });

  $$('[data-week]', root).forEach((b) => (b.onclick = () => { week += Number(b.dataset.week); render(); }));
  $('[data-clear]', root).onclick = () => {
    const days = new Set(weekDays(week));
    [...selected].forEach((k) => { if (days.has(k.slice(0, 10)) && !booked.has(k)) selected.delete(k); });
    render();
  };
  $('[data-copy]', root).onclick = () => {
    const days = weekDays(week);
    const next = weekDays(week + 1);
    let n = 0;
    [...selected].forEach((k) => {
      const i = days.indexOf(k.slice(0, 10));
      if (i >= 0) { selected.add(`${next[i]}${k.slice(10)}`); n++; }
    });
    if (!n) return toast('這週還沒有選時段');
    week = Math.min(WEEKS_AHEAD, week + 1);
    render();
    toast(`已複製 ${n} 個時段到下一週`);
  };
  $$('[data-set]', root).forEach((el) => (el.onchange = async () => {
    const key = el.dataset.set;
    const v = Number(el.value);
    if (key === 'minutes') {
      const unbooked = [...selected].filter((k) => !booked.has(k) && k > nowLocal());
      if (unbooked.length) {
        const yes = await confirmDialog({ title: '改變時段長度？', message: `表格會重新切格，已選的 ${unbooked.length} 個時段會被清除（已有人預約的會保留）。`, ok: '改變並清除' });
        if (!yes) { el.value = s.minutes; return; }
        unbooked.forEach((k) => selected.delete(k));
      }
    }
    if (key === 'capacity' && !(v >= 1)) { el.value = s.capacity; return; }
    s = { ...s, [key]: v };
    if (s.endHour <= s.startHour) s.endHour = Math.min(24, s.startHour + 1);
    $('[data-set="endHour"]', root).value = s.endHour;
    render();
  }));
  render();

  return {
    value: () => ({ settings: { ...s }, starts: [...selected].filter((k) => k > nowLocal()) }),
    count: () => [...selected].filter((k) => k > nowLocal()).length,
  };
}

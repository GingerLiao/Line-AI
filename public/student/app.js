import { initAuth, api, $, $$, esc, toast, daysLeft, mmdd, splitList } from '/shared/api.js';

const state = { cards: [], resumes: [], prefs: {} };
const REGIONS = ['台北', '新北', '桃園', '台中', '台南', '高雄', '遠端'];
const SCHEDULES = ['每週3天以上', '平日', '假日'];
const DURATIONS = [{ v: 3, t: '3 個月以上' }, { v: 6, t: '6 個月以上' }, { v: 0, t: '不限' }];
const STATUS_TEXT = { pending: '已投遞・等待回覆', shortlisted: '企業已收藏', interview: '🎉 邀請面試', rejected: '未錄取' };

// =============== 啟動 ===============
await initAuth('student');
[state.resumes, state.prefs] = await Promise.all([api('/student/resumes'), api('/student/preferences')]);
const startTab = new URLSearchParams(location.search).get('tab') || 'swipe';
switchTab(startTab);

$$('.tabbar button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
$('#open-filter').onclick = openFilter;
$('#new-resume').onclick = () => openResumeEditor();
$$('#actions .round').forEach((b) => (b.onclick = () => decide(b.dataset.act)));

function switchTab(tab) {
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${tab}`));
  $('#page-title').textContent = { swipe: '找實習', resumes: '我的履歷', saved: '收藏・投遞' }[tab];
  $('#open-filter').classList.toggle('hidden', tab !== 'swipe');
  if (tab === 'swipe') loadCards();
  if (tab === 'resumes') renderResumes();
  if (tab === 'saved') loadSaved();
}

// =============== 底部面板 ===============
function openSheet(title, html, icon = '') {
  const root = $('#sheet-root');
  root.innerHTML = `
    <div class="sheet-backdrop">
      <div class="sheet">
        <div class="sheet-head">${icon}<h2>${esc(title)}</h2><button class="icon-btn" data-close>✕</button></div>
        <div class="sheet-body">${html}</div>
      </div>
    </div>`;
  const backdrop = $('.sheet-backdrop', root);
  backdrop.onclick = (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) closeSheet(); };
  return $('.sheet-body', root);
}
let onSheetClose = null;
function closeSheet() {
  $('#sheet-root').innerHTML = '';
  const cb = onSheetClose;
  onSheetClose = null;
  cb?.();
}

// =============== 滑卡 ===============
async function loadCards() {
  state.cards = await api('/student/cards');
  renderDeck();
}

function renderDeck() {
  const deck = $('#deck');
  const [top, next] = state.cards;
  $('#actions').classList.toggle('hidden', !top);
  if (!top) {
    deck.innerHTML = `<div class="empty">目前沒有符合條件的新職缺 🙌<br><br><button class="btn" id="empty-filter">調整篩選條件</button></div>`;
    $('#empty-filter').onclick = openFilter;
    return;
  }
  deck.innerHTML = (next ? cardHtml(next, 'behind') : '') + cardHtml(top, 'top');
  bindSwipe($('.card.top', deck), top);
}

function cardHtml(job, cls) {
  const left = daysLeft(job.deadline);
  const score = job.match?.score;
  return `
  <article class="card ${cls}">
    ${score !== undefined ? `<span class="match tag ${score >= 80 ? '' : score >= 60 ? 'warn' : 'bad'}">符合度 ${score}%</span>` : ''}
    <div class="card-head">
      <div class="avatar">${esc(job.companyName.slice(0, 2))}</div>
      <div><h3>${esc(job.companyName.replace(/(股份)?有限公司$/, ''))}</h3><span class="tag">${esc(job.category)}・實習</span></div>
    </div>
    <p class="desc">${esc(job.description)}</p>
    <div class="facts">
      <div>💲 時薪 ${esc(job.wage)} 元</div>
      <div>📍 ${esc(job.location)}</div>
      <div>🕒 每週 ${esc(job.daysPerWeek)} 天・${esc(job.durationMonths)} 個月</div>
      <div>📅 截止 ${mmdd(job.deadline)}${left !== null && left <= 3 ? ` <span class="tag bad">剩 ${left} 天</span>` : ''}</div>
    </div>
    <div class="reqs">
      <div class="muted small">要求條件</div>
      <div><b>🎓 學歷</b>${esc(job.requirements?.degree || '不限')}　<b>📚 科系</b>${esc(job.requirements?.departments?.join('、') || '不限')}</div>
      <div><b>🛠 技能</b>${esc((job.requiredSkills || []).join('・') || '不限')}</div>
    </div>
    <div class="stamp apply">投遞</div><div class="stamp skip">跳過</div><div class="stamp save">收藏</div>
    <div class="more">點卡片看完整職缺內容 ›</div>
  </article>`;
}

// 用 Hammer.js 處理拖曳手勢
function bindSwipe(el, job) {
  const mc = new Hammer.Manager(el);
  mc.add(new Hammer.Pan({ direction: Hammer.DIRECTION_ALL, threshold: 5 }));
  mc.add(new Hammer.Tap());

  const stamp = (name, v) => ($(`.stamp.${name}`, el).style.opacity = Math.max(0, Math.min(1, v)));

  mc.on('panmove', (e) => {
    el.classList.remove('animate');
    el.style.transform = `translate(${e.deltaX}px, ${e.deltaY}px) rotate(${e.deltaX / 15}deg)`;
    stamp('apply', e.deltaX / 100);
    stamp('skip', -e.deltaX / 100);
    stamp('save', Math.abs(e.deltaX) < 60 ? -e.deltaY / 100 : 0);
  });
  mc.on('panend', (e) => {
    if (e.deltaX > 110) decide('apply');
    else if (e.deltaX < -110) decide('skip');
    else if (e.deltaY < -110 && Math.abs(e.deltaX) < 80) decide('save');
    else resetCard(el);
  });
  mc.on('tap', () => openJobDetail(job));
}

function resetCard(el = $('.card.top')) {
  if (!el) return;
  el.classList.add('animate');
  el.style.transform = '';
  $$('.stamp', el).forEach((s) => (s.style.opacity = 0));
}

function flyOut(action) {
  const el = $('.card.top');
  el.classList.add('animate');
  const to = { apply: 'translate(150%, 0) rotate(20deg)', skip: 'translate(-150%, 0) rotate(-20deg)', save: 'translate(0, -150%)' }[action];
  el.style.transform = to;
  el.style.opacity = 0;
  return new Promise((r) => setTimeout(r, 250));
}

async function decide(action) {
  const job = state.cards[0];
  if (!job) return;

  if (action === 'apply') {
    const resumeId = await pickResume(job);
    if (!resumeId) return resetCard();
    await submit(job, action, resumeId);
    return toast('已投遞！企業會在 LINE 收到通知');
  }
  await submit(job, action);
  if (action === 'save') toast('已收藏，截止前會用 LINE 提醒你 🔔');
}

async function submit(job, action, resumeId) {
  await flyOut(action);
  try {
    await api('/student/swipes', { method: 'POST', body: { jobId: job.id, action, resumeId } });
    state.cards.shift();
  } catch (err) {
    toast(err.message);
  }
  renderDeck();
}

// =============== 職缺詳情 + AI 職涯健檢 ===============
function openJobDetail(job) {
  const r = job.requirements || {};
  const body = openSheet(job.title, `
    <p><b>${esc(job.companyName)}</b></p>
    <p>${esc(job.description)}</p>
    <div class="box">
      💲 時薪 ${esc(job.wage)} 元<br>📍 ${esc(job.location)}<br>
      🕒 每週 ${esc(job.daysPerWeek)} 天・${esc(job.durationMonths)} 個月${job.weekend ? '（含假日）' : ''}<br>📅 報名截止 ${esc(job.deadline || '—')}
    </div>
    <div class="section-title">要求條件</div>
    <div class="box small">
      學歷：${esc(r.degree || '不限')}　科系：${esc(r.departments?.join('、') || '不限')}<br>
      年級：${r.minGrade ? `大${'一二三四'[r.minGrade - 1]}以上` : '不限'}　經歷：${esc(r.experience || '不拘')}　語言：${esc(r.languages?.join('、') || '不限')}<br>
      必備技能：${esc((job.requiredSkills || []).join('、') || '—')}<br>
      加分條件：${esc((job.bonusSkills || []).join('、') || '—')}
    </div>
    ${job.benefits?.length ? `<div class="section-title">公司福利</div><div class="chips">${job.benefits.map((b) => `<span class="chip">${esc(b)}</span>`).join('')}</div>` : ''}
    <div style="margin-top:18px"><button class="btn primary block" id="do-check">✨ AI 職涯健檢</button></div>
  `);
  $('#do-check', body).onclick = () => openCareerCheck(job);
}

async function openCareerCheck(job) {
  const resumeId = state.prefs.resumeId || state.resumes[0]?.id;
  if (!resumeId) {
    toast('請先建立一份履歷');
    return switchTab('resumes');
  }
  const body = openSheet('AI 職涯健診', `<div class="empty"><span class="spinner" style="border-color:var(--green);border-right-color:transparent"></span> 分析中…</div>`, '<span class="logo">✓</span>');
  try {
    const { evaluation: ev, advice } = await api('/student/career-check', { method: 'POST', body: { jobId: job.id, resumeId } });
    const ok = ev.checks.filter((c) => c.ok);
    const bad = ev.checks.filter((c) => !c.ok);
    const missing = [...ev.missingSkills, ...ev.bonusMissing];
    body.innerHTML = `
      <p class="muted small">${esc(job.title)}・${esc(job.companyName)}</p>
      <div class="section-title">✅ 你已具備</div>
      <div class="chips">${[...ok.map((c) => `${c.label}`), ...ev.matchedSkills, ...ev.bonusMatched].map((t) => `<span class="chip on">${esc(t)}</span>`).join('') || '<span class="muted small">—</span>'}</div>
      ${bad.length ? `<div class="section-title">⚠️ 不符合</div>${bad.map((c) => `
        <div class="box red"><b>${esc(c.label)}</b><br><span class="small">${esc(c.detail)}。${esc(advice.mismatchNotes?.[c.key] || '')}</span></div>`).join('')}` : ''}
      ${missing.length ? `<div class="section-title">◌ 缺少技能（可補強）</div>${missing.map((s) => `
        <div class="box"><b>${esc(s)}</b>${ev.missingSkills.includes(s) ? ' <span class="tag bad">必備</span>' : ' <span class="tag warn">加分</span>'}<br><span class="small muted">${esc(advice.skillNotes?.[s] || '')}</span></div>`).join('')}` : ''}
      <div class="box sand"><b>💡 建議</b><ol class="small" style="padding-left:18px;margin:8px 0 0">${(advice.suggestions || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
      <p class="muted small">根據履歷：${esc(state.resumes.find((r) => r.id === resumeId)?.title || '')}（可在篩選條件中切換）</p>`;
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

// =============== 投遞時選擇履歷 ===============
function pickResume(job) {
  return new Promise((resolve) => {
    if (!state.resumes.length) {
      toast('請先建立一份履歷再投遞');
      resolve(null);
      return switchTab('resumes');
    }
    // 推薦：與此職缺技能最相符的履歷
    const scoreOf = (r) => (job.requiredSkills || []).filter((s) => (r.skills || []).some((x) => x.toLowerCase() === s.toLowerCase())).length;
    const sorted = [...state.resumes].sort((a, b) => scoreOf(b) - scoreOf(a));
    let chosen = sorted[0].id;

    const body = openSheet('用哪一份履歷投遞？', `
      <p class="muted small" style="margin-top:0">投遞到　${esc(job.title)}・${esc(job.companyName)}</p>
      ${sorted.map((r, i) => `
        <label class="radio-card ${i === 0 ? 'on' : ''}">
          <input type="radio" name="resume" value="${esc(r.id)}" ${i === 0 ? 'checked' : ''}>
          <div style="flex:1"><b>${esc(r.title)}</b><div class="muted small">${ago(r.updatedAt)}更新${i === 0 && scoreOf(r) ? '・與此職缺最相符' : ''}</div></div>
          ${i === 0 ? '<span class="tag">推薦</span>' : ''}
        </label>`).join('')}
      <button class="btn block" id="pick-new" style="margin-bottom:10px">＋ 建立新履歷</button>
      <button class="btn primary block" id="pick-ok">➤ 確認投遞</button>`);

    $$('input[name=resume]', body).forEach((input) => (input.onchange = () => {
      chosen = input.value;
      $$('.radio-card', body).forEach((c) => c.classList.toggle('on', c.contains(input)));
    }));
    onSheetClose = () => resolve(null);
    $('#pick-new', body).onclick = () => { closeSheet(); switchTab('resumes'); openResumeEditor(); };
    $('#pick-ok', body).onclick = () => { onSheetClose = null; closeSheet(); resolve(chosen); };
  });
}

const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso)) / 86400e3);
  return d <= 0 ? '今天' : d < 7 ? `${d} 天前` : `${Math.floor(d / 7)} 週前`;
};

// =============== 篩選條件 ===============
async function openFilter() {
  const p = { regions: [], schedules: [], minWage: 0, minDuration: 0, smartSort: false, ...state.prefs };
  const hasResume = state.resumes.length > 0;
  if (!p.resumeId && hasResume) p.resumeId = state.resumes[0].id;

  const chips = (key, items) => items.map((v) => `<button class="chip ${p[key].includes(v) ? 'on' : ''}" data-key="${key}" data-v="${esc(v)}">${esc(v)}</button>`).join('');

  const body = openSheet('篩選條件', `
    <div class="box green">
      <div style="display:flex;align-items:center;gap:10px">
        <b style="flex:1">✨ 根據我的履歷智慧排序</b>
        <label class="switch"><input type="checkbox" id="f-smart" ${p.smartSort && hasResume ? 'checked' : ''} ${hasResume ? '' : 'disabled'}><span></span></label>
      </div>
      <p class="small muted">先篩掉不符的硬條件，再用 AI 把最適合你的排前面。</p>
      ${hasResume ? `<select class="input small" id="f-resume">${state.resumes.map((r) => `<option value="${esc(r.id)}" ${r.id === p.resumeId ? 'selected' : ''}>依據履歷：${esc(r.title)}</option>`).join('')}</select>`
        : '<p class="small muted">尚未建立履歷時，此選項無法開啟，仍可依下列條件瀏覽。</p>'}
    </div>
    <div class="filter-group"><div class="label">地區</div><div class="chips">${chips('regions', REGIONS)}</div></div>
    <div class="filter-group"><div class="label">上班時段</div><div class="chips">${chips('schedules', SCHEDULES)}</div></div>
    <div class="filter-group"><div class="label">期望薪資 <em id="f-wage-text"></em></div><input type="range" id="f-wage" min="0" max="300" step="10" value="${p.minWage}"></div>
    <div class="filter-group"><div class="label">實習時長</div><div class="chips">${DURATIONS.map((d) => `<button class="chip ${p.minDuration === d.v ? 'on' : ''}" data-dur="${d.v}">${d.t}</button>`).join('')}</div></div>
    <button class="btn primary block" id="f-apply">查看符合職缺</button>`, '<span class="logo">⚙︎</span>');

  const refreshCount = async () => {
    $('#f-wage-text', body).textContent = p.minWage ? `時薪 ${p.minWage} 元以上` : '不限';
    const { count } = await api('/student/cards/count', { method: 'POST', body: p });
    $('#f-apply', body).textContent = `查看 ${count} 個符合職缺`;
  };

  $$('[data-key]', body).forEach((b) => (b.onclick = () => {
    const list = p[b.dataset.key];
    const i = list.indexOf(b.dataset.v);
    i >= 0 ? list.splice(i, 1) : list.push(b.dataset.v);
    b.classList.toggle('on');
    refreshCount();
  }));
  $$('[data-dur]', body).forEach((b) => (b.onclick = () => {
    p.minDuration = Number(b.dataset.dur);
    $$('[data-dur]', body).forEach((x) => x.classList.toggle('on', x === b));
    refreshCount();
  }));
  $('#f-wage', body).oninput = (e) => { p.minWage = Number(e.target.value); refreshCount(); };
  $('#f-smart', body).onchange = (e) => (p.smartSort = e.target.checked);
  if (hasResume) $('#f-resume', body).onchange = (e) => (p.resumeId = e.target.value);

  $('#f-apply', body).onclick = async () => {
    state.prefs = await api('/student/preferences', { method: 'PUT', body: p });
    closeSheet();
    switchTab('swipe');
  };
  refreshCount();
}

// =============== 履歷 ===============
function renderResumes() {
  const list = $('#resume-list');
  list.innerHTML = state.resumes.length
    ? state.resumes.map((r) => `
      <div class="item"><div class="item-row">
        <div class="grow"><h4>${esc(r.title)}</h4>
          <div class="muted small">${esc(r.school)} ${esc(r.department)}・${ago(r.updatedAt)}更新</div>
          <div class="chips" style="margin-top:8px">${(r.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
        </div>
        <button class="btn" data-edit="${esc(r.id)}">編輯</button>
      </div></div>`).join('')
    : '<div class="empty">還沒有履歷<br>上傳 PDF 或貼上文字，AI 10 秒幫你建好 ✨</div>';
  $$('[data-edit]', list).forEach((b) => (b.onclick = () => openResumeEditor(state.resumes.find((r) => r.id === b.dataset.edit))));
}

function openResumeEditor(resume) {
  const body = openSheet(resume ? '編輯履歷' : '智慧建立履歷', `
    ${resume ? '' : `
    <div class="box green">
      <b>✨ 上傳檔案，AI 自動填好</b>
      <p class="small muted">支援 PDF 或 .txt；也可以直接貼上履歷文字。</p>
      <input type="file" id="r-file" accept=".pdf,.txt" class="small">
      <textarea class="input" id="r-text" placeholder="或貼上履歷文字…" style="margin-top:8px"></textarea>
      <button class="btn primary" id="r-parse" style="margin-top:8px">AI 解析</button>
    </div>`}
    <form id="r-form"></form>`);
  const form = $('#r-form', body);
  const fill = (r = {}) => {
    form.innerHTML = `
      <label class="field"><span>履歷名稱（例如：數據分析履歷）</span><input class="input" name="title" required value="${esc(r.title)}"></label>
      <div class="grid2">
        <label class="field"><span>姓名</span><input class="input" name="name" value="${esc(r.name)}"></label>
        <label class="field"><span>學校</span><input class="input" name="school" value="${esc(r.school)}"></label>
        <label class="field"><span>科系</span><input class="input" name="department" value="${esc(r.department)}"></label>
        <label class="field"><span>學歷</span><select class="input" name="degree">${['大學', '碩士', '專科', '高中職', '博士'].map((d) => `<option ${r.degree === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field"><span>年級（大一=1，碩一=5）</span><input class="input" name="grade" type="number" min="1" max="8" value="${esc(r.grade)}"></label>
        <label class="field"><span>預計畢業</span><input class="input" name="graduation" placeholder="2028/06" value="${esc(r.graduation)}"></label>
      </div>
      <label class="field"><span>技能（用逗號分隔）</span><input class="input" name="skills" value="${esc((r.skills || []).join(', '))}"></label>
      <label class="field"><span>語言（例如：中文:母語, 英文:多益 750）</span><input class="input" name="languages" value="${esc((r.languages || []).map((l) => `${l.name}:${l.level || ''}`).join(', '))}"></label>
      <label class="field"><span>專案與經歷（一行一筆：名稱 | 年份 | 描述）</span><textarea class="input" name="experiences">${esc((r.experiences || []).map((e) => `${e.title} | ${e.year} | ${e.description}`).join('\n'))}</textarea></label>
      <label class="field"><span>作品集連結（一行一個）</span><textarea class="input" name="links" style="min-height:50px">${esc((r.links || []).join('\n'))}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Email</span><input class="input" name="email" value="${esc(r.contact?.email)}"></label>
        <label class="field"><span>電話</span><input class="input" name="phone" value="${esc(r.contact?.phone)}"></label>
      </div>
      <button class="btn primary block">儲存履歷</button>`;
  };
  fill(resume);

  if (!resume) {
    $('#r-parse', body).onclick = async (e) => {
      const fd = new FormData();
      const file = $('#r-file', body).files[0];
      if (file) fd.append('file', file);
      fd.append('text', $('#r-text', body).value);
      e.target.disabled = true;
      e.target.innerHTML = '<span class="spinner"></span> 解析中…';
      try {
        const parsed = await api('/student/resumes/parse', { method: 'POST', form: fd });
        fill({ title: `${parsed.department || ''}履歷`, ...parsed });
        toast(parsed.aiFailed ? 'AI 目前忙碌，已先用基本方式填入，請確認欄位' : 'AI 已自動填好，請確認或微調');
      } catch (err) {
        toast(err.message);
      }
      e.target.disabled = false;
      e.target.textContent = 'AI 解析';
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const data = {
      id: resume?.id,
      title: f.title, name: f.name, school: f.school, department: f.department, degree: f.degree,
      grade: Number(f.grade) || 0, graduation: f.graduation,
      skills: splitList(f.skills),
      languages: splitList(f.languages).map((s) => { const [name, level = ''] = s.split(/[:：]/); return { name: name.trim(), level: level.trim() }; }),
      experiences: f.experiences.split('\n').filter((l) => l.trim()).map((l) => { const [title, year = '', description = ''] = l.split('|').map((x) => x.trim()); return { title, year, description }; }),
      links: f.links.split('\n').map((x) => x.trim()).filter(Boolean),
      contact: { email: f.email, phone: f.phone },
    };
    await api('/student/resumes', { method: 'POST', body: data });
    state.resumes = await api('/student/resumes');
    closeSheet();
    renderResumes();
    toast('履歷已儲存');
  };
}

// =============== 收藏・投遞 ===============
async function loadSaved() {
  const rows = await api('/student/saved');
  const list = $('#saved-list');
  if (!rows.length) {
    list.innerHTML = '<div class="empty">還沒有收藏或投遞的職缺<br>上滑可以收藏，截止前會用 LINE 提醒你</div>';
    return;
  }
  rows.sort((a, b) => (a.job.deadline || '').localeCompare(b.job.deadline || ''));
  list.innerHTML = rows.map((r) => {
    const left = daysLeft(r.job.deadline);
    const status = r.action === 'apply'
      ? `<span class="tag ${r.status === 'rejected' ? 'bad' : ''}">${STATUS_TEXT[r.status] || '已投遞'}</span>`
      : `<span class="tag warn">🔔 已收藏${left !== null ? (left >= 0 ? `・剩 ${left} 天截止` : '・已截止') : ''}</span>`;
    return `
      <div class="item"><div class="item-row">
        <div class="avatar">${esc(r.job.companyName.slice(0, 2))}</div>
        <div class="grow"><h4>${esc(r.job.title)}</h4><div class="muted small">${esc(r.job.companyName)}・截止 ${mmdd(r.job.deadline)}</div><div style="margin-top:6px">${status}</div></div>
        ${r.action === 'save' && left >= 0 ? `<button class="btn primary" data-apply="${esc(r.id)}">投遞</button>` : ''}
      </div></div>`;
  }).join('');
  $$('[data-apply]', list).forEach((b) => (b.onclick = async () => {
    const row = rows.find((r) => r.id === b.dataset.apply);
    const resumeId = await pickResume(row.job);
    if (!resumeId) return;
    try {
      await api(`/student/saved/${row.id}/apply`, { method: 'POST', body: { resumeId } });
      toast('已投遞！');
      loadSaved();
    } catch (err) {
      toast(err.message);
    }
  }));
}

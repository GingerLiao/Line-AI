import {
  initAuth, api, $, $$, esc, toast, daysLeft, mmdd, splitList,
  gradeLabel, GRADE_OPTIONS, fitGrade, GRADUATED, aiWaiting, prepareUpload, confirmDialog, UPLOAD_ACCEPT,
} from '/shared/api.js';
import { CITIES, DISTRICTS, REMOTE, placeLabel, parseAddress } from '/shared/taiwan.js';

const state = { cards: [], resumes: [], prefs: {} };
const SCHEDULES = ['每週3天以內', '每週3天以上', '平日', '假日'];
const WAGES = [0, 200, 250, 300, 350, 400].map((v) => ({ v, t: v ? `${v} 以上` : '不限' }));
const DURATIONS = [{ v: 0, t: '不限' }, { v: 3, t: '3 個月以上' }, { v: 6, t: '6 個月以上' }];
const GRADES = [0, 1, 2, 3, 4, 5, 6];
const STATUS_TEXT = { pending: '已投遞・等待回覆', shortlisted: '企業考慮中', interview: '🎉 邀請面試', rejected: '未錄取' };
const TITLES = { swipe: '找實習', saved: '收藏・投遞', resumes: '我的履歷' };
let currentTab = 'swipe';
let onSheetClose = null; // 面板被關掉時要做的事

let openJobId = null; // 推播「查看詳情」：直接打開這個職缺


function startParams() {
  const p = new URLSearchParams(location.search);
  const liffState = p.get('liff.state'); // 例如 "?tab=saved&job=abc"
  if (liffState) new URLSearchParams(liffState.replace(/^[^?]*\?/, '')).forEach((v, k) => p.set(k, v));
  return p;
}

function switchTab(tab) {
  currentTab = tab;
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${tab}`));
  $('#page-title').textContent = TITLES[tab];
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
function closeSheet() {
  $('#sheet-root').innerHTML = '';
  const cb = onSheetClose;
  onSheetClose = null;
  cb?.();
}

const spinnerHtml = (text) => `<div class="empty"><span class="spinner dark"></span> ${text}</div>`;

// =============== 滑卡 ===============
async function loadCards() {
  $('#deck').innerHTML = '<div class="card skeleton"><div class="sk sk-head"></div><div class="sk"></div><div class="sk"></div><div class="sk short"></div></div>';
  $('#actions').classList.add('hidden');
  try {
    state.cards = await api('/student/cards');
  } catch (err) {
    state.cards = [];
    toast(err.message);
  }
  renderDeck();
}

function renderDeck() {
  const deck = $('#deck');
  const [top, next] = state.cards;
  $('#actions').classList.toggle('hidden', !top);
  if (!top) {
    deck.innerHTML = `<div class="empty">目前沒有符合條件的新職缺 🙌<br><br>
      <button class="btn primary hidden" id="empty-restore"></button>
      <button class="btn" id="empty-filter">調整篩選條件</button></div>`;
    $('#empty-filter').onclick = () => openFilter();
    showRestoreButton();
    return;
  }
  deck.innerHTML = (next ? cardHtml(next, 'behind') : '') + cardHtml(top, 'top');
  bindSwipe($('.card.top', deck), top);
}

// 滑完後：如果有跳過的職缺，提供「再看一次」
async function showRestoreButton() {
  const { count } = await api('/student/swipes/skipped').catch(() => ({ count: 0 }));
  const btn = $('#empty-restore');
  if (!btn || !count) return;
  btn.textContent = `↺ 再看一次跳過的 ${count} 個職缺`;
  btn.classList.remove('hidden');
  btn.onclick = async () => {
    btn.disabled = true;
    await api('/student/swipes/restore-skipped', { method: 'POST' });
    toast('已把跳過的職缺放回來');
    loadCards();
  };
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
    ${job.explore || job.reasons?.length ? `<div class="chips reasons">${job.explore ? '<span class="tag explore">🔍 換個口味</span>' : ''}${(job.reasons || []).map((r) => `<span class="tag ${r === '即將截止' ? 'bad' : ''}">${esc(r)}</span>`).join('')}</div>` : ''}
    <p class="desc">${esc(job.description)}</p>
    <div class="facts">
      <div>💲 時薪 ${esc(job.wage)} 元</div>
      <div>📍 ${esc(placeLabel(job.city ? job : parseAddress(job.location)) || job.location)}</div>
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
// extra：從「收藏・投遞」打開時，附上目前狀態與下方的按鈕
function openJobDetail(job, extra = {}) {
  const r = job.requirements || {};
  const left = daysLeft(job.deadline);
  const chips = (list, cls) => (list?.length ? list.map((s) => `<span class="chip ${cls}">${esc(s)}</span>`).join('') : '<span class="muted small">不限</span>');
  const remote = /遠端/.test(job.location || '');
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location || '')}`;
  const stages = job.interviewStages?.length ? job.interviewStages : [{ name: '面談', mode: '', detail: '企業會再通知面試方式' }];
  const MODE_ICON = { 線上: '💻', 實體: '🏢', 電話: '📞', 作業: '📝' };
  const body = openSheet('職缺詳情', `
    <div class="job-hero">
      <div class="detail-head">
        <div class="avatar">${esc(job.companyName.slice(0, 2))}</div>
        <div><h3>${esc(job.title)}</h3><div class="muted small">${esc(job.companyName)}</div></div>
      </div>
      <div class="chips">
        <span class="tag">${esc(job.category || '實習')}</span>
        ${job.headcount ? `<span class="tag">招募 ${esc(job.headcount)} 人</span>` : ''}
        ${job.status === 'closed' ? '<span class="tag bad">職缺已關閉</span>' : ''}
        ${left !== null && left >= 0 && left <= 7 ? `<span class="tag bad">剩 ${left} 天截止</span>` : ''}
      </div>
    </div>
    ${extra.statusHtml || ''}
    <div class="tiles four">
      <div class="tile"><div class="k">時薪</div><div class="v">${esc(job.wage)} 元</div></div>
      <div class="tile"><div class="k">每週</div><div class="v">${esc(job.daysPerWeek)} 天</div></div>
      <div class="tile"><div class="k">期間</div><div class="v">${esc(job.durationMonths)} 個月</div></div>
      <div class="tile"><div class="k">截止</div><div class="v">${mmdd(job.deadline)}</div></div>
    </div>
    ${job.companyIntro ? `<div class="section-title">🏢 關於公司</div><p class="para">${esc(job.companyIntro)}</p>` : ''}
    <div class="section-title">📝 你會做什麼</div>
    ${job.responsibilities?.length ? `<ul class="bullets">${job.responsibilities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="para">${esc(job.description || '—')}</p>`}
    <div class="section-title">🕒 上班資訊</div>
    <div class="box">
      <dl class="kv">
        <dt>上班時段</dt><dd>${esc(job.workHours || `每週 ${job.daysPerWeek} 天${job.weekend ? '（含假日）' : ''}`)}</dd>
        <dt>實習期間</dt><dd>${esc(job.durationMonths)} 個月</dd>
        ${job.startDate ? `<dt>到職時間</dt><dd>${esc(job.startDate)}</dd>` : ''}
        <dt>工作地點</dt><dd>${esc(job.location || '—')}${job.location && !remote ? ` <a class="map-link" href="${mapUrl}" target="_blank" rel="noopener">地圖 ↗</a>` : ''}</dd>
      </dl>
    </div>
    <div class="section-title">🎯 要求條件</div>
    <div class="box">
      <dl class="kv">
        <dt>學歷</dt><dd>${esc(r.degree || '不限')}</dd>
        <dt>科系</dt><dd>${esc(r.departments?.join('、') || '不限')}</dd>
        <dt>年級</dt><dd>${r.minGrade ? `${gradeLabel(r.minGrade)}以上` : '不限'}</dd>
        <dt>經歷</dt><dd>${esc(r.experience || '不拘')}</dd>
        <dt>語言</dt><dd>${esc(r.languages?.join('、') || '不限')}</dd>
      </dl>
      <div class="small muted" style="margin:12px 0 6px">必備技能</div><div class="chips">${chips(job.requiredSkills, 'req')}</div>
      <div class="small muted" style="margin:10px 0 6px">加分條件</div><div class="chips">${chips(job.bonusSkills, 'bonus')}</div>
    </div>
    ${job.benefits?.length ? `<div class="section-title">🎁 福利</div><div class="chips">${job.benefits.map((b) => `<span class="chip on">${esc(b)}</span>`).join('')}</div>` : ''}
    <div class="section-title">🧭 應徵流程</div>
    <ol class="timeline">
      <li><b>投遞履歷</b><span class="muted small">在實習 Swipe 右滑或按投遞</span></li>
      ${stages.map((st) => `<li><b>${esc(st.name)}</b>${st.mode ? ` <span class="mode">${MODE_ICON[st.mode] || ''} ${esc(st.mode)}</span>` : ''}${st.detail ? `<span class="muted small">${esc(st.detail)}</span>` : ''}</li>`).join('')}
      <li><b>錄取通知</b><span class="muted small">結果會用 LINE 通知你</span></li>
    </ol>
    ${job.applyMaterials?.length ? `<div class="section-title">📎 應備資料</div><div class="chips">${job.applyMaterials.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}
    <div style="margin-top:20px;display:grid;gap:10px">
      ${extra.actionHtml || ''}
      <button class="btn ${extra.actionHtml ? '' : 'primary'} block" id="do-check">✨ AI 職涯健檢：我適合這個職缺嗎？</button>
    </div>
  `);
  $('#do-check', body).onclick = () => openCareerCheck(job);
  return body;
}

async function openCareerCheck(job) {
  const resumeId = state.prefs.resumeId || state.resumes[0]?.id;
  if (!resumeId) {
    toast('請先建立一份履歷');
    closeSheet();
    return switchTab('resumes');
  }
  const body = openSheet('AI 職涯健診', `<div class="empty"><span class="spinner dark"></span> AI 分析中… <span id="ck-sec">0</span> 秒<br><span class="small">通常需要 10–20 秒</span></div>`, '<span class="logo">✓</span>');
  const start = Date.now();
  const timer = setInterval(() => { const el = $('#ck-sec', body); if (el) el.textContent = Math.floor((Date.now() - start) / 1000); }, 1000);
  try {
    const { evaluation: ev, advice, aiFailed } = await api('/student/career-check', { method: 'POST', body: { jobId: job.id, resumeId } });
    const ok = ev.checks.filter((c) => c.ok);
    const bad = ev.checks.filter((c) => !c.ok);
    const missing = [...ev.missingSkills, ...ev.bonusMissing];
    body.innerHTML = `
      ${aiFailed ? '<div class="notice">⚠️ AI 目前忙碌，以下是基本建議，稍後再試一次可以拿到 AI 的個人化建議。</div>' : ''}
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
  } finally {
    clearInterval(timer);
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

// =============== 篩選條件（第一次使用時也用這個面板設定）===============
async function openFilter({ welcome = false } = {}) {
  const p = { locations: [], schedules: [], categories: [], minWage: 0, minDuration: 0, smartSort: true, ...state.prefs };
  p.locations = [...p.locations];
  p.regions = []; // 舊版「六都」設定改用 locations
  const hasResume = state.resumes.length > 0;
  if (!p.resumeId && hasResume) p.resumeId = state.resumes[0].id;

  const multi = (key, items) => items.map((v) => `<button class="chip ${p[key].includes(v) ? 'on' : ''}" data-key="${key}" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  const single = (key, items) => items.map((o) => `<button class="chip ${p[key] === o.v ? 'on' : ''}" data-one="${key}" data-v="${o.v}">${o.t}</button>`).join('');

  const body = openSheet(welcome ? '歡迎使用實習 Swipe 👋' : '篩選條件', `
    ${welcome ? '<p class="muted" style="margin-top:0">先告訴我們你想找什麼樣的實習，之後隨時可以按右上角「篩選」修改。都不選代表「不限」。</p>' : ''}
    <div class="filter-group"><div class="label">職業類別 <em>可複選</em></div><div class="chips" id="f-cats"><span class="muted small">載入中…</span></div></div>
    <div class="filter-group"><div class="label">地區 <em>可加入多個</em></div>
      <div class="place-pick">
        <select class="input" id="f-city"><option value="">選擇縣市</option>${CITIES.map((c) => `<option>${c}</option>`).join('')}<option value="${REMOTE}">遠端工作</option></select>
        <select class="input" id="f-district" disabled><option value="">全部行政區</option></select>
        <button class="btn" id="f-add-place" disabled>＋ 加入</button>
      </div>
      <div class="chips" id="f-places"></div>
    </div>
    <div class="filter-group"><div class="label">期望時薪</div><div class="chips">${single('minWage', WAGES)}</div></div>
    <div class="filter-group"><div class="label">上班時段</div><div class="chips">${multi('schedules', SCHEDULES)}</div></div>
    <div class="filter-group"><div class="label">實習時長</div><div class="chips">${single('minDuration', DURATIONS)}</div></div>
    <div class="box green">
      <div style="display:flex;align-items:center;gap:10px">
        <b style="flex:1">✨ 根據我的履歷智慧排序</b>
        <label class="switch"><input type="checkbox" id="f-smart" ${p.smartSort && hasResume ? 'checked' : ''} ${hasResume ? '' : 'disabled'}><span></span></label>
      </div>
      <p class="small muted">把最適合你的職缺排在前面，也會參考你滑卡的喜好。</p>
      ${hasResume ? `<select class="input small" id="f-resume">${state.resumes.map((r) => `<option value="${esc(r.id)}" ${r.id === p.resumeId ? 'selected' : ''}>依據履歷：${esc(r.title)}</option>`).join('')}</select>`
        : '<p class="small muted" style="margin-bottom:0">建立履歷後就能開啟。</p>'}
    </div>
    <div class="sheet-foot">
      <button class="btn primary block" id="f-apply">查看符合職缺</button>
    </div>`, '<span class="logo">⚙︎</span>');

  // 關掉面板也算完成第一次設定，之後不再自動跳出
  if (welcome) onSheetClose = () => savePrefs({ ...state.prefs, onboarded: true });

  // 只採用最後一次查詢的結果，避免快速連點時數字跳來跳去
  let seq = 0;
  const refreshCount = async () => {
    const mine = ++seq;
    const btn = $('#f-apply', body);
    btn.innerHTML = '<span class="spinner"></span> 計算中…';
    try {
      const { count } = await api('/student/cards/count', { method: 'POST', body: p });
      if (mine === seq) btn.textContent = count ? `查看 ${count} 個符合職缺` : '沒有符合的新職缺，放寬一點條件吧';
    } catch {
      if (mine === seq) btn.textContent = '查看符合職缺';
    }
  };
  const bindChips = (root) => {
    $$('[data-key]', root).forEach((b) => (b.onclick = () => {
      const list = p[b.dataset.key];
      const i = list.indexOf(b.dataset.v);
      i >= 0 ? list.splice(i, 1) : list.push(b.dataset.v);
      b.classList.toggle('on');
      refreshCount();
    }));
  };
  bindChips(body);
  $$('[data-one]', body).forEach((b) => (b.onclick = () => {
    const key = b.dataset.one;
    p[key] = Number(b.dataset.v);
    $$(`[data-one="${key}"]`, body).forEach((x) => x.classList.toggle('on', x === b));
    refreshCount();
  }));
  // 地區：先選縣市，再選行政區（可不選＝整個縣市），按「加入」
  const renderPlaces = () => {
    $('#f-places', body).innerHTML = p.locations.length
      ? p.locations.map((l, i) => `<button class="chip on" data-place="${i}">${esc(placeLabel(l) || l.city)} ✕</button>`).join('')
      : '<span class="muted small">尚未選擇，代表不限地區</span>';
    $$('[data-place]', body).forEach((b) => (b.onclick = () => { p.locations.splice(Number(b.dataset.place), 1); renderPlaces(); refreshCount(); }));
  };
  const citySel = $('#f-city', body);
  const distSel = $('#f-district', body);
  citySel.onchange = () => {
    const list = DISTRICTS[citySel.value] || [];
    distSel.innerHTML = `<option value="">全部行政區</option>${list.map((d) => `<option>${d}</option>`).join('')}`;
    distSel.disabled = !list.length;
    $('#f-add-place', body).disabled = !citySel.value;
  };
  $('#f-add-place', body).onclick = () => {
    const loc = { city: citySel.value, district: distSel.value };
    // 已經選了整個縣市，就不用再加同縣市的行政區；選整個縣市時，移除該縣市的行政區
    if (p.locations.some((l) => l.city === loc.city && (!l.district || l.district === loc.district))) return toast('已經加入過了');
    if (!loc.district) p.locations = p.locations.filter((l) => l.city !== loc.city);
    p.locations.push(loc);
    citySel.value = '';
    citySel.onchange();
    renderPlaces();
    refreshCount();
  };
  renderPlaces();

  $('#f-smart', body).onchange = (e) => (p.smartSort = e.target.checked);
  if (hasResume) $('#f-resume', body).onchange = (e) => (p.resumeId = e.target.value);

  $('#f-apply', body).onclick = async (e) => {
    e.target.disabled = true;
    e.target.innerHTML = '<span class="spinner"></span> 套用中…';
    onSheetClose = null;
    try {
      await savePrefs({ ...p, onboarded: true });
      closeSheet();
      switchTab('swipe');
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.textContent = '查看符合職缺';
    }
  };

  // 職業類別：依目前有開放的職缺動態產生
  api('/student/categories').then((cats) => {
    const names = cats.map((c) => c.name);
    for (const c of p.categories) if (!names.includes(c)) names.push(c); // 已選但目前沒職缺的也保留
    $('#f-cats', body).innerHTML = names.length ? multi('categories', names) : '<span class="muted small">目前沒有職缺</span>';
    bindChips($('#f-cats', body));
  }).catch(() => ($('#f-cats', body).innerHTML = '<span class="muted small">載入失敗</span>'));
  refreshCount();
}

async function savePrefs(p) {
  state.prefs = await api('/student/preferences', { method: 'PUT', body: p });
}

// =============== 履歷 ===============
const DEGREES = ['大學', '碩士', '博士', '專科', '高中職'];
// 三種經歷區塊：每個都可以按「＋」新增好幾筆，每筆可附連結或檔案
const SECTIONS = [
  { key: 'awards', icon: '🏆', title: '競賽成績・證照', add: '新增競賽或證照',
    name: '例如：全國大專商業個案競賽、多益', role: '名次／成績', rolePh: '例如：第二名、850 分' },
  { key: 'projects', icon: '💡', title: '專案作品', add: '新增專案或作品',
    name: '例如：校園二手書交易 App', role: '擔任角色', rolePh: '例如：組長、前端開發' },
  { key: 'activities', icon: '🌱', title: '其他活動經歷', add: '新增社團、志工、工讀…',
    name: '例如：系學會、偏鄉教育志工、咖啡廳工讀', role: '職位', rolePh: '例如：公關長、店員' },
];

function renderResumes() {
  const list = $('#resume-list');
  list.innerHTML = state.resumes.length
    ? state.resumes.map((r) => {
      const counts = SECTIONS.map((sec) => [sec, (r[sec.key] || []).length]).filter(([, n]) => n);
      return `
      <div class="item"><div class="item-row">
        <div class="avatar">📄</div>
        <div class="grow"><h4>${esc(r.title)}</h4>
          <div class="muted small">${esc(r.school)} ${esc(r.department)}・${gradeLabel(r.grade, r.degree)}・${ago(r.updatedAt)}更新</div>
          <div class="chips" style="margin-top:8px">${(r.skills || []).slice(0, 6).map((s) => `<span class="tag">${esc(s)}</span>`).join('')}
            ${counts.map(([sec, n]) => `<span class="tag warn">${sec.icon} ${n}</span>`).join('')}</div>
        </div>
        <button class="btn" data-edit="${esc(r.id)}">編輯</button>
      </div></div>`;
    }).join('')
    : '<div class="empty">還沒有履歷<br>上傳 PDF、拍照或貼上文字，AI 幫你建好 ✨</div>';
  $$('[data-edit]', list).forEach((b) => (b.onclick = () => openResumeEditor(state.resumes.find((r) => r.id === b.dataset.edit))));
}

// 舊版履歷只有「experiences」，打開時放進「其他活動經歷」
function normalizeResume(r = {}) {
  const out = { ...r };
  for (const sec of SECTIONS) out[sec.key] = (r[sec.key] || []).map((x) => ({ ...x }));
  if (!out.awards.length && !out.projects.length && !out.activities.length && r.experiences?.length) {
    out.activities = r.experiences.map((e) => ({ title: e.title, role: '', date: e.year || '', description: e.description || '', link: '' }));
  }
  return out;
}

function openResumeEditor(resume) {
  const body = openSheet(resume ? '編輯履歷' : '智慧建立履歷', `
    ${resume ? '' : `
    <div class="box green">
      <b>✨ 上傳履歷，AI 自動填好</b>
      <p class="small muted">支援 PDF、文字檔，也可以直接拍照或從相簿選履歷照片；或在下面貼上履歷文字。</p>
      <div class="upload-pick">
        <label class="btn" for="r-file">📎 選擇檔案／照片</label>
        <input type="file" id="r-file" accept="${UPLOAD_ACCEPT}">
        <span class="file-name" id="r-file-name">尚未選擇</span>
      </div>
      <textarea class="input" id="r-text" placeholder="或貼上履歷文字…" style="margin-top:8px"></textarea>
      <button class="btn primary block" id="r-parse" style="margin-top:8px">✨ AI 解析</button>
    </div>`}
    <form id="r-form" novalidate></form>`);
  const form = $('#r-form', body);
  let draft = normalizeResume(resume);

  const itemHtml = (sec, item, i) => `
    <div class="entry" data-sec="${sec.key}" data-i="${i}">
      <button type="button" class="entry-del" data-del title="刪除這筆">✕</button>
      <label class="field"><span>名稱</span><input class="input" data-f="title" placeholder="${esc(sec.name)}" value="${esc(item.title)}"></label>
      <div class="grid2">
        <label class="field"><span>${esc(sec.role)}</span><input class="input" data-f="role" placeholder="${esc(sec.rolePh)}" value="${esc(item.role)}"></label>
        <label class="field"><span>時間</span><input class="input" data-f="date" placeholder="2025/03–2025/06" value="${esc(item.date)}"></label>
      </div>
      <label class="field"><span>說明（做了什麼、成果）</span><textarea class="input" data-f="description" style="min-height:60px">${esc(item.description)}</textarea></label>
      <label class="field"><span>連結（選填）</span><input class="input" data-f="link" type="url" placeholder="https://" value="${esc(item.link)}"></label>
      <div class="entry-file">
        ${item.file ? `<a class="file-chip" href="${esc(item.file.url || '#')}" target="_blank" rel="noopener">📄 ${esc(item.file.name)}</a><button type="button" class="link-btn" data-unfile>移除檔案</button>`
          : `<label class="link-btn">📎 附上檔案（PDF 或圖片，5MB 內）<input type="file" data-file accept=".pdf,image/*" hidden></label>`}
      </div>
    </div>`;

  // 先把畫面上輸入到一半的內容收回 draft，重畫時才不會不見
  const collect = () => {
    $$('.entry', form).forEach((el) => {
      const item = draft[el.dataset.sec][Number(el.dataset.i)];
      $$('[data-f]', el).forEach((input) => (item[input.dataset.f] = input.value.trim()));
    });
  };
  const renderSection = (key) => {
    const sec = SECTIONS.find((x) => x.key === key);
    const list = $(`[data-list="${key}"]`, form);
    list.innerHTML = draft[key].map((item, i) => itemHtml(sec, item, i)).join('') || '<p class="muted small empty-sec">還沒有資料，按下方「＋」新增</p>';
    $$('.entry', list).forEach((el) => {
      const i = Number(el.dataset.i);
      $('[data-del]', el).onclick = () => { collect(); draft[key].splice(i, 1); renderSection(key); };
      const unfile = $('[data-unfile]', el);
      if (unfile) unfile.onclick = () => { collect(); draft[key][i].file = null; renderSection(key); };
      const fileInput = $('[data-file]', el);
      if (fileInput) fileInput.onchange = async () => {
        const raw = fileInput.files[0];
        if (!raw) return;
        collect();
        const label = fileInput.parentElement;
        label.innerHTML = '<span class="spinner dark"></span> 上傳中…';
        try {
          const fd = new FormData();
          fd.append('file', await prepareUpload(raw), raw.name);
          draft[key][i].file = await api('/student/files', { method: 'POST', form: fd });
        } catch (err) {
          toast(err.message.includes('large') || err.message.includes('413') ? '檔案太大，請小於 5MB' : err.message);
        }
        renderSection(key);
      };
    });
  };

  const fill = (r = {}) => {
    draft = normalizeResume(r);
    const degree = DEGREES.includes(r.degree) ? r.degree : '大學';
    form.innerHTML = `
      <label class="field"><span>履歷名稱（例如：數據分析履歷）</span><input class="input" name="title" required value="${esc(r.title)}"></label>
      <div class="form-section">
        <div class="section-title">👤 基本資料</div>
        <div class="grid2">
          <label class="field"><span>姓名</span><input class="input" name="name" value="${esc(r.name)}"></label>
          <label class="field"><span>學校</span><input class="input" name="school" value="${esc(r.school)}"></label>
          <label class="field"><span>科系</span><input class="input" name="department" value="${esc(r.department)}"></label>
          <label class="field"><span>學歷（目前就讀）</span><select class="input" name="degree">${DEGREES.map((d) => `<option ${degree === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="field"><span>年級</span><select class="input" name="grade"></select></label>
          <label class="field"><span>預計畢業</span><input class="input" name="graduation" placeholder="2028/06" value="${esc(r.graduation)}"></label>
        </div>
        <label class="field"><span>GPA（選填）</span><input class="input" name="gpa" placeholder="例如 3.8 / 4.3" value="${esc(r.gpa)}"></label>
      </div>
      <div class="form-section">
        <div class="section-title">✍️ 自我介紹</div>
        <label class="field"><textarea class="input" name="about" placeholder="個性、興趣、想在實習中學到什麼（100 字左右）">${esc(r.about)}</textarea></label>
      </div>
      <div class="form-section">
        <div class="section-title">🛠 技能與語言</div>
        <label class="field"><span>技能（用逗號分隔）</span><input class="input" name="skills" placeholder="Excel, Python, Canva" value="${esc((r.skills || []).join(', '))}"></label>
        <label class="field"><span>語言（例如：中文:母語, 英文:多益 750）</span><input class="input" name="languages" value="${esc((r.languages || []).map((l) => `${l.name}:${l.level || ''}`).join(', '))}"></label>
      </div>
      ${SECTIONS.map((sec) => `
      <div class="form-section">
        <div class="section-title">${sec.icon} ${sec.title}</div>
        <div data-list="${sec.key}"></div>
        <button type="button" class="btn add-entry" data-add="${sec.key}">＋ ${sec.add}</button>
      </div>`).join('')}
      <div class="form-section">
        <div class="section-title">✉️ 聯絡方式</div>
        <div class="grid2">
          <label class="field"><span>Email</span><input class="input" name="email" type="email" value="${esc(r.contact?.email)}"></label>
          <label class="field"><span>電話</span><input class="input" name="phone" type="tel" value="${esc(r.contact?.phone)}"></label>
        </div>
        <label class="field"><span>個人作品集／GitHub（選填，一行一個）</span><textarea class="input" name="links" style="min-height:50px">${esc((r.links || []).join('\n'))}</textarea></label>
      </div>
      <button class="btn primary block" id="r-save">儲存履歷</button>
      ${resume ? '<button type="button" class="btn block danger-outline" id="r-delete" style="margin-top:10px">🗑 刪除這份履歷</button>' : ''}`;

    // 年級選項跟著學歷變（大學：大一～大四；碩士：碩一～碩三…）
    const gradeSel = form.grade;
    const renderGrades = (deg, current) => {
      const n = fitGrade(current, deg);
      gradeSel.innerHTML = `<option value="0">請選擇</option>${GRADE_OPTIONS[deg].map((g) => `<option value="${g}" ${g === n ? 'selected' : ''}>${gradeLabel(g, deg)}</option>`).join('')}<option value="${GRADUATED}" ${n === GRADUATED ? 'selected' : ''}>已畢業</option>`;
    };
    renderGrades(degree, r.grade);
    form.degree.onchange = () => renderGrades(form.degree.value, Number(gradeSel.value));

    SECTIONS.forEach((sec) => renderSection(sec.key));
    $$('[data-add]', form).forEach((b) => (b.onclick = () => {
      collect();
      draft[b.dataset.add].push({ title: '', role: '', date: '', description: '', link: '', file: null });
      renderSection(b.dataset.add);
      $$(`[data-list="${b.dataset.add}"] .entry`, form).pop()?.querySelector('input')?.focus();
    }));
  };
  fill(resume);

  if (!resume) {
    $('#r-file', body).onchange = (e) => ($('#r-file-name', body).textContent = e.target.files[0]?.name || '尚未選擇');
    $('#r-parse', body).onclick = async (e) => {
      const fd = new FormData();
      const file = await prepareUpload($('#r-file', body).files[0]);
      if (file) fd.append('file', file);
      fd.append('text', $('#r-text', body).value);
      const stop = aiWaiting(e.currentTarget, 'AI 解析中');
      try {
        const parsed = await api('/student/resumes/parse', { method: 'POST', form: fd });
        fill({ title: `${parsed.department || ''}履歷`, ...parsed });
        toast(parsed.aiFailed ? 'AI 目前忙碌，已先用基本方式填入，請確認欄位' : 'AI 已自動填好，請確認或微調');
      } catch (err) {
        toast(err.message);
      }
      stop();
    };
  }

  // 刪除履歷（已投遞的企業仍會保留投遞當下的副本）
  form.addEventListener('click', async (e) => {
    if (e.target.id !== 'r-delete') return;
    const yes = await confirmDialog({
      title: `刪除「${resume.title}」？`,
      message: '刪除後無法復原。已經用這份履歷投遞的企業，仍然看得到投遞當下的內容。',
      ok: '刪除', danger: true,
    });
    if (!yes) return;
    try {
      await api(`/student/resumes/${resume.id}`, { method: 'DELETE' });
      state.resumes = state.resumes.filter((r) => r.id !== resume.id);
      if (state.prefs.resumeId === resume.id) state.prefs.resumeId = null;
      closeSheet();
      renderResumes();
      toast('履歷已刪除');
    } catch (err) {
      toast(err.message);
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.title.value.trim()) { form.title.focus(); return toast('請填寫履歷名稱'); }
    collect();
    const f = Object.fromEntries(new FormData(form));
    const keep = (item) => item.title || item.description || item.link || item.file;
    const data = {
      id: resume?.id,
      title: f.title, name: f.name, school: f.school, department: f.department, degree: f.degree,
      grade: Number(f.grade) || 0, graduation: f.graduation, gpa: f.gpa, about: f.about,
      skills: splitList(f.skills),
      languages: splitList(f.languages).map((s) => { const [name, level = ''] = s.split(/[:：]/); return { name: name.trim(), level: level.trim() }; }),
      ...Object.fromEntries(SECTIONS.map((sec) => [sec.key, draft[sec.key].filter(keep)])),
      links: f.links.split('\n').map((x) => x.trim()).filter(Boolean),
      contact: { email: f.email, phone: f.phone, lineId: resume?.contact?.lineId || '' },
      experiences: [], // 舊欄位，已搬到上面三個區塊
    };
    const btn = $('#r-save', form);
    btn.disabled = true;
    try {
      await api('/student/resumes', { method: 'POST', body: data });
      state.resumes = await api('/student/resumes');
      closeSheet();
      renderResumes();
      toast('履歷已儲存');
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
}

// =============== 收藏・投遞 ===============
async function loadSaved() {
  const list = $('#saved-list');
  list.innerHTML = spinnerHtml('載入中…');
  let rows;
  try {
    rows = await api('/student/saved');
  } catch (err) {
    list.innerHTML = `<div class="empty">載入失敗：${esc(err.message)}<br><br><button class="btn" id="saved-retry">重新載入</button></div>`;
    $('#saved-retry').onclick = loadSaved;
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<div class="empty">還沒有收藏或投遞的職缺<br>上滑可以收藏，截止前會用 LINE 提醒你</div>';
    return;
  }
  rows.sort((a, b) => (a.job.deadline || '').localeCompare(b.job.deadline || ''));
  const canApply = (r) => r.action === 'save' && r.job.status !== 'closed' && daysLeft(r.job.deadline) >= 0;
  const statusTag = (r) => {
    const left = daysLeft(r.job.deadline);
    if (r.action === 'apply') return `<span class="tag ${r.status === 'rejected' ? 'bad' : ''}">${STATUS_TEXT[r.status] || '已投遞'}</span>`;
    if (r.job.status === 'closed') return '<span class="tag bad">職缺已關閉</span>';
    return `<span class="tag warn">🔔 已收藏${left !== null ? (left >= 0 ? `・剩 ${left} 天截止` : '・已截止') : ''}</span>`;
  };
  const interviewHtml = (i) => (i ? `
    <div class="interview">
      <b>🎉 面試資訊</b>
      <div>📅 ${esc(i.date)} ${esc(i.time)}${i.mode ? `・${esc(i.mode)}` : ''}</div>
      ${i.place ? `<div>📍 ${esc(i.place)}</div>` : ''}
      ${i.contact ? `<div>☎️ ${esc(i.contact)}</div>` : ''}
      ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}
    </div>` : '');

  // 收藏的職缺可以像 iPhone 一樣往左滑，露出右邊的「刪除」（取消收藏）
  list.innerHTML = rows.map((r) => {
    const item = `
      <div class="item tappable ${r.action === 'save' ? 'swipe-content' : ''}" data-open="${esc(r.id)}"><div class="item-row">
        <div class="avatar">${esc(r.job.companyName.slice(0, 2))}</div>
        <div class="grow"><h4>${esc(r.job.title)}</h4><div class="muted small">${esc(r.job.companyName)}・截止 ${mmdd(r.job.deadline)}</div><div style="margin-top:6px">${statusTag(r)}</div></div>
        ${canApply(r) ? `<button class="btn primary" data-apply="${esc(r.id)}">投遞</button>` : '<span class="chev">›</span>'}
      </div>${r.status === 'interview' ? interviewHtml(r.interview) : ''}</div>`;
    return r.action === 'save'
      ? `<div class="swipe-row"><button class="swipe-del" data-unsave="${esc(r.id)}" tabindex="-1">🗑<span>刪除</span></button>${item}</div>`
      : item;
  }).join('');
  $$('.swipe-content', list).forEach(bindSwipeToDelete);
  if (rows.some((r) => r.action === 'save') && !safeHint()) toast('小技巧：收藏的職缺往左滑可以刪除');

  const applyFromSaved = async (row) => {
    const resumeId = await pickResume(row.job);
    if (!resumeId) return;
    try {
      await api(`/student/saved/${row.id}/apply`, { method: 'POST', body: { resumeId } });
      toast('已投遞！');
      loadSaved();
    } catch (err) {
      toast(err.message);
    }
  };
  // 取消收藏：職缺會回到滑卡的卡池
  const unsave = async (row) => {
    try {
      await api(`/student/saved/${row.id}`, { method: 'DELETE' });
      toast('已取消收藏，之後滑卡還會再看到這個職缺');
      loadSaved();
    } catch (err) {
      toast(err.message);
    }
  };
  $$('[data-unsave]', list).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const rowEl = b.closest('.swipe-row');
    rowEl.classList.add('removing'); // 先播放收合動畫
    setTimeout(() => unsave(rows.find((r) => r.id === b.dataset.unsave)), 220);
  }));
  $$('[data-apply]', list).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    applyFromSaved(rows.find((r) => r.id === b.dataset.apply));
  }));
  // 點整張卡片：打開職缺詳情
  $$('[data-open]', list).forEach((el) => (el.onclick = () => {
    if (el.dataset.swiped) return; // 剛滑開／滑回時不要打開詳情
    const row = rows.find((r) => r.id === el.dataset.open);
    const body = openJobDetail(row.job, {
      statusHtml: `<div style="margin-bottom:12px">${statusTag(row)}</div>${row.status === 'interview' ? interviewHtml(row.interview) : ''}`,
      actionHtml: (canApply(row) ? '<button class="btn primary block" id="detail-apply">➤ 投遞這個職缺</button>' : '')
        + (row.action === 'save' ? '<button class="btn block" id="detail-unsave">🔕 取消收藏</button>' : ''),
    });
    const btn = $('#detail-apply', body);
    if (btn) btn.onclick = () => { closeSheet(); applyFromSaved(row); };
    const un = $('#detail-unsave', body);
    if (un) un.onclick = () => { closeSheet(); unsave(row); };
  }));
  // 從 LINE 推播（例如面試邀請）點進來：自動打開那個職缺
  if (openJobId) {
    const row = rows.find((r) => r.job.id === openJobId || r.jobId === openJobId);
    openJobId = null;
    if (row) $(`[data-open="${row.id}"]`, list)?.click();
  }
}

// =============== 清單左滑刪除（像 iPhone）===============
const DEL_W = 88; // 刪除按鈕寬度
let openSwipe = null; // 目前滑開的那一列，同時只開一列

function closeSwipe(el = openSwipe) {
  if (!el) return;
  el.style.transition = 'transform .2s ease';
  el.style.transform = '';
  if (openSwipe === el) openSwipe = null;
}

function bindSwipeToDelete(el) {
  let startX = 0, startY = 0, base = 0, dx = 0, mode = null; // mode：null 還沒判斷、'x' 橫滑、'y' 捲動
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (openSwipe && openSwipe !== el) closeSwipe();
    startX = e.clientX; startY = e.clientY; dx = 0; mode = null;
    base = openSwipe === el ? -DEL_W : 0;
    el.style.transition = 'none';
  });
  el.addEventListener('pointermove', (e) => {
    if (!startX) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!mode && Math.abs(mx) + Math.abs(my) > 8) mode = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (mode !== 'x') return;
    el.setPointerCapture?.(e.pointerId);
    dx = mx;
    const x = Math.min(0, base + dx); // 只能往左
    el.style.transform = `translateX(${x < -DEL_W ? -DEL_W + (x + DEL_W) * 0.35 : x}px)`; // 超過按鈕寬度時有阻力
  });
  const end = () => {
    if (!startX) return;
    startX = 0;
    if (mode !== 'x') { el.style.transition = ''; return; }
    el.dataset.swiped = '1';
    setTimeout(() => delete el.dataset.swiped, 50);
    el.style.transition = 'transform .2s ease';
    if (base + dx < -DEL_W / 2) {
      el.style.transform = `translateX(-${DEL_W}px)`;
      openSwipe = el;
    } else closeSwipe(el);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
// 點清單其他地方就把滑開的列收回去
document.addEventListener('pointerdown', (e) => {
  if (openSwipe && !openSwipe.parentElement.contains(e.target)) closeSwipe();
});

// 「往左滑可以刪除」的提示只顯示一次
function safeHint() {
  try {
    if (localStorage.getItem('hint-swipe-delete')) return true;
    localStorage.setItem('hint-swipe-delete', '1');
  } catch {}
  return false;
}

// =============== 啟動（放在檔案最後，上面的函式與常數都已經定義好）===============
await initAuth('student');
[state.resumes, state.prefs] = await Promise.all([api('/student/resumes'), api('/student/preferences')]);

$$('.tabbar button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
$('#open-filter').onclick = () => openFilter();
$('#new-resume').onclick = () => openResumeEditor();
$$('#actions [data-act]').forEach((b) => (b.onclick = () => decide(b.dataset.act)));

// 網址參數要等 LIFF 登入後再讀：從 LINE 推播點進來時，參數會先放在 liff.state 裡
const params = startParams();
currentTab = params.get('tab') || 'swipe';
openJobId = params.get('job');

switchTab(currentTab);
// 第一次使用：先設定想找的實習條件，再開始滑卡
if (currentTab === 'swipe' && !state.prefs.onboarded) openFilter({ welcome: true });

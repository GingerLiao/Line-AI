import {
  initAuth, api, profile, logout, isFriend, $, $$, esc, toast, splitList,
  gradeLabel, aiWaiting, confirmDialog, multiUpload,
} from '/shared/api.js';
import { parseAddress, placeLabel } from '/shared/taiwan.js';
import { slotEditor, slotText } from '/company/slots.js';
import { showSchedule } from '/company/schedule.js';

const CATEGORIES = ['數據分析', '軟體開發', '設計', '行銷企劃', '業務', '財務會計', '人力資源', '行政', '法務', '研究', '產品企劃', '影音製作', '媒體', '電商', '教育', '遊戲企劃', '餐飲'];
const STATUS = {
  pending: { text: '待處理', cls: '' },
  shortlisted: { text: '考慮中', cls: 'warn' },
  interview: { text: '已邀請面試', cls: 'ok' },
  rejected: { text: '不適合', cls: 'bad' },
};
const FINAL = ['interview', 'rejected'];
const STAGE_MODES = ['線上', '實體', '電話', '作業'];
const DEFAULT_BOOKING = { minutes: 30, capacity: 1, replyDays: 7, startHour: 9, endHour: 18 };

let jobs = [];
let currentJobId = null;
const summaries = {}; // AI 摘要快取：applicationId → 文字

const { demo, cfg } = await initAuth('company');
$('#me').textContent = (profile.displayName || '企').slice(0, 1);
$('#logout').onclick = () => logout('company');

// 做法 A：企業也要加官方帳號好友才收得到應徵通知，沒加就顯示提醒
if (!demo && cfg.oaBasicId && (await isFriend()) === false) {
  $('#friend-link').href = `https://line.me/R/ti/p/${encodeURIComponent(cfg.oaBasicId)}`;
  $('#friend-banner').classList.remove('hidden');
}
$('#new-job').onclick = () => showJobForm();
$('#open-schedule').onclick = () => openSchedule();
await loadJobs();

const startJob = new URLSearchParams(location.search).get('job');
if (startJob && jobs.some((j) => j.id === startJob)) showJob(startJob);
else if (jobs.length) showJob(jobs[0].id);
else showJobForm();

// 面試行程總表
function openSchedule() {
  currentJobId = null;
  $$('.job-link').forEach((b) => b.classList.remove('on'));
  $('#open-schedule').classList.add('on');
  setCrumb('面試行程');
  showSchedule($('#main'), { openApp: (jobId, appId) => showJob(jobId, appId) });
}

function setCrumb(text) {
  $('#crumb').textContent = text;
}

async function loadJobs() {
  jobs = await api('/company/jobs');
  $('#job-list').innerHTML = jobs.length
    ? jobs.map((j) => `
      <button class="job-link ${j.id === currentJobId ? 'on' : ''} ${j.status === 'closed' ? 'closed' : ''}" data-job="${esc(j.id)}">
        <b>${esc(j.title)}</b><span>${j.status === 'closed' ? '已關閉・' : ''}${j.applicantCount} 位應徵者・截止 ${esc(j.deadline || '—')}</span>
      </button>`).join('')
    : '<p class="muted small">還沒有職缺</p>';
  $$('[data-job]').forEach((b) => (b.onclick = () => showJob(b.dataset.job)));
}

// =============== 刊登／編輯職缺（AI 建檔與手動填寫在同一頁）===============
function showJobForm(job) {
  $('#open-schedule')?.classList.remove('on');
  currentJobId = job?.id || null;
  $$('.job-link').forEach((b) => b.classList.toggle('on', b.dataset.job === currentJobId));
  setCrumb(job ? `編輯：${job.title}` : '刊登職缺');
  const main = $('#main');
  main.innerHTML = `
    ${job ? `<button class="btn ghost back" id="back">← 返回「${esc(job.title)}」</button>` : ''}
    <div class="panel">
      <h2 class="panel-title">${job ? '編輯職缺' : '刊登新職缺'}</h2>
      <div class="ai-fill">
        <div class="ai-fill-head"><b>✨ 有現成的職缺說明？</b></div>
        <div id="j-files"></div>
        <textarea class="input" id="j-text" placeholder="或直接貼上職缺說明文字（也可以在這裡貼上截圖）…" style="margin-top:8px;min-height:64px"></textarea>
        <div style="margin-top:10px"><button class="btn primary" id="j-parse">✨ AI 自動填入欄位</button></div>
      </div>
      <div class="ai-note hidden" id="ai-note"></div>
      <form id="job-form"></form>
    </div>`;

  if (job) $('#back').onclick = () => showJob(job.id);
  const picker = multiUpload($('#j-files'), { pasteTarget: $('#j-text') });
  $('#j-parse').onclick = async (e) => {
    const fd = new FormData();
    picker.files().forEach((f) => fd.append('files', f, f.name));
    fd.append('text', $('#j-text').value);
    const stop = aiWaiting(e.currentTarget, 'AI 解析中', picker.files().length > 2 ? '檔案較多，約 20–60 秒' : '約 10–30 秒');
    try {
      const { skipped, ...parsed } = await api('/company/jobs/parse', { method: 'POST', form: fd });
      fillJobForm({ ...parsed, id: job?.id });
      $('#ai-note').textContent = (parsed.aiFailed
        ? '⚠️ AI 目前忙碌，已先用基本方式填入，請仔細確認欄位（或稍後再按一次）'
        : '⚡ AI 已自動填好，請確認或微調後送出')
        + (skipped?.length ? `　（讀不到：${skipped.join('、')}，請改存成 PDF 或截圖）` : '');
      $('#ai-note').classList.remove('hidden');
      $('#job-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message);
    }
    stop();
  };
  fillJobForm(job || { companyName: jobs[0]?.companyName });
}

function fillJobForm(j = {}) {
  const r = j.requirements || {};
  const form = $('#job-form');
  form.innerHTML = `
    <div class="section-title">基本資訊</div>
    <label class="field"><span>企業名稱</span><input class="input" name="companyName" required value="${esc(j.companyName)}"></label>
    <div class="grid2">
      <label class="field"><span>職缺名稱</span><input class="input" name="title" required placeholder="例如：數據分析實習生" value="${esc(j.title)}"></label>
      <label class="field"><span>職業類別（學生用來篩選）</span><input class="input" name="category" list="cat-list" placeholder="選擇或自行輸入" value="${esc(j.category)}">
        <datalist id="cat-list">${CATEGORIES.map((c) => `<option value="${c}">`).join('')}</datalist></label>
    </div>
    <label class="field"><span>公司簡介（一到兩句，讓學生認識你們）</span><textarea class="input" name="companyIntro" style="min-height:60px" placeholder="例如：專做零售業數據分析的新創，團隊 35 人。">${esc(j.companyIntro)}</textarea></label>
    <label class="field"><span>職缺摘要（顯示在滑卡卡片上，一到兩句）</span><textarea class="input" name="description" style="min-height:60px">${esc(j.description)}</textarea></label>
    <label class="field"><span>詳細工作內容（一行一項）</span><textarea class="input" name="responsibilities" placeholder="每週整理營運報表\n用 SQL 撈資料、清理資料">${esc((j.responsibilities || []).join('\n'))}</textarea></label>
    <div class="section-title">工作條件</div>
    <div class="grid4">
      <label class="field"><span>時薪（元）</span><input class="input" name="wage" type="number" min="0" placeholder="基本工資 196" value="${esc(j.wage)}"></label>
      <label class="field"><span>每週天數</span><input class="input" name="daysPerWeek" type="number" min="1" max="7" value="${esc(j.daysPerWeek)}"></label>
      <label class="field"><span>實習時長（月）</span><input class="input" name="durationMonths" type="number" min="0" value="${esc(j.durationMonths)}"></label>
      <label class="field"><span>報名截止日</span><input class="input" name="deadline" type="date" value="${esc(j.deadline)}"></label>
    </div>
    <div class="grid4">
      <label class="field" style="grid-column: span 3"><span>工作地址（遠端工作請填「遠端」）</span><input class="input" name="location" placeholder="例如：台北市南港區經貿二路 66 號" value="${esc(j.location)}">
        <small class="place-hint" id="place-hint"></small></label>
      <label class="field"><span>假日上班</span><select class="input" name="weekend"><option value="">否</option><option value="1" ${j.weekend ? 'selected' : ''}>是</option></select></label>
    </div>
    <div class="grid4">
      <label class="field" style="grid-column: span 2"><span>上班時段</span><input class="input" name="workHours" placeholder="例如：週一至週五擇三天 09:30–18:30" value="${esc(j.workHours)}"></label>
      <label class="field"><span>招募人數</span><input class="input" name="headcount" type="number" min="0" value="${esc(j.headcount || '')}"></label>
      <label class="field"><span>到職時間</span><input class="input" name="startDate" placeholder="例如：錄取後兩週內" value="${esc(j.startDate)}"></label>
    </div>
    <div class="section-title">要求條件</div>
    <div class="grid4">
      <label class="field"><span>學歷</span><input class="input" name="degree" placeholder="大學以上" value="${esc(r.degree)}"></label>
      <label class="field"><span>科系（空白＝不限）</span><input class="input" name="departments" value="${esc((r.departments || []).join(', '))}"></label>
      <label class="field"><span>最低年級</span><select class="input" name="minGrade">${[0, 1, 2, 3, 4, 5].map((g) => `<option value="${g}" ${Number(r.minGrade || 0) === g ? 'selected' : ''}>${g ? `${gradeLabel(g)}以上` : '不限'}</option>`).join('')}</select></label>
      <label class="field"><span>語言</span><input class="input" name="languages" value="${esc((r.languages || ['中文']).join(', '))}"></label>
    </div>
    <label class="field"><span>必備技能（逗號分隔）</span><input class="input" name="requiredSkills" value="${esc((j.requiredSkills || []).join(', '))}"></label>
    <label class="field"><span>加分條件（逗號分隔）</span><input class="input" name="bonusSkills" value="${esc((j.bonusSkills || []).join(', '))}"></label>
    <label class="field"><span>公司福利（逗號分隔）</span><input class="input" name="benefits" value="${esc((j.benefits || []).join(', '))}"></label>
    <div class="section-title">應徵流程</div>
    <div id="stages"></div>
    <button type="button" class="btn add-stage" id="add-stage">＋ 新增面試階段</button>
    <label class="field"><span>應備資料（逗號分隔）</span><input class="input" name="applyMaterials" placeholder="履歷, 作品集, 成績單" value="${esc((j.applyMaterials || ['履歷']).join(', '))}"></label>
    <div class="section-title">🗓 面試預約時段（選填）</div>
    <p class="muted small" style="margin-top:-4px">開放時段後，邀請面試時可以讓同學自己選時間，不用再打電話或寄信約。之後也可以隨時在職缺頁修改。</p>
    <div id="slot-editor"><div class="muted small"><span class="spinner dark"></span> 載入時段…</div></div>
    <div class="form-foot">
      ${j.id ? '<button type="button" class="btn" id="cancel-edit">取消</button>' : ''}
      <button class="btn primary">${j.id ? '✓ 儲存變更' : '✓ 確認送出，開始媒合'}</button>
    </div>`;

  // 地址裡就有縣市與行政區，即時顯示系統辨識的結果（學生用地區篩選時就是看這個）
  const showPlace = () => {
    const place = parseAddress(form.location.value);
    const hint = $('#place-hint');
    hint.className = `place-hint ${place.city ? 'ok' : 'warn'}`;
    hint.textContent = !form.location.value.trim() ? ''
      : place.city ? `✓ 學生篩選地區：${placeLabel(place)}${place.district || place.city === '遠端' ? '' : '（加上行政區會更精準）'}`
        : '⚠️ 認不出縣市，請寫成「台北市大安區…」，學生才能用地區篩選到';
  };
  form.location.oninput = showPlace;
  showPlace();

  // 面試流程：可以有好幾個階段（書面審查 → 一面 → 二面…）
  let stages = (j.interviewStages || []).map((x) => ({ ...x }));
  if (!stages.length) stages = [{ name: '面談', mode: '實體', detail: '' }];
  const collectStages = () => $$('.stage', form).forEach((el, i) => $$('[data-k]', el).forEach((inp) => (stages[i][inp.dataset.k] = inp.value.trim())));
  const renderStages = () => {
    $('#stages').innerHTML = stages.map((st, i) => `
      <div class="stage">
        <span class="stage-no">${i + 1}</span>
        <input class="input" data-k="name" placeholder="階段名稱，例如：書面審查、一面" value="${esc(st.name)}">
        <select class="input" data-k="mode">${STAGE_MODES.map((m) => `<option ${st.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <input class="input" data-k="detail" placeholder="說明，例如：人資視訊 20 分鐘" value="${esc(st.detail)}">
        <button type="button" class="icon-btn" data-rm="${i}" title="刪除">✕</button>
      </div>`).join('');
    $$('[data-rm]', form).forEach((b) => (b.onclick = () => { collectStages(); stages.splice(Number(b.dataset.rm), 1); renderStages(); }));
  };
  renderStages();

  // 面試時段：新職缺從空白開始；編輯時載入已設定的時段
  let slots = null;
  (j.id ? api(`/company/jobs/${j.id}/slots`) : Promise.resolve({ settings: { ...DEFAULT_BOOKING, ...j.interviewBooking }, slots: [] }))
    .then((data) => { slots = slotEditor($('#slot-editor'), data); })
    .catch(() => { $('#slot-editor').innerHTML = '<div class="muted small">時段載入失敗，可以稍後在職缺頁設定。</div>'; });
  $('#add-stage').onclick = () => { collectStages(); stages.push({ name: '', mode: '實體', detail: '' }); renderStages(); };
  if (j.id) $('#cancel-edit').onclick = () => showJob(j.id);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    collectStages();
    const btn = $('.form-foot .primary', form);
    btn.disabled = true;
    try {
      const saved = await api('/company/jobs', {
        method: 'POST',
        body: {
          id: j.id,
          companyName: f.companyName, title: f.title, category: f.category, description: f.description,
          wage: f.wage, daysPerWeek: f.daysPerWeek, durationMonths: f.durationMonths, deadline: f.deadline,
          location: f.location, weekend: Boolean(f.weekend),
          requirements: {
            degree: f.degree, departments: splitList(f.departments), minGrade: Number(f.minGrade) || 0,
            experience: r.experience || '不拘', languages: splitList(f.languages),
          },
          requiredSkills: splitList(f.requiredSkills), bonusSkills: splitList(f.bonusSkills), benefits: splitList(f.benefits),
          companyIntro: f.companyIntro, workHours: f.workHours, headcount: f.headcount, startDate: f.startDate,
          responsibilities: f.responsibilities.split('\n').map((x) => x.trim()).filter(Boolean),
          interviewStages: stages.filter((st) => st.name),
          applyMaterials: splitList(f.applyMaterials),
          interviewBooking: slots?.value().settings || j.interviewBooking,
        },
      });
      if (slots) await api(`/company/jobs/${saved.id}/slots`, { method: 'PUT', body: slots.value() });
      toast(j.id ? '已儲存變更' : '職缺已進入卡池，開始媒合！');
      currentJobId = saved.id;
      await loadJobs();
      showJob(saved.id);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
}

// =============== 職缺頁：概況 + 應徵者分析 + 應徵者 ===============
async function showJob(jobId, focusAppId = null) {
  $('#open-schedule')?.classList.remove('on');
  currentJobId = jobId;
  $$('.job-link').forEach((b) => b.classList.toggle('on', b.dataset.job === jobId));
  const job = jobs.find((j) => j.id === jobId);
  setCrumb(job.title);
  const main = $('#main');
  const closed = job.status === 'closed';
  main.innerHTML = `
    <div class="panel job-head">
      <div class="grow">
        <h2>${esc(job.title)} <span class="status-pill ${closed ? 'bad' : 'ok'}">${closed ? '已關閉' : '招募中'}</span></h2>
        <div class="muted small">${esc(job.category || '')}・時薪 ${esc(job.wage)} 元・${esc(job.location || '')}・截止 ${esc(job.deadline || '—')}</div>
      </div>
      <div class="acts">
        <button class="btn" id="edit-job">✎ 編輯職缺</button>
        <button class="btn ${closed ? 'primary' : ''}" id="toggle-job">${closed ? '↺ 重新開放' : '🔒 關閉職缺'}</button>
      </div>
    </div>
    <div class="panel slot-summary" id="slot-summary"><span class="muted small">載入面試時段…</span></div>
    <div id="job-body"><div class="empty"><span class="spinner dark"></span> 載入應徵者…</div></div>`;
  $('#edit-job').onclick = () => showJobForm(job);
  renderSlotSummary(job);
  $('#toggle-job').onclick = async () => {
    const next = closed ? 'open' : 'closed';
    const yes = await confirmDialog(next === 'closed'
      ? { title: '關閉這個職缺？', message: '關閉後學生就滑不到這個職缺，已投遞的應徵者紀錄會保留。之後可以隨時重新開放。', ok: '關閉職缺', danger: true }
      : { title: '重新開放這個職缺？', message: '職缺會重新出現在學生的卡池中（報名截止日需在今天之後）。', ok: '重新開放' });
    if (!yes) return;
    await api(`/company/jobs/${job.id}/status`, { method: 'POST', body: { status: next } });
    toast(next === 'closed' ? '職缺已關閉' : '職缺已重新開放');
    await loadJobs();
    showJob(job.id);
  };

  const apps = await api(`/company/jobs/${jobId}/applicants`);
  if (currentJobId !== jobId) return; // 載入期間已切到別的職缺
  const bodyEl = $('#job-body');
  if (!apps.length) {
    bodyEl.innerHTML = `<div class="panel empty">還沒有應徵者${closed ? '' : '，職缺已在學生的卡池中 🃏'}</div>`;
    return;
  }
  bodyEl.innerHTML = `
    ${analyticsHtml(job, apps)}
    <div class="applicants">
      <div><div class="side-title" style="margin-top:0">應徵者（${apps.length}）・符合標準者在前</div><div id="app-list"></div></div>
      <div class="panel" id="app-detail"></div>
    </div>`;

  const renderList = (selected) => {
    $('#app-list').innerHTML = apps.map((a) => {
      const q = qualify(a, job);
      const r = a.resume;
      const st = STATUS[a.status] || STATUS.pending;
      return `<button class="app-link ${a.id === selected ? 'on' : ''} ${a.status === 'rejected' ? 'dim' : ''}" data-app="${esc(a.id)}">
        <b>${esc(r.name || '未填姓名')} ${a.status !== 'pending' ? `<em class="mini ${st.cls}">${st.text}</em>` : ''}</b>
        <span>${esc((r.department || '').replace(/系$/, '') || '科系未填')}・${gradeLabel(r.grade, r.degree)}</span>
        <span class="${q.ok ? 'pass' : 'warn'}">${q.ok ? '✓ 符合標準' : `未達：${q.unmet.map((x) => x.label).join('、')}`}</span>
      </button>`;
    }).join('');
    $$('[data-app]').forEach((b) => (b.onclick = () => { renderList(b.dataset.app); renderDetail(apps.find((a) => a.id === b.dataset.app)); }));
  };

  const renderDetail = (a) => {
    const r = a.resume;
    const q = qualify(a, job);
    const st = STATUS[a.status] || STATUS.pending;
    const final = FINAL.includes(a.status);
    $('#app-detail').innerHTML = `
      <div class="person">
        <div class="avatar">${esc((r.name || '?').slice(0, 1))}</div>
        <div class="grow"><h2>${esc(r.name || '未填姓名')} ${a.status !== 'pending' ? `<span class="status-pill ${st.cls}">${st.text}</span>` : ''}</h2>
          <div class="muted">${[r.school, r.department, gradeLabel(r.grade, r.degree)].filter(Boolean).map(esc).join('・')}</div></div>
        ${q.ok ? '<div class="stamp-ok" title="學歷、科系、年級與必備技能都符合">符合標準</div>' : ''}
      </div>
      ${final ? resultHtml(a) : `
      <div class="decide">
        <button class="btn" data-act="rejected">✕ 不適合</button>
        <button class="btn ${a.status === 'shortlisted' ? 'on' : ''}" data-act="shortlist">${a.status === 'shortlisted' ? '★ 已列入考慮' : '☆ 列入考慮'}</button>
        <button class="btn primary" data-act="interview">➤ 邀請面試</button>
      </div>`}
      <div class="contact">
        ${r.contact?.email ? `<span>✉️ ${esc(r.contact.email)}</span>` : ''}
        ${r.contact?.phone ? `<span>📞 ${esc(r.contact.phone)}</span>` : ''}
        ${r.contact?.lineId ? `<span>💬 ${esc(r.contact.lineId)}</span>` : ''}
      </div>
      <div class="ai-box">
        <div class="small" style="color:var(--green-dark)">✨ AI 履歷摘要</div>
        <div class="sum" id="ai-sum">${summaries[a.id] ? esc(summaries[a.id]) : (a.aiSummary ? esc(a.aiSummary) : '<span class="spinner dark"></span> AI 摘要產生中…（約 5–15 秒）')}</div>
      </div>
      <section class="check-card">
        <h4>📋 錄取條件檢核 <span class="muted small">${q.ok ? '全部符合' : `${q.unmet.length} 項未達`}</span></h4>
        <table class="checks">
          <tr><th>條件</th><th>職缺要求</th><th>應徵者</th><th></th></tr>
          ${q.items.map((x) => `<tr class="${x.ok ? '' : 'no'}"><td>${esc(x.label)}</td><td>${esc(x.need)}</td><td>${esc(x.have)}</td><td class="mark">${x.ok ? '✓ 符合' : '✕ 未達'}</td></tr>`).join('')}
        </table>
      </section>
      <div class="resume-grid">
        <section class="r-card">
          <h4>🎓 學歷</h4>
          <dl class="kv">
            <dt>學校</dt><dd>${esc(r.school || '—')}</dd>
            <dt>科系</dt><dd>${esc(r.department || '—')}</dd>
            <dt>年級</dt><dd>${esc(r.degree || '')} ${gradeLabel(r.grade, r.degree)}</dd>
            ${r.graduation ? `<dt>預計畢業</dt><dd>${esc(r.graduation)}</dd>` : ''}
            ${r.gpa ? `<dt>GPA</dt><dd>${esc(r.gpa)}</dd>` : ''}
          </dl>
        </section>
        <section class="r-card">
          <h4>🛠 技能與語言</h4>
          <div class="chips">${(r.skills || []).map((x) => `<span class="chip ${hasSkillIn(x, job) ? 'on' : ''}">${esc(x)}</span>`).join('') || '<span class="muted small">—</span>'}</div>
          <div class="small" style="margin-top:10px">${(r.languages || []).map((l) => `<span class="lang">${esc(l.name)}${l.level ? `・${esc(l.level)}` : ''}</span>`).join('') || '<span class="muted">—</span>'}</div>
        </section>
      </div>
      ${r.about ? `<section class="r-block"><h4>✍️ 自我介紹</h4><p>${esc(r.about)}</p></section>` : ''}
      ${resumeSections(r).map(([title, items]) => `
      <section class="r-block"><h4>${title}</h4>
        ${items.length ? items.map(entryHtml).join('') : '<p class="muted small">—</p>'}
      </section>`).join('')}
      ${r.links?.length ? `<section class="r-block"><h4>🔗 作品集・連結</h4>${r.links.map((l) => `<div class="small"><a href="${esc(safeUrl(l))}" target="_blank" rel="noopener">${esc(l)}</a></div>`).join('')}</section>` : ''}`;

    // AI 摘要：點開才算，算過就存起來
    if (!summaries[a.id] && !a.aiSummary) {
      api(`/company/applications/${a.id}/summary`, { method: 'POST' })
        .then(({ summary }) => {
          summaries[a.id] = summary;
          const el = $('#ai-sum');
          if (el && $('.app-link.on')?.dataset.app === a.id) el.textContent = summary;
        })
        .catch(() => { const el = $('#ai-sum'); if (el) el.textContent = 'AI 摘要暫時無法產生，稍後再點一次這位應徵者。'; });
    }

    const setStatus = async (status, extra = {}) => {
      const updated = await api(`/company/applications/${a.id}/status`, { method: 'POST', body: { status, ...extra } });
      Object.assign(a, { status, interview: updated.interview });
      renderList(a.id);
      renderDetail(a);
      $('#analytics').outerHTML = analyticsHtml(job, apps);
    };
    $$('[data-act]', $('#app-detail')).forEach((b) => (b.onclick = async () => {
      try {
        if (b.dataset.act === 'shortlist') {
          await setStatus(a.status === 'shortlisted' ? 'pending' : 'shortlisted');
        } else if (b.dataset.act === 'rejected') {
          const yes = await confirmDialog({
            title: `確定 ${r.name || '這位同學'} 不適合？`,
            message: '送出後<b>無法更改</b>，系統會用 LINE 婉轉通知同學。',
            ok: '確定不適合', danger: true,
          });
          if (yes) { await setStatus('rejected'); toast('已通知同學'); }
        } else {
          const interview = await interviewDialog(a, job);
          if (interview) { await setStatus('interview', { interview }); toast(interview.booking ? '已用 LINE 請同學選面試時段' : '已用 LINE 通知同學面試邀請'); }
        }
      } catch (err) {
        toast(err.message);
      }
    }));
  };

  const first = apps.find((x) => x.id === focusAppId) || apps[0]; // 從面試行程點名字進來：直接打開那位
  renderList(first.id);
  renderDetail(first);
}

// =============== 面試時段：職缺頁的摘要與管理視窗 ===============
async function renderSlotSummary(job) {
  const el = $('#slot-summary');
  let data;
  try {
    data = await api(`/company/jobs/${job.id}/slots`);
  } catch {
    el.innerHTML = '<span class="muted small">面試時段載入失敗</span>';
    return;
  }
  if (!$('#slot-summary') || currentJobId !== job.id) return;
  const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16);
  const future = data.slots.filter((x) => x.start > now);
  const open = future.filter((x) => x.booked < x.capacity).length;
  const bookedCount = future.reduce((n, x) => n + x.booked, 0);
  const st = data.settings;
  el.innerHTML = `
    <div class="grow">
      <b>🗓 面試預約時段</b>
      <div class="muted small">${future.length
        ? `可預約 ${open} 個時段・已預約 ${bookedCount} 人・每格 ${st.minutes} 分鐘、${st.capacity} 人・同學需在 ${st.replyDays} 天內回覆`
        : '還沒有開放時段。開放後，邀請面試時可以讓同學自己選時間。'}</div>
    </div>
    <button class="btn ${future.length ? '' : 'primary'}" id="manage-slots">${future.length ? '管理時段' : '＋ 設定面試時段'}</button>`;
  $('#manage-slots').onclick = () => openSlotManager(job, data);
}

function openSlotManager(job, data) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true">
      <h3>🗓 面試預約時段・${esc(job.title)}</h3>
      <div id="slot-modal-editor"></div>
      <div class="modal-foot"><button class="btn" data-no>取消</button><button class="btn primary" data-yes>✓ 儲存時段</button></div>
    </div>`;
  document.body.append(wrap);
  const editor = slotEditor($('#slot-modal-editor', wrap), data);
  wrap.onclick = (e) => { if (e.target === wrap || e.target.closest('[data-no]')) wrap.remove(); };
  $('[data-yes]', wrap).onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api(`/company/jobs/${job.id}/slots`, { method: 'PUT', body: editor.value() });
      wrap.remove();
      toast(r.kept ? `已儲存；${r.kept} 個已有人預約的時段會保留給已預約的同學，不再開放給其他人` : `已儲存，目前可預約 ${r.open} 個時段`);
      Object.assign(job, { interviewBooking: editor.value().settings });
      renderSlotSummary(job);
    } catch (err) {
      e.currentTarget.disabled = false;
      toast(err.message);
    }
  };
}

// 已送出的結果（不能再改）
function resultHtml(a) {
  if (a.status === 'rejected') return '<div class="result bad">✕ 已標記為不適合，並已通知同學（無法更改）</div>';
  const i = a.interview || {};
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const booking = !i.booking ? ''
    : i.slot ? `<div>🗓 同學已預約：<b>${esc(slotText(i.slot, i.minutes))}</b></div>`
      : i.unavailable ? `<div class="warn-text">⚠️ 同學表示時段都不方便${i.unavailable.note ? `：「${esc(i.unavailable.note)}」` : ''}。新增時段後同學就能重新選。</div>`
        : today > i.replyBy ? `<div class="warn-text">⚠️ 已超過回覆期限（${esc(i.replyBy)}），同學還沒選時段</div>`
          : `<div>⏳ 等待同學選時段（期限 ${esc(i.replyBy)}）</div>`;
  return `<div class="result ok"><b>✓ 已邀請面試，並已用 LINE 通知同學</b>
    ${booking}
    ${i.date && !i.booking ? `<div>📅 ${esc(i.date)} ${esc(i.time)}</div>` : ''}
    ${i.mode || i.place ? `<div>${i.mode ? `💬 ${esc(i.mode)}` : ''}${i.place ? `・📍 ${esc(i.place)}` : ''}</div>` : ''}
    ${i.note ? `<div class="muted small">${esc(i.note)}</div>` : ''}</div>`;
}

// 邀請面試：讓同學從面試時段自己選（預設），或直接指定時間；送出後用 LINE 傳給同學
async function interviewDialog(a, job) {
  let data = { settings: DEFAULT_BOOKING, slots: [] };
  try { data = await api(`/company/jobs/${job.id}/slots`); } catch {}
  const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16);
  const open = data.slots.filter((x) => x.start > now && x.booked < x.capacity).length;
  return new Promise((resolve) => {
    const tomorrow = new Date(Date.now() + 86400e3 + 8 * 3600e3).toISOString().slice(0, 10);
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal" id="iv-form">
        <h3>邀請 ${esc(a.resume.name || '同學')} 面試</h3>
        <p class="muted">${esc(job.title)}・送出後會立即用 LINE 通知同學，<b>無法更改</b>。</p>
        <div class="seg-pick" id="iv-how">
          <button type="button" data-how="booking" class="${open ? 'on' : ''}" ${open ? '' : 'disabled'}>🗓 讓同學選時段<small>${open ? `目前 ${open} 個時段可預約` : '還沒有開放時段'}</small></button>
          <button type="button" data-how="fixed" class="${open ? '' : 'on'}">📅 直接指定時間</button>
        </div>
        ${open ? '' : '<p class="muted small">想讓同學自己選時間？先到職缺頁的「面試預約時段」開放時段。</p>'}
        <div data-for="booking">
          <label class="field"><span>同學需在幾天內選好時段</span><select class="input" name="replyDays">${[2, 3, 5, 7, 10, 14].map((d) => `<option value="${d}" ${d === data.settings.replyDays ? 'selected' : ''}>${d} 天內</option>`).join('')}</select></label>
        </div>
        <div class="grid2" data-for="fixed">
          <label class="field"><span>面試日期</span><input class="input" type="date" name="date" min="${tomorrow}" value="${tomorrow}"></label>
          <label class="field"><span>時間</span><input class="input" type="time" name="time" value="14:00"></label>
        </div>
        <label class="field"><span>面試方式</span>
          <div class="chips" id="iv-mode">${['實體', '線上', '電話'].map((m, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-mode="${m}">${m}</button>`).join('')}</div></label>
        <label class="field"><span id="iv-place-label">面試地點</span><input class="input" name="place" value="${esc(job.location || '')}" placeholder="地址"></label>
        <label class="field"><span>聯絡人與電話（選填）</span><input class="input" name="contact" placeholder="例如：人資 王小姐 02-1234-5678"></label>
        <label class="field"><span>給同學的話（選填）</span><textarea class="input" name="note" placeholder="例如：請攜帶作品集，面試約 30 分鐘。"></textarea></label>
        <div class="modal-foot"><button type="button" class="btn" data-no>取消</button><button class="btn primary">➤ 送出邀請</button></div>
      </form>`;
    let mode = '實體';
    let how = open ? 'booking' : 'fixed';
    const form = wrap.querySelector('form');
    const showHow = () => {
      $$('[data-how]', wrap).forEach((b) => b.classList.toggle('on', b.dataset.how === how));
      $$('[data-for]', wrap).forEach((el) => el.classList.toggle('hidden', el.dataset.for !== how));
    };
    showHow();
    $$('[data-how]', wrap).forEach((b) => (b.onclick = () => { how = b.dataset.how; showHow(); }));
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.onclick = (e) => { if (e.target === wrap || e.target.closest('[data-no]')) done(null); };
    $$('[data-mode]', wrap).forEach((b) => (b.onclick = () => {
      mode = b.dataset.mode;
      $$('[data-mode]', wrap).forEach((x) => x.classList.toggle('on', x === b));
      $('#iv-place-label', wrap).textContent = { 實體: '面試地點', 線上: '會議連結', 電話: '備註（例如：會由公司撥打）' }[mode];
      form.place.placeholder = { 實體: '地址', 線上: 'Google Meet／Teams 連結', 電話: '' }[mode];
      if (mode !== '實體' && form.place.value === job.location) form.place.value = '';
    }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const base = { mode, place: f.place, contact: f.contact, note: f.note };
      if (how === 'booking') return done({ ...base, booking: true, replyDays: Number(f.replyDays) });
      if (!f.date || !f.time) return toast('請填寫面試日期與時間');
      done({ ...base, date: f.date, time: f.time });
    };
    document.body.append(wrap);
  });
}

// =============== 應徵者分析（不用 AI，直接統計）===============
function analyticsHtml(job, apps) {
  const n = apps.length;
  const count = (fn) => apps.filter(fn).length;
  const passed = count((a) => qualify(a, job).ok);
  const byStatus = Object.keys(STATUS).map((k) => ({ label: STATUS[k].text, v: count((a) => (a.status || 'pending') === k) }));

  const tally = (values) => {
    const m = {};
    for (const v of values) m[v] = (m[v] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, v]) => ({ label, v }));
  };
  const has = (a, s) => (a.resume.skills || []).some((x) => x.toLowerCase() === s.toLowerCase());
  const skills = [...(job.requiredSkills || []), ...(job.bonusSkills || [])].map((s) => ({ label: s, v: count((a) => has(a, s)) }));

  const bars = (title, rows) => `
    <div class="bars"><div class="bars-title">${title}</div>
      ${rows.length ? rows.map((r) => `
        <div class="bar-row" title="${esc(r.label)}：${r.v} / ${n} 人">
          <span class="bar-label">${esc(r.label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.round((r.v / n) * 100)}%"></span></span>
          <span class="bar-val">${r.v}</span>
        </div>`).join('') : '<div class="muted small">—</div>'}
    </div>`;

  return `
  <section class="panel analytics" id="analytics">
    <div class="analytics-head"><b>📊 應徵者分析</b><span class="muted small">共 ${n} 位</span></div>
    <div class="stats">
      <div class="stat"><span>應徵人數</span><b>${n}</b></div>
      <div class="stat"><span>符合標準</span><b>${passed}<small> / ${n}</small></b></div>
      <div class="stat"><span>待處理</span><b>${count((a) => (a.status || 'pending') === 'pending')}</b></div>
      <div class="stat"><span>已邀請面試</span><b>${count((a) => a.status === 'interview')}</b></div>
    </div>
    <div class="bars-grid">
      ${bars('技能覆蓋（有此技能的人數）', skills)}
      ${bars('科系分布', tally(apps.map((a) => a.resume.department || '未填')))}
      ${bars('年級分布', tally(apps.map((a) => gradeLabel(a.resume.grade, a.resume.degree))))}
      ${bars('處理進度', byStatus)}
    </div>
  </section>`;
}

// =============== 履歷檢視的小工具 ===============
function safeUrl(u) {
  return /^https?:\/\//.test(u || '') ? u : '#';
}
function hasSkillIn(skill, job) {
  return [...(job.requiredSkills || []), ...(job.bonusSkills || [])].some((x) => x.toLowerCase() === String(skill).toLowerCase());
}

// 競賽證照、專案作品、活動經歷（舊版履歷只有 experiences，放在活動經歷）
function resumeSections(r) {
  const legacy = (r.experiences || []).map((e) => ({ title: e.title, date: e.year, description: e.description }));
  const activities = r.activities?.length ? r.activities : legacy;
  return [['🏆 競賽成績・證照', r.awards || []], ['💡 專案作品', r.projects || []], ['🌱 其他活動經歷', activities]];
}

function entryHtml(x) {
  return `
    <div class="entry-view">
      <div class="entry-top"><b>${esc(x.title)}</b>${x.role ? `<span class="tag">${esc(x.role)}</span>` : ''}<span class="muted small date">${esc(x.date || '')}</span></div>
      ${x.description ? `<div class="small">${esc(x.description)}</div>` : ''}
      ${x.link || x.file ? `<div class="entry-links">
        ${x.link ? `<a href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener">🔗 連結</a>` : ''}
        ${x.file?.url ? `<a href="${esc(x.file.url)}" target="_blank" rel="noopener">📄 ${esc(x.file.name)}</a>` : ''}
      </div>` : ''}
    </div>`;
}

// =============== 錄取條件檢核（學歷・科系・年級・必備技能）===============
// 只看企業設定的硬性條件，全部符合就蓋「符合標準」章，不打分數
function qualify(a, job) {
  const r = a.resume;
  const req = job.requirements || {};
  const check = (key) => a.evaluation.checks.find((c) => c.key === key);
  const items = [
    { label: '學歷', need: req.degree || '不限', have: r.degree || '未填', ok: check('degree')?.ok ?? true },
    { label: '科系', need: req.departments?.length ? req.departments.join('、') : '不限', have: r.department || '未填', ok: check('department')?.ok ?? true },
    { label: '年級', need: req.minGrade ? `${gradeLabel(req.minGrade)}以上` : '不限', have: gradeLabel(r.grade, r.degree), ok: check('grade')?.ok ?? true },
    ...(job.requiredSkills || []).map((skill) => ({
      label: `必備：${skill}`, need: '需具備', ok: !a.evaluation.missingSkills.includes(skill),
      have: a.evaluation.missingSkills.includes(skill) ? '履歷未列' : '有',
    })),
  ];
  const unmet = items.filter((x) => !x.ok).map((x) => ({ ...x, label: x.label.replace(/^必備：/, '') }));
  return { items, unmet, ok: !unmet.length };
}

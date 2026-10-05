import { initAuth, api, profile, logout, isFriend, $, $$, esc, toast, splitList } from '/shared/api.js';

let jobs = [];
let currentJobId = null;

const { demo, cfg } = await initAuth('company');
$('#me').textContent = (profile.displayName || '企').slice(0, 1);
$('#logout').onclick = () => logout('company');

// 做法 A：企業也要加官方帳號好友才收得到應徵通知，沒加就顯示提醒
if (!demo && cfg.oaBasicId && (await isFriend()) === false) {
  $('#friend-link').href = `https://line.me/R/ti/p/${encodeURIComponent(cfg.oaBasicId)}`;
  $('#friend-banner').classList.remove('hidden');
}
$('#new-job').onclick = () => showJobForm();
await loadJobs();

const startJob = new URLSearchParams(location.search).get('job');
if (startJob && jobs.some((j) => j.id === startJob)) showApplicants(startJob);
else if (jobs.length) showApplicants(jobs[0].id);
else showJobForm();

async function loadJobs() {
  jobs = await api('/company/jobs');
  $('#job-list').innerHTML = jobs.length
    ? jobs.map((j) => `
      <button class="job-link ${j.id === currentJobId ? 'on' : ''}" data-job="${esc(j.id)}">
        <b>${esc(j.title)}</b><span>${j.applicantCount} 位應徵者・截止 ${esc(j.deadline || '—')}</span>
      </button>`).join('')
    : '<p class="muted small">還沒有職缺</p>';
  $$('[data-job]').forEach((b) => (b.onclick = () => showApplicants(b.dataset.job)));
}

// =============== 刊登職缺（兩種建檔模式）===============
function showJobForm(job) {
  currentJobId = null;
  $$('.job-link').forEach((b) => b.classList.remove('on'));
  $('#crumb').textContent = '｜ 刊登職缺';
  const main = $('#main');
  main.innerHTML = `
    <div class="panel">
      <div class="seg"><button data-mode="manual" class="on">自己填寫</button><button data-mode="upload">上傳檔案智慧建檔</button></div>
      <div id="upload-area" class="hidden">
        <div class="upload">📄 <input type="file" id="j-file" accept=".pdf,.txt"></div>
        <textarea class="input" id="j-text" placeholder="或直接貼上職缺說明文字…"></textarea>
        <div style="margin:10px 0 16px"><button class="btn primary" id="j-parse">✨ AI 自動拆成欄位</button></div>
      </div>
      <div class="ai-note hidden" id="ai-note">⚡ AI 已自動填好，請確認或微調</div>
      <form id="job-form"></form>
    </div>`;

  $$('[data-mode]', main).forEach((b) => (b.onclick = () => {
    $$('[data-mode]', main).forEach((x) => x.classList.toggle('on', x === b));
    $('#upload-area').classList.toggle('hidden', b.dataset.mode !== 'upload');
  }));

  $('#j-parse').onclick = async (e) => {
    const fd = new FormData();
    const file = $('#j-file').files[0];
    if (file) fd.append('file', file);
    fd.append('text', $('#j-text').value);
    e.target.disabled = true;
    e.target.innerHTML = '<span class="spinner"></span> AI 解析中…';
    try {
      fillJobForm(await api('/company/jobs/parse', { method: 'POST', form: fd }));
      $('#ai-note').classList.remove('hidden');
    } catch (err) {
      toast(err.message);
    }
    e.target.disabled = false;
    e.target.textContent = '✨ AI 自動拆成欄位';
  };
  fillJobForm(job || { companyName: jobs[0]?.companyName });
}

function fillJobForm(j = {}) {
  const r = j.requirements || {};
  const form = $('#job-form');
  form.innerHTML = `
    <label class="field"><span>企業名稱</span><input class="input" name="companyName" required value="${esc(j.companyName)}"></label>
    <div class="grid2">
      <label class="field"><span>職缺名稱</span><input class="input" name="title" required value="${esc(j.title)}"></label>
      <label class="field"><span>工作類別</span><input class="input" name="category" value="${esc(j.category)}"></label>
    </div>
    <label class="field"><span>工作內容</span><textarea class="input" name="description">${esc(j.description)}</textarea></label>
    <div class="grid4">
      <label class="field"><span>時薪（元）</span><input class="input" name="wage" type="number" value="${esc(j.wage)}"></label>
      <label class="field"><span>每週天數</span><input class="input" name="daysPerWeek" type="number" min="1" max="7" value="${esc(j.daysPerWeek)}"></label>
      <label class="field"><span>實習時長（月）</span><input class="input" name="durationMonths" type="number" value="${esc(j.durationMonths)}"></label>
      <label class="field"><span>報名截止日</span><input class="input" name="deadline" type="date" value="${esc(j.deadline)}"></label>
    </div>
    <div class="grid4">
      <label class="field" style="grid-column: span 2"><span>地點</span><input class="input" name="location" value="${esc(j.location)}"></label>
      <label class="field"><span>地區</span><select class="input" name="region">${['台北', '新北', '桃園', '台中', '台南', '高雄', '遠端', '其他'].map((x) => `<option ${j.region === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field"><span>假日上班</span><select class="input" name="weekend"><option value="">否</option><option value="1" ${j.weekend ? 'selected' : ''}>是</option></select></label>
    </div>
    <div class="section-title">要求條件</div>
    <div class="grid4">
      <label class="field"><span>學歷</span><input class="input" name="degree" placeholder="大學以上" value="${esc(r.degree)}"></label>
      <label class="field"><span>科系（空白=不限）</span><input class="input" name="departments" value="${esc((r.departments || []).join(', '))}"></label>
      <label class="field"><span>最低年級（0=不限）</span><input class="input" name="minGrade" type="number" min="0" max="8" value="${esc(r.minGrade || 0)}"></label>
      <label class="field"><span>語言</span><input class="input" name="languages" value="${esc((r.languages || ['中文']).join(', '))}"></label>
    </div>
    <label class="field"><span>必備技能（逗號分隔）</span><input class="input" name="requiredSkills" value="${esc((j.requiredSkills || []).join(', '))}"></label>
    <label class="field"><span>加分條件（逗號分隔）</span><input class="input" name="bonusSkills" value="${esc((j.bonusSkills || []).join(', '))}"></label>
    <label class="field"><span>公司福利（逗號分隔）</span><input class="input" name="benefits" value="${esc((j.benefits || []).join(', '))}"></label>
    <div class="form-foot"><button class="btn primary">✓ 確認送出，開始媒合</button></div>`;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const saved = await api('/company/jobs', {
      method: 'POST',
      body: {
        id: j.id,
        companyName: f.companyName, title: f.title, category: f.category, description: f.description,
        wage: f.wage, daysPerWeek: f.daysPerWeek, durationMonths: f.durationMonths, deadline: f.deadline,
        location: f.location, region: f.region, weekend: Boolean(f.weekend),
        requirements: {
          degree: f.degree, departments: splitList(f.departments), minGrade: Number(f.minGrade) || 0,
          experience: r.experience || '不拘', languages: splitList(f.languages),
        },
        requiredSkills: splitList(f.requiredSkills), bonusSkills: splitList(f.bonusSkills), benefits: splitList(f.benefits),
      },
    });
    toast('職缺已進入卡池，開始媒合！');
    currentJobId = saved.id;
    await loadJobs();
    showApplicants(saved.id);
  };
}

// =============== 應徵者後台篩選 ===============
async function showApplicants(jobId) {
  currentJobId = jobId;
  $$('.job-link').forEach((b) => b.classList.toggle('on', b.dataset.job === jobId));
  const job = jobs.find((j) => j.id === jobId);
  $('#crumb').textContent = `｜ 職缺：${job.title}`;
  const main = $('#main');
  main.innerHTML = '<div class="empty"><span class="spinner" style="border-color:var(--green);border-right-color:transparent"></span> AI 整理應徵者中…</div>';

  const apps = await api(`/company/jobs/${jobId}/applicants`);
  if (!apps.length) {
    main.innerHTML = `<div class="panel empty">還沒有應徵者，職缺已在學生的卡池中 🃏<br><br><button class="btn" id="edit-job">編輯職缺</button></div>`;
    $('#edit-job').onclick = () => showJobForm(job);
    return;
  }

  main.innerHTML = `
    <div class="applicants">
      <div><div class="side-title" style="margin-top:0">應徵者（${apps.length}）</div><div id="app-list"></div>
        <button class="btn" id="edit-job" style="margin-top:10px">編輯職缺</button></div>
      <div class="panel" id="app-detail"></div>
    </div>`;
  $('#edit-job').onclick = () => showJobForm(job);

  const renderList = (selected) => {
    $('#app-list').innerHTML = apps.map((a) => {
      const failed = a.evaluation.checks.filter((c) => !c.ok);
      const r = a.resume;
      return `<button class="app-link ${a.id === selected ? 'on' : ''} ${a.status === 'rejected' ? 'dim' : ''}" data-app="${esc(a.id)}">
        <b>${esc(r.name)}</b>
        <span class="${failed.length ? 'warn' : ''}">${esc((r.department || '').replace(/系$/, ''))}・大${'一二三四五六'[r.grade - 1] || '?'}・${failed.length ? `${failed.map((c) => c.label).join('、')}未達` : '條件符合'}</span>
      </button>`;
    }).join('');
    $$('[data-app]').forEach((b) => (b.onclick = () => { renderList(b.dataset.app); renderDetail(apps.find((a) => a.id === b.dataset.app)); }));
  };

  const renderDetail = (a) => {
    const r = a.resume;
    const ev = a.evaluation;
    const missing = [...ev.missingSkills, ...ev.bonusMissing];
    const statusText = { pending: '', shortlisted: '已收藏', interview: '已邀請面試', rejected: '不適合' }[a.status];
    $('#app-detail').innerHTML = `
      <div class="person">
        <div class="avatar">${esc((r.name || '?').slice(0, 1))}</div>
        <div><h2>${esc(r.name)} ${statusText ? `<span class="status-pill">${statusText}</span>` : ''}</h2>
          <div class="muted">${esc(r.school)} ${esc(r.department)}・大${'一二三四五六'[r.grade - 1] || '?'}</div></div>
        <div class="acts">
          <button class="btn" data-status="rejected" title="不適合">✕</button>
          <button class="btn" data-status="shortlisted" title="收藏">🔖</button>
          <button class="btn primary" data-status="interview">➤ 邀請面試</button>
        </div>
      </div>
      <div class="contact">
        ${r.contact?.email ? `<span>✉️ ${esc(r.contact.email)}</span>` : ''}
        ${r.contact?.phone ? `<span>📞 ${esc(r.contact.phone)}</span>` : ''}
        ${r.contact?.lineId ? `<span>💬 ${esc(r.contact.lineId)}</span>` : ''}
      </div>
      <div class="ai-box">
        <div class="small" style="color:var(--green-dark)">✨ AI 履歷摘要</div>
        <div class="sum">${esc(a.aiSummary)}</div>
        <div class="chips">
          ${ev.checks.map((c) => `<span class="tag ${c.ok ? '' : 'bad'}" title="${esc(c.detail)}">${c.ok ? '✓' : '✕'} ${esc(c.label)}</span>`).join('')}
          ${missing.map((s) => `<span class="tag warn">${esc(s)}・缺</span>`).join('')}
        </div>
      </div>
      <div class="info-grid">
        <div><div class="section-title">教育背景</div><div class="small">${esc(r.school)} ${esc(r.department)}<br><span class="muted">${r.graduation ? `預計 ${esc(r.graduation)} 畢業` : ''}${r.gpa ? `・GPA ${esc(r.gpa)}` : ''}</span></div></div>
        <div><div class="section-title">語言</div><div class="small">${(r.languages || []).map((l) => `${esc(l.name)}${l.level ? `（${esc(l.level)}）` : ''}`).join('<br>') || '—'}</div></div>
      </div>
      <div class="section-title">技能</div>
      <div class="chips">${(r.skills || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      <div class="section-title">專案與經歷</div>
      ${(r.experiences || []).map((x) => `<div class="exp"><b class="small">${esc(x.title)}</b> <span class="muted small">${esc(x.year)}</span><div class="small muted">${esc(x.description)}</div></div>`).join('') || '<p class="muted small">—</p>'}
      ${r.links?.length ? `<div class="section-title">作品集・連結</div>${r.links.map((l) => `<div class="small"><a href="${esc(/^https?:\/\//.test(l) ? l : '#')}" target="_blank" rel="noopener">${esc(l)}</a></div>`).join('')}` : ''}`;

    $$('[data-status]').forEach((b) => (b.onclick = async () => {
      const status = b.dataset.status;
      const message = status === 'interview' ? prompt('要附給同學的訊息（可留空），例如面試時間：', '') : undefined;
      if (message === null) return;
      await api(`/company/applications/${a.id}/status`, { method: 'POST', body: { status, message } });
      a.status = status;
      toast(status === 'interview' ? '已用 LINE 通知同學面試邀請' : '已更新');
      renderList(a.id);
      renderDetail(a);
    }));
  };

  renderList(apps[0].id);
  renderDetail(apps[0]);
}

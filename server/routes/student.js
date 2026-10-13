// 學生端 API（都需要登入）
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { parseResume, careerAdvice } from '../ai.js';
import { filesToInput, isEmptyInput, parseLinks, MAX_UPLOADS } from '../extract.js';
import { evaluate, passesFilters, matchesKeyword } from '../matching.js';
import { pushMessage, linkCard, liffUrl } from '../line.js';
import { rankJobs } from '../ranking.js';
import { embeddingModel } from '../ai.js';
import { withEmbedding, stripEmbedding } from '../embeddings.js';
import { cleanResumeFiles, withFileUrls, attachSourceFiles } from '../files.js';
import { jobSlots, bookSlot, releaseSlot, canChooseSlot, slotLabel, nowLocal, httpError } from '../slots.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: MAX_UPLOADS } });
export const studentRouter = Router();

const ownResume = async (req, id) => {
  const r = await db.get('resumes', id);
  return r && r.ownerId === req.user.userId ? r : null;
};

// ---------- 履歷 ----------
studentRouter.get('/resumes', async (req, res) => {
  res.json((await db.find('resumes', { ownerId: req.user.userId })).map((r) => withFileUrls(stripEmbedding(r))));
});

// AI 智慧建立履歷：可以一次給很多來源 → 回傳結構化草稿（不存檔，讓學生確認後再存）
//  - files：履歷、作品集、證照、成績單…（PDF、Word、PowerPoint、文字檔、照片、截圖）
//  - text：貼上的文字；links：作品或社群連結（一行一個）
// 作品、證照檔案會自動掛到履歷對應的那一筆
studentRouter.post('/resumes/parse', upload.array('files', MAX_UPLOADS), async (req, res) => {
  const files = req.files || [];
  const links = parseLinks(req.body.links);
  const input = await filesToInput(files, { text: req.body.text || '', links });
  if (isEmptyInput(input)) {
    return res.status(400).json({ error: input.skipped.length ? `讀不到「${input.skipped.join('、')}」的內容，請改存成 PDF 或截圖上傳` : '請上傳檔案、貼上文字或連結' });
  }
  const parsed = await parseResume(input);
  parsed.links = [...new Set([...(parsed.links || []), ...links])];
  const attached = await attachSourceFiles(parsed, files, req.user.userId);
  res.json(withFileUrls({ ...parsed, attached, skipped: input.skipped }));
});

studentRouter.post('/resumes', async (req, res) => {
  const { id, embedding, aiFailed, attached, skipped, ...data } = req.body;
  const clean = await cleanResumeFiles(data, req.user.userId); // 附件只能是自己上傳的
  // 存檔時順便算語意向量，給滑卡排序用
  const row = await withEmbedding({ ...clean, ownerId: req.user.userId, updatedAt: new Date().toISOString() }, 'resume');
  if (id) {
    if (!(await ownResume(req, id))) return res.status(404).json({ error: '找不到履歷' });
    return res.json(withFileUrls(stripEmbedding(await db.set('resumes', id, row))));
  }
  res.json(withFileUrls(stripEmbedding(await db.add('resumes', row))));
});

// 刪除履歷：已經用這份履歷投遞的應徵紀錄，先存一份副本，企業端仍然看得到當時的履歷
studentRouter.delete('/resumes/:id', async (req, res) => {
  const resume = await ownResume(req, req.params.id);
  if (!resume) return res.status(404).json({ error: '找不到履歷' });
  const apps = await db.find('applications', { resumeId: resume.id });
  await Promise.all(apps.map((a) => db.update('applications', a.id, { resumeSnapshot: stripEmbedding(resume) })));
  await db.remove('resumes', resume.id);
  // 篩選條件裡選的「依據履歷」如果是這份，就清掉
  const prefs = await db.get('preferences', req.user.userId);
  if (prefs?.resumeId === resume.id) await db.update('preferences', req.user.userId, { resumeId: null });
  res.json({ ok: true });
});

// ---------- 求職條件 ----------
studentRouter.get('/preferences', async (req, res) => {
  res.json((await db.get('preferences', req.user.userId)) || {});
});

studentRouter.put('/preferences', async (req, res) => {
  res.json(await db.set('preferences', req.user.userId, req.body));
});

// ---------- 卡池：符合條件、還沒滑過的職缺 ----------
// 篩選面板的「查看 N 個符合職缺」也用同一套邏輯，數字才會跟實際卡片一致
async function cardPool(me, prefs) {
  const [swipes, allJobs] = await Promise.all([db.find('swipes', { studentId: me }), db.find('jobs')]);
  // 滑過的不再出現；但「再看一次」放回來的跳過紀錄（restored）不算
  const swiped = new Set(swipes.filter((s) => !s.restored).map((s) => s.jobId));
  const candidates = allJobs.filter((j) => j.status === 'open' && !swiped.has(j.id) && passesFilters(j, prefs));
  return { swipes, allJobs, candidates };
}

studentRouter.get('/cards', async (req, res) => {
  const me = req.user.userId;
  const prefs = (await db.get('preferences', me)) || {};
  const { swipes, allJobs, candidates: pool } = await cardPool(me, prefs);
  // 關鍵字搜尋（篩選旁的「搜尋」）：在符合篩選條件的職缺中再找一次
  const q = String(req.query.q || '').slice(0, 50);
  const candidates = q ? pool.filter((j) => matchesKeyword(j, q)) : pool;

  // 先篩掉硬條件（上面），再依「規則 + AI 語意 + 滑卡偏好 + 時效」排序（server/ranking.js）
  const resume = prefs.smartSort && prefs.resumeId ? await ownResume(req, prefs.resumeId) : null;
  const ranked = rankJobs({
    jobs: candidates,
    resume,
    swipes,
    allJobsById: new Map(allJobs.map((j) => [j.id, j])),
    model: embeddingModel,
  });
  res.json(ranked.map(stripEmbedding));
});

// 「再看一次跳過的職缺」：目前有幾個可以放回來
const skippedOf = async (me) => {
  const swipes = await db.find('swipes', { studentId: me });
  // 同一個職缺後來有收藏／投遞或再次跳過，以最新一筆為準
  const latest = new Map();
  for (const s of swipes.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))) latest.set(s.jobId, s);
  return [...latest.values()].filter((s) => s.action === 'skip' && !s.restored);
};

studentRouter.get('/swipes/skipped', async (req, res) => {
  res.json({ count: (await skippedOf(req.user.userId)).length });
});

// 把跳過的職缺放回卡池（保留紀錄給行為學習用，只標記 restored）
studentRouter.post('/swipes/restore-skipped', async (req, res) => {
  const skipped = await skippedOf(req.user.userId);
  await Promise.all(skipped.map((s) => db.update('swipes', s.id, { restored: true })));
  res.json({ restored: skipped.length });
});

// 符合條件、還沒滑過的數量（篩選面板上的「查看 N 個符合職缺」）
studentRouter.post('/cards/count', async (req, res) => {
  const { candidates } = await cardPool(req.user.userId, req.body);
  res.json({ count: candidates.length });
});

// 篩選面板的「職業類別」選項：目前開放中的職缺有哪些類別
studentRouter.get('/categories', async (req, res) => {
  const jobs = await db.find('jobs', { status: 'open' });
  const counts = {};
  for (const j of jobs) if (j.category) counts[j.category] = (counts[j.category] || 0) + 1;
  res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })));
});

// ---------- AI 職涯健檢 ----------
studentRouter.post('/career-check', async (req, res) => {
  const { jobId, resumeId } = req.body;
  const [job, resume] = await Promise.all([db.get('jobs', jobId), ownResume(req, resumeId)]);
  if (!job || !resume) return res.status(404).json({ error: '找不到職缺或履歷' });
  const evaluation = evaluate(resume, job);
  const { aiFailed, ...advice } = await careerAdvice(resume, job, evaluation);
  res.json({ job: { title: job.title, companyName: job.companyName }, evaluation, advice, aiFailed });
});

// ---------- 滑卡：skip（左滑）/ save（上滑收藏）/ apply（右滑投遞）----------
studentRouter.post('/swipes', async (req, res) => {
  const { jobId, action, resumeId } = req.body;
  if (!['skip', 'save', 'apply'].includes(action)) return res.status(400).json({ error: 'action 錯誤' });
  const job = await db.get('jobs', jobId);
  if (!job) return res.status(404).json({ error: '找不到職缺' });

  if (action === 'apply' && !(await ownResume(req, resumeId))) {
    return res.status(400).json({ error: '投遞需要選一份履歷' });
  }

  const swipe = await db.add('swipes', {
    studentId: req.user.userId, jobId, action, resumeId: resumeId || null, reminded: false, createdAt: new Date().toISOString(),
  });
  if (action === 'apply') await applyToJob(req, job, resumeId);
  res.json(swipe);
});

// 建立應徵紀錄並推播通知企業
async function applyToJob(req, job, resumeId) {
  const resume = await ownResume(req, resumeId);
  await db.add('applications', {
    jobId: job.id, companyId: job.companyId, studentId: req.user.userId, resumeId, status: 'pending', createdAt: new Date().toISOString(),
  });
  await pushMessage(job.companyId, linkCard({
    title: '收到新的應徵 🎉',
    body: `${resume.name || '一位同學'} 投遞了「${job.title}」`,
    buttonLabel: '查看應徵者',
    url: liffUrl('company', `?job=${job.id}`),
  }));
}

// 單一職缺（朋友用 LINE 分享的連結打開）：附上我對這個職缺的狀態
studentRouter.get('/jobs/:id', async (req, res) => {
  const job = await db.get('jobs', req.params.id);
  if (!job) return res.status(404).json({ error: '找不到這個職缺，可能已經下架' });
  const me = req.user.userId;
  const swipe = (await db.find('swipes', { studentId: me, jobId: job.id })).find((s) => s.action !== 'skip');
  const app = swipe?.action === 'apply' ? (await db.find('applications', { studentId: me, jobId: job.id }))[0] : null;
  res.json({ job: stripEmbedding(job), swipe: swipe || null, status: app?.status || null });
});

// 我的收藏 / 投遞紀錄
studentRouter.get('/saved', async (req, res) => {
  const me = req.user.userId;
  const swipes = (await db.find('swipes', { studentId: me })).filter((s) => s.action !== 'skip');
  const apps = await db.find('applications', { studentId: me });
  const rows = await Promise.all(swipes.map(async (s) => {
    const app = apps.find((a) => a.jobId === s.jobId);
    return { ...s, job: stripEmbedding(await db.get('jobs', s.jobId)), appId: app?.id, status: app?.status, interview: app?.interview, canChoose: canChooseSlot(app?.interview) };
  }));
  res.json(rows.filter((r) => r.job));
});

// 取消收藏：刪掉收藏紀錄，職缺會回到滑卡的卡池（已投遞的不能取消）
studentRouter.delete('/saved/:swipeId', async (req, res) => {
  const swipe = await db.get('swipes', req.params.swipeId);
  if (!swipe || swipe.studentId !== req.user.userId) return res.status(404).json({ error: '找不到收藏' });
  if (swipe.action !== 'save') return res.status(400).json({ error: '已投遞的職缺不能取消收藏' });
  await db.remove('swipes', swipe.id);
  res.json({ ok: true });
});

// ---------- 面試時段預約 ----------
async function invitedApp(req) {
  const app = await db.get('applications', req.params.id);
  if (!app || app.studentId !== req.user.userId) throw httpError(404, '找不到應徵紀錄');
  if (app.status !== 'interview' || !app.interview?.booking) throw httpError(400, '這個面試不需要選時段');
  return app;
}

// 可以選的時段（未來、還有名額；自己目前選的也列出來）
studentRouter.get('/applications/:id/slots', async (req, res) => {
  const app = await invitedApp(req);
  const now = nowLocal();
  const slots = (await jobSlots(app.jobId))
    .filter((s) => s.start > now && (s.booked.includes(app.id) || (!s.closed && s.booked.length < s.capacity)))
    .map((s) => ({ start: s.start, minutes: s.minutes, left: s.capacity - s.booked.length, mine: s.booked.includes(app.id) }));
  res.json({ slots, interview: app.interview, canChoose: canChooseSlot(app.interview) });
});

// 預約或更改時段
studentRouter.post('/applications/:id/book', async (req, res) => {
  const app = await invitedApp(req);
  if (!canChooseSlot(app.interview)) {
    throw httpError(400, app.interview.slot ? '面試前 24 小時內不能更改時段，請直接聯絡企業' : '已超過回覆期限，請直接聯絡企業');
  }
  const changed = Boolean(app.interview.slot);
  const slot = await bookSlot(app, req.body.start);
  const interview = {
    ...app.interview, slot: slot.start, minutes: slot.minutes,
    date: slot.start.slice(0, 10), time: slot.start.slice(11, 16), unavailable: null, bookedAt: new Date().toISOString(),
  };
  await db.update('applications', app.id, { interview });
  const [job, resume] = await Promise.all([db.get('jobs', app.jobId), db.get('resumes', app.resumeId)]);
  await pushMessage(app.companyId, linkCard({
    title: changed ? '應徵者更改了面試時段' : '應徵者已預約面試時段 🗓',
    body: `${resume?.name || app.resumeSnapshot?.name || '同學'}（${job.title}）\n${slotLabel(slot.start, slot.minutes)}`,
    buttonLabel: '查看應徵者',
    url: liffUrl('company', `?job=${job.id}`),
  }));
  res.json({ interview, canChoose: canChooseSlot(interview) });
});

// 時段都不方便：告訴企業（已選的時段會釋出）
studentRouter.post('/applications/:id/unavailable', async (req, res) => {
  const app = await invitedApp(req);
  if (app.interview.slot) await releaseSlot(app, app.interview.slot);
  const note = String(req.body.note || '').trim().slice(0, 300);
  const interview = { ...app.interview, slot: null, date: '', time: '', unavailable: { note, at: new Date().toISOString() } };
  await db.update('applications', app.id, { interview });
  const [job, resume] = await Promise.all([db.get('jobs', app.jobId), db.get('resumes', app.resumeId)]);
  await pushMessage(app.companyId, linkCard({
    title: '應徵者表示面試時段都不方便',
    body: `${resume?.name || app.resumeSnapshot?.name || '同學'}（${job.title}）${note ? `\n「${note}」` : ''}\n可以新增時段，同學就能重新選擇。`,
    buttonLabel: '查看應徵者',
    url: liffUrl('company', `?job=${job.id}`),
  }));
  res.json({ interview, canChoose: canChooseSlot(interview) });
});

// 從收藏中投遞
studentRouter.post('/saved/:swipeId/apply', async (req, res) => {
  const swipe = await db.get('swipes', req.params.swipeId);
  if (!swipe || swipe.studentId !== req.user.userId || swipe.action !== 'save') {
    return res.status(404).json({ error: '找不到收藏' });
  }
  const { resumeId } = req.body;
  if (!(await ownResume(req, resumeId))) return res.status(400).json({ error: '投遞需要選一份履歷' });
  const job = await db.get('jobs', swipe.jobId);
  if (!job) return res.status(404).json({ error: '職缺已下架' });
  await applyToJob(req, job, resumeId);
  res.json(await db.update('swipes', swipe.id, { action: 'apply', resumeId }));
});

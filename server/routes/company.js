// 企業端 API（都需要登入）
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { parseJob, summarizeApplicant } from '../ai.js';
import { filesToInput, isEmptyInput, MAX_UPLOADS } from '../extract.js';
import { evaluate } from '../matching.js';
import { parseAddress } from '../../public/shared/taiwan.js';
import { pushMessage, linkCard, liffUrl } from '../line.js';
import { withEmbedding, stripEmbedding } from '../embeddings.js';
import { withFileUrls } from '../files.js';
import { bookingSettings, jobSlots, saveSlots, openSlots, addDays, dateLabel } from '../slots.js';
import { today } from '../matching.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: MAX_UPLOADS } });
export const companyRouter = Router();

const ownJob = async (req, id) => {
  const j = await db.get('jobs', id);
  return j && j.companyId === req.user.userId ? j : null;
};

// ---------- 職缺 ----------
companyRouter.get('/jobs', async (req, res) => {
  const jobs = await db.find('jobs', { companyId: req.user.userId });
  const apps = await db.find('applications', { companyId: req.user.userId });
  res.json(jobs.map((j) => ({ ...stripEmbedding(j), applicantCount: apps.filter((a) => a.jobId === j.id).length })));
});

// 上傳檔案智慧建檔：職缺說明、徵才海報、公司簡介…（可以好幾個檔案＋貼上文字）
// AI 合併後拆成結構化欄位，回傳草稿讓企業確認／微調
companyRouter.post('/jobs/parse', upload.array('files', MAX_UPLOADS), async (req, res) => {
  const input = await filesToInput(req.files || [], { text: req.body.text || '' });
  if (isEmptyInput(input)) {
    return res.status(400).json({ error: input.skipped.length ? `讀不到「${input.skipped.join('、')}」的內容，請改存成 PDF 或截圖上傳` : '請上傳檔案或貼上職缺說明' });
  }
  res.json({ ...(await parseJob(input)), skipped: input.skipped });
});

// 確認送出，開始媒合：職缺進入卡池
companyRouter.post('/jobs', async (req, res) => {
  const { id, applicantCount, embedding, createdAt, aiFailed, skipped, status, ...data } = req.body;
  let row = {
    ...data,
    wage: Number(data.wage) || 0,
    daysPerWeek: Number(data.daysPerWeek) || 0,
    durationMonths: Number(data.durationMonths) || 0,
    headcount: Number(data.headcount) || 0,
    interviewBooking: bookingSettings(data.interviewBooking),
    ...parseAddress(data.location), // 從地址辨識縣市與行政區，給學生用地區篩選
    companyId: req.user.userId,
    updatedAt: new Date().toISOString(),
  };
  row = await withEmbedding(row, 'job'); // 算語意向量，給學生端滑卡排序用
  if (id) {
    const old = await ownJob(req, id);
    if (!old) return res.status(404).json({ error: '找不到職缺' });
    // 編輯不會改變開放／關閉狀態
    const saved = await db.set('jobs', id, { ...row, status: old.status || 'open', createdAt: old.createdAt || row.updatedAt });
    return res.json(stripEmbedding(saved));
  }
  res.json(stripEmbedding(await db.add('jobs', { ...row, status: 'open', createdAt: row.updatedAt })));
});

// 關閉／重新開放職缺：關閉後不再出現在學生的卡池，已投遞的紀錄保留
companyRouter.post('/jobs/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'status 錯誤' });
  const job = await ownJob(req, req.params.id);
  if (!job) return res.status(404).json({ error: '找不到職缺' });
  res.json(stripEmbedding(await db.update('jobs', job.id, { status, updatedAt: new Date().toISOString() })));
});

// ---------- 應徵者（後台篩選）----------
// 清單只做規則比對（很快、不花 AI 額度）；AI 摘要等點開某位應徵者時才算
// ---------- 面試時段（同一職缺的應徵者共用）----------
companyRouter.get('/jobs/:jobId/slots', async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到職缺' });
  const [slots, apps] = await Promise.all([jobSlots(job.id), db.find('applications', { jobId: job.id })]);
  const nameOf = async (appId) => {
    const app = apps.find((a) => a.id === appId);
    const resume = app && ((await db.get('resumes', app.resumeId)) || app.resumeSnapshot);
    return resume?.name || '同學';
  };
  res.json({
    settings: bookingSettings(job.interviewBooking),
    slots: await Promise.all(slots.map(async ({ id, jobId, companyId, booked, ...s }) => ({
      ...s, closed: Boolean(s.closed), booked: booked.length, names: await Promise.all(booked.map(nameOf)),
    }))),
  });
});

// 儲存時段：{ settings: { minutes, capacity, replyDays, startHour, endHour }, starts: ['2026-10-20T14:00', …] }
companyRouter.put('/jobs/:jobId/slots', async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到職缺' });
  const settings = bookingSettings(req.body.settings);
  await db.update('jobs', job.id, { interviewBooking: settings });
  const { kept } = await saveSlots(job, settings, req.body.starts);
  res.json({ ok: true, kept, open: (await openSlots(job.id)).length });
});

// 面試行程總表：所有職缺的面試時段、誰預約了哪一格、還在等誰選時段
companyRouter.get('/schedule', async (req, res) => {
  const me = req.user.userId;
  const [jobs, slots, apps] = await Promise.all([
    db.find('jobs', { companyId: me }), db.find('slots', { companyId: me }), db.find('applications', { companyId: me }),
  ]);
  const jobOf = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const invited = apps.filter((a) => a.status === 'interview' && jobOf[a.jobId]);
  const names = Object.fromEntries(await Promise.all(invited.map(async (a) => {
    const r = (await db.get('resumes', a.resumeId)) || a.resumeSnapshot;
    return [a.id, { name: r?.name || '同學', school: [r?.school, r?.department].filter(Boolean).join(' ') }];
  })));
  const person = (a) => ({ appId: a.id, ...names[a.id], mode: a.interview.mode || '', place: a.interview.place || '', contact: a.interview.contact || '' });

  // 有時間的面試：同學選的時段＋企業直接指定的時間
  const booked = invited.filter((a) => a.interview?.date && a.interview?.time).map((a) => ({
    start: `${a.interview.date}T${a.interview.time}`, minutes: a.interview.minutes || 0,
    jobId: a.jobId, byStudent: Boolean(a.interview.booking), ...person(a),
  }));
  // 還沒有人選滿的時段（給企業看哪裡還空著）
  const open = slots.filter((s) => jobOf[s.jobId] && !s.closed && s.booked.length < s.capacity)
    .map((s) => ({ start: s.start, minutes: s.minutes, jobId: s.jobId, capacity: s.capacity, left: s.capacity - s.booked.length }));
  // 邀請了但還沒選時段
  const waiting = invited.filter((a) => a.interview?.booking && !a.interview.slot).map((a) => ({
    jobId: a.jobId, replyBy: a.interview.replyBy, unavailable: a.interview.unavailable || null, ...person(a),
  }));
  res.json({
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status })),
    booked: booked.sort((a, b) => a.start.localeCompare(b.start)),
    open: open.sort((a, b) => a.start.localeCompare(b.start)),
    waiting,
  });
});

companyRouter.get('/jobs/:jobId/applicants', async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到職缺' });
  const apps = await db.find('applications', { jobId: job.id });

  const rows = await Promise.all(apps.map(async (app) => {
    const resume = (await db.get('resumes', app.resumeId)) || app.resumeSnapshot; // 學生刪掉履歷時用投遞當下的副本
    if (!resume) return null;
    const { resumeSnapshot, ...rest } = app;
    return { ...rest, resume: withFileUrls(stripEmbedding(resume)), evaluation: evaluate(resume, job) };
  }));
  // 符合標準（學歷・科系・年級・必備技能全部符合）的排前面，其次是未達項目少的
  const unmet = (r) => r.evaluation.checks.filter((c) => c.key !== 'language' && !c.ok).length + r.evaluation.missingSkills.length;
  res.json(rows.filter(Boolean).sort((a, b) => unmet(a) - unmet(b)));
});

// AI 履歷摘要：算一次就存起來，避免每次打開都花時間與 API 費用
companyRouter.post('/applications/:id/summary', async (req, res) => {
  const app = await ownApplication(req);
  if (!app) return res.status(404).json({ error: '找不到應徵紀錄' });
  if (app.aiSummary) return res.json({ summary: app.aiSummary });
  const [found, job] = await Promise.all([db.get('resumes', app.resumeId), db.get('jobs', app.jobId)]);
  const resume = found || app.resumeSnapshot;
  if (!resume || !job) return res.status(404).json({ error: '找不到履歷或職缺' });
  const { text, aiFailed } = await summarizeApplicant(resume, job);
  if (!aiFailed) await db.update('applications', app.id, { aiSummary: text }); // AI 失敗時不存，下次重試
  res.json({ summary: text, aiFailed });
});

async function ownApplication(req) {
  const app = await db.get('applications', req.params.id);
  return app && app.companyId === req.user.userId ? app : null;
}

// 決定結果：收藏（待考慮，可以再改）→ 不適合 / 邀請面試（送出後不能更改）
const FINAL = ['rejected', 'interview'];
const clip = (v, n = 200) => String(v || '').trim().slice(0, n);

companyRouter.post('/applications/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'shortlisted', ...FINAL].includes(status)) return res.status(400).json({ error: 'status 錯誤' });
  const app = await ownApplication(req);
  if (!app) return res.status(404).json({ error: '找不到應徵紀錄' });
  if (FINAL.includes(app.status)) return res.status(409).json({ error: '已送出結果，不能再更改' });

  const patch = { status, decidedAt: FINAL.includes(status) ? new Date().toISOString() : null };
  let interview = null;
  if (status === 'interview') {
    const i = req.body.interview || {};
    const base = { mode: clip(i.mode, 10), place: clip(i.place), contact: clip(i.contact, 100), note: clip(i.note, 500) };
    if (i.booking) {
      // 讓同學自己從面試時段中選，回覆期限由企業決定
      if (!(await openSlots(app.jobId)).length) return res.status(400).json({ error: '這個職缺還沒有可預約的面試時段，請先設定' });
      const days = Math.min(30, Math.max(1, Number(i.replyDays) || 7));
      interview = { ...base, booking: true, replyBy: addDays(today(), days), slot: null, date: '', time: '' };
    } else {
      interview = { ...base, date: clip(i.date, 10), time: clip(i.time, 5) };
      if (!interview.date || !interview.time) return res.status(400).json({ error: '請填寫面試日期與時間' });
    }
    patch.interview = interview;
  }
  const updated = await db.update('applications', app.id, patch);

  if (interview) {
    const job = await db.get('jobs', app.jobId);
    const lines = [
      `${job.companyName}「${job.title}」想邀請你面試！`,
      '',
      interview.booking
        ? `🗓 請在 ${dateLabel(interview.replyBy)} 前，點下方按鈕選一個方便的面試時段`
        : `📅 ${dateLabel(interview.date)} ${interview.time}`,
      interview.mode && `💬 ${interview.mode}面試`,
      interview.place && `📍 ${interview.place}`,
      interview.contact && `☎️ 聯絡人：${interview.contact}`,
      interview.note && `\n${interview.note}`,
    ].filter((l) => l !== undefined && l !== '' && l !== false);
    await pushMessage(app.studentId, linkCard({
      title: '你收到面試邀請！🎉',
      body: lines.join('\n'),
      buttonLabel: interview.booking ? '選擇面試時段' : '查看詳情',
      url: liffUrl('student', `?tab=saved&job=${job.id}`),
    }));
  } else if (status === 'rejected') {
    const job = await db.get('jobs', app.jobId);
    await pushMessage(app.studentId, linkCard({
      title: '應徵結果通知',
      body: `謝謝你應徵${job.companyName}「${job.title}」。這次很可惜沒有機會合作，繼續滑卡，下一個更適合你的職缺可能就在後面！`,
      buttonLabel: '繼續找實習',
      url: liffUrl('student'),
    }));
  }
  res.json(updated);
});

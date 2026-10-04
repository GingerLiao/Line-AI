// 學生端 API（都需要登入）
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { parseResume, careerAdvice } from '../ai.js';
import { fileToText } from '../extract.js';
import { evaluate, passesFilters } from '../matching.js';
import { pushMessage, linkCard, liffUrl } from '../line.js';

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });
export const studentRouter = Router();

const ownResume = async (req, id) => {
  const r = await db.get('resumes', id);
  return r && r.ownerId === req.user.userId ? r : null;
};

// ---------- 履歷 ----------
studentRouter.get('/resumes', async (req, res) => {
  res.json(await db.find('resumes', { ownerId: req.user.userId }));
});

// AI 智慧建立履歷：上傳檔案或貼上文字 → 回傳結構化草稿（不存檔，讓學生確認後再存）
studentRouter.post('/resumes/parse', upload.single('file'), async (req, res) => {
  const text = req.file ? await fileToText(req.file) : req.body.text || '';
  if (!text.trim()) return res.status(400).json({ error: '請上傳檔案或貼上履歷文字' });
  res.json(await parseResume(text));
});

studentRouter.post('/resumes', async (req, res) => {
  const { id, ...data } = req.body;
  const row = { ...data, ownerId: req.user.userId, updatedAt: new Date().toISOString() };
  if (id) {
    if (!(await ownResume(req, id))) return res.status(404).json({ error: '找不到履歷' });
    return res.json(await db.set('resumes', id, row));
  }
  res.json(await db.add('resumes', row));
});

// ---------- 求職條件 ----------
studentRouter.get('/preferences', async (req, res) => {
  res.json((await db.get('preferences', req.user.userId)) || {});
});

studentRouter.put('/preferences', async (req, res) => {
  res.json(await db.set('preferences', req.user.userId, req.body));
});

// ---------- 卡池：符合條件、還沒滑過的職缺 ----------
studentRouter.get('/cards', async (req, res) => {
  const me = req.user.userId;
  const prefs = (await db.get('preferences', me)) || {};
  const swiped = new Set((await db.find('swipes', { studentId: me })).map((s) => s.jobId));
  let jobs = (await db.find('jobs', { status: 'open' })).filter((j) => !swiped.has(j.id) && passesFilters(j, prefs));

  // 「根據我的履歷智慧排序」：先篩掉硬條件，再依符合度排前面
  const resume = prefs.smartSort && prefs.resumeId ? await ownResume(req, prefs.resumeId) : null;
  if (resume) {
    jobs = jobs
      .map((j) => ({ ...j, match: evaluate(resume, j) }))
      .sort((a, b) => b.match.score - a.match.score);
  } else {
    jobs.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  }
  res.json(jobs);
});

// 符合條件的數量（篩選面板上的「查看 N 個符合職缺」）
studentRouter.post('/cards/count', async (req, res) => {
  const jobs = await db.find('jobs', { status: 'open' });
  res.json({ count: jobs.filter((j) => passesFilters(j, req.body)).length });
});

// ---------- AI 職涯健檢 ----------
studentRouter.post('/career-check', async (req, res) => {
  const { jobId, resumeId } = req.body;
  const [job, resume] = await Promise.all([db.get('jobs', jobId), ownResume(req, resumeId)]);
  if (!job || !resume) return res.status(404).json({ error: '找不到職缺或履歷' });
  const evaluation = evaluate(resume, job);
  const advice = await careerAdvice(resume, job, evaluation);
  res.json({ job: { title: job.title, companyName: job.companyName }, evaluation, advice });
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

// 我的收藏 / 投遞紀錄
studentRouter.get('/saved', async (req, res) => {
  const me = req.user.userId;
  const swipes = (await db.find('swipes', { studentId: me })).filter((s) => s.action !== 'skip');
  const apps = await db.find('applications', { studentId: me });
  const rows = await Promise.all(swipes.map(async (s) => ({
    ...s,
    job: await db.get('jobs', s.jobId),
    status: apps.find((a) => a.jobId === s.jobId)?.status,
  })));
  res.json(rows.filter((r) => r.job));
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

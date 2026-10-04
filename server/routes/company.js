// 企業端 API（都需要登入）
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { parseJob, summarizeApplicant } from '../ai.js';
import { fileToText } from '../extract.js';
import { evaluate } from '../matching.js';
import { pushMessage, linkCard, liffUrl } from '../line.js';

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });
export const companyRouter = Router();

const ownJob = async (req, id) => {
  const j = await db.get('jobs', id);
  return j && j.companyId === req.user.userId ? j : null;
};

// ---------- 職缺 ----------
companyRouter.get('/jobs', async (req, res) => {
  const jobs = await db.find('jobs', { companyId: req.user.userId });
  const apps = await db.find('applications', { companyId: req.user.userId });
  res.json(jobs.map((j) => ({ ...j, applicantCount: apps.filter((a) => a.jobId === j.id).length })));
});

// 上傳檔案智慧建檔：AI 把職缺說明拆成結構化欄位，回傳草稿讓企業確認／微調
companyRouter.post('/jobs/parse', upload.single('file'), async (req, res) => {
  const text = req.file ? await fileToText(req.file) : req.body.text || '';
  if (!text.trim()) return res.status(400).json({ error: '請上傳檔案或貼上職缺說明' });
  res.json(await parseJob(text));
});

// 確認送出，開始媒合：職缺進入卡池
companyRouter.post('/jobs', async (req, res) => {
  const { id, applicantCount, ...data } = req.body;
  const row = {
    ...data,
    wage: Number(data.wage) || 0,
    daysPerWeek: Number(data.daysPerWeek) || 0,
    durationMonths: Number(data.durationMonths) || 0,
    companyId: req.user.userId,
    status: data.status || 'open',
    updatedAt: new Date().toISOString(),
  };
  if (id) {
    if (!(await ownJob(req, id))) return res.status(404).json({ error: '找不到職缺' });
    return res.json(await db.set('jobs', id, row));
  }
  res.json(await db.add('jobs', { ...row, createdAt: row.updatedAt }));
});

// ---------- 應徵者（後台篩選）----------
companyRouter.get('/jobs/:jobId/applicants', async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到職缺' });
  const apps = await db.find('applications', { jobId: job.id });

  const rows = await Promise.all(apps.map(async (app) => {
    const resume = await db.get('resumes', app.resumeId);
    if (!resume) return null;
    const evaluation = evaluate(resume, job);
    // AI 摘要算一次就存起來，避免每次打開都花 API 費用
    if (!app.aiSummary) {
      app.aiSummary = await summarizeApplicant(resume, job);
      await db.update('applications', app.id, { aiSummary: app.aiSummary });
    }
    return { ...app, resume, evaluation };
  }));
  res.json(rows.filter(Boolean).sort((a, b) => b.evaluation.score - a.evaluation.score));
});

// 不適合 / 收藏 / 邀請面試
companyRouter.post('/applications/:id/status', async (req, res) => {
  const { status, message } = req.body;
  if (!['rejected', 'shortlisted', 'interview'].includes(status)) return res.status(400).json({ error: 'status 錯誤' });
  const app = await db.get('applications', req.params.id);
  if (!app || app.companyId !== req.user.userId) return res.status(404).json({ error: '找不到應徵紀錄' });

  const updated = await db.update('applications', app.id, { status });
  if (status === 'interview') {
    const job = await db.get('jobs', app.jobId);
    await pushMessage(app.studentId, linkCard({
      title: '你收到面試邀請！',
      body: `${job.companyName}「${job.title}」想邀請你面試。${message ? `\n\n${message}` : ''}`,
      buttonLabel: '查看詳情',
      url: liffUrl('student', '?tab=saved'),
    }));
  }
  res.json(updated);
});

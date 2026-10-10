// 企業端 API（都需要登入）
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { parseJob, summarizeApplicant } from '../ai.js';
import { fileToInput, isEmptyInput } from '../extract.js';
import { evaluate } from '../matching.js';
import { parseAddress } from '../../public/shared/taiwan.js';
import { pushMessage, linkCard, liffUrl } from '../line.js';
import { withEmbedding, stripEmbedding } from '../embeddings.js';
import { withFileUrls } from '../files.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
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

// 上傳檔案智慧建檔：AI 把職缺說明（PDF、文字檔、照片）拆成結構化欄位，回傳草稿讓企業確認／微調
companyRouter.post('/jobs/parse', upload.single('file'), async (req, res) => {
  const input = await fileToInput(req.file, req.body.text || '');
  if (isEmptyInput(input)) return res.status(400).json({ error: '請上傳檔案或貼上職缺說明' });
  res.json(await parseJob(input));
});

// 確認送出，開始媒合：職缺進入卡池
companyRouter.post('/jobs', async (req, res) => {
  const { id, applicantCount, embedding, createdAt, aiFailed, status, ...data } = req.body;
  let row = {
    ...data,
    wage: Number(data.wage) || 0,
    daysPerWeek: Number(data.daysPerWeek) || 0,
    durationMonths: Number(data.durationMonths) || 0,
    headcount: Number(data.headcount) || 0,
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
companyRouter.get('/jobs/:jobId/applicants', async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到職缺' });
  const apps = await db.find('applications', { jobId: job.id });

  const rows = await Promise.all(apps.map(async (app) => {
    const resume = await db.get('resumes', app.resumeId);
    if (!resume) return null;
    return { ...app, resume: withFileUrls(stripEmbedding(resume)), evaluation: evaluate(resume, job) };
  }));
  res.json(rows.filter(Boolean).sort((a, b) => b.evaluation.score - a.evaluation.score));
});

// AI 履歷摘要：算一次就存起來，避免每次打開都花時間與 API 費用
companyRouter.post('/applications/:id/summary', async (req, res) => {
  const app = await ownApplication(req);
  if (!app) return res.status(404).json({ error: '找不到應徵紀錄' });
  if (app.aiSummary) return res.json({ summary: app.aiSummary });
  const [resume, job] = await Promise.all([db.get('resumes', app.resumeId), db.get('jobs', app.jobId)]);
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
    interview = {
      date: clip(i.date, 10), time: clip(i.time, 5), mode: clip(i.mode, 10),
      place: clip(i.place), contact: clip(i.contact, 100), note: clip(i.note, 500),
    };
    if (!interview.date || !interview.time) return res.status(400).json({ error: '請填寫面試日期與時間' });
    patch.interview = interview;
  }
  const updated = await db.update('applications', app.id, patch);

  if (interview) {
    const job = await db.get('jobs', app.jobId);
    const lines = [
      `${job.companyName}「${job.title}」想邀請你面試！`,
      '',
      `📅 ${interview.date}（${'日一二三四五六'[new Date(interview.date).getDay()]}）${interview.time}`,
      interview.mode && `💬 ${interview.mode}面試`,
      interview.place && `📍 ${interview.place}`,
      interview.contact && `☎️ 聯絡人：${interview.contact}`,
      interview.note && `\n${interview.note}`,
    ].filter((l) => l !== undefined && l !== '' && l !== false);
    await pushMessage(app.studentId, linkCard({
      title: '你收到面試邀請！🎉',
      body: lines.join('\n'),
      buttonLabel: '查看詳情',
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

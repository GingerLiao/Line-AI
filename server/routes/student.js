// 學生端 API（都需要登入）
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { parseResume, careerAdvice } from '../ai.js';
import { fileToInput, isEmptyInput } from '../extract.js';
import { evaluate, passesFilters } from '../matching.js';
import { pushMessage, linkCard, liffUrl } from '../line.js';
import { rankJobs } from '../ranking.js';
import { embeddingModel } from '../ai.js';
import { withEmbedding, stripEmbedding } from '../embeddings.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
export const studentRouter = Router();

const ownResume = async (req, id) => {
  const r = await db.get('resumes', id);
  return r && r.ownerId === req.user.userId ? r : null;
};

// ---------- 履歷 ----------
studentRouter.get('/resumes', async (req, res) => {
  res.json((await db.find('resumes', { ownerId: req.user.userId })).map(stripEmbedding));
});

// AI 智慧建立履歷：上傳檔案（PDF、文字檔、照片）或貼上文字 → 回傳結構化草稿（不存檔，讓學生確認後再存）
studentRouter.post('/resumes/parse', upload.single('file'), async (req, res) => {
  const input = await fileToInput(req.file, req.body.text || '');
  if (isEmptyInput(input)) return res.status(400).json({ error: '請上傳檔案或貼上履歷文字' });
  res.json(await parseResume(input));
});

studentRouter.post('/resumes', async (req, res) => {
  const { id, ...data } = req.body;
  const { embedding, ...clean } = data;
  // 存檔時順便算語意向量，給滑卡排序用
  const row = await withEmbedding({ ...clean, ownerId: req.user.userId, updatedAt: new Date().toISOString() }, 'resume');
  if (id) {
    if (!(await ownResume(req, id))) return res.status(404).json({ error: '找不到履歷' });
    return res.json(stripEmbedding(await db.set('resumes', id, row)));
  }
  res.json(stripEmbedding(await db.add('resumes', row)));
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
  const { swipes, allJobs, candidates } = await cardPool(me, prefs);

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

// 我的收藏 / 投遞紀錄
studentRouter.get('/saved', async (req, res) => {
  const me = req.user.userId;
  const swipes = (await db.find('swipes', { studentId: me })).filter((s) => s.action !== 'skip');
  const apps = await db.find('applications', { studentId: me });
  const rows = await Promise.all(swipes.map(async (s) => {
    const app = apps.find((a) => a.jobId === s.jobId);
    return { ...s, job: stripEmbedding(await db.get('jobs', s.jobId)), status: app?.status, interview: app?.interview };
  }));
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

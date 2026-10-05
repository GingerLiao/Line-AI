import express from 'express';
import crypto from 'node:crypto';
import { config, demoMode } from './config.js';
import { db } from './db.js';
import { aiEnabled } from './ai.js';
import { requireUser } from './line.js';
import { studentRouter } from './routes/student.js';
import { companyRouter } from './routes/company.js';
import { startReminderCron, sendDeadlineReminders } from './reminder.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// 前端啟動時先拿設定（LIFF ID、是否為示範模式）
app.get('/api/config', (req, res) => {
  res.json({
    demoMode,
    liffIdStudent: config.line.liffIdStudent,
    liffIdCompany: config.line.liffIdCompany,
    oaBasicId: config.line.oaBasicId,
  });
});

app.use('/api/student', requireUser, studentRouter);
app.use('/api/company', requireUser, companyRouter);

// 健康檢查：給外部定時服務每 10 分鐘呼叫一次，避免 Render 免費方案休眠
app.get('/healthz', (req, res) => res.send('ok'));

// 外部排程每天呼叫一次，發送截止提醒：GET /api/cron/reminders?key=<CRON_SECRET>
// （同一則收藏只會提醒一次，重複呼叫不會重複推播）
app.get('/api/cron/reminders', async (req, res) => {
  const key = Buffer.from(String(req.query.key || ''));
  const secret = Buffer.from(config.cronSecret);
  if (!config.cronSecret || key.length !== secret.length || !crypto.timingSafeEqual(key, secret)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ sent: await sendDeadlineReminders() });
});

// 開發用：手動觸發截止提醒（示範模式才開放）
if (demoMode) app.post('/api/dev/run-reminders', async (req, res) => res.json({ sent: await sendDeadlineReminders() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`實習 Swipe 啟動於 http://localhost:${config.port}`);
  console.log(`  學生端：/student/   企業端：/company/`);
  console.log(`  資料庫：${db.kind}　AI：${aiEnabled ? 'OpenAI' : '規則版（未設定 OPENAI_API_KEY）'}　登入：${demoMode ? '示範模式' : 'LINE Login'}`);
  if (config.cronSecret) console.log('[reminder] 使用外部排程呼叫 /api/cron/reminders');
  else startReminderCron();
});

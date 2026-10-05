import express from 'express';
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
  startReminderCron();
});

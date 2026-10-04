// 收藏職缺截止提醒：每天定時檢查，對「已收藏、尚未投遞、即將截止」的職缺推播 LINE 訊息
import cron from 'node-cron';
import { db } from './db.js';
import { config } from './config.js';
import { daysUntil } from './matching.js';
import { pushMessage, linkCard, liffUrl } from './line.js';

export async function sendDeadlineReminders() {
  const saved = await db.find('swipes', { action: 'save', reminded: false });
  let sent = 0;
  for (const swipe of saved) {
    const job = await db.get('jobs', swipe.jobId);
    if (!job?.deadline) continue;
    const left = daysUntil(job.deadline);
    if (left < 0 || left > config.reminder.daysBefore) continue;

    await pushMessage(swipe.studentId, linkCard({
      title: `⏰ 收藏的職缺${left === 0 ? '今天' : ` ${left} 天後`}截止`,
      body: `${job.companyName}「${job.title}」報名截止 ${job.deadline}，別錯過！`,
      buttonLabel: '立即投遞',
      url: liffUrl('student', '?tab=saved'),
    }));
    await db.update('swipes', swipe.id, { reminded: true });
    sent++;
  }
  console.log(`[reminder] 已發送 ${sent} 則截止提醒`);
  return sent;
}

export function startReminderCron() {
  cron.schedule(config.reminder.cron, sendDeadlineReminders, { timezone: 'Asia/Taipei' });
  console.log(`[reminder] 排程已啟動：${config.reminder.cron}（Asia/Taipei）`);
}

// 收藏職缺截止提醒：每天定時檢查，對「已收藏、尚未投遞、即將截止」的職缺推播 LINE 訊息
import cron from 'node-cron';
import { db } from './db.js';
import { config } from './config.js';
import { daysUntil } from './matching.js';
import { pushMessage, linkCard, liffUrl } from './line.js';
import { dateLabel, slotLabel } from './slots.js';

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
      url: liffUrl('student', `?tab=saved&job=${job.id}`),
    }));
    await db.update('swipes', swipe.id, { reminded: true });
    sent++;
  }
  sent += await sendInterviewReminders();
  console.log(`[reminder] 已發送 ${sent} 則提醒`);
  return sent;
}

// 面試相關提醒（每則只發一次）：
//  - 還沒選時段、明天就是回覆期限
//  - 明天就要面試
async function sendInterviewReminders() {
  let sent = 0;
  for (const app of await db.find('applications', { status: 'interview' })) {
    const i = app.interview || {};
    const job = await db.get('jobs', app.jobId);
    if (!job) continue;
    const url = liffUrl('student', `?tab=saved&job=${job.id}`);
    if (i.booking && !i.slot && !i.unavailable && i.replyBy && daysUntil(i.replyBy) === 1 && !i.replyReminded) {
      await pushMessage(app.studentId, linkCard({
        title: '⏰ 記得選面試時段',
        body: `${job.companyName}「${job.title}」的面試時段，請在 ${dateLabel(i.replyBy)} 前選好。`,
        buttonLabel: '選擇面試時段', url,
      }));
      await db.update('applications', app.id, { interview: { ...i, replyReminded: true } });
      sent++;
    } else if (i.date && daysUntil(i.date) === 1 && !i.dayBeforeReminded) {
      await pushMessage(app.studentId, linkCard({
        title: '📅 明天要面試囉',
        body: `${job.companyName}「${job.title}」\n${i.slot ? slotLabel(i.slot, i.minutes) : `${dateLabel(i.date)} ${i.time}`}${i.mode ? `・${i.mode}` : ''}${i.place ? `\n📍 ${i.place}` : ''}`,
        buttonLabel: '查看詳情', url,
      }));
      await db.update('applications', app.id, { interview: { ...i, dayBeforeReminded: true } });
      sent++;
    }
  }
  return sent;
}

export function startReminderCron() {
  cron.schedule(config.reminder.cron, sendDeadlineReminders, { timezone: 'Asia/Taipei' });
  console.log(`[reminder] 排程已啟動：${config.reminder.cron}（Asia/Taipei）`);
}

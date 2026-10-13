// 面試時段預約
//  - 企業在職缺上設定可面試的時段（同一職缺的應徵者共用），每格長度、每格人數、回覆期限都由企業決定
//  - 邀請面試時選「讓同學自己選時段」，同學在期限內從還有名額的時段挑一個
//  - 時段存在 slots 資料表，一格一筆：{ jobId, companyId, start, minutes, capacity, booked: [應徵紀錄 id] }
//  - 時間一律用台北時間字串 'YYYY-MM-DDTHH:mm'，方便比較與顯示
import { db } from './db.js';
import { today } from './matching.js';

export const BOOKING_DEFAULTS = { minutes: 30, capacity: 1, replyDays: 7, startHour: 9, endHour: 18 };
const MAX_SLOTS = 400;
const START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const nowLocal = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16);
const slotId = (jobId, start) => `${jobId}_${start.replace(/\D/g, '')}`;
const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// 職缺的預約設定（缺的欄位用預設值補上）
export function bookingSettings(raw = {}) {
  const d = BOOKING_DEFAULTS;
  const startHour = clampInt(raw.startHour, 0, 23, d.startHour);
  return {
    minutes: clampInt(raw.minutes, 10, 240, d.minutes),
    capacity: clampInt(raw.capacity, 1, 50, d.capacity),
    replyDays: clampInt(raw.replyDays, 1, 30, d.replyDays),
    startHour,
    endHour: clampInt(raw.endHour, startHour + 1, 24, d.endHour),
  };
}

// 結束時間 'HH:mm'
export function slotEnd(start, minutes) {
  const [h, m] = start.slice(11, 16).split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function jobSlots(jobId) {
  return (await db.find('slots', { jobId })).sort((a, b) => a.start.localeCompare(b.start));
}

// 未來、還有名額的時段
export async function openSlots(jobId) {
  const now = nowLocal();
  return (await jobSlots(jobId)).filter((s) => s.start > now && !s.closed && s.booked.length < s.capacity);
}

// 企業儲存時段：starts 是要開放的所有時段開始時間
// 已經有人預約的時段不會被刪掉，只是不再開放給其他人（closed），等預約的同學改時段後才刪除
// 回傳 kept：被保留的數量，畫面提醒企業
export async function saveSlots(job, settings, starts) {
  const now = nowLocal();
  const wanted = new Set((starts || []).filter((s) => START_RE.test(s) && s > now).slice(0, MAX_SLOTS));
  const existing = await jobSlots(job.id);
  let kept = 0;
  for (const slot of existing) {
    if (wanted.has(slot.start)) continue;
    if (!slot.booked.length) await db.remove('slots', slot.id);
    else if (slot.start > now) {
      kept++;
      if (!slot.closed) await db.update('slots', slot.id, { closed: true });
    }
  }
  for (const start of wanted) {
    const old = existing.find((s) => s.start === start);
    // 已有人預約的時段：長度不變，人數不能少於已預約人數
    const row = old?.booked.length
      ? { ...old, closed: false, capacity: Math.max(settings.capacity, old.booked.length) }
      : { jobId: job.id, companyId: job.companyId, start, minutes: settings.minutes, capacity: settings.capacity, booked: old?.booked || [] };
    const { id, ...data } = row;
    await db.set('slots', slotId(job.id, start), data);
  }
  return { kept };
}

// 同學預約（或更改）時段；名額用 transaction 鎖住，兩個人同時按也不會超收
export async function bookSlot(app, start) {
  if (!START_RE.test(start || '')) throw httpError(400, '時段格式錯誤');
  if (start <= nowLocal()) throw httpError(400, '這個時段已經過了，請換一個');
  const slot = await db.transact('slots', slotId(app.jobId, start), (s) => {
    if (!s || s.closed) throw httpError(404, '這個時段已被企業取消，請重新選擇');
    if (s.booked.includes(app.id)) return null;
    if (s.booked.length >= s.capacity) throw httpError(409, '這個時段剛好額滿了，請換一個');
    return { ...s, booked: [...s.booked, app.id] };
  }) || await db.get('slots', slotId(app.jobId, start));
  const old = app.interview?.slot;
  if (old && old !== start) await releaseSlot(app, old);
  return slot;
}

export async function releaseSlot(app, start) {
  const id = slotId(app.jobId, start);
  const s = await db.transact('slots', id, (x) => (x ? { ...x, booked: x.booked.filter((b) => b !== app.id) } : null));
  if (s?.closed && !s.booked.length) await db.remove('slots', id); // 企業已經取消的時段，沒人了就刪掉
}

// 同學還能不能選／改時段：回覆期限內，而且原本的時段在 24 小時之後
export function canChooseSlot(interview) {
  if (!interview?.booking) return false;
  if (interview.replyBy && today() > interview.replyBy) return false;
  if (!interview.slot) return true;
  const in24h = new Date(Date.now() + 32 * 3600e3).toISOString().slice(0, 16); // 台北時間 + 24 小時
  return interview.slot > in24h;
}

const WEEK = '日一二三四五六';
export const dateLabel = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`;
export const slotLabel = (start, minutes) => `${dateLabel(start.slice(0, 10))} ${start.slice(11, 16)}–${slotEnd(start, minutes)}`;

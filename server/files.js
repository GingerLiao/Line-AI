// 履歷附件（證照、作品檔案）：存在資料庫裡，用「有時效的簽名網址」給學生本人與應徵的企業查看
//  - Firestore 一筆資料最多 1MB，所以檔案切成多塊存（每塊約 500KB）
//  - 網址形式：/files/<id>?exp=<到期時間>&sig=<簽名>，過期或簽名不對就打不開
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { db } from './db.js';
import { config } from './config.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CHUNK = 500 * 1024;
const LINK_TTL = 2 * 3600e3; // 簽名網址 2 小時內有效
// 沒設定 FILE_SECRET 時每次啟動隨機產生（重開後舊網址失效，重新整理頁面就會拿到新的）
const secret = config.fileSecret || crypto.randomBytes(32).toString('hex');

const sign = (id, exp) => crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');

export function fileUrl(id) {
  const exp = Date.now() + LINK_TTL;
  return `/files/${encodeURIComponent(id)}?exp=${exp}&sig=${sign(id, exp)}`;
}

// 學生上傳附件
const upload = multer({ limits: { fileSize: MAX_FILE_BYTES } });
export const studentFilesRouter = Router();
studentFilesRouter.post('/', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: '請選擇檔案' });
  if (!/^(image\/|application\/pdf$)/.test(f.mimetype)) return res.status(400).json({ error: '只支援 PDF 或圖片' });
  const name = Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 120); // multer 檔名是 latin1，轉回中文
  const chunks = Math.ceil(f.size / CHUNK);
  const meta = await db.add('files', {
    ownerId: req.user.userId, name, mime: f.mimetype, size: f.size, chunks, createdAt: new Date().toISOString(),
  });
  for (let i = 0; i < chunks; i++) {
    await db.set('fileChunks', `${meta.id}-${i}`, { data: f.buffer.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64') });
  }
  res.json({ id: meta.id, name, mime: f.mimetype, size: f.size, url: fileUrl(meta.id) });
});

// 用簽名網址下載／預覽
export const publicFilesRouter = Router();
publicFilesRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig || '');
  const expected = sign(id, exp);
  const ok = exp > Date.now() && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return res.status(403).send('連結已過期，請回到頁面重新開啟');
  const meta = await db.get('files', id);
  if (!meta) return res.status(404).send('找不到檔案');
  const parts = [];
  for (let i = 0; i < meta.chunks; i++) parts.push(Buffer.from((await db.get('fileChunks', `${id}-${i}`))?.data || '', 'base64'));
  res.set({
    'Content-Type': meta.mime,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(Buffer.concat(parts));
});

// ---------- 履歷裡的附件欄位 ----------
export const RESUME_SECTIONS = ['awards', 'projects', 'activities'];

// 存檔前：只保留自己上傳的檔案（避免引用別人的檔案 id），並拿掉暫時的網址
export async function cleanResumeFiles(resume, ownerId) {
  const out = { ...resume };
  for (const key of RESUME_SECTIONS) {
    out[key] = await Promise.all((resume[key] || []).map(async (item) => {
      const fileId = item.file?.id;
      const meta = fileId ? await db.get('files', fileId) : null;
      return { ...item, file: meta && meta.ownerId === ownerId ? { id: meta.id, name: meta.name, mime: meta.mime } : null };
    }));
  }
  return out;
}

// 回傳給前端前：每個附件加上簽名網址
export function withFileUrls(resume) {
  if (!resume) return resume;
  const out = { ...resume };
  for (const key of RESUME_SECTIONS) {
    out[key] = (resume[key] || []).map((item) => (item.file?.id ? { ...item, file: { ...item.file, url: fileUrl(item.file.id) } } : item));
  }
  return out;
}

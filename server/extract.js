// 把上傳的檔案、貼上的文字、連結整理成 AI 可以解析的內容（可以一次很多個）
//  - PDF / Word / PowerPoint / 純文字 → 讀出文字
//  - 照片、截圖 → 圖片，交給 AI 直接看圖
// 回傳 { text, images: [data URI], sources: [{ no, name, kind }], skipped: [檔名] }
import { PDFParse } from 'pdf-parse';
import { docxText, pptxText } from './office.js';

export const MAX_UPLOADS = 8; // 一次最多幾個檔案
const MAX_IMAGES = 6; // 圖片太多 AI 會變慢
const MAX_CHARS_PER_FILE = 15_000;
const MAX_CHARS = 40_000;

// multer 給的中文檔名是 latin1 編碼，轉回 UTF-8
export const fileName = (f) => Buffer.from(f.originalname || '', 'latin1').toString('utf8').slice(0, 120) || '檔案';

const ext = (name) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';

async function pdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

// 一個檔案 → { text } 或 { image }；讀不出來回傳 null
async function readFile(f) {
  const name = fileName(f);
  const e = ext(name);
  if (f.mimetype?.startsWith('image/')) return { image: `data:${f.mimetype};base64,${f.buffer.toString('base64')}` };
  if (f.mimetype === 'application/pdf' || e === 'pdf') return { text: await pdfText(f.buffer) };
  if (e === 'docx') return { text: docxText(f.buffer) };
  if (e === 'pptx') return { text: pptxText(f.buffer) };
  if (['doc', 'ppt', 'xls', 'pages', 'key', 'hwp'].includes(e)) return null; // 舊格式讀不了，請另存成 PDF
  // 其他：看起來是文字就當文字（txt、md、csv、html…）
  const s = f.buffer.toString('utf8');
  return s.includes('�') || /[\x00-\x08]/.test(s.slice(0, 2000)) ? null : { text: s };
}

export async function filesToInput(files = [], { text = '', links = [] } = {}) {
  const parts = [];
  const images = [];
  const sources = [];
  const skipped = [];
  if (text.trim()) parts.push(`【貼上的文字】\n${text.trim()}`);

  for (const [i, f] of files.entries()) {
    const no = i + 1;
    const name = fileName(f);
    let got = null;
    try {
      got = await readFile(f);
    } catch (err) {
      console.error(`[extract] ${name} 讀取失敗：${err.message}`);
    }
    if (got?.image && images.length < MAX_IMAGES) {
      images.push(got.image);
      parts.push(`【檔案 ${no}：${name}】（圖片，見第 ${images.length} 張附圖）`);
      sources.push({ no, name, kind: 'image' });
    } else if (got?.text?.trim()) {
      parts.push(`【檔案 ${no}：${name}】\n${got.text.trim().slice(0, MAX_CHARS_PER_FILE)}`);
      sources.push({ no, name, kind: 'text' });
    } else {
      skipped.push(name); // 掃描檔 PDF、舊版 Office、圖片太多…
    }
  }
  if (links.length) parts.push(`【連結】\n${links.join('\n')}`);
  return { text: parts.join('\n\n').slice(0, MAX_CHARS), images, sources, skipped };
}

export const isEmptyInput = (input) => !input.images?.length && !input.text?.trim();

// 使用者輸入的連結：一行一個（或用空白、逗號分隔），只留 http(s)
export const parseLinks = (s) => [...new Set(String(s || '').split(/[\s,，、]+/).filter((x) => /^https?:\/\/\S+$/i.test(x)))].slice(0, 10);

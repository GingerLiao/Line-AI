// 讀出 Word（.docx）與 PowerPoint（.pptx）裡的文字，不需要額外套件
// 這兩種檔案其實是 ZIP 壓縮檔，文字放在裡面的 XML：
//  - Word：word/document.xml
//  - PowerPoint：ppt/slides/slide1.xml、slide2.xml…
import zlib from 'node:zlib';

const MAX_XML = 20 * 1024 * 1024; // 解壓後最多 20MB，避免惡意檔案塞爆記憶體

// 讀 ZIP 的目錄，回傳 { 檔名: 讀取函式 }
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是有效的 Office 檔案');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count && buf.readUInt32LE(off) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(off + 10);
    const size = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const skip = nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries[name] = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: MAX_XML }) : data).toString('utf8');
    };
    off += 46 + skip;
  }
  return entries;
}

const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

// 段落結束換行、Tab 保留，其餘標籤拿掉
const xmlText = (xml, para) => decode(xml.replace(new RegExp(`</${para}>`, 'g'), '\n').replace(/<w:tab\/>|<a:tab\/>/g, '\t'))
  .replace(/\n{3,}/g, '\n\n').trim();

export function docxText(buf) {
  const zip = unzip(buf);
  if (!zip['word/document.xml']) throw new Error('讀不到 Word 內容');
  return xmlText(zip['word/document.xml'](), 'w:p');
}

export function pptxText(buf) {
  const zip = unzip(buf);
  const slides = Object.keys(zip)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return slides.map((n, i) => `（第 ${i + 1} 頁）\n${xmlText(zip[n](), 'a:p')}`).join('\n\n');
}

// 把上傳的檔案轉成 AI 可以解析的內容
//  - PDF / 純文字 → { text }
//  - 照片（JPG / PNG / WebP…）→ { image: data URI }，交給 AI 直接看圖
import { PDFParse } from 'pdf-parse';

export async function fileToText(file) {
  if (!file) return '';
  const isPdf = file.mimetype === 'application/pdf' || file.originalname?.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const { text } = await parser.getText();
      return text;
    } finally {
      await parser.destroy();
    }
  }
  return file.buffer.toString('utf8');
}

// 上傳的檔案（或貼上的文字）→ parseResume / parseJob 的輸入
export async function fileToInput(file, pastedText = '') {
  if (file?.mimetype?.startsWith('image/')) {
    return { image: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` };
  }
  return { text: file ? await fileToText(file) : pastedText };
}

export const isEmptyInput = (input) => !input.image && !input.text?.trim();

// 把上傳的檔案（PDF / 純文字）轉成文字，交給 AI 解析
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

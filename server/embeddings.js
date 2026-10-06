// 履歷／職缺存檔時順便算好語意向量，滑卡排序時就不用再呼叫 AI
import { embedText, embeddingModel } from './ai.js';
import { jobText, resumeText } from './ranking.js';

export async function withEmbedding(row, kind) {
  const text = kind === 'job' ? jobText(row) : resumeText(row);
  const embedding = await embedText(text);
  return embedding ? { ...row, embedding } : { ...row, embedding: null };
}

// 是否需要（重新）計算：沒有向量，或向量是別的模型算的
export const needsEmbedding = (row) => row.embedding?.model !== embeddingModel;

// 向量很長，不需要傳給前端
export function stripEmbedding(row) {
  if (!row) return row;
  const { embedding, ...rest } = row;
  return rest;
}

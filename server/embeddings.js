// 履歷／職缺存檔時順便算好語意向量，滑卡排序時就不用再呼叫 AI
import { embedText, embeddingModel } from './ai.js';
import { jobText, resumeText } from './ranking.js';
import { packVector, isPacked } from './vectors.js';

export async function withEmbedding(row, kind) {
  const text = kind === 'job' ? jobText(row) : resumeText(row);
  const embedding = await embedText(text);
  // 向量壓成一段字串存，Firestore 讀取時比數字陣列省很多記憶體
  return embedding ? { ...row, embedding: { model: embedding.model, vector: packVector(embedding.vector) } } : { ...row, embedding: null };
}

// 是否需要（重新）計算：沒有向量，或向量是別的模型算的
export const needsEmbedding = (row) => row.embedding?.model !== embeddingModel;

// 舊格式（數字陣列）要轉成字串格式
export const needsPacking = (row) => Boolean(row.embedding?.vector) && !isPacked(row.embedding);
export const packEmbedding = (embedding) => ({ ...embedding, vector: packVector(embedding.vector) });

// 向量很長，不需要傳給前端
export function stripEmbedding(row) {
  if (!row) return row;
  const { embedding, ...rest } = row;
  return rest;
}

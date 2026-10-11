// 補算語意向量：npm run embed
// 用在剛開啟 AI、換了 embedding 模型，或之前 AI 忙碌沒算到的履歷／職缺
import { db } from './db.js';
import { embeddingModel } from './ai.js';
import { withEmbedding, needsEmbedding, needsPacking, packEmbedding } from './embeddings.js';

let done = 0, failed = 0, packed = 0;
for (const [col, kind] of [['jobs', 'job'], ['resumes', 'resume']]) {
  for (const row of await db.find(col)) {
    if (!needsEmbedding(row)) {
      // 模型沒變，只是舊的數字陣列格式：轉成省記憶體的字串格式，不用重新呼叫 AI
      if (needsPacking(row)) { await db.update(col, row.id, { embedding: packEmbedding(row.embedding) }); packed++; }
      continue;
    }
    const { id, ...data } = await withEmbedding(row, kind);
    if (!data.embedding) { failed++; continue; }
    await db.update(col, id, { embedding: data.embedding });
    done++;
  }
}
console.log(`語意向量模型：${embeddingModel}　補算 ${done} 筆、轉換格式 ${packed} 筆${failed ? `，失敗 ${failed} 筆（稍後再執行一次）` : ''}`);
process.exit(0);

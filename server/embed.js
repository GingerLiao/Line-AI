// 補算語意向量：npm run embed
// 用在剛開啟 AI、換了 embedding 模型，或之前 AI 忙碌沒算到的履歷／職缺
import { db } from './db.js';
import { embeddingModel } from './ai.js';
import { withEmbedding, needsEmbedding } from './embeddings.js';

let done = 0, failed = 0;
for (const [col, kind] of [['jobs', 'job'], ['resumes', 'resume']]) {
  for (const row of await db.find(col)) {
    if (!needsEmbedding(row)) continue;
    const { id, ...data } = await withEmbedding(row, kind);
    if (!data.embedding) { failed++; continue; }
    await db.update(col, id, { embedding: data.embedding });
    done++;
  }
}
console.log(`語意向量模型：${embeddingModel}　補算 ${done} 筆${failed ? `，失敗 ${failed} 筆（稍後再執行一次）` : ''}`);
process.exit(0);

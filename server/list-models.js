// 列出目前 AI 金鑰可以用的模型：npm run models
// 用的是 .env 裡同一組 OPENAI_API_KEY／OPENAI_BASE_URL，跟網站呼叫 AI 的方式一樣
import OpenAI from 'openai';
import { config } from './config.js';

if (!config.openai.apiKey) {
  console.log('尚未設定 OPENAI_API_KEY');
  process.exit(1);
}
const client = new OpenAI({ apiKey: config.openai.apiKey, baseURL: config.openai.baseURL });
const ids = [];
for await (const m of client.models.list()) ids.push(m.id.replace(/^models\//, ''));
ids.sort();

const embed = ids.filter((id) => /embed/i.test(id));
const chat = ids.filter((id) => !/embed/i.test(id));
console.log('=== 語意向量模型（填 OPENAI_EMBEDDING_MODEL）===');
console.log(embed.length ? embed.join('\n') : '（沒有找到）');
console.log('\n=== 對話模型（填 OPENAI_MODEL／OPENAI_FALLBACK_MODELS）===');
console.log(chat.join('\n'));
console.log(`\n目前設定：OPENAI_MODEL=${config.openai.model}  OPENAI_EMBEDDING_MODEL=${config.openai.embeddingModel || '（未設定）'}`);

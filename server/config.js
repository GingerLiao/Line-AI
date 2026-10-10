import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  publicBaseUrl: env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`,

  line: {
    loginChannelId: env.LINE_LOGIN_CHANNEL_ID || '',
    liffIdStudent: env.LIFF_ID_STUDENT || '',
    liffIdCompany: env.LIFF_ID_COMPANY || '',
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    // 官方帳號的 Basic ID（@ 開頭），用來產生「加入好友」連結
    oaBasicId: env.LINE_OA_BASIC_ID || '',
  },

  openai: {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    // 改用其他「OpenAI 相容」的服務（例如 Google Gemini 免費方案）時填它的網址；留空就是 OpenAI
    baseURL: env.OPENAI_BASE_URL || undefined,
    // 主要模型忙碌或失敗時，依序改用的備用模型（逗號分隔）
    // 語意向量（Embeddings）模型：OpenAI 預設 text-embedding-3-small；用 Gemini 時要另外設定
    embeddingModel: env.OPENAI_EMBEDDING_MODEL || (env.OPENAI_BASE_URL ? '' : 'text-embedding-3-small'),
    fallbackModels: (env.OPENAI_FALLBACK_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean),
  },

  firestoreEnabled: Boolean(env.GOOGLE_APPLICATION_CREDENTIALS),

  // 外部排程（例如 cron-job.org）觸發截止提醒用的密碼；有設定就不啟動程式內建的排程
  cronSecret: env.CRON_SECRET || '',

  // 履歷附件簽名網址用的密碼（不設定也能用，但伺服器重開後舊網址會失效）
  fileSecret: env.FILE_SECRET || '',

  reminder: {
    cron: env.REMINDER_CRON || '0 9 * * *',
    daysBefore: Number(env.REMINDER_DAYS_BEFORE || 3),
  },
};

// 沒有設定 LINE Login 時，開啟示範模式：用 ?as=<userId> 假裝登入
export const demoMode = !config.line.loginChannelId;

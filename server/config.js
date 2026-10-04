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
  },

  openai: {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  firestoreEnabled: Boolean(env.GOOGLE_APPLICATION_CREDENTIALS),

  reminder: {
    cron: env.REMINDER_CRON || '0 9 * * *',
    daysBefore: Number(env.REMINDER_DAYS_BEFORE || 3),
  },
};

// 沒有設定 LINE Login 時，開啟示範模式：用 ?as=<userId> 假裝登入
export const demoMode = !config.line.loginChannelId;

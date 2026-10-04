// LINE 相關：驗證 LIFF 傳來的 ID Token、透過 Messaging API 推播訊息
import { config, demoMode } from './config.js';

// 驗證 LIFF 的 ID Token，回傳 { userId, name }
// 文件：https://developers.line.biz/en/reference/line-login/#verify-id-token
export async function verifyIdToken(idToken) {
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: config.line.loginChannelId }),
  });
  if (!res.ok) throw new Error(`ID token 驗證失敗：${await res.text()}`);
  const payload = await res.json();
  return { userId: payload.sub, name: payload.name };
}

// Express middleware：把登入者放進 req.user
//  - 正式模式：Authorization: Bearer <LIFF ID Token>
//  - 示範模式：X-Demo-User: <userId>
export async function requireUser(req, res, next) {
  try {
    if (demoMode) {
      const userId = req.get('X-Demo-User');
      if (!userId) return res.status(401).json({ error: '示範模式請帶 X-Demo-User 標頭' });
      req.user = { userId, name: userId };
      return next();
    }
    const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
    if (!token) return res.status(401).json({ error: '尚未登入 LINE' });
    req.user = await verifyIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
}

// 推播訊息給某位使用者
// 文件：https://developers.line.biz/en/reference/messaging-api/#send-push-message
export async function pushMessage(to, messages) {
  messages = Array.isArray(messages) ? messages : [messages];
  if (!config.line.channelAccessToken) {
    console.log(`[push:demo] → ${to}`, JSON.stringify(messages));
    return;
  }
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.line.channelAccessToken}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) console.error('[push] 失敗', res.status, await res.text());
}

// 簡單的按鈕卡片（Flex Message），點了會打開 LIFF 頁面
export function linkCard({ title, body, buttonLabel, url }) {
  return {
    type: 'flex',
    altText: `${title}：${body}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', color: '#06C755' },
          { type: 'text', text: body, wrap: true, size: 'sm', color: '#333333' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: buttonLabel, uri: url } },
        ],
      },
    },
  };
}

// 推播訊息裡的連結：有 LIFF ID 就用 liff.line.me 開啟（會在 LINE 內開），否則用一般網址
export function liffUrl(side, pathAndQuery = '') {
  const liffId = side === 'company' ? config.line.liffIdCompany : config.line.liffIdStudent;
  if (liffId) return `https://liff.line.me/${liffId}${pathAndQuery}`;
  return `${config.publicBaseUrl}/${side}/${pathAndQuery}`;
}

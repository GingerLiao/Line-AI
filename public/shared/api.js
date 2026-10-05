// 前端共用：LINE 登入（LIFF）與呼叫後端 API
//  - 正式模式：用 LIFF 登入，拿 ID Token 放在 Authorization 標頭
//  - 示範模式（後端沒設定 LINE_LOGIN_CHANNEL_ID）：網址加 ?as=<userId> 假裝登入
let authHeaders = {};
export let profile = { displayName: '' };

export async function initAuth(side) {
  const cfg = await fetch('/api/config').then((r) => r.json());

  if (cfg.demoMode) {
    const params = new URLSearchParams(location.search);
    const key = `demo-user-${side}`;
    const userId = params.get('as') || safeGet(key) || `demo-${side}`;
    safeSet(key, userId);
    authHeaders = { 'X-Demo-User': userId };
    profile = { displayName: userId };
    return { demo: true, cfg };
  }

  const liffId = side === 'company' ? cfg.liffIdCompany : cfg.liffIdStudent;
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    await new Promise(() => {}); // 等待跳轉
  }
  authHeaders = { Authorization: `Bearer ${liff.getIDToken()}` };
  profile = await liff.getProfile();
  return { demo: false, cfg };
}

// 登出後回到網站首頁（示範模式只清掉假帳號）
export function logout(side) {
  safeSet(`demo-user-${side}`, '');
  if (window.liff?.isLoggedIn?.()) liff.logout();
  location.href = '/';
}

// 是否已加官方帳號好友（推播的前提）。無法判斷時回傳 null
export async function isFriend() {
  try {
    const { friendFlag } = await liff.getFriendship();
    return friendFlag;
  } catch {
    return null;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { ...authHeaders } };
  if (form) {
    opts.body = form; // FormData：瀏覽器會自動設定 Content-Type
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- 小工具 ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 所有使用者輸入的內容都要先跳脫再放進 innerHTML，避免 XSS
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

export function daysLeft(date) {
  if (!date) return null;
  const t = new Date(new Date().toLocaleDateString('sv', { timeZone: 'Asia/Taipei' }));
  return Math.round((new Date(date) - t) / 86400e3);
}

export const mmdd = (date) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '—');
export const splitList = (s) => String(s || '').split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean);

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// 前端共用：LINE 登入（LIFF）與呼叫後端 API
//  - 正式模式：用 LIFF 登入，拿 ID Token 放在 Authorization 標頭
//  - 示範模式（後端沒設定 LINE_LOGIN_CHANNEL_ID）：網址加 ?as=<userId> 假裝登入
let authHeaders = {};
let liffId = null; // 有值代表使用 LIFF 正式登入
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

  liffId = side === 'company' ? cfg.liffIdCompany : cfg.liffIdStudent;
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    await new Promise(() => {}); // 等待跳轉
  }
  // 瀏覽器可能還記著昨天的 ID Token，過期就先重新登入，免得使用者填完表單才失敗
  if (!tokenValid()) await relogin();
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

// ID Token 是否還有效（預留 1 分鐘緩衝）
function tokenValid() {
  const decoded = liff.getDecodedIDToken();
  return Boolean(decoded?.exp && decoded.exp * 1000 > Date.now() + 60_000);
}

// ID Token 過期時重新登入拿新的：
//  - LINE App 內：重新從 liff.line.me 開啟，LINE 會發新的 token
//  - 一般瀏覽器：登出再登入
// 30 秒內重複發生就停止，避免無限跳轉
async function relogin() {
  const key = 'liff-relogin-at';
  if (Date.now() - Number(safeGet(key, 'sessionStorage') || 0) < 30_000) {
    toast('登入已過期，請關閉頁面後重新開啟');
    throw new Error('登入已過期，請關閉頁面後重新開啟');
  }
  safeSet(key, String(Date.now()), 'sessionStorage');
  if (liff.isInClient()) {
    location.replace(`https://liff.line.me/${liffId}${location.search}`);
  } else {
    liff.logout();
    liff.login({ redirectUri: location.href });
  }
  await new Promise(() => {}); // 等待跳轉
}

export async function api(path, { method = 'GET', body, form } = {}) {
  if (liffId) {
    if (!tokenValid()) await relogin();
    authHeaders = { Authorization: `Bearer ${liff.getIDToken()}` };
  }
  const opts = { method, headers: { ...authHeaders } };
  if (form) {
    opts.body = form; // FormData：瀏覽器會自動設定 Content-Type
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && liffId && /expired/i.test(data.error || '')) await relogin();
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

function safeGet(k, store = 'localStorage') { try { return window[store].getItem(k); } catch { return null; } }
function safeSet(k, v, store = 'localStorage') { try { window[store].setItem(k, v); } catch {} }

// 滑卡排序：把「比較適合這位學生」的職缺排在前面
//
// 符合度 = 規則分數 + AI 語意分數 + 個人偏好分數 + 時效分數（加權）
//   - 規則分數：學歷／科系／年級／技能逐項比對（matching.evaluate）
//   - AI 語意分數：履歷與職缺的語意向量有多接近（Embeddings）
//   - 個人偏好分數：這位學生滑過的職缺 → 推出他喜歡的方向（行為學習）
//   - 時效分數：快截止、剛刊登的稍微往前
// 每 5 張卡穿插 1 張「探索」職缺，避免只推同一類（同溫層）。
import { evaluate, daysUntil } from './matching.js';

// ---------- 要拿去算語意向量的文字 ----------
export function jobText(job) {
  return [
    job.title, job.category, job.description,
    ...(job.responsibilities || []),
    `必備技能：${(job.requiredSkills || []).join('、')}`,
    `加分條件：${(job.bonusSkills || []).join('、')}`,
  ].filter(Boolean).join('\n');
}

export function resumeText(resume) {
  return [
    resume.title, resume.department,
    `技能：${(resume.skills || []).join('、')}`,
    resume.about,
    // 競賽證照、專案作品、活動經歷（舊版履歷是 experiences）
    ...['awards', 'projects', 'activities', 'experiences'].flatMap((k) => (resume[k] || []).map((e) => `${e.title}${e.role ? `（${e.role}）` : ''}：${e.description || ''}`)),
  ].filter(Boolean).join('\n');
}

// ---------- 向量運算 ----------
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : null;
}

// 兩個向量要由同一個模型產生才能比較
const vecOf = (row, model) => (row?.embedding?.model === model ? row.embedding.vector : null);

// ---------- 行為學習：從滑卡紀錄算出「偏好方向」 ----------
const ACTION_WEIGHT = { apply: 1, save: 0.7, skip: -0.3 };
const MAX_HISTORY = 50; // 只看最近 50 筆，興趣改變時能跟著調整

export function preferenceVector(swipes, jobsById, model) {
  const recent = [...swipes]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, MAX_HISTORY);
  let pref = null;
  let count = 0;
  for (const s of recent) {
    const w = ACTION_WEIGHT[s.action];
    const v = vecOf(jobsById.get(s.jobId), model);
    if (!w || !v) continue;
    pref ||= new Array(v.length).fill(0);
    for (let i = 0; i < v.length; i++) pref[i] += w * v[i];
    count++;
  }
  // 只有跳過、沒有任何喜歡的紀錄時，偏好方向沒有意義
  const liked = recent.some((s) => s.action !== 'skip' && vecOf(jobsById.get(s.jobId), model));
  return { vector: liked ? pref : null, count };
}

// 滑越多張越相信偏好：5 張以下 0、20 張以上 1
export const preferenceTrust = (count) => Math.max(0, Math.min(1, (count - 5) / 15));

// ---------- 時效 ----------
function timeScore(job, today) {
  const left = job.deadline ? daysUntil(job.deadline) : 60;
  const urgency = Math.max(0, Math.min(1, 1 - left / 30)); // 30 天內越接近截止越高
  const ageDays = job.createdAt ? (today - new Date(job.createdAt)) / 86400e3 : 99;
  const fresh = ageDays <= 7 ? 1 : 0; // 一週內刊登
  return 0.6 * urgency + 0.4 * fresh;
}

// 把相似度縮放到 0～1（只用來排序，數字本身不顯示）
// 差距至少當作 0.2 來算，避免候選很少時，微小差距被放大成 0 和 1、蓋過硬條件
const MIN_SPREAD = 0.2;
function normalize(values) {
  const nums = values.filter((v) => v !== null);
  if (!nums.length) return values;
  const min = Math.min(...nums), max = Math.max(...nums);
  const spread = Math.max(max - min, MIN_SPREAD);
  const offset = (spread - (max - min)) / 2; // 差距很小時，大家都落在中間附近
  return values.map((v) => (v === null ? null : (v - min + offset) / spread));
}

// ---------- 主程式 ----------
// jobs：候選職缺（已過濾硬條件、未滑過）
// allJobsById：所有職缺（用來查滑過的職缺向量）
// resume：開啟「根據履歷智慧排序」時的履歷，否則 null
export function rankJobs({ jobs, resume, swipes = [], allJobsById, model, now = new Date(), exploreEvery = 5 }) {
  if (!jobs.length) return [];

  const { vector: prefVec, count } = preferenceVector(swipes, allJobsById || new Map(), model);
  const trust = prefVec ? preferenceTrust(count) : 0;
  const resumeVec = vecOf(resume, model);

  const rule = jobs.map((j) => (resume ? evaluate(resume, j) : null));
  const semantic = normalize(jobs.map((j) => (resumeVec ? cosine(resumeVec, vecOf(j, model)) : null)));
  const preference = normalize(jobs.map((j) => (prefVec && trust > 0 ? cosine(prefVec, vecOf(j, model)) : null)));
  const time = jobs.map((j) => timeScore(j, now));

  const weights = {
    rule: 0.5 - 0.05 * trust,
    semantic: 0.4 - 0.15 * trust,
    preference: 0.2 * trust,
    time: 0.1,
  };

  const scored = jobs.map((job, i) => {
    const parts = {
      rule: rule[i] ? rule[i].score / 100 : null,
      semantic: semantic[i],
      preference: preference[i],
      time: time[i],
    };
    // 沒有的分數（例如沒開履歷排序、沒有向量）就不算，其餘權重重新分配
    let sum = 0, wsum = 0;
    for (const [k, v] of Object.entries(parts)) {
      if (v === null || v === undefined || !weights[k]) continue;
      sum += weights[k] * v;
      wsum += weights[k];
    }
    const rank = wsum ? sum / wsum : 0;
    return { ...job, match: rule[i] ? { ...rule[i] } : undefined, rank, reasons: reasonsFor(job, parts, rule[i]) };
  });

  scored.sort((a, b) => b.rank - a.rank);
  return insertExploration(scored, exploreEvery);
}

function reasonsFor(job, parts, ev) {
  const r = [];
  if (ev && ev.checks.every((c) => c.ok) && !ev.missingSkills.length) r.push('條件都符合');
  else if (ev && !ev.missingSkills.length) r.push('技能符合');
  if (parts.semantic !== null && parts.semantic >= 0.7) r.push('經歷相關');
  if (parts.preference !== null && parts.preference >= 0.7) r.push('你可能喜歡');
  const left = job.deadline ? daysUntil(job.deadline) : null;
  if (left !== null && left <= 3) r.push('即將截止');
  return r;
}

// 每 N 張的最後一張，換成後半段的職缺，讓學生看看不同類型
function insertExploration(list, every) {
  if (!every || list.length < every + 1) return list;
  const out = [];
  const head = list.slice(0, Math.ceil(list.length / 2));
  const tail = list.slice(head.length);
  while (head.length || tail.length) {
    const pos = out.length + 1;
    if (pos % every === 0 && tail.length) {
      out.push({ ...tail.shift(), explore: true });
    } else {
      out.push(head.length ? head.shift() : tail.shift());
    }
  }
  return out;
}

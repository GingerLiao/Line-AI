// 媒合邏輯（不需要 AI，可預期、可測試）
//  1. passesFilters：學生設定的「硬條件」（地區、職業類別、時段、薪資、時長）
//  2. evaluate：拿履歷跟職缺的要求條件逐項比對，算出分數
// AI 只負責「把文字變結構化」與「寫建議」，判斷對錯交給這裡，避免 AI 亂判。

const DEGREE_RANK = { 高中職: 1, 專科: 2, 大學: 3, 碩士: 4, 博士: 5 };

export function degreeRank(text = '') {
  for (const [name, rank] of Object.entries(DEGREE_RANK)) if (text.includes(name)) return rank;
  return 0; // 不限
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
const hasSkill = (skills, target) => skills.some((s) => norm(s) === norm(target));

// ---------- 1. 硬條件篩選 ----------
export function passesFilters(job, prefs = {}) {
  const { regions = [], schedules = [], categories = [], minWage = 0, minDuration = 0 } = prefs;

  if (regions.length && !regions.includes(job.region || '其他')) return false;
  if (categories.length && !categories.includes(job.category)) return false;
  if (minWage && job.wage < minWage) return false;
  if (minDuration && job.durationMonths < minDuration) return false;
  if (schedules.length) {
    const ok = schedules.some((s) => {
      if (s === '每週3天以上') return job.daysPerWeek >= 3;
      if (s === '每週3天以內') return job.daysPerWeek > 0 && job.daysPerWeek <= 3;
      if (s === '平日') return !job.weekend;
      if (s === '假日') return Boolean(job.weekend);
      return true;
    });
    if (!ok) return false;
  }
  if (job.deadline && job.deadline < today()) return false; // 已截止
  return true;
}

// ---------- 2. 履歷 vs 職缺 逐項比對 ----------
export function evaluate(resume, job) {
  const req = job.requirements || {};
  const skills = resume.skills || [];
  const checks = [];

  // 學歷
  const need = degreeRank(req.degree);
  const have = degreeRank(resume.degree);
  checks.push({
    key: 'degree',
    label: '學歷',
    ok: !need || have >= need,
    detail: need ? `要求${req.degree}，你是${resume.degree || '未填'}` : '不限',
  });

  // 科系
  const depts = req.departments || [];
  const deptOk = !depts.length || depts.some((d) => (resume.department || '').includes(d));
  checks.push({
    key: 'department',
    label: '科系',
    ok: deptOk,
    detail: depts.length ? `限 ${depts.join('、')}` : '不限',
  });

  // 年級
  if (req.minGrade) {
    const grade = Number(resume.grade || 0);
    checks.push({
      key: 'grade',
      label: '年級',
      ok: grade >= req.minGrade,
      detail: `此職缺限大${gradeText(req.minGrade)}以上，你目前大${gradeText(grade)}`,
    });
  }

  // 語言
  const langs = req.languages || [];
  if (langs.length) {
    const mine = (resume.languages || []).map((l) => l.name || l);
    const missing = langs.filter((l) => !mine.some((m) => m.includes(l)));
    checks.push({
      key: 'language',
      label: '語言',
      ok: !missing.length,
      detail: missing.length ? `缺少 ${missing.join('、')}` : langs.join('、'),
    });
  }

  const required = job.requiredSkills || [];
  const bonus = job.bonusSkills || [];
  const matchedSkills = required.filter((s) => hasSkill(skills, s));
  const missingSkills = required.filter((s) => !hasSkill(skills, s));
  const bonusMatched = bonus.filter((s) => hasSkill(skills, s));
  const bonusMissing = bonus.filter((s) => !hasSkill(skills, s));

  // 分數：硬條件每項不符扣很多，技能依比例加分
  const failed = checks.filter((c) => !c.ok).length;
  const skillRatio = required.length ? matchedSkills.length / required.length : 1;
  const bonusRatio = bonus.length ? bonusMatched.length / bonus.length : 0;
  const score = Math.max(0, Math.round(100 - failed * 40 - (1 - skillRatio) * 40 + bonusRatio * 10));

  return { checks, matchedSkills, missingSkills, bonusMatched, bonusMissing, score: Math.min(100, score) };
}

const GRADE_TEXT = ['?', '一', '二', '三', '四', '五', '六'];
const gradeText = (n) => GRADE_TEXT[n] || String(n);

export function today() {
  // 以台北時間計算今天日期 YYYY-MM-DD
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

export function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - new Date(today())) / 86400e3);
}

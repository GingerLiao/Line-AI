import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, passesFilters, degreeRank } from '../server/matching.js';

const job = {
  region: '台北', wage: 200, daysPerWeek: 3, weekend: false, durationMonths: 6, deadline: '2999-12-31',
  requirements: { degree: '大學以上', departments: [], minGrade: 3, languages: ['中文'] },
  requiredSkills: ['SQL', 'Python', 'Excel'], bonusSkills: ['Tableau'],
};

test('degreeRank 認得學歷高低', () => {
  assert.ok(degreeRank('碩士') > degreeRank('大學以上'));
  assert.equal(degreeRank(''), 0);
});

test('硬條件篩選：地區、薪資、時長、時段', () => {
  assert.equal(passesFilters(job, {}), true);
  assert.equal(passesFilters(job, { regions: ['新北'] }), false);
  assert.equal(passesFilters(job, { minWage: 250 }), false);
  assert.equal(passesFilters(job, { minDuration: 6 }), true);
  assert.equal(passesFilters(job, { schedules: ['假日'] }), false);
  assert.equal(passesFilters({ ...job, deadline: '2000-01-01' }, {}), false, '已截止的職缺不出現');
});

test('職業類別、每週 3 天以內、其他地區', () => {
  const j = { ...job, category: '數據分析' };
  assert.equal(passesFilters(j, { categories: ['數據分析'] }), true);
  assert.equal(passesFilters(j, { categories: ['設計'] }), false);
  assert.equal(passesFilters(j, { schedules: ['每週3天以內'] }), true);
  assert.equal(passesFilters({ ...j, daysPerWeek: 4 }, { schedules: ['每週3天以內'] }), false);
  assert.equal(passesFilters({ ...j, region: '其他' }, { regions: ['其他'] }), true);
});

test('年級不足會被標記，技能大小寫不敏感', () => {
  const resume = { degree: '大學', department: '資管系', grade: 2, skills: ['sql', 'Python', 'Excel'], languages: [{ name: '中文' }] };
  const ev = evaluate(resume, job);
  assert.equal(ev.checks.find((c) => c.key === 'grade').ok, false);
  assert.deepEqual(ev.missingSkills, []);
  assert.deepEqual(ev.bonusMissing, ['Tableau']);
});

test('完全符合的分數高於年級不符', () => {
  const base = { degree: '大學', department: '資管系', skills: ['SQL', 'Python', 'Excel'], languages: [{ name: '中文' }] };
  assert.ok(evaluate({ ...base, grade: 3 }, job).score > evaluate({ ...base, grade: 2 }, job).score);
});

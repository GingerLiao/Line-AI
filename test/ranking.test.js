import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankJobs, preferenceVector, preferenceTrust, cosine } from '../server/ranking.js';

// 用手做的 3 維向量代表 [行銷, 工程, 數據]，不需要真的呼叫 AI
const M = 'test-model';
const vec = (v) => ({ model: M, vector: v });
const base = { status: 'open', deadline: '2999-12-31', requirements: {}, requiredSkills: [], bonusSkills: [] };
const job = (id, v, extra = {}) => ({ ...base, id, title: id, embedding: vec(v), ...extra });

const jobs = [
  job('mkt-1', [1, 0, 0]), job('mkt-2', [0.9, 0.1, 0]),
  job('eng-1', [0, 1, 0]), job('eng-2', [0.1, 0.9, 0]),
  job('data-1', [0, 0.2, 1]),
];
const byId = (list) => new Map(list.map((j) => [j.id, j]));
const ids = (list) => list.map((j) => j.id);

test('cosine：方向相同為 1、垂直為 0、不同長度回傳 null', () => {
  assert.equal(cosine([1, 0], [2, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1], [1, 0]), null);
});

test('偏好信任度：5 張以下為 0，20 張以上為 1', () => {
  assert.equal(preferenceTrust(3), 0);
  assert.equal(preferenceTrust(20), 1);
  assert.ok(preferenceTrust(12) > 0 && preferenceTrust(12) < 1);
});

test('只有跳過、沒有喜歡的紀錄時，不產生偏好方向', () => {
  const swipes = [{ jobId: 'eng-1', action: 'skip' }];
  assert.equal(preferenceVector(swipes, byId(jobs), M).vector, null);
});

test('不同模型的向量不會拿來比較', () => {
  const other = jobs.map((j) => ({ ...j, embedding: { model: 'other', vector: j.embedding.vector } }));
  const swipes = [{ jobId: 'mkt-1', action: 'apply' }];
  assert.equal(preferenceVector(swipes, byId(other), M).vector, null);
});

test('行為學習：一直右滑行銷、跳過工程後，行銷職缺排到前面', () => {
  // 歷史職缺（已滑過），共 20 筆 → 偏好信任度 = 1
  const history = [];
  const swipes = [];
  for (let i = 0; i < 10; i++) {
    history.push(job(`old-mkt-${i}`, [1, 0.05, 0]), job(`old-eng-${i}`, [0.05, 1, 0]));
    swipes.push({ jobId: `old-mkt-${i}`, action: 'apply', createdAt: `2026-01-${10 + i}` });
    swipes.push({ jobId: `old-eng-${i}`, action: 'skip', createdAt: `2026-01-${10 + i}` });
  }
  const all = byId([...history, ...jobs]);

  const before = rankJobs({ jobs, resume: null, swipes: [], allJobsById: all, model: M, exploreEvery: 0 });
  const after = rankJobs({ jobs, resume: null, swipes, allJobsById: all, model: M, exploreEvery: 0 });

  assert.deepEqual(ids(after).slice(0, 2).sort(), ['mkt-1', 'mkt-2']);
  assert.ok(ids(after).indexOf('eng-1') > ids(after).indexOf('mkt-1'));
  assert.ok(after[0].reasons.includes('你可能喜歡'));
  assert.notDeepEqual(ids(before), ids(after), '滑卡紀錄應該改變排序');
});

test('語意分數：履歷偏工程時，工程職缺排前面', () => {
  const resume = { degree: '大學', skills: [], languages: [], embedding: vec([0, 1, 0.1]) };
  const ranked = rankJobs({ jobs, resume, swipes: [], allJobsById: byId(jobs), model: M, exploreEvery: 0 });
  assert.ok(['eng-1', 'eng-2'].includes(ranked[0].id));
  assert.ok(ranked[0].reasons.includes('經歷相關'));
});

test('規則仍然有效：硬條件不符的職缺即使語意接近也會往後', () => {
  const resume = { degree: '大學', grade: 2, skills: [], languages: [], embedding: vec([0, 1, 0]) };
  const strict = job('eng-strict', [0, 1, 0], { requirements: { minGrade: 4 } });
  const list = [strict, job('eng-ok', [0.1, 0.9, 0])];
  const ranked = rankJobs({ jobs: list, resume, swipes: [], allJobsById: byId(list), model: M, exploreEvery: 0 });
  assert.equal(ranked[0].id, 'eng-ok');
});

test('探索卡：每 5 張穿插 1 張後段職缺，且不會漏掉或重複職缺', () => {
  const many = Array.from({ length: 12 }, (_, i) => job(`j${i}`, [1 - i / 12, i / 12, 0]));
  const resume = { degree: '大學', skills: [], languages: [], embedding: vec([1, 0, 0]) };
  const ranked = rankJobs({ jobs: many, resume, swipes: [], allJobsById: byId(many), model: M });
  assert.equal(ranked.length, 12);
  assert.equal(new Set(ids(ranked)).size, 12);
  assert.equal(ranked[4].explore, true);
  assert.ok(!ranked[0].explore);
});

test('沒有任何向量時也能排序（退回規則與時效），不會出錯', () => {
  const plain = jobs.map(({ embedding, ...j }) => j);
  const ranked = rankJobs({ jobs: plain, resume: null, swipes: [], allJobsById: byId(plain), model: M });
  assert.equal(ranked.length, plain.length);
});

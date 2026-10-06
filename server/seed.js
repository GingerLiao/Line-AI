// 建立示範資料：npm run seed
// 示範帳號：學生 demo-student、企業 demo-company（示範模式用 ?as=<id> 切換）
import { db } from './db.js';
import { today } from './matching.js';
import { withEmbedding } from './embeddings.js';
import { demoJobs } from './seed-jobs.js';

const inDays = (n) => {
  const d = new Date(today());
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const COMPANY = 'demo-company';
const STUDENT = 'demo-student';

const jobs = demoJobs(inDays);

const resumes = [
  {
    title: '數據分析履歷', name: '林小安', school: '〇〇大學', department: '資訊管理系', degree: '大學', grade: 2,
    gpa: '3.7', graduation: '2029/06',
    skills: ['SQL', 'Python', 'Excel'],
    languages: [{ name: '中文', level: '母語' }, { name: '英文', level: '多益 750' }],
    experiences: [
      { title: '系學會・活動數據分析', year: '2025', description: '用 SQL 整理三年報名資料，報名率提升 20%。' },
      { title: '資料視覺化・課程專題', year: '2025', description: '以 Python 分析公開交通數據，產出互動圖表。' },
    ],
    links: ['https://github.com/example'],
    contact: { email: 'student@example.edu.tw', phone: '0912-345-678', lineId: '' },
  },
  {
    title: '行銷企劃履歷', name: '林小安', school: '〇〇大學', department: '資訊管理系', degree: '大學', grade: 2,
    skills: ['社群經營', '文案', 'Canva'],
    languages: [{ name: '中文', level: '母語' }],
    experiences: [{ title: '系學會・公關長', year: '2025', description: '經營系學會 IG，追蹤數成長 2 倍。' }],
    links: [], contact: { email: 'student@example.edu.tw', phone: '', lineId: '' },
  },
];

// 其他應徵者（讓企業後台有資料可以看）
const otherApplicants = [
  {
    id: 'demo-applicant-1',
    resume: {
      title: '數據分析', name: '陳品妍', school: '〇〇大學', department: '資訊管理系', degree: '大學', grade: 3,
      gpa: '3.7', graduation: '2028/06', skills: ['SQL', 'Python', 'Excel', 'Google Analytics'],
      languages: [{ name: '中文', level: '母語' }, { name: '英文', level: '多益 750' }],
      experiences: [
        { title: '系學會・活動數據分析', year: '2025', description: '用 SQL 整理三年報名資料，做出報表協助決策，報名率提升 20%。' },
        { title: '資料視覺化・課程專題', year: '2025', description: '以 Python 分析公開交通數據，產出互動圖表與分析報告。' },
      ],
      links: ['https://github.com/chenpy'], contact: { email: 'chen.py@mail.example.edu.tw', phone: '0912-345-678', lineId: '@chenpy' },
    },
  },
  {
    id: 'demo-applicant-2',
    resume: {
      title: '統計', name: '林宗翰', school: '〇〇大學', department: '統計系', degree: '大學', grade: 3,
      skills: ['R', 'Excel', '統計', 'SQL'], languages: [{ name: '中文', level: '母語' }],
      experiences: [{ title: '迴歸分析期末專題', year: '2025', description: '分析房價影響因素。' }],
      links: [], contact: { email: 'lin@example.edu.tw', phone: '', lineId: '' },
    },
  },
  {
    id: 'demo-applicant-3',
    resume: {
      title: '資工', name: '王思婷', school: '〇〇大學', department: '資訊工程系', degree: '大學', grade: 2,
      skills: ['Python', 'SQL', 'Tableau'], languages: [{ name: '中文', level: '母語' }],
      experiences: [], links: [], contact: { email: 'wang@example.edu.tw', phone: '', lineId: '' },
    },
  },
];

const now = new Date().toISOString();
const jobIds = [];
for (const [i, job] of jobs.entries()) {
  const id = `demo-job-${i + 1}`;
  await db.set('jobs', id, await withEmbedding({ ...job, companyId: COMPANY, status: 'open', createdAt: now, updatedAt: now }, 'job'));
  jobIds.push(id);
}
for (const [i, r] of resumes.entries()) {
  await db.set('resumes', `demo-resume-${i + 1}`, await withEmbedding({ ...r, ownerId: STUDENT, updatedAt: now }, 'resume'));
}
await db.set('preferences', STUDENT, {
  regions: [], schedules: [], minWage: 0, minDuration: 0, smartSort: true, resumeId: 'demo-resume-1',
});
for (const a of otherApplicants) {
  const resumeId = `${a.id}-resume`;
  await db.set('resumes', resumeId, await withEmbedding({ ...a.resume, ownerId: a.id, updatedAt: now }, 'resume'));
  await db.set('applications', `${a.id}-app`, {
    jobId: jobIds[0], companyId: COMPANY, studentId: a.id, resumeId, status: 'pending', createdAt: now,
  });
}

console.log(`已建立 ${jobs.length} 個職缺、${resumes.length} 份學生履歷、${otherApplicants.length} 位應徵者（資料庫：${db.kind}）`);
console.log('學生端： http://localhost:3000/student/?as=demo-student');
console.log('企業端： http://localhost:3000/company/?as=demo-company');
process.exit(0);

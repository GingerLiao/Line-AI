// 建立示範資料：npm run seed
// 示範帳號：學生 demo-student、企業 demo-company（示範模式用 ?as=<id> 切換）
import { db } from './db.js';
import { today } from './matching.js';
import { withEmbedding } from './embeddings.js';
import { demoJobs } from './seed-jobs.js';
import { withDetails } from './seed-job-details.js';
import { parseAddress } from '../public/shared/taiwan.js';

const inDays = (n) => {
  const d = new Date(today());
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const COMPANY = 'demo-company';
const STUDENT = 'demo-student';

const jobs = demoJobs(inDays).map(withDetails); // 加上公司簡介、完整地址、面試流程等詳細資料

const resumes = [
  {
    title: '數據分析履歷', name: '林小安', school: '〇〇大學', department: '資訊管理系', degree: '大學', grade: 2,
    gpa: '3.7', graduation: '2029/06',
    skills: ['SQL', 'Python', 'Excel'],
    languages: [{ name: '中文', level: '母語' }, { name: '英文', level: '多益 750' }],
    about: '喜歡從數據裡找答案，擔任系學會活動組時開始用 SQL 分析報名資料。希望在實習中學習企業如何用數據做決策。',
    awards: [
      { title: '校內資料分析競賽', role: '第三名', date: '2025/05', description: '分析校園餐廳消費資料，提出尖峰分流建議。', link: '' },
      { title: 'TQC Excel 2019', role: '專業級', date: '2024/12', description: '', link: '' },
    ],
    projects: [
      { title: '台北市公共自行車使用分析', role: '組長', date: '2025/03–2025/06', description: '以 Python 分析公開交通數據，產出互動圖表與尖峰時段建議。', link: 'https://github.com/example' },
    ],
    activities: [
      { title: '資管系學會', role: '活動組組員', date: '2024/09–2025/06', description: '用 SQL 整理三年報名資料，報名率提升 20%。', link: '' },
    ],
    links: ['https://github.com/example'],
    contact: { email: 'student@example.edu.tw', phone: '0912-345-678', lineId: '' },
  },
  {
    title: '行銷企劃履歷', name: '林小安', school: '〇〇大學', department: '資訊管理系', degree: '大學', grade: 2,
    skills: ['社群經營', '文案', 'Canva'],
    languages: [{ name: '中文', level: '母語' }],
    about: '喜歡寫文案和做設計，經營系學會 IG 一年，對品牌行銷很有興趣。',
    awards: [], projects: [],
    activities: [{ title: '資管系學會', role: '公關長', date: '2024/09–2025/06', description: '經營系學會 IG，追蹤數成長 2 倍。', link: '' }],
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
      about: '對商業分析有熱情，習慣用資料說故事。',
      awards: [{ title: '全國大專校院資料分析競賽', role: '佳作', date: '2025/04', description: '電商回購率預測。', link: '' }],
      projects: [{ title: '公開交通數據視覺化', role: '資料分析', date: '2025/03–2025/06', description: '以 Python 分析公開交通數據，產出互動圖表與分析報告。', link: 'https://github.com/chenpy' }],
      activities: [{ title: '資管系學會', role: '活動組長', date: '2024/09–2025/06', description: '用 SQL 整理三年報名資料，做出報表協助決策，報名率提升 20%。', link: '' }],
      links: ['https://github.com/chenpy'], contact: { email: 'chen.py@mail.example.edu.tw', phone: '0912-345-678', lineId: '@chenpy' },
    },
  },
  {
    id: 'demo-applicant-2',
    resume: {
      title: '統計', name: '林宗翰', school: '〇〇大學', department: '統計系', degree: '大學', grade: 3,
      skills: ['R', 'Excel', '統計', 'SQL'], languages: [{ name: '中文', level: '母語' }],
      about: '統計系三年級，熟悉迴歸與假設檢定。',
      awards: [], activities: [],
      projects: [{ title: '迴歸分析期末專題', role: '組員', date: '2025/06', description: '分析房價影響因素。', link: '' }],
      links: [], contact: { email: 'lin@example.edu.tw', phone: '', lineId: '' },
    },
  },
  {
    id: 'demo-applicant-3',
    resume: {
      title: '資工', name: '王思婷', school: '〇〇大學', department: '資訊工程系', degree: '大學', grade: 2,
      skills: ['Python', 'SQL', 'Tableau'], languages: [{ name: '中文', level: '母語' }],
      about: '', awards: [], projects: [], activities: [], links: [], contact: { email: 'wang@example.edu.tw', phone: '', lineId: '' },
    },
  },
];

const now = new Date().toISOString();
const jobIds = [];
for (const [i, job] of jobs.entries()) {
  const id = `demo-job-${i + 1}`;
  await db.set('jobs', id, await withEmbedding({ ...job, ...parseAddress(job.location), companyId: COMPANY, status: 'open', createdAt: now, updatedAt: now }, 'job'));
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

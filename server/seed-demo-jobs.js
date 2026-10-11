// Demo 用：加入 5 個「社群行銷」類的職缺（不同公司），讓上傳黃品瑄履歷後滑卡時會排在前面
// 用法：npm run seed:demo　（只新增／更新這 5 筆，不會動到其他資料，可以重複執行）
// 公司皆為虛構
import { db } from './db.js';
import { today } from './matching.js';
import { withEmbedding } from './embeddings.js';
import { parseAddress } from '../public/shared/taiwan.js';

const inDays = (n) => {
  const d = new Date(today());
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// 這些職缺屬於另一個示範企業帳號（不是你登入的企業），投遞時的 LINE 通知會送不出去，屬正常現象
const COMPANY = 'demo-partner';
const req = (o = {}) => ({ degree: '大學以上', departments: [], minGrade: 0, experience: '不拘', languages: ['中文'], ...o });
const STAGES = [
  { name: '書面審查', mode: '線上', detail: '看履歷與作品集，約一週內通知' },
  { name: '主管面談', mode: '實體', detail: '聊作品與對品牌的想法，約 40 分鐘' },
];

const jobs = [
  {
    companyName: '青檸生活選物股份有限公司', title: '社群小編實習生', category: '行銷企劃',
    description: '經營品牌 IG 與 Threads，撰寫商品貼文與限時動態，參與新品上市活動。',
    companyIntro: '主打台灣設計師小物的生活選物品牌，全台 6 間門市，IG 追蹤 12 萬。',
    responsibilities: ['撰寫商品貼文與限時動態文案', '用 Canva 製作社群圖片', '回覆粉絲留言並整理常見問題', '協助新品上市的抽獎活動'],
    wage: 205, location: '台北市信義區松高路 19 號 6 樓', daysPerWeek: 3, weekend: false, durationMonths: 6, deadline: inDays(12),
    workHours: '週一至週五擇三天，10:00–19:00', headcount: 2, startDate: '錄取後兩週內',
    requirements: req(), requiredSkills: ['社群經營', '文案', 'Canva'], bonusSkills: ['攝影', 'Photoshop'],
    benefits: ['員工購物折扣', '彈性工時', '表現優異可轉正職'],
  },
  {
    companyName: '光點文創有限公司', title: '品牌行銷實習生', category: '行銷企劃',
    description: '協助文創品牌規劃社群內容與市集活動，學習從企劃到執行的完整流程。',
    companyIntro: '經營文創市集與聯名商品的品牌公司，每年舉辦 20 場以上市集活動。',
    responsibilities: ['規劃每月社群內容排程', '撰寫活動宣傳文案', '協助市集現場拍攝與直播', '整理活動成效報告'],
    wage: 210, location: '台北市中山區赤峰街 41 號 2 樓', daysPerWeek: 3, weekend: true, durationMonths: 6, deadline: inDays(18),
    workHours: '每週 3 天（含週末市集），依排班', headcount: 1, startDate: '錄取後一週內',
    requirements: req({ minGrade: 2 }), requiredSkills: ['社群經營', '文案'], bonusSkills: ['Premiere', '攝影'],
    benefits: ['市集活動免費參加', '交通補助', '彈性工時'],
  },
  {
    companyName: '南風咖啡烘焙股份有限公司', title: '短影音行銷實習生', category: '行銷企劃',
    description: '企劃與拍攝咖啡品牌的 Reels 與 TikTok 短影音，提升年輕族群聲量。',
    companyIntro: '自家烘焙的精品咖啡連鎖品牌，台北 8 間門市，正積極經營短影音平台。',
    responsibilities: ['企劃每週 2 支短影音腳本', '到門市拍攝咖啡製作與店員日常', '用 Premiere 剪輯並上字幕', '追蹤影片觀看數與互動數據'],
    wage: 220, location: '台北市大安區復興南路一段 219 號', daysPerWeek: 3, weekend: false, durationMonths: 6, deadline: inDays(9),
    workHours: '週一至週五擇三天，09:00–18:00', headcount: 1, startDate: '錄取後兩週內',
    requirements: req(), requiredSkills: ['社群經營', 'Premiere'], bonusSkills: ['攝影', '文案'],
    benefits: ['每日咖啡免費', '彈性工時', '作品可放入作品集'],
  },
  {
    companyName: '好點子公關顧問有限公司', title: '公關行銷實習生', category: '行銷企劃',
    description: '協助品牌記者會與網紅合作專案，撰寫新聞稿與社群文案。',
    companyIntro: '服務美妝、生活與科技品牌的公關公司，擅長網紅行銷與品牌活動。',
    responsibilities: ['撰寫新聞稿與社群貼文', '整理網紅合作名單與成效', '協助記者會與品牌活動執行', '蒐集媒體露出並製作報告'],
    wage: 215, location: '台北市松山區敦化北路 168 號 10 樓', daysPerWeek: 4, weekend: false, durationMonths: 6, deadline: inDays(22),
    workHours: '週一至週五擇四天，10:00–19:00', headcount: 2, startDate: '錄取後兩週內',
    requirements: req({ minGrade: 3 }), requiredSkills: ['文案', '社群經營'], bonusSkills: ['GA4', 'Canva'],
    benefits: ['三節獎金', '交通補助', '表現優異可轉正職'],
  },
  {
    companyName: '跳跳鹿親子樂園股份有限公司', title: '內容行銷實習生', category: '行銷企劃',
    description: '為親子樂園經營社群與部落格，企劃節慶活動內容，吸引家庭客群。',
    companyIntro: '北台灣最大的室內親子樂園品牌，3 個館別，年入園人次 60 萬。',
    responsibilities: ['撰寫部落格與社群文章', '企劃節慶主題活動貼文', '用 Canva 製作活動海報', '分析 GA4 網站流量與活動報名數'],
    wage: 200, location: '新北市板橋區文化路一段 188 巷 66 號', daysPerWeek: 3, weekend: true, durationMonths: 6, deadline: inDays(28),
    workHours: '每週 3 天（含一天週末），10:00–19:00', headcount: 1, startDate: '錄取後兩週內',
    requirements: req(), requiredSkills: ['文案', 'Canva'], bonusSkills: ['GA4', '社群經營'],
    benefits: ['樂園免費入場', '員工餐', '彈性工時'],
  },
];

const now = new Date().toISOString();
for (const [i, job] of jobs.entries()) {
  const row = {
    ...job, ...parseAddress(job.location),
    interviewStages: STAGES, applyMaterials: ['履歷', '作品集或經營過的社群帳號連結'],
    companyId: COMPANY, status: 'open', createdAt: now, updatedAt: now,
  };
  await db.set('jobs', `demo-mkt-${i + 1}`, await withEmbedding(row, 'job'));
}
console.log(`已新增 ${jobs.length} 個社群行銷示範職缺（資料庫：${db.kind}）`);
process.exit(0);

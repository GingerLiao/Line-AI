// AI 功能（OpenAI API）
//  - parseResume：履歷文字 → 結構化 JSON
//  - parseJob：職缺說明文字 → 結構化 JSON
//  - careerAdvice：AI 職涯健檢的「建議」
//  - summarizeApplicant：企業後台的「AI 履歷摘要」
// 沒有設定 OPENAI_API_KEY 時，會改用簡單的規則（關鍵字）版本，方便離線開發。
// AI 呼叫失敗（模型忙碌、額度用完）時：先試備用模型，全部失敗再退回規則版，畫面不會壞掉。
import OpenAI from 'openai';
import { config } from './config.js';

const client = config.openai.apiKey
  // 最多等 30 秒、失敗重試 1 次，避免 AI 服務出問題時畫面一直轉圈
  ? new OpenAI({ apiKey: config.openai.apiKey, baseURL: config.openai.baseURL, timeout: 30_000, maxRetries: 1 })
  : null;
export const aiEnabled = Boolean(client);

const models = [config.openai.model, ...config.openai.fallbackModels];

// 依序嘗試主要模型與備用模型，全部失敗就丟出最後的錯誤
async function askJson(system, user) {
  let lastErr;
  for (const model of models) {
    try {
      const res = await client.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      // 有些模型會把 JSON 包在 ```json ... ``` 裡，先拿掉
      const content = res.choices[0].message.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return JSON.parse(content);
    } catch (err) {
      lastErr = err;
      console.error(`[ai] ${model} 失敗：${err.status || ''} ${err.message}`);
    }
  }
  throw lastErr;
}

// 有 AI 就用 AI；AI 全部失敗就改用規則版，並標記 aiFailed 讓畫面提示使用者
async function tryAi(aiFn, fallbackFn) {
  if (!client) return { value: fallbackFn(), aiFailed: false };
  try {
    return { value: await aiFn(), aiFailed: false };
  } catch {
    return { value: fallbackFn(), aiFailed: true };
  }
}

// ---------------- 履歷 ----------------
const RESUME_SCHEMA = `{
  "name": "姓名",
  "school": "學校",
  "department": "科系，例如 資訊管理系",
  "degree": "高中職 | 專科 | 大學 | 碩士 | 博士",
  "grade": 年級數字，大一=1、大四=4、碩一=5,
  "gpa": "GPA 或空字串",
  "graduation": "預計畢業年月，例如 2028/06",
  "skills": ["技能，每個技能一個短詞，例如 SQL、Python、Excel"],
  "languages": [{"name": "中文", "level": "母語"}],
  "experiences": [{"title": "經歷名稱", "year": "2025", "description": "一句話描述成果"}],
  "links": ["作品集或 GitHub 網址"],
  "contact": {"email": "", "phone": "", "lineId": ""}
}`;

export async function parseResume(text) {
  const { value, aiFailed } = await tryAi(
    () => askJson(`你是履歷解析器。把使用者的履歷整理成以下 JSON 格式，找不到的欄位留空字串或空陣列，不要捏造：\n${RESUME_SCHEMA}`, text),
    () => fallbackParseResume(text),
  );
  return { ...value, aiFailed };
}

// ---------------- 職缺 ----------------
const JOB_SCHEMA = `{
  "companyName": "公司全名",
  "title": "職缺名稱，例如 數據分析實習生",
  "category": "工作類別，例如 數據分析",
  "description": "工作內容，一到兩句",
  "wage": 時薪數字（月薪請除以 160 換算成時薪）,
  "location": "地點，例如 台北南港",
  "region": "台北 | 新北 | 桃園 | 台中 | 台南 | 高雄 | 遠端 | 其他",
  "daysPerWeek": 每週天數數字,
  "weekend": 是否假日上班 true/false,
  "durationMonths": 實習月數數字,
  "deadline": "報名截止日 YYYY-MM-DD，沒寫就空字串",
  "requirements": {
    "degree": "例如 大學以上，不限則空字串",
    "departments": ["限定科系，不限則空陣列"],
    "minGrade": 最低年級數字，不限則 0,
    "experience": "例如 不拘",
    "languages": ["例如 中文"]
  },
  "requiredSkills": ["必備技能短詞"],
  "bonusSkills": ["加分條件短詞"],
  "benefits": ["公司福利短詞"]
}`;

export async function parseJob(text) {
  const { value, aiFailed } = await tryAi(
    () => askJson(`你是職缺解析器。今天是 ${new Date().toISOString().slice(0, 10)}。把職缺說明整理成以下 JSON 格式，找不到的欄位留空，不要捏造：\n${JOB_SCHEMA}`, text),
    () => fallbackParseJob(text),
  );
  return { ...value, aiFailed };
}

// ---------------- AI 職涯健檢 ----------------
// evaluation 由 matching.evaluate() 算好，AI 只負責把結果寫成可執行的建議
export async function careerAdvice(resume, job, evaluation) {
  const { value } = await tryAi(() => aiCareerAdvice(resume, job, evaluation), () => fallbackAdvice(resume, job, evaluation));
  return value;
}

async function aiCareerAdvice(resume, job, evaluation) {
  const out = await askJson(
    `你是給大學生的職涯顧問。根據履歷與職缺的比對結果，用繁體中文給出：
{
  "mismatchNotes": {"<check key>": "對每個不符合的項目，給一句具體建議，例如『建議先收藏，明年可直接投遞』"},
  "skillNotes": {"<缺少的技能>": "一句話說明補強難易度"},
  "suggestions": ["3 點具體、可執行的建議，包含免費學習資源與大約所需時間"]
}
語氣友善、精簡。`,
    JSON.stringify({ resume, job, evaluation }),
  );
  return {
    mismatchNotes: out.mismatchNotes || {},
    skillNotes: out.skillNotes || {},
    suggestions: out.suggestions || [],
  };
}

// ---------------- 企業端：AI 履歷摘要 ----------------
// 回傳 { text, aiFailed }；aiFailed 時是規則版摘要，呼叫端不要存起來，下次再讓 AI 重試
export async function summarizeApplicant(resume, job) {
  const { value, aiFailed } = await tryAi(async () => {
    const out = await askJson(
      '你是招募助理。用繁體中文、60 字以內，摘要這位應徵者與此職缺最相關的重點（技能、經歷、可上班天數）。輸出 {"summary": "..."}',
      JSON.stringify({ resume, job }),
    );
    return out.summary;
  }, () => fallbackSummary(resume));
  return { text: value, aiFailed };
}

// ---------------- 語意向量（滑卡排序用）----------------
// 回傳 { model, vector }。有設定 AI 就用 AI 的 embedding 模型；
// 沒有設定時用本機的「關鍵字向量」，效果較差但可以離線跑。AI 失敗回傳 null（之後可用 npm run embed 補算）。
export const embeddingModel = client && config.openai.embeddingModel ? config.openai.embeddingModel : 'local-hash-v1';

export async function embedText(text) {
  if (embeddingModel === 'local-hash-v1') return { model: embeddingModel, vector: localEmbed(text) };
  try {
    const res = await client.embeddings.create({ model: embeddingModel, input: text.slice(0, 8000) });
    const vector = res.data[0].embedding.map((x) => Math.round(x * 1e5) / 1e5); // 縮短小數，省資料庫空間
    return { model: embeddingModel, vector };
  } catch (err) {
    console.error(`[ai] embedding ${embeddingModel} 失敗：${err.status || ''} ${err.message}`);
    return null;
  }
}

// 本機版：英文字詞 + 中文兩字詞，雜湊到 512 維
function localEmbed(text) {
  const dim = 512;
  const v = new Array(dim).fill(0);
  const s = String(text).toLowerCase();
  const tokens = [...(s.match(/[a-z0-9+#.]+/g) || [])];
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    v[(h >>> 0) % dim] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => Math.round((x / norm) * 1e5) / 1e5);
}

// =====================================================================
// 以下是沒有 OpenAI 金鑰時的「規則版」，只求可以跑，不求聰明
// =====================================================================
const KNOWN_SKILLS = [
  'SQL', 'Python', 'Excel', 'Tableau', 'Power BI', 'R', 'Java', 'JavaScript', 'TypeScript',
  'React', 'Vue', 'Node.js', 'Figma', 'Photoshop', 'Illustrator', 'Google Analytics', 'SEO',
  'C++', 'C#', 'Go', 'Git', 'Docker', 'Linux', '機器學習', '資料視覺化', '社群經營', '文案',
  '統計', '剪輯', 'Premiere', 'Canva',
];

const findSkills = (text) =>
  KNOWN_SKILLS.filter((s) => new RegExp(`(^|[^A-Za-z])${s.replace(/[.+#]/g, '\\$&')}([^A-Za-z]|$)`, 'i').test(text));

const pick = (text, re) => (text.match(re) || [])[1]?.trim() || '';

function fallbackParseResume(text) {
  const gradeMap = { 一: 1, 二: 2, 三: 3, 四: 4 };
  const g = text.match(/大([一二三四])/);
  return {
    name: pick(text, /姓名[:：]\s*(\S+)/),
    school: pick(text, /(\S+大學)/),
    department: pick(text, /(\S+系)/),
    degree: /碩士|研究所/.test(text) ? '碩士' : '大學',
    grade: g ? gradeMap[g[1]] : 0,
    gpa: pick(text, /GPA[:：\s]*([\d.]+)/i),
    graduation: pick(text, /(\d{4}\/\d{2})\s*畢業/),
    skills: findSkills(text),
    languages: [{ name: '中文', level: '母語' }, ...(/英文|多益|TOEIC/i.test(text) ? [{ name: '英文', level: pick(text, /(多益\s*\d+)/) }] : [])],
    experiences: [],
    links: text.match(/https?:\/\/\S+/g) || [],
    contact: {
      email: pick(text, /([\w.+-]+@[\w.-]+)/),
      phone: pick(text, /(09\d{2}-?\d{3}-?\d{3})/),
      lineId: '',
    },
  };
}

function fallbackParseJob(text) {
  const wage = Number(pick(text, /時薪\s*(\d+)/)) || Math.round(Number(pick(text, /月薪\s*(\d+)/)) / 160) || 0;
  const regions = ['台北', '新北', '桃園', '台中', '台南', '高雄', '遠端'];
  const deadline = text.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*截止|截止[日：:\s]*(\d{1,2})\s*[\/月]\s*(\d{1,2})/);
  let deadlineStr = '';
  if (deadline) {
    const [m, d] = deadline[1] ? [deadline[1], deadline[2]] : [deadline[3], deadline[4]];
    deadlineStr = `${new Date().getFullYear()}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const skills = findSkills(text);
  const bonusText = pick(text, /加分[^：:]*[:：]([^\n]+)/);
  const bonus = findSkills(bonusText);
  return {
    companyName: pick(text, /(\S+(?:股份)?有限公司)/),
    title: pick(text, /職缺(?:名稱)?[:：]\s*(\S+)/),
    category: pick(text, /(?:類別|職類)[:：]\s*(\S+)/),
    description: pick(text, /工作內容[:：]\s*([^\n]+)/),
    wage,
    location: pick(text, /地點[:：]\s*(\S+)/),
    region: regions.find((r) => text.includes(r)) || '其他',
    daysPerWeek: Number(pick(text, /每週\s*(\d)\s*天/)) || 0,
    weekend: /假日/.test(text),
    durationMonths: Number(pick(text, /(\d+)\s*個月/)) || 0,
    deadline: deadlineStr,
    requirements: {
      degree: pick(text, /(大學以上|碩士以上|專科以上|高中職以上)/),
      departments: [],
      minGrade: { 二: 2, 三: 3, 四: 4 }[pick(text, /大([二三四])以上/)] || 0,
      experience: '不拘',
      languages: ['中文'],
    },
    requiredSkills: skills.filter((s) => !bonus.includes(s)),
    bonusSkills: bonus,
    benefits: ['彈性工時', '三節獎金', '正職優先錄取'].filter((b) => text.includes(b)),
  };
}

function fallbackAdvice(resume, job, ev) {
  const mismatchNotes = {};
  for (const c of ev.checks.filter((c) => !c.ok)) {
    mismatchNotes[c.key] = c.key === 'grade' ? '建議先收藏，明年符合年級後可直接投遞。' : '此項為硬性條件，建議優先找其他職缺。';
  }
  const skillNotes = Object.fromEntries(ev.missingSkills.concat(ev.bonusMissing).map((s) => [s, '短期可補，建議做一個小作品證明。']));
  const suggestions = ev.missingSkills.concat(ev.bonusMissing).slice(0, 2).map((s) => `先累積一份 ${s} 作品集（約 4 週）`);
  const ready = ev.checks.every((c) => c.ok) && !ev.missingSkills.length;
  suggestions.push(ready ? '條件都符合，可以直接投遞！' : '收藏此職缺，條件達成後直接投遞。');
  return { mismatchNotes, skillNotes, suggestions };
}

function fallbackSummary(resume) {
  const exp = (resume.experiences || [])[0];
  return `熟 ${(resume.skills || []).slice(0, 3).join('、') || '—'}${exp ? `；做過${exp.title}` : ''}。`;
}

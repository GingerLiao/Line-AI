// 學歷與年級（前後端共用）
// 年級存成數字，方便和職缺的「最低年級」比較：大一=1…大四=4、碩一=5、碩二=6、碩三=7、博一=8…、已畢業=99
export const GRADUATED = 99;
const CN = ['', '一', '二', '三', '四', '五'];

// 依學歷列出可以選的年級
export const GRADE_OPTIONS = {
  大學: [1, 2, 3, 4],
  碩士: [5, 6, 7],
  博士: [8, 9, 10, 11, 12],
  專科: [1, 2, 3, 4, 5],
  高中職: [1, 2, 3],
};

export function gradeLabel(n, degree = '') {
  n = Number(n) || 0;
  if (!n) return '年級未填寫';
  if (n === GRADUATED) return '已畢業';
  if (degree === '專科') return `專${CN[n] || n}`;
  if (degree === '高中職') return `高${CN[n] || n}`;
  if (n <= 4) return `大${CN[n]}`;
  if (n <= 7) return `碩${CN[n - 4]}`;
  return `博${CN[n - 7] || n - 7}`;
}

// 換學歷時，年級要換成新學歷裡的選項（例如大學改成碩士 → 碩一）
export function fitGrade(n, degree) {
  const options = GRADE_OPTIONS[degree] || [];
  n = Number(n) || 0;
  if (!n || n === GRADUATED || options.includes(n)) return n;
  return options[0] || 0;
}

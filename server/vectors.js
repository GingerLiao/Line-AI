// 語意向量的存放格式
// 以前存成數字陣列（3072 個數字），Firestore 讀取時每個數字都會變成一個物件，很吃記憶體。
// 現在改存成一段 base64 字串（Float32），讀取只要解一個字串；舊的陣列格式仍然讀得懂。

export function packVector(vector) {
  return Buffer.from(Float32Array.from(vector).buffer).toString('base64');
}

// 同一筆資料在快取裡會被重複使用，解開過的向量記下來，不重算
const decoded = new WeakMap();

// embedding → 可以拿來算相似度的向量（Float32Array 或陣列）；沒有就回傳 null
export function vectorOf(embedding) {
  const v = embedding?.vector;
  if (!v) return null;
  if (typeof v !== 'string') return v; // 舊格式：數字陣列
  let out = decoded.get(embedding);
  if (!out) {
    const buf = Buffer.from(v, 'base64');
    // 複製一份對齊的記憶體（小的 Buffer 可能共用記憶體池，起點不一定是 4 的倍數）
    out = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    decoded.set(embedding, out);
  }
  return out;
}

export const isPacked = (embedding) => typeof embedding?.vector === 'string';

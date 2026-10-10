// 資料存取層：有 Firestore 金鑰就用 Firestore，否則用本機 JSON 檔。
// 兩者提供相同的介面，讓其他程式不必在意底層是哪一種。
//
//   get(col, id)            取一筆
//   find(col, where = {})   以「欄位 = 值」條件查詢多筆
//   add(col, data)          新增（自動產生 id）
//   set(col, id, data)      以指定 id 寫入（覆蓋）
//   update(col, id, patch)  部分更新
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

function createFirestoreDb() {
  // 延遲載入，讓沒有 Firestore 的人也能跑
  return import('firebase-admin/app').then(async ({ initializeApp, applicationDefault }) => {
    const { getFirestore } = await import('firebase-admin/firestore');
    initializeApp({ credential: applicationDefault() });
    // 資料庫 ID 不是預設的 (default) 時，用 FIRESTORE_DATABASE_ID 指定
    const store = process.env.FIRESTORE_DATABASE_ID ? getFirestore(process.env.FIRESTORE_DATABASE_ID) : getFirestore();
    store.settings({ ignoreUndefinedProperties: true }); // 欄位是 undefined 時略過，不要報錯

    const withId = (doc) => (doc.exists ? { id: doc.id, ...doc.data() } : null);

    // 職缺每次滑卡都要整批讀（含語意向量），在記憶體快取 60 秒，有寫入就清掉
    const CACHED = new Set(['jobs']);
    const cache = new Map();
    const all = async (col) => {
      const hit = cache.get(col);
      if (hit && Date.now() - hit.at < 60_000) return hit.rows;
      const rows = (await store.collection(col).get()).docs.map(withId);
      cache.set(col, { at: Date.now(), rows });
      return rows;
    };
    const touch = (col) => cache.delete(col);
    const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

    return {
      kind: 'firestore',
      async get(col, id) {
        if (CACHED.has(col)) {
          const row = (await all(col)).find((r) => r.id === id);
          return row ? { ...row } : withId(await store.collection(col).doc(id).get());
        }
        return withId(await store.collection(col).doc(id).get());
      },
      async find(col, where = {}) {
        if (CACHED.has(col)) return (await all(col)).filter((r) => matches(r, where)).map((r) => ({ ...r }));
        let q = store.collection(col);
        for (const [k, v] of Object.entries(where)) q = q.where(k, '==', v);
        const snap = await q.get();
        return snap.docs.map(withId);
      },
      async add(col, data) {
        const ref = await store.collection(col).add(data);
        touch(col);
        return { id: ref.id, ...data };
      },
      async set(col, id, data) {
        await store.collection(col).doc(id).set(data);
        touch(col);
        return { id, ...data };
      },
      async update(col, id, patch) {
        await store.collection(col).doc(id).update(patch);
        touch(col);
        return this.get(col, id);
      },
    };
  });
}

function createJsonDb() {
  const file = path.resolve('data/db.json');
  let data = {};
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };
  const table = (col) => (data[col] ||= {});

  return {
    kind: 'json',
    async get(col, id) {
      const row = table(col)[id];
      return row ? { id, ...row } : null;
    },
    async find(col, where = {}) {
      return Object.entries(table(col))
        .map(([id, row]) => ({ id, ...row }))
        .filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
    },
    async add(col, row) {
      const id = crypto.randomUUID().slice(0, 8);
      table(col)[id] = row;
      save();
      return { id, ...row };
    },
    async set(col, id, row) {
      table(col)[id] = row;
      save();
      return { id, ...row };
    },
    async update(col, id, patch) {
      if (!table(col)[id]) return null;
      Object.assign(table(col)[id], patch);
      save();
      return { id, ...table(col)[id] };
    },
  };
}

export const db = config.firestoreEnabled ? await createFirestoreDb() : createJsonDb();

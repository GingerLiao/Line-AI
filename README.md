# 實習 Swipe 💼

> 2026 LINE × AI 創新創業競賽｜智慧校園
> 校園徵才／實習媒合助理：**精準媒合・即時提醒・原生整合**

不用重新學一個平台，打開每天都在用的 LINE，就能隨時找到適合的實習。

| 學生端（LIFF） | 企業端（LIFF / 網頁） |
| --- | --- |
| 智慧建立履歷（上傳 PDF，AI 自動填好） | 智慧建立職缺（上傳說明檔，AI 拆成欄位） |
| 篩選條件 + 依履歷 AI 智慧排序 | 職缺進入卡池，自動配對 |
| 滑卡：左滑跳過／上滑收藏／右滑投遞 | 收到應徵即 LINE 推播通知 |
| AI 職涯健檢：已具備／不符合／缺少技能／建議 | AI 履歷摘要 + 條件比對，快速篩選 |
| 收藏職缺 → 截止前 LINE 主動提醒 | 一鍵邀請面試，LINE 通知學生 |

## 快速開始（5 分鐘，不需要任何金鑰）

```bash
npm install
npm run seed     # 建立示範職缺、履歷、應徵者
npm run dev      # 啟動 http://localhost:3000
```

- 學生端：<http://localhost:3000/student/?as=demo-student>
- 企業端：<http://localhost:3000/company/?as=demo-company>

沒有設定金鑰時會自動進入**示範模式**：用網址 `?as=` 假裝登入、AI 改用關鍵字規則、資料存在 `data/db.json`、推播訊息印在終端機。

## 完整教學

👉 **[docs/TUTORIAL.md](docs/TUTORIAL.md)**：從本機跑起來 → 串 OpenAI → 建 LINE 官方帳號與 LIFF → Firestore → 部署上線，一步一步完成。

## 技術架構

```
學生端 LIFF ─┐                       ┌─ OpenAI API（履歷／職缺結構化、健檢建議、應徵者摘要）
            ├─ Express (server/) ───┼─ Firestore（或本機 JSON）
企業端 LIFF ─┘    ▲                  └─ LINE Messaging API（Push：新應徵、面試邀請、截止提醒）
                  └─ node-cron 每天檢查收藏職缺的截止日
```

| 簡報技術架構 | 對應程式 |
| --- | --- |
| 登入 LINE（LIFF + LINE Login） | `public/shared/api.js`、`server/line.js` |
| 設定求職條件（LIFF 前端表單） | `public/student/app.js` → `openFilter()` |
| 填寫／上傳履歷（OpenAI 結構化） | `server/ai.js` → `parseResume()` |
| 滑卡瀏覽 + AI 健檢（Firestore + OpenAI） | `server/routes/student.js`、`server/matching.js` |
| 滑動決策（Hammer.js） | `public/student/app.js` → `bindSwipe()` |
| 收藏職缺截止提醒（node-cron + Push API） | `server/reminder.js` |
| 建立職缺（OpenAI 結構化） | `server/ai.js` → `parseJob()` |
| 職缺進入卡池配對（條件比對） | `server/matching.js` → `passesFilters()` |
| 收到應徵 + 後台篩選（Express + Push） | `server/routes/company.js` |

## 指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 開發模式（改程式自動重啟） |
| `npm start` | 正式啟動 |
| `npm run seed` | 寫入示範資料 |
| `npm test` | 執行媒合邏輯單元測試 |

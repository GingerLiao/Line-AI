# 實習 Swipe 完整教學

這份教學依照簡報的內容（使用情境 → MVP → 功能示意圖 → 技術架構），帶你把「實習 Swipe」從零做到可以在 LINE 裡實際使用。

建議照順序做，每一關結束都有「✅ 檢查點」，確認通過再往下。

- [第 0 關：先看懂我們要做什麼](#第-0-關先看懂我們要做什麼)
- [第 1 關：在本機跑起來（示範模式）](#第-1-關在本機跑起來示範模式)
- [第 2 關：讀懂程式架構](#第-2-關讀懂程式架構)
- [第 3 關：串接 OpenAI](#第-3-關串接-openai)
- [第 4 關：建立 LINE 官方帳號（推播用）](#第-4-關建立-line-官方帳號推播用)
- [第 5 關：建立 LINE Login 與 LIFF（登入用）](#第-5-關建立-line-login-與-liff登入用)
- [第 6 關：用 ngrok 在手機 LINE 裡測試](#第-6-關用-ngrok-在手機-line-裡測試)
- [第 7 關：換成 Firestore](#第-7-關換成-firestore)
- [第 8 關：部署上線 + 圖文選單](#第-8-關部署上線--圖文選單)
- [第 9 關：Demo 前的測試清單](#第-9-關demo-前的測試清單)
- [下一步：從 MVP 到簡報上的完整版](#下一步從-mvp-到簡報上的完整版)
- [常見問題](#常見問題)

---

## 第 0 關：先看懂我們要做什麼

### 要解決的問題（簡報 p.2）

| 學生 | 企業 |
| --- | --- |
| 實習資訊分散、容易被忽略 | 刊登職缺曝光費高 |
| 看到適合的職缺卻錯過截止 | 中小企業、新創缺乏長期曝光預算 |
| 主流徵才網站體驗複雜 | 職缺無法精準被目標對象看到 |

### MVP 流程（簡報 p.3）

```
學生：智慧建立履歷 → 滑卡配對 ─┐
                               ├→ 媒合成功 → 進行面試
企業：智慧建立職缺 → 後台篩選 ─┘
```

### 對應到資料表

把流程拆成「要存什麼」，就是資料庫的設計：

| 資料表 (collection) | 存什麼 | 誰寫入 |
| --- | --- | --- |
| `resumes` | 學生的履歷（可以有很多份） | 學生 |
| `preferences` | 學生的篩選條件（文件 id = 學生 LINE userId） | 學生 |
| `jobs` | 企業的職缺 | 企業 |
| `swipes` | 每一次滑卡：`skip` 跳過／`save` 收藏／`apply` 投遞 | 學生 |
| `applications` | 投遞紀錄，狀態 `pending → shortlisted / interview / rejected` | 學生建立、企業更新 |

> 💡 **設計重點**：使用者的 id 直接用 **LINE userId**，所以「推播給某人」只要拿這個 id 呼叫 Push API 就好，不需要另外存對應表。

---

## 第 1 關：在本機跑起來（示範模式）

### 需要的東西

- [Node.js 20 以上](https://nodejs.org/)（終端機輸入 `node -v` 確認）
- 一個程式編輯器（推薦 VS Code）
- Git

### 步驟

```bash
git clone https://github.com/GingerLiao/Line-AI.git
cd Line-AI
npm install
npm run seed
npm run dev
```

看到這段就代表成功：

```
實習 Swipe 啟動於 http://localhost:3000
  資料庫：json　AI：規則版（未設定 OPENAI_API_KEY）　登入：示範模式
```

打開瀏覽器，按 F12 開啟開發者工具，切換到手機模式（Ctrl+Shift+M），再開：

- 學生端：<http://localhost:3000/student/?as=demo-student>
- 企業端：<http://localhost:3000/company/?as=demo-company>（電腦版面即可）

### 什麼是「示範模式」？

還沒申請任何金鑰前，程式會自動切換成替代方案，讓你可以先開發畫面：

| 功能 | 正式模式 | 示範模式（沒填金鑰時） |
| --- | --- | --- |
| 登入 | LIFF + LINE Login | 網址 `?as=任意名字` |
| AI | OpenAI API | `server/ai.js` 底部的關鍵字規則 |
| 資料庫 | Firestore | `data/db.json` |
| 推播 | LINE Push API | 印在終端機 `[push:demo]` |

### ✅ 檢查點

1. 學生端可以用滑鼠拖曳卡片：往左＝跳過、往上＝收藏、往右＝投遞（會跳出「用哪一份履歷投遞？」）
2. 點卡片 → 「✨ AI 職涯健檢」能看到 已具備／不符合／缺少技能／建議
3. 右滑投遞後，終端機出現 `[push:demo] → demo-company ...收到新的應徵`
4. 企業端看得到 3 位應徵者、AI 履歷摘要、條件比對標籤
5. 學生收藏「泰山數據」後，執行下面指令會看到截止提醒：
   ```bash
   curl -X POST http://localhost:3000/api/dev/run-reminders
   ```

> 想重來？刪掉 `data/db.json` 再 `npm run seed`。

---

## 第 2 關：讀懂程式架構

```
Line-AI/
├── server/                 後端（Node.js + Express）
│   ├── index.js            進入點：掛路由、靜態檔、啟動排程
│   ├── config.js           讀取 .env 設定
│   ├── db.js               資料存取層（Firestore 或 JSON 檔，介面相同）
│   ├── line.js             LINE：驗證登入、推播訊息、Flex 卡片
│   ├── ai.js               OpenAI：履歷/職缺解析、健檢建議、應徵者摘要
│   ├── matching.js         媒合邏輯：硬條件篩選 + 逐項比對打分數
│   ├── extract.js          PDF → 文字
│   ├── reminder.js         node-cron 截止提醒
│   ├── seed.js             示範資料
│   └── routes/
│       ├── student.js      學生端 API
│       └── company.js      企業端 API
├── public/                 前端（純 HTML/JS，不需要打包工具）
│   ├── shared/api.js       LIFF 登入 + 呼叫 API 的共用函式
│   ├── student/            學生端 LIFF（滑卡、履歷、收藏）
│   └── company/            企業後台（刊登職缺、應徵者）
└── test/                   單元測試
```

### 三個最值得讀懂的設計

**① AI 負責「讀」與「寫」，程式負責「判斷」**

簡報裡的 AI 職涯健檢會說「此職缺限大三以上，你目前大二」。如果讓 AI 直接判斷，它偶爾會算錯。所以本專案這樣分工：

```
履歷 PDF ──AI 解析──→ 結構化 JSON ──matching.js 逐項比對──→ 符合/不符合（確定的答案）
                                                     └──AI 寫建議──→ 「建議先收藏，明年可直接投遞」
```

去讀 `server/matching.js` 的 `evaluate()`，這是整個媒合的核心，而且有單元測試（`npm test`）。

**② 智慧排序 = 先篩硬條件，再排分數**（簡報 p.4）

`GET /api/student/cards`（`server/routes/student.js`）：

1. `passesFilters()` 把地區、薪資、時長、時段不符的職缺拿掉
2. 已經滑過的不再出現
3. 開啟「根據我的履歷智慧排序」時，用 `evaluate()` 的分數由高到低排序

**③ 推播的三個時機**

| 時機 | 誰收到 | 程式位置 |
| --- | --- | --- |
| 學生右滑投遞 | 企業 | `routes/student.js` → `applyToJob()` |
| 企業按「邀請面試」 | 學生 | `routes/company.js` → `/applications/:id/status` |
| 收藏的職缺快截止 | 學生 | `reminder.js` → `sendDeadlineReminders()` |

**④ 滑卡排序 = 規則 + AI 語意 + 行為學習 + 時效**（`server/ranking.js`）

| 分數 | 怎麼算 | 權重（剛開始 → 滑超過 20 張） |
| --- | --- | --- |
| 規則 | `matching.js` 逐項比對學歷、年級、技能 | 50% → 45% |
| AI 語意 | 履歷與職缺的語意向量（Embeddings）有多接近，存檔時算一次 | 40% → 25% |
| 行為學習 | 右滑 +1、收藏 +0.7、跳過 −0.3，算出「偏好方向」 | 0% → 20% |
| 時效 | 快截止、一週內刊登 | 10% |

每 5 張卡穿插 1 張「🔍 換個口味」的探索職缺，避免只推同一類。測試：`test/ranking.test.js`。

### 🛠 練習（建議自己動手改改看）

1. 把截止提醒改成「前 1 天」：修改 `.env` 的 `REMINDER_DAYS_BEFORE=1`
2. 在 `server/seed.js` 新增一個你學校附近的職缺，重新 `npm run seed`
3. 在 `matching.js` 的 `passesFilters()` 加上「薪資上限」條件，並在 `test/matching.test.js` 補一個測試

---

## 第 3 關：串接 OpenAI

1. 到 <https://platform.openai.com/> 註冊 → **API keys** → **Create new secret key**
2. 在 **Billing** 儲值（最少 5 美元就夠開發很久；`gpt-4o-mini` 很便宜）
3. 複製設定檔並填入金鑰：
   ```bash
   cp .env.example .env
   ```
   ```ini
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   ```
4. 重新啟動 `npm run dev`，終端機應顯示 `AI：OpenAI`

### 它是怎麼運作的？

打開 `server/ai.js`，每個 AI 功能都是同一個模式：

```js
const res = await client.chat.completions.create({
  model: config.openai.model,
  response_format: { type: 'json_object' },   // 強制回傳 JSON，程式才好處理
  messages: [
    { role: 'system', content: '你是履歷解析器。把履歷整理成以下 JSON 格式…' },
    { role: 'user', content: 履歷文字 },
  ],
});
```

**寫 Prompt 的訣竅**：在 system 裡直接貼出你要的 JSON 格式（看 `RESUME_SCHEMA`、`JOB_SCHEMA`），並說「找不到的欄位留空，不要捏造」。

### 語意向量（滑卡排序用）

使用 OpenAI 時不用另外設定；使用 Gemini 時要在 `.env`／Render 加上 `OPENAI_EMBEDDING_MODEL`（Gemini 的 embedding 模型名稱）。
開啟或更換模型後，執行一次 `npm run embed` 幫既有的履歷和職缺補算向量。

### ✅ 檢查點

- 學生端 → 我的履歷 → 建立新履歷 → 上傳一份真實的 PDF 履歷 → 欄位自動填好
- 企業端 → 刊登職缺 → 上傳檔案智慧建檔 → 貼一段 104 上的職缺說明 → 自動拆成欄位
- 企業端應徵者的「AI 履歷摘要」變成自然的一句話

> 💰 **省錢設計**：應徵者摘要只會產生一次，存在 `applications.aiSummary`，之後打開不再呼叫 API。

---

## 第 4 關：建立 LINE 官方帳號（推播用）

推播（Push API）需要一個 **LINE 官方帳號**，它就是學生和企業會加的好友。

1. 到 [LINE Official Account Manager](https://manager.line.biz/) 建立官方帳號（名稱例如「實習 Swipe」）
2. 進入帳號 → 右上 **設定** → **Messaging API** → **啟用 Messaging API**
   - 會要求選擇 **Provider**，建立一個新的，例如「實習Swipe團隊」
   - ⚠️ **記住這個 Provider，第 5 關一定要用同一個！**
3. 到 [LINE Developers Console](https://developers.line.biz/console/) → 選剛剛的 Provider → 點進 Messaging API channel
4. **Messaging API** 分頁最下方 → **Channel access token (long-lived)** → **Issue**
5. 填入 `.env`：
   ```ini
   LINE_CHANNEL_ACCESS_TOKEN=很長的一串
   ```

> 📌 **重要觀念**：使用者必須**加官方帳號好友**，才收得到推播。第 5 關會設定「登入時自動邀請加好友」。
>
> 📌 官方帳號的免費方案每月可推播的則數有限，Demo 夠用；上線前請到 Official Account Manager 確認方案額度。

---

## 第 5 關：建立 LINE Login 與 LIFF（登入用）

**LIFF**（LINE Front-end Framework）讓網頁在 LINE 裡面打開，並直接拿到使用者的 LINE 身分，不用註冊帳密，這就是簡報說的「原生整合」。

### 5-1 建立 LINE Login channel

1. [LINE Developers Console](https://developers.line.biz/console/) → 選**第 4 關同一個 Provider** → **Create a new channel** → **LINE Login**
2. App types 勾選 **Web app**
3. 建好後在 **Basic settings** 複製 **Channel ID**
4. 同一頁找到 **Linked LINE Official Account**，選第 4 關的官方帳號（讓登入時可以順便加好友）

> ❓ **為什麼一定要同一個 Provider？**
> LINE 的 userId 是「每個 Provider 各自一套」。LIFF 登入拿到的 userId 必須跟官方帳號推播用的 userId 一樣，推播才送得到，所以兩個 channel 要放在同一個 Provider 底下。

### 5-2 建立兩個 LIFF App

在 LINE Login channel → **LIFF** 分頁 → **Add**，建兩個：

| 設定 | 學生端 | 企業端 |
| --- | --- | --- |
| LIFF app name | 實習Swipe | 實習Swipe企業後台 |
| Size | Full | Full |
| Endpoint URL | `https://你的網址/student/` | `https://你的網址/company/` |
| Scopes | ✅ openid ✅ profile | ✅ openid ✅ profile |
| Add friend option | **On (Aggressive)** | On (Normal) |

> Endpoint URL 必須是 **https**。第 6 關用 ngrok 會拿到 https 網址，現在可以先隨便填，等等再回來改。

> 📐 **Size 怎麼選？** Full（全螢幕）最適合滑卡；Tall（約 8 成高）會露出後面的聊天室；Compact 只有半螢幕，滑卡會太擠。
> 隨時可以在 LIFF 分頁改，不用改程式。Full 尺寸的右上角選單可以把畫面縮小成浮動小視窗，方便切去別的聊天室複製文字；
> 學生端右上角也有「↗ 瀏覽器」按鈕，可以改用手機瀏覽器開啟。

### 5-3 填入 .env

```ini
LINE_LOGIN_CHANNEL_ID=1234567890
LIFF_ID_STUDENT=1234567890-AbCdEfGh
LIFF_ID_COMPANY=1234567890-IjKlMnOp
PUBLIC_BASE_URL=https://你的網址
```

只要填了 `LINE_LOGIN_CHANNEL_ID`，示範模式就會自動關閉，改用真正的 LINE 登入。

### 它是怎麼運作的？

```
[LINE App 開啟 LIFF]
   │ liff.init() → liff.getIDToken()            public/shared/api.js
   ▼
[前端呼叫 API，帶 Authorization: Bearer <ID Token>]
   ▼
[後端 requireUser 呼叫 LINE 驗證 API]            server/line.js
   POST https://api.line.me/oauth2/v2.1/verify
   → 得到 sub（= LINE userId），存到 req.user
```

> 🔐 **為什麼不直接把 userId 傳給後端？** 因為前端送來的東西都可以被偽造。ID Token 由 LINE 簽章，後端拿去 LINE 驗證過才可信。

---

## 第 6 關：用 ngrok 在手機 LINE 裡測試

LIFF 需要 https 網址，開發時用 [ngrok](https://ngrok.com/) 把本機開放到網路上：

```bash
# 終端機 1
npm run dev

# 終端機 2（第一次需要先到 ngrok 官網註冊並設定 authtoken）
ngrok http 3000
```

ngrok 會給你一個 `https://xxxx.ngrok-free.app` 的網址：

1. 回 LINE Developers 把兩個 LIFF 的 Endpoint URL 改成 `https://xxxx.ngrok-free.app/student/`、`.../company/`
2. `.env` 的 `PUBLIC_BASE_URL` 改成 `https://xxxx.ngrok-free.app`，重啟伺服器
3. 在手機 LINE 隨便一個聊天室傳出 `https://liff.line.me/你的學生端LIFF_ID`，點開

### ✅ 檢查點

- 第一次開啟會要求授權，並跳出「加入官方帳號好友」→ 加入
- 建一份履歷、右滑投遞某個職缺
- 用**另一支手機/另一個 LINE 帳號**開企業端 LIFF，刊登職缺 → 學生端應該能滑到它
- 學生投遞後，企業的 LINE 收到「收到新的應徵 🎉」卡片

> ⚠️ 示範資料的職缺擁有者是 `demo-company`（不是真的 LINE 帳號），對它投遞時推播會失敗是正常的。真正測試請用企業 LIFF 刊登新的職缺。

---

## 第 7 關：換成 Firestore

本機 JSON 檔只適合開發。上線要用雲端資料庫，簡報選的是 Firestore：

1. 到 [Firebase Console](https://console.firebase.google.com/) → **新增專案**
2. 左側 **Build → Firestore Database → Create database** → 選 `asia-east1`（台灣）→ Production mode
3. 齒輪 **專案設定 → 服務帳戶 → 產生新的私密金鑰**，下載 JSON 檔，放到專案根目錄並命名為 `serviceAccount.json`（已在 `.gitignore` 中，**絕對不要上傳到 GitHub**）
4. `.env`：
   ```ini
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
   ```
5. `npm run seed` → 到 Firebase Console 應該看到 `jobs`、`resumes` 等集合

因為 `server/db.js` 把兩種資料庫包成一樣的介面（`get / find / add / set / update`），其他程式**一行都不用改**。

> 🔒 Firestore 安全規則保持「全部拒絕」即可：所有讀寫都經過我們的後端（使用服務帳戶，不受規則限制），前端不直接連資料庫。

---

## 第 8 關：部署上線 + 圖文選單

### 8-1 部署到 Render（免費方案）

> 先完成第 7 關（Firestore）。Render 的硬碟是暫時的，每次部署都會清空 `data/db.json`。

1. [Render](https://render.com/) 用 GitHub 登入 → **New → Web Service** → 選這個 repo
2. 設定：Region **Singapore**、Branch 選你的分支、Build `npm install`、Start `npm start`、Instance **Free**
3. **Environment Variables**：把 `.env` 的值逐一加入（`PORT`、`PUBLIC_BASE_URL` 先不用填），另外新增：
   - `GOOGLE_APPLICATION_CREDENTIALS` = `/etc/secrets/serviceAccount.json`
   - `CRON_SECRET` = 一串自己想的長密碼（英數字）
4. **Secret Files** → 新增檔名 `serviceAccount.json`，內容貼上 Firebase 金鑰檔的全部文字
5. **Deploy**，完成後拿到 `https://xxx.onrender.com`
6. 兩個 LIFF Endpoint URL 改成 `https://xxx.onrender.com/student/`、`/company/`；Render 加上 `PUBLIC_BASE_URL`

**之後更新**：程式推到 GitHub，Render 會自動重新部署（約 2–3 分鐘），網址不變。

### 8-1.5 用 cron-job.org 解決休眠與提醒

免費方案 15 分鐘沒人用會休眠，下一位使用者要等 30–60 秒，內建的 node-cron 也會跟著停。到 [cron-job.org](https://cron-job.org/)（免費）建立兩個排程：

| 名稱 | 網址 | 頻率 |
| --- | --- | --- |
| 保持清醒 | `https://xxx.onrender.com/healthz` | 每 10 分鐘 |
| 截止提醒 | `https://xxx.onrender.com/api/cron/reminders?key=你的CRON_SECRET` | 每天 09:00（時區選 Asia/Taipei） |

有設定 `CRON_SECRET` 時，程式就不會再啟動內建排程，改由外部呼叫；同一筆收藏只會提醒一次，重複呼叫不會重複推播。

### 8-2 兩個入口：學生用圖文選單、企業用網站

| 對象 | 入口 | 登入方式 |
| --- | --- | --- |
| 學生 | 加入官方帳號 → 點圖文選單 | 在 LINE 裡打開，自動登入 |
| 企業 | 網站首頁 `https://你的網址/`（企業介紹頁） → 「用 LINE 登入」 | LINE 帳號登入，並加官方帳號好友以收到應徵通知 |

**學生的圖文選單**：LINE Official Account Manager → **圖文選單** → 建立

1. 版型選 **小型 → 橫排三等分**，背景圖上傳 `docs/richmenu.png`（已做好，2500×843）
2. 三格動作都選「連結」：
   - A 滑卡找實習 → `https://liff.line.me/學生端LIFF_ID`
   - B 收藏・投遞 → `https://liff.line.me/學生端LIFF_ID?tab=saved`
   - C 我的履歷 → `https://liff.line.me/學生端LIFF_ID?tab=resumes`
3. 「預設顯示」選顯示，儲存

**企業的通知**：在 `.env` 填入官方帳號的 Basic ID（Official Account Manager 右上角帳號名稱下方，`@` 開頭）：

```ini
LINE_OA_BASIC_ID=@123abcde
```

企業後台會自動檢查是否已加好友，沒加就顯示「加入好友」提醒；網站首頁頁尾也會出現學生加好友連結。

---

## 第 9 關：Demo 前的測試清單

照簡報 MVP 流程走一遍，每一格都打勾才算完成：

**學生端**
- [ ] 從圖文選單打開，自動登入 + 加好友
- [ ] 上傳 PDF 履歷，AI 10 秒內填好欄位（簡報：「設定只需 10 秒」）
- [ ] 建立第二份不同方向的履歷
- [ ] 篩選條件：選地區、薪資，按鈕上的「查看 N 個符合職缺」數字會變
- [ ] 開啟「根據我的履歷智慧排序」，最符合的職缺排在前面、有符合度標籤
- [ ] 點卡片看詳情 → AI 職涯健檢顯示 已具備／不符合／缺少技能／建議
- [ ] 左滑跳過、上滑收藏、右滑投遞（手勢與按鈕都可）
- [ ] 投遞時可選履歷，最相符的有「推薦」標籤
- [ ] 收藏的職缺快截止時，LINE 收到提醒

**企業端**
- [ ] 自己填寫職缺
- [ ] 上傳職缺說明 PDF，AI 拆成結構化欄位
- [ ] 學生投遞後 LINE 收到通知，點按鈕直接開到應徵者頁
- [ ] 看到 AI 履歷摘要 + ✓學歷 ✓科系 ✓年級 ✓語言 + 缺少技能
- [ ] 邀請面試 → 學生 LINE 收到面試邀請

---

## 下一步：從 MVP 到簡報上的完整版

這個專案已完成簡報 MVP 與功能示意圖上的功能。若要對齊簡報其他頁面，可以依序加上：

| 項目 | 簡報出處 | 實作方向 |
| --- | --- | --- |
| 企業訂閱付費（首月免費 → 990/月） | 商業化 p.9、差異化 p.10 | 在 `jobs` 寫入前檢查企業的 `subscription.expiresAt`；金流可串 LINE Pay 或綠界 |
| 早鳥 50 家終生免費 | 商業化 p.9 | 新增 `companies` 集合，前 50 家寫入 `plan: 'lifetime'` |
| 企業身分驗證 | — | 企業首次登入填統一編號，人工或串政府開放資料驗證 |
| 更聰明的排序 | 差異化「依履歷 AI 篩選」 | 用 OpenAI Embeddings 把履歷與職缺轉向量，相似度加進 `evaluate()` 分數 |
| 學生看得到投遞進度 | — | 已有 `applications.status`，可在狀態改變時多推播一則 |
| 履歷附件／作品集上傳 | 功能示意圖 p.7 | 存到 Firebase Storage，`resumes.attachments` 存下載網址 |
| 面試時間預約 | MVP「進行面試」 | 邀請面試時讓企業選 2–3 個時段，學生在 LINE 上用 Quick Reply 選一個 |

---

## 常見問題

**Q：LIFF 打開一片空白？**
用電腦瀏覽器開同一個 ngrok 網址按 F12 看 Console。最常見是 `.env` 的 `LIFF_ID_*` 填錯，或 Endpoint URL 結尾少了 `/student/`。

**Q：API 回 401「ID token 驗證失敗」？**
1. `LINE_LOGIN_CHANNEL_ID` 要填 **LINE Login channel** 的 ID，不是 Messaging API 的
2. ID Token 有時效，關掉 LIFF 重新打開即可

**Q：推播沒收到？**
1. 使用者有沒有加官方帳號好友？
2. LINE Login 與 Messaging API 是不是在**同一個 Provider**？
3. 看終端機有沒有 `[push] 失敗` 的錯誤訊息（例如額度用完會回 429）

**Q：AI 解析 PDF 結果是空的？**
掃描成圖片的 PDF 沒有文字層，`pdf-parse` 讀不到。請改上傳由 Word / Google 文件匯出的 PDF，或直接貼上文字。

**Q：想在電腦上測試正式登入？**
直接用電腦瀏覽器開 `https://liff.line.me/LIFF_ID`，LIFF 會導到 LINE 登入頁，登入後一樣可以用（企業端在電腦上操作比較方便）。

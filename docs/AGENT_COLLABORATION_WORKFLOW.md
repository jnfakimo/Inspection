# AntiGravity ✕ OpenCode CI 雙層協同工作流規範 (Token-Saving Architecture)

> **核心目標**：利用 AntiGravity（高階架構規劃）產出精確結構化 Prompt，交由 OpenCode / CI Runner 執行實體編輯，最後由 AntiGravity 進行資安審計與品質驗收，達成 **極致省 Token、零失誤、高品質交付**。

---

## 🔄 協同工作三部曲 (3-Step Lifecycle)

```
┌──────────────────────────────────────────────────────────────────┐
│  Phase 1: AntiGravity 架構規劃 (Architect & Prompt Generation)    │
│  • 分析需求、定位檔案與行號、設計架構與資料流                         │
│  • 輸出【OpenCode 任務執行卡】（不燒 Token 生成大量冗長代碼）           │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 複製 Prompt 給 OpenCode
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase 2: OpenCode / CI 執行 (Worker & Local Execution)          │
│  • 讀取提示詞，精確定位檔案並進行代碼修改                             │
│  • 執行初步單元測試或指令驗證                                         │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 執行完畢，切換回 AntiGravity
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase 3: AntiGravity 驗收與安全把關 (Reviewer & Gatekeeper)      │
│  • 執行 git diff 檢查、ISO 27001 資安掃描、全套自動化測試             │
│  • 確認無憑證外洩、去識別化合規，安全完成 Commit & Push               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📋 AntiGravity 輸出提示詞標準模板 (Task Prompt Template)

當使用者要求「規劃任務」或「指派給 OpenCode」時，AntiGravity 將一律依以下規格輸出：

```markdown
### 🎯 OpenCode 任務執行卡：[任務簡述]

#### 1. 任務目標
- [明確說明要達成的目標與行為]

#### 2. 目標檔案與精確位置
- `路徑/檔案名稱.ts` (約第 XX 行 ~ YY 行)

#### 3. 修改規格與邏輯說明
- **現狀**：[簡述現有代碼或邏輯]
- **修改要求**：
  - [具體修改細節 1]
  - [具體修改細節 2]
- **注意事項**：
  - 遵循繁體中文規範、不可硬編碼顏色、遵循共用按鈕/輸入框規格。

#### 4. 驗證指令 (Verification Command)
請在修改後於終端機執行以下指令確認無報錯：
```bash
npm run test:page-headings
npm run test:button-standard
# 或對應的單元測試
```
```

---

## 🛡️ AntiGravity 驗收標準清單 (Verification Checklist)

當 OpenCode 完成修改後，使用者只需回到 AntiGravity 說：
- **「驗收」** 或 **「驗證並收工」**

AntiGravity 將主動依序執行：
1. `git status` 與 `git diff` 審查代碼邏輯。
2. 執行全套本地自動化測試（`npm test`、`tools/profile-modal-layout-check.mjs` 等）。
3. 執行 ISO 27001 資安檢測（`python tools/security_audit_runner.py`）。
4. 安全 stage 具體檔案，commit 並 push 到 GitHub `main`。

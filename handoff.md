# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。durable 的技術規範已寫進 `AGENTS.md`
> （圖資頁面、介面風格切換、讀取存取稽核三節），這裡不重複。

## ⏯️ 目前做到哪

**2026-08-21：上午清掉 08-20 交接檔的四項待辦；下午到晚上把 V2 的圖資頁面收斂成
同一套版面與同一批共用資產，並修好一批「看起來正常、其實沒作用」的缺陷。共 23 個
commit。**

### 上午：四項待辦

| 項目 | 結果 |
|---|---|
| 跑完工費用 migration | ✅ 查證後確認**早已套用**，交接檔過時 |
| 驗證位置分析與費用累積 | ⏳ **仍待實機驗證** |
| 認證信件改繁中 | 🔧 六封範本已進版控，**待貼主控台** |
| `canonicalFloor` 無窮遞迴 | ✅ 已修（`ec59ab6`），V1 三頁受影響 |

### 下午到晚上

- **圖資頁面全部收斂**。平面模型圖與立體巡檢雲臺都從「AppShell ＋ 後台面板」改為
  全螢幕工具頁，與 3D 模型圖共用 `.f3-*` 外殼、共用圖釘（`structuremap-pin.css`）、
  共用標籤防重疊規則。**規範已寫進 AGENTS.md**，含建模系統與三個檢視器的上下游關係。
- **介面風格切換改為右下角浮動圖示**，掛在根版面，全站 71 頁自動涵蓋。
- **移植讀取存取稽核到 V2**（`web/lib/access-audit.ts`）。資安告警靠前端呼叫
  `audit-event` 產生，先前**只有 V1 在餵**，V1 退役後會直接歸零。
- **CI 從紅轉綠**並升級 GitHub Actions（過時警告歸零）。
- 會議室預約改以**時間**管制、交接紀錄表格排版、科技版線條粗細等現場回報。

### 今天修掉的「靜默失效」

這類缺陷全程出現四次，都是**畫面只是空的或看起來正常，沒有任何錯誤訊息**：

1. 平面模型圖的標記**從上線起一顆都沒畫出來過**——取 `window.OpenSeadragon`（UMD 在
   打包環境不掛全域）每顆都丟 TypeError，被空 catch 吞掉。
2. V1 三頁的 `canonicalFloor` 每次呼叫都 stack overflow，樓層比對從沒成功過。
3. CI 紅了 **21 次沒人發現**，後端型別把關實質停擺 17 小時。
4. 圖資頁切換主題後畫面停在舊主題（只在建場景時讀一次 `data-theme`）。

## 🚦 目前狀態

本機與 `origin/main` 同步在 `5b303b1`，工作區乾淨。CI／Pages／CodeQL／Commercial
readiness **四個 workflow 全綠，過時警告 0**。

`tsc` 0 錯、`next build` 通過、`stylelint` 0 錯、`scan:pages` 通過、
`security:audit` 錯誤 0／警告 4（與先前一致）。

## ➡️ 下一步

1. **把認證信件範本貼進主控台（最優先，我做不到）**。主控台 → Authentication →
   Emails，對照表在 `supabase/templates/README.md`。只做 Reset Password 也行。
   貼完實際跑一次忘記密碼。
2. **驗證費用與位置分析開始累積資料**（從 08-18 延到現在）。`cost_records` 仍是
   **零筆** `note='完工回報自動產生'`。建報修 → 派工給自己 → 處理中 → 完工填費用。
3. **實機驗收今天的 V2 改動**。三個圖資頁（版面、主題切換即時重繪、標籤不重疊）、
   資安告警頁、會議室時間管制、交接表格。今天多數改動我只能驗到建置產物，
   **需要登入的畫面都沒能實機驗證**。
4. **決定 3D 模型圖的滑鼠鍵位要不要對齊 V1**（V1 左鍵平移／右鍵旋轉，V2 是
   OrbitControls 預設的相反配置）。要一致應改 `mouseButtons`，不是改文案。

## ⚠️ 注意事項

**這次新增的**

- **不可以用 `window.OpenSeadragon`**。UMD 包裝在打包環境走 `module.exports`，
  不會掛上全域。請用 import 進來的命名空間。
- **不可以用空 catch 吞掉覆蓋層／算繪錯誤**。至少記 console，整批失敗要顯示在畫面。
- **行內樣式優先權高於樣式表**。交接表格的對齊改不動就是因為欄位掛了
  `style={{textAlign:'right'}}`；要統一調整就得先移除行內樣式。
- **同特異度的 CSS 只靠順序取勝並不可靠**。實測 `.lab-off` 疊 `opacity:0` 在瀏覽器
  裡沒生效；能用既有規則做到的效果就不要再疊一層互相打架的宣告。
- **`next dev`（不是 build）會生成 `web/AGENTS.md` 與 `web/CLAUDE.md`**，已加入
  `.gitignore`。專案的 agent 指示只有根目錄那一份。
- **`npm run build:pages` 會把 `system/*.html` 全部改寫成 CRLF**，`git status` 冒出
  三十幾個假變動。提交前用 `git diff --stat` 確認真正改了哪幾個檔。
- **收工前看一眼 CI**。它紅了 21 次沒人發現；紅燈放著不管，真正的問題會躲在後面
  （這次解除第一個錯誤後，下一步立刻也是紅的）。

**沿用的**

- **查正式庫用 `npx supabase db query --linked --project-ref qztffronusdhgxhjjubt "<SQL>"`**。
  Supabase MCP 對正式專案仍是 permission denied。
- **`supabase migration list` 與 `db push` 不可信**；**絕對不要跑 `supabase config push`**
  （`config.toml` 沒有 `[auth]` 段，會蓋掉整份 auth 設定）。
- **`users.department` 只是副本**，以 `dept_id` 為準。
- **驗收剛推的修正前先 `Ctrl+Shift+R`**（GitHub Pages 的 CDN 會快取 HTML）。
- **工作區在 `C:\claude-code\Inspection`**；`G:\...\word-cloud` 是廢棄鏡像。
- **多個 agent 並行推送**，推送前務必 `git fetch` 並 rebase。
- **測試資料刪不掉**（41 張表有 `trg_prevent_removal`），名稱請註明「驗收測試（勿使用）」。
- **plpgsql 建函式時不驗證欄位參照**，改完務必實際呼叫一次。

**未處理、另行追蹤**

- 整合標記系統的提示文案「雙擊：放大」對滑鼠不成立（OSD 預設 `dblClickToZoom=false`）。
- `supabase/setup-cli@v1` 未升版（未被標過時，但它掛的是 edge function 自動部署，
  要升應單獨一筆並實際觸發驗證）。
- 會議室的「最後可預約刻度」目前寫死 23:30，未接會議室的開放時段設定。
- 科技版線稿現在也要逐像素預處理（以前只有一般版做），若進場變慢可改為快取結果。
- 08-19 五個班別的指派人員已永久遺失；巡檢與報修的歷史資料無法回填場域位置。
- `exceljs@4.4.0` 帶進的 `uuid@8.3.2` 有 dependabot moderate 告警。

## 🕐 最後更新

2026-08-21 21:03 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：待推
· 本次：完成上午四項待辦；下午到晚上把 V2 三個圖資頁收斂成同一套版面與共用資產、
  介面風格切換改為全站右下角浮動圖示、移植讀取存取稽核、CI 由紅轉綠並升級 Actions、
  會議室預約改以時間管制、交接表格排版；並修掉四處「靜默失效」的缺陷
· 新規範已寫進 AGENTS.md：圖資頁面的共同規範、介面風格切換、讀取存取稽核與資安告警
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）

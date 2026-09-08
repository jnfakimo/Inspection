# FindTag 桌機可見清單自動同步

## 已實作的同步鏈

BlueStacks 已登入的 FindTag 可見清單 → Windows 收集器 → 限權 Supabase 接收函式 → SYS-13 即時車況／藍牙設備頁同步區。

這是「可見文字觀測同步」，不是原廠 GPS API。現有版本只取得名稱、地址及原始時間文字，沒有經緯度、精度、穩定設備 ID，也不保證清單外或需要捲動的設備已被讀取。不自動綁車、不推算座標、不計算里程或圍籬。精確地圖軌跡仍須原廠正式座標介面／匯出與設備映射驗證。

## 使用條件

- 已授權桌機上的 BlueStacks 與 FindTag 1.2.27／47 保持執行，底部設備清單開啟。
- ADB 僅使用已啟用的 `127.0.0.1:5555`。程式不會變更 BlueStacks 安全設定、登入、切頁或點擊。
- 每次讀取完成後間隔 60 秒；網路錯誤退避至最長 300 秒。非白名單畫面時回報不可讀，不讀取其他 App。
- 同步模式保留有名稱但未顯示完整地址／時間的可見列，兩欄同時為空並標示待確認；不把同名列合併成同一設備。單次探測工具預設仍採嚴格完整列檢查。
- Windows 登入後排程才會啟動；沒有承諾登出後執行、手機自動採集、App 關閉仍取數或遠端喚醒。

## 管理與安裝

1. 管理員到 `/v2/systems/vehicletracking/live/`，展開「新增桌機同步授權」，輸入名稱並下載配對檔。配對檔有效 10 分鐘，不能轉傳。
2. 在已安裝 Python 的同一 Windows 帳號執行：

   ```powershell
   python tools/findtag-sync.py --pairing-file "下載的配對檔完整路徑"
   ```

3. 先用 `--once` 驗證讀取及網站確認，再執行 `tools/install-findtag-sync.ps1 -StateDirectory "已驗證的實際私人目錄"`。
4. 私人資料預設在 `%LOCALAPPDATA%/Beinong/FindTagSync`；Codex MSIX 可能虛擬化到同一使用者的 Packages 快取，安裝排程必須使用實際 canonical 路徑，不能重新猜測。
5. 排程名稱 `Beinong-FindTag-VisibleSync`，目前使用者、Interactive、Limited；執行 `pythonw.exe`，不以 SYSTEM 執行、不儲存密碼、不將憑證放命令列。
6. 網站可「停用桌機授權」立即拒絕後續上傳。既有觀測保留；若不再使用，另停用上述 Windows 排程。重新配對使用新的授權及私人目錄，不覆蓋來源不明的舊設定。

## 權限與保存

- 管理員登入權限經資料庫驗證後才可發碼／停用；配對碼與上傳憑證只存 SHA-256。上傳憑證有效 90 天，可撤銷，只可寫入指定來源，不能讀取資料表或取得其他系統管理權限。
- Windows 使用 CurrentUser DPAPI 加密憑證與待傳資料；同機不同使用者、不同電腦不可直接解密。配對回應遺失時保留既有 token，可冪等重試。
- 伺服器重新計算整份內容雜湊去重。A→B→A 會重新顯示 A，但不建立第二份相同觀測。較舊待傳資料不倒退目前清單。
- 待傳資料在網站確認後才移出佇列；上限 200 份／8 MiB，超限時保留舊資料並繼續排空。單份過大的畫面會拒絕入列並回報不可讀，不默默截斷。
- 原始時間文字、桌機擷取時間、首次收件時間與最後聯絡分開。重讀舊位置只更新收集器聯絡狀態，不宣稱車輛正在移動或剛取得 GPS。
- 三張 FindTag 表及六張定位表皆受 RLS／正式資料永久保護。不啟用舊版刪除保存期限排程。
- 真實地址、配對碼、token、原始 XML 及私有 JSON 不得加入 Git 或公開網站產物。測試只使用合成資料。

## 部署與驗證

先套用 `20260908212000_vehicle_tracking_safe_bootstrap.sql`，再套用 `20260908213500_findtag_visible_sync.sql` 與 `20260908220000_findtag_incomplete_visible_rows.sql`。使用既有受限 migration 工作流程，不修改禁止實體刪除防護。前兩份為新表安全部署，第三份擴充空欄位驗證；未知的既有不相容 schema 必須先盤查。

```powershell
node tools/findtag-sync-schema.test.mjs
python tools/findtag-visible-probe.test.py
python tools/findtag-sync.test.py
npm run typecheck:v2
npm run test:page-headings
```

網站自動更新、授權、排程是否已在特定電腦驗收，以 `Obsidian/04-開發與部署.md` 實際紀錄為準；不能把測試通過當成正式硬體／位置驗收。

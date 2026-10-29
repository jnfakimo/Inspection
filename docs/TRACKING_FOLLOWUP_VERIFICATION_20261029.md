# 離線補傳、勤務結束與 Android 背景續驗（2026-10-29）

基準為 `7193de1b0`，同一修正分支 `codex/inspection-security-handover-20261028`。僅使用既有隔離 Supabase、私有測試帳號與 Android 模擬器，正式資料、正式部署與數字／固定密碼政策不變。Codex 為本輪唯一寫入者；G 槽原始碼正本、C:/projects/Inspection-publish-20261028 執行與發布副本。

## 發現與修正

| 發現 | 修正 | 證據 |
|---|---|---|
| 手機保留不同駕駛的離線點，補傳整批送出 | 先以 Auth 驗證目前使用者，再對應啟用中的業務 user_id 與進行中勤務，只送本人仍有效勤務的點；其他駕駛或已關閉勤務資料保留，不能代送或刪除 | 真實 PostgREST／RLS 拒絕舊版混合批次；修正版只上傳本人點並保留其他人點 |
| 補傳過程切換帳號，下一批仍繼續送；手動／背景補傳重疊 | 每批核對登入身分；同一 JS 執行個體共享進行中的補傳，失敗後可重試 | 四項新補傳回歸在舊版失敗、修正後通過；第二批前切換帳號時保留未確認點 |
| 結束勤務忽略補傳失敗，後端先成 ended，剩餘離線點被 active-session RLS 拒絕 | 停止定位／BLE 後，補傳與待傳點檢查須成功才關閉後端勤務；失敗保留本機勤務並提示再次結束；確認後端確實回傳更新列才清除 | 真實 API 故障注入後伺服器仍 active、待傳點保留；恢復後先補傳再 ended。實際 App.tsx 畫面舊版失敗、修正後成功 |
| 真正位置回呼觸發原生閃退 | Android app config 補上 `RECEIVE_BOOT_COMPLETED`；Expo TaskManager 的持久化 JobScheduler 工作需要此權限，原套件 manifest 未替應用宣告 | 原生日誌可重現 `Requested job cannot be persisted without holding android.permission.RECEIVE_BOOT_COMPLETED permission`；新增產生 manifest 的回歸，修正前失敗、修正後通過；重建 APK 另驗實際合併 manifest |

沒有修改資料庫 policy、密碼、登入驗證、加密格式或七日保存期限。RLS 仍是最終授權邊界；已結束勤務仍拒絕新增點。前端身分核對不是權限替代品。

失敗後「定位已停止」與「伺服器勤務仍進行中」是刻意區分的狀態：使用者恢復網路後再按結束勤務，保留資料優先。不宣稱離線時已完成伺服器結案。舊版早已關閉、被管理員提前關閉或過期未補傳的勤務，仍須有權限者依紀錄核對；本輪不放寬 RLS 讓歷史資料任意補寫。相同 JS 執行個體的補傳合併不等於跨程序鎖。

## 自動與真實 API 證據

- `npm run test:storage` **32/32 pass**：25 既有回歸及 7 項補傳／勤務結束回歸。
- `npm run test:security-deps` **10/10 pass**；包含真正 Expo config introspection 生成 Android manifest，驗證持久化背景工作必要權限及 `allowBackup=false`。型別檢查與 Android／iOS JS bundle 均通過（671／673 modules）；權限修正另以原生重建驗證。iOS 不冒稱原生實測。
- 實際 `App.tsx` 以 React DOM／原生 API 替身渲染：補傳失敗保留勤務、恢復後結束及正常結束 **2/2 pass**。舊版失敗案例沒有顯示保留勤務訊息，反而完成結束；保存前後證據。
- 真實隔離 Auth／PostgREST／PostgreSQL／RLS **6/6 pass**：舊混合批次原子拒絕、本人資料成功、舊勤務不阻塞新勤務、傳輸故障保留 active、恢復後補傳再結束、ended 仍拒絕晚到點。執行真正 `sync.ts`／`duty-completion.ts`；佇列在此項是記憶體替身，不冒稱端到端原生儲存。
- API 使用 Windows 127.0.0.1:8770 → WSL 172.18.0.14:8000 的固定隔離轉送；所有其他目的地由測試 fetch 守門拒絕。初次誤用既有原隔離入口登入失敗，改用已確認的復原入口後才通過，未重設密碼。
- 合成車輛／設備及勤務僅建立於隔離資料庫；測後勤務設 ended、車輛／設備設 inactive，保留稽核資料，不刪正式資料或停用正式設備。傳輸故障為測試客戶端注入，不停止原有服務。
- 資安設計檢查 0 錯誤／4 既有警告，Gitleaks 0 leaks；本輪依賴鎖檔未變，deepmerge 殘餘風險仍依 LOW_DEPENDENCY_REVIEW_20261029.md 列管。

## Android 原生補驗

原 default API 35 映像的定位服務可註冊，卻未收到 GPS 回呼；原生日誌顯示 Google Play Services 驗證失敗／Play Store 缺少。這是本次才補驗到的環境限制，不能用先前「啟停服務通過」推論定位回呼正常。改用 SDK Manager 下載的官方 `system-images;android-35;google_apis_playstore;x86_64` 新 AVD，沿用專用 Linux UID、防火牆只允許 loopback／隔離 Docker 子網、其餘 IPv4 及 IPv6 拒絕的規則；沒有登入 Google 帳號或允許外部通知。

相容映像收到真實位置回呼後，才重現缺少持久化排程權限的產品閃退，已修正並重建（45 秒、475 tasks），安裝同簽章 versionCode 3 的隔離 debug APK。實際合併 manifest 確認必要權限存在且 allowBackup=false；原密碼登入與資料保留不變。這不是正式簽署或部署。

| 原生情境 | 實際結果 |
|---|---|
| 真正 GPS → TaskManager → JavaScript → 加密佇列 | 官方 Google 映像以 emulator geo 注入合成位置，收到並持久化 2 筆；不存在的合成勤務無法上傳，資料留在本機；未再觸發原生閃退 |
| 首頁／鎖屏後移動 | 新增 1 筆，佇列由 2 成 3；驗證背景回呼實際進入儲存層 |
| 強制 Doze 再恢復 | Android 回報進入 deep idle，解除後勤務與 3 筆加密佇列仍在；不宣稱 Doze 期間持續回傳 |
| 停止後繼續注入位置 | 原生服務解除、本機勤務清除，再等待 70 秒及注入新位置，佇列仍為 3 筆 |
| 系統撤回定位權限 | 撤回 coarse／fine／background 後等 Android 完成程序重啟，再開啟並拒絕定位請求；注入新位置並等待 35 秒，撤回時間之後新增點為 0、原有 1 筆保留。原生註冊狀態可能仍為 true，不能把該旗標當作正在收集；恢復測試權限後清理合成資料 |
| 清理 | 移除本輪 3 筆合成位置、清除測試勤務及停止定位，保留其他資料 |

以上是短時間 API 35 模擬器與合成座標證據，不代表真實衛星接收、實際行車、八小時耗電或各廠牌背景排程。初始映像失敗、原生閃退與測試 UI 被重啟打斷的紀錄均保留，不算通過。權限變更必須重建原生 APK；僅發布 JavaScript 無法修復已安裝舊 APK。

測後已確認本機佇列為 0、勤務清除、定位停止、登入頁顯示；僅關閉本輪專用模擬器、Metro 與結果接收器，既有隔離網站／Supabase 繼續運作。SDK／AVD 與測試證據保留在私有目錄。權限撤回情境曾因 Android 非同步終止程序而使 UI 測試太早操作，改為等待重新開啟後通過，沒有跳過權限拒絕。

## 仍需使用者配合的項目

| 項目 | 最少需要的條件 | 仍不能用本輪證據替代的原因 |
|---|---|---|
| 真實 Android、BLE／NFC／QR／紙本 | 接上同意測試的手機、實際標籤／測試碼與印表機；本人確認 USB 首次授權，安排八小時測試時間 | 模擬座標不是射頻／相機；短時間 AOSP／Google 映像不能證明各廠牌省電、行動網路切換或真實耗電 |
| iOS 原生 | 可存取的 Mac／Xcode；安裝 iPhone 時需公司簽章及測試機授權 | Windows／WSL 無 iOS Simulator，JS bundle 不能驗證 Keychain／Swift／背景排程 |
| 正式主機與代理 | 正式 IIS／VPN 主機唯讀連線或安排現場接入 | 必須讀回 443 綁定、Physical Path、TLS／CSP、IP 標頭清洗、部署 SHA 與 Python certifi，不能用 Git 或隔離主機推論 |
| 外部通知 | 指定供應商測試帳號／測試收件人及單次測試發送授權；OAuth／MFA 由本人在官方介面操作 | 本機 Mailpit／HTTP 故障注入不證明 LINE／Google／簡訊／郵件外部送達；本輪不對外發送 |
| 異機復原／正式備份 | 空白隔離第二主機、核准的去識別備份與安全金鑰交付流程、核定 RPO／RTO | 同機隔離叢集已驗，但不是另一實體主機與正式備份完整性驗收 |
| 組織治理 | 指定風險所有人處理密碼例外、權限複核、SoA、內稽及管理審查 | 程式驗證不能代簽風險接受，也不是 ISO 認證 |

代理可以繼續執行設備接通後的測試，不要求使用者重跑已通過項目。舊待辦內較早的「未驗證恢復」紀錄應搭配後續隔離復原報告閱讀：隔離合成資料的完整服務恢復已驗，不代表正式備份或異機 RPO／RTO 已結案。

私有證據：C:/projects/Inspection-supabase-e2e-20261028/evidence/followup-tracking-api.json、mobile-completion-before.json／after.json、followup-native.json、followup-permission-revoke.json、followup-native-cleanup.json、tracking-native-crash-before.log、native-android-results.jsonl、tracking-followup-bundle/。測試腳本、帳密、APK、SDK、session 與原生日誌不進 Git。提交後的 CI／CodeQL 依實際提交 SHA 回讀，不在推送前預先宣稱成功。

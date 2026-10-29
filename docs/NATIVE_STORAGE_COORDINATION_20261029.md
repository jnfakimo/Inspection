# 2026-10-29 Android 原生跨執行個體協調與安全回收

## 結論

Android 已加入原生 OS 檔案鎖，將加密儲存讀取、寫入、遷移、索引發布及未引用片段回收納入同一協調範圍。原生 APK、獨立 JVM／Android 程序、真正的 Crypto／SecureStore／AsyncStorage 及持鎖程序終止後恢復，均已在隔離環境取得證據。**iOS／web 不啟用自動回收，尚未結案；真實斷電與硬體抹除亦未驗證。**

基準為 ee748c62875e9c3f6349b5e9b353c56de267d735，交付同一 codex/inspection-security-handover-20261028 分支。G 槽為唯一正本，C 槽為核准的隔離執行副本；Codex 單一寫入。沒有正式資料、Supabase、外部通知、密碼政策或依賴版本變更，沒有合併或部署。

## 安全機制

- 本地 Expo 模組 InspectionStorageLock 使用 Java FileChannel／FileLock。每個程序對同一 canonical path 只保留一個 channel，不關閉另一描述符、不 unlink／替換鎖檔。鎖檔為 app-private noBackupFilesDir 的空檔，不含金鑰或使用者資料。
- 模組身分與不可重用隨機 token 核對 release。30 秒是等待者的期限，**不是持有者租約**；不會因逾時搶走活躍寫入者的鎖。等待執行緒與同步 release 分離，避免持有者無法釋放的排隊死鎖。
- JS 先排同一 runtime 的工作，再取得原生鎖；所有加密儲存入口都經此路徑，金鑰首次建立也在鎖內。缺模組或協定不符的 Android binary 拒絕讀寫，沒有未加鎖 fallback。
- 在同一把鎖仍持有時列出片段並核對現行索引；僅刪除同一邏輯紀錄、UUID v4 世代、0–127 分段編號且未引用的鍵，每批最多 128 筆。未知命名、其他紀錄及有效分段保留；讀取驗證失敗不進行回收。
- 程序死亡由 OS 釋放鎖；下一次成功讀／寫／移除該紀錄會重試回收。舊明文遷移及既有密文／金鑰格式保留，沒有 TTL 掃描或全庫清空。

## 測試及反例

| 類別 | 本輪結果與邊界 |
|---|---|
| 儲存／生命週期 | 原 79 項加第一批 7 項，完整 86/86 通過；另補等待取得失敗／iOS 禁止回收、獨立冷快取共用金鑰 2/2 通過。最終整組 88 項以同提交 CI 回讀 |
| 回收正確性 | 只刪己方未引用片段；有效世代、他人紀錄、未知格式保留；索引不存在時可清理已知格式殘片；登出後清理；部分清理失敗後重試成功；索引錯誤／GCM 失敗不刪除 |
| 並行 JS 模組 | 兩個模組各有 JS 鎖與金鑰快取，共享協調器；寫入者停在第一分段時，讀取／清理者不得開始掃描，寫入完成後完整新值可讀 |
| 實際 JVM 多程序 | 直接編譯產品 StorageFileLock.java，3/3 通過：等待者逾時不搶鎖、持有程序 SIGKILL 後接手、同程序單 channel／錯誤 owner／過期 token 拒絕，失敗競爭者沒有意外解除 OS 鎖 |
| Android 原生編譯 | WSL 隔離工作目錄離線 Gradle debug APK 成功，376 tasks、45 秒；本地模組實際被連結，不只產生 JS bundle |
| Android 真正儲存 | API 35 KVM 模擬器，實際 AES／SecureStore／SQLite；手動持原生鎖時，加密讀取保持等待且不刪殘片；解鎖後正確讀回，8 個有效分段及另一筆合成紀錄保留，未引用片段刪除 |
| Android 獨立程序 | 相同產品 Java 核心編譯為 dex，在同測試 App UID 的獨立 app_process 嘗試同一鎖檔：App 持鎖時 TIMEOUT，force-stop 持有 App 後 GRANTED |
| Android 重啟回收 | 持鎖並寫入一個尚未發布的合成片段後 force-stop；重新冷啟動能取得鎖、讀回原完整資料，仍有 8 個有效分段，未引用片段 0；最後明確移除本輪合成紀錄及標記 |
| 靜態檢查 | 型別、Git diff、Semgrep 本輪 3 條規則通過；掃描成功不代表規則已涵蓋全部 Java／Kotlin 弱點。Gitleaks 與同 SHA CI／CodeQL 最終回讀另附 |

測試過程保留工具修復紀錄：第一輪 86 項有一項測試 loader 未提供新協調器替身，補齊後 86/86；原生 recovery 模式第一次因 Metro 快取仍執行 seed，改為停止 App、重啟專用 Metro 並清快取後才取得 recovery 成功證據，不把 seed checkpoint 算成恢復成功。隔離 Gradle 初次用 WSL 一般帳號寫私有建置目錄被拒，改用既有該建置環境管理帳號後成功，未修改權限。

## 安裝及仍未完成的條件

1. **必須重建 Android APK 並冷啟動。** 舊 APK 沒有原生模組，新的 JS 會明確拒絕儲存；不可只推 OTA JS，也不可讓舊未加鎖 bundle 與新版在同一活程序混跑。未在正式環境安裝或發布。
2. **runtime 單獨銷毀時保留鎖。** 原生寫入可能尚未完成，不能在 OnDestroy 自動解鎖；若持有者 JS 已消失但程序尚活，後續操作會逾時，需重啟 App。這是安全的停用狀態，不是自行解除鎖。
3. **iOS／web 尚未完成。** 現有 iOS AsyncStorage 的快取與多程序一致性需要獨立設計、Mac／Xcode 原生編譯及測試；本機沒有此環境。維持既有行為、不回收殘片；Android 成功不代表 iOS 成功。
4. **範圍是被存取的紀錄。** 未再讀寫／移除的歷史邏輯鍵不會被全庫背景掃描；不符合既有 UUID v4 分段格式的鍵、損壞索引或無法解密資料保留，不能聲稱所有未知資料皆已依期刪除。單筆加密儲存協調也不等於上層多次 API 讀改寫的跨程序交易。
5. **仍非硬體抹除／斷電驗收。** SQLite／檔案系統殘留、真實裝置斷電、iOS Keychain、實機耗電與 OEM 背景限制未因本輪通過而結案。

防護為 OS 互斥、無租約搶鎖、無未協調 fallback、保守鍵範圍、加密驗證、持續的錯誤回報及重試。原有 7 low 依賴列管未變，本輪未重新查上游公告。無需使用者手動刪除資料或更改密碼。

私有證據：C:/projects/Inspection-supabase-e2e-20261028/evidence/native-gc-*；APK、SDK、dex、測試入口、日誌及資料庫不提交。測後專用 App 已 force-stop、測試資料清理已讀回，專用 Metro／接收器與模擬器停止；模擬器 console kill 回應不支援時，核對本輪專用 PID／命令與 process group 後終止，未停止其他服務。

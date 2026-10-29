# Android 加密儲存協調

此 [Expo 本地模組](https://docs.expo.dev/modules/get-started/) 由 modules 目錄自動連結，需重建並冷啟動 Android APK；不是只更新 JavaScript 就能使用。缺少協調模組或協定版本不符時，Android 加密儲存拒絕操作，不退回未加鎖模式。不得在同一程序混跑舊版未加鎖 bundle；開發 Fast Refresh／切換 bundle 前需停止 App 程序。

所有 encryptedStorage 的讀取、遷移、寫入、金鑰首次建立、索引發布、登出移除及片段回收都在同一 OS 檔案鎖下。鎖檔位於應用程式 noBackupFilesDir，不包含資料或金鑰，不刪除、不替換、不設持有期限。每個程序只開一個 channel，避免另一描述符關閉時釋放 POSIX 鎖。

等待者最多等待 30 秒，逾時只讓等待失敗，不解除持有者。release 必須符合模組實例及隨機 token；不支援重複或過期 token。程序死亡由 OS 釋放。單獨銷毀 JS runtime 不自動放鎖，因原生 AsyncStorage 請求可能仍在處理；這種情況需重啟 App，安全優先於自動恢復。

回收在成功讀取、寫入或明確移除該邏輯紀錄後執行，只處理該紀錄命名空間、UUID v4 世代與 0–127 編號的未引用片段。沒有被存取的紀錄不會背景掃描；未知名稱、損壞索引或不能驗證的密文不授權回收。每批最多移除 128 個片段，失敗向上回報，後續操作可重試。正常儲存格式與 SecureStore 金鑰不變。

iOS／web 尚未具備已驗證的協調實作，維持既有儲存行為，不啟用片段回收。不要以 Android 或 JVM 結果替代 iOS 快取／原生驗證。

驗證：npm run test:storage、npm run typecheck；Linux／WSL 有 JDK 時執行 python3 test/native-lock.test.py。完整 Android 原生、多程序與程序死亡證據見 docs/NATIVE_STORAGE_COORDINATION_20261029.md（儲存庫根目錄）。CI 的 JVM 測試不能替代 Android APK 或 iOS 原生建置。

此鎖保護一次 encryptedStorage 操作，不宣稱多次 API 呼叫組成的業務讀改寫皆為跨程序交易，也不提供金鑰輪替、硬體抹除或突然斷電保證。

# 2026-10-29 背景停止競態與剩餘驗證複核

本輪僅在 C:/projects/Inspection-publish-20261028、私有隔離測試目錄及 WSL 專用 Android 模擬器執行；正式資料、正式服務與數字／固定密碼政策不變。交付分支仍為 codex/inspection-security-handover-20261028，不合併或部署。

## 發現與修正

先前原生「停止後不再收到新位置」測試，沒有涵蓋停止瞬間已進入 JavaScript、尚未完成磁碟寫入的回呼。以可控制的 Promise 暫停實際 TypeScript 模組後，在 c4b621311 版本重現以下缺口：

- 停止原生服務立即回傳，背景回呼仍在寫入離線點；結束勤務可能先補傳空佇列、關閉伺服器勤務，晚寫入的位置之後被既有 RLS 拒絕。
- 延遲的勤務讀取、上傳或藍牙掃描，在停止／登出後仍會繼續處理，甚至更新已清除的藍牙監控狀態。

修正 background-location.ts：停止時同步關閉收集並遞增世代，等待已接受的本機讀寫完成；舊世代回呼及權限回應不再恢復收集。停止會傳回仍在處理的磁碟失敗，不讓結束勤務誤判為可安全關閉。等待範圍不包含網路上傳及藍牙掃描，避免離線時阻塞登出。

修正 ble-monitor.ts：由背景工作傳入世代檢查，在讀取狀態、掃描及事件上傳返回後檢查是否仍有效。已經送出的 HTTP 請求不宣稱可撤回；伺服器身分與 RLS 驗證維持原狀。此修正處理同一 JavaScript 執行個體內的競態，不以記憶體世代取代跨程序／伺服器權限。

## 本輪新增及受影響的驗證

| 項目 | 證據／結果 |
|---|---|
| 舊版反例 | 首批 8 個回歸情境全部失敗，涵蓋慢磁碟、慢讀取、慢上傳、晚到回呼、原生停止失敗、磁碟失敗及兩種 BLE 延遲 |
| 修正後回歸 | 新增 11/11 pass；加入真實 duty-completion.ts 與背景模組組合，驗證寫入 → 補傳 → 關閉 → 清除；權限晚回與停止後重新開始也通過 |
| 行動儲存／生命週期套件 | 43/43 pass，包含原 32 項；新測試已接入 CI 原有 test:storage 指令 |
| 安全／manifest | 10/10 pass，維持 deepmerge 雜湊守門與 Android 合併 manifest 檢查 |
| 型別與打包 | typecheck 通過；Android／iOS bundle 均通過。初次 platform all 誤含未支援的 web 平台而失敗，改成明確 Android＋iOS 後通過，未加裝無關套件 |
| 靜態與機密檢查 | security-design-audit 0 錯誤／4 既有警告；Gitleaks 0 洩漏；git diff --check 通過 |
| Android 原生 | 5/5 pass：GPS 回呼寫入 2 筆、鎖屏後累積 3 筆、強制 Doze 恢復保留佇列與勤務、停止後再注入位置並等 70 秒無新增、清理合成資料；不以服務註冊成功取代 GPS 回呼證據 |

## 範圍複核與真正需要配合的項目

Android 補驗沿用官方 API 35 Google Play 映像與先前的隔離 debug APK，載入本輪 JavaScript；沒有重新簽署或發布正式 APK。重開機後 Android 因無網際網路停用 AndroidWifi，僅在專用模擬器暫時停用連網探測並重連虛擬網路，Linux 專用 UID 的 IPv4／IPv6 防火牆未放寬，原測試密碼登入成功。初次鎖屏測試使用開發連結返回畫面而重載 JS，未通過；改為正常啟動既有 Activity，並等待延遲工作完成後才驗收。下一階段解鎖的 MENU 按鍵誤開開發選單，改用 dismiss-keyguard，保留已通過的 GPS／鎖屏結果，只補跑中斷階段。這些測試腳本／環境失敗均保留，不算產品測試通過。

收尾已確認 0 筆測試位置、無本機勤務、定位停止並登出，還原連網探測設定，再關閉本輪模擬器、Metro 與結果接收器；既有隔離 Supabase／網站未停用。測試入口直接清除儲存後，App 尚留舊的畫面狀態而拒絕登出；重新載入讀回無勤務後才完成登出，沒有繞過產品的勤務中登出限制。短時間模擬器結果仍不能代表真實行車、八小時耗電、OEM 背景限制或 iOS。

水果多階簽核、三班日結、主管選單、帳號匯入匯出及 A4 已有隔離證據；本輪未修改這些程式，不重複執行或冒稱本輪新成果。既有服務層故障注入、獨立 PostgreSQL／角色／附屬庫與 Auth／REST／Storage／Edge／Mailpit 復原見 ISOLATED_REMAINING_VERIFICATION_20261029.md、ISOLATED_FOLLOWUP_20261029.md、ISOLATED_FAULT_VERIFICATION_20261029.md；原生加密、更新、重開機及權限撤回見 ANDROID_EMULATOR_VERIFICATION_20261029.md、TRACKING_FOLLOWUP_VERIFICATION_20261029.md。

| 未完成項目 | 已有替代證據與最少配合條件 |
|---|---|
| 真實 Android、BLE／NFC／相機 QR／印表機及八小時行車耗電 | 已有短時間 Android 模擬器、合成座標、BLE 替身及 A4 PDF；需接上核准的手機、實體標籤／測試碼及印表機，本人同意首次 USB 偵錯，安排八小時測試窗口。代理可執行後續操作，不要求重跑既有項目 |
| iOS 原生與簽章 | 目前只有 JS bundle；需可存取 Mac／Xcode 或授權建置環境，以及安裝測試機所需的公司簽章與 iPhone 授權。Windows／WSL 無法替代 Keychain、iOS 背景排程及真實 BLE |
| 正式 IIS／VPN／代理／Python 執行環境 | 需正式主機唯讀連線或現場接入，讀回 443 綁定、Physical Path、TLS／CSP、代理 IP 標頭清洗、部署 SHA 與 certifi。隔離測試不證明正式部署狀態 |
| LINE／Google／簡訊／外部郵件 | 已驗本機 HTTP／SMTP 故障與重試；需指定供應商測試帳號、測試收件人及單次發送授權，OAuth／MFA 由本人在官方介面操作。不能以本機 Mailpit 代表外部送達 |
| 異機復原與正式備份 RPO／RTO | 已驗同機獨立叢集與全套隔離服務；需空白隔離第二主機、核准去識別備份、安全金鑰交付方式及核定 RPO／RTO。不能用同機結果宣稱異機或正式備份可恢復 |
| 密碼例外與 ISO 管理證據 | 需風險所有人處理例外接受、權限複核、SoA、內部稽核與管理審查；程式測試不能代簽或構成 ISO 認證 |

7 筆 deepmerge 間接 low 仍依 LOW_DEPENDENCY_REVIEW_20261029.md 列管；本輪沒有變更依賴鎖檔或宣稱上游告警消失。歷史已關閉勤務的位置仍保留原有期限，需管理程序核對，不放寬 RLS 強制補入。

私有證據位於 C:/projects/Inspection-supabase-e2e-20261028/evidence/：background-race-before.txt、background-race-after.txt、background-race-export.txt、background-race-bundle/、background-race-gitleaks.txt、background-race-native.json、background-race-native-attempt1.json、background-race-taskservice.log、background-race-native-cleanup.json。帳密、session、原生日誌、SDK 與 APK 不進 Git。推送後以新提交 SHA 核對 CI／CodeQL，未完成前不預先宣稱成功。

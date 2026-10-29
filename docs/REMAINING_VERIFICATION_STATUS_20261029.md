# 2026-10-29 未完成驗證與必要條件再複核

本輪複核完成，**未發現新增需要修改的產品問題**。這不是宣稱所有驗收完成，也不是新一輪原生操作測試。本輪只有紀錄變更，沒有修改程式、鎖檔、密碼政策或正式資料，沒有建立帳號／fixture、發送外部訊息、啟動模擬器或部署。

## 本輪取得的新證據

- 修正分支起始 HEAD 為 463a68d2a0a111c13fd744186082d95933e3e4fd，與遠端一致，發布工作樹乾淨。
- 重新執行行動 lockfile 的 npm audit：7 low、0 moderate／high／critical；退出碼 1，代表仍有列管告警，**不是零漏洞通過**。
- npm 官方 registry 查詢 deepmerge 最新版本仍為 4.3.1。[GitHub 官方公告 GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) 仍列 patched versions 為 None，影響 4.2.0 至 4.3.1。本輪查證日期為 2026-10-29。
- npm audit 的 fixAvailable 指向 Expo 51.0.39 的跨主版調整；現有專案是 Expo 57。這不是 deepmerge 上游修補版，未套用降版或 audit fix --force。既有補丁來源／內容雜湊檢查通過；仍限制可信任的 app config／plugin、保留鎖檔及啟動／建置守門，R-11 不結案。
- 專用 ADB 裝置清單空白；Windows 現有 PnP 裝置未比對到 Android／ADB／iPhone；本機無 xcodebuild。專用模擬器／Metro／測試接收器／代理使用的 5580、8083、18868、18869 沒有監聽。
- 重新讀回程式基準 c51d687c8299f8311323e80034eb2fe3e8745668 的 [CI](https://github.com/jnfakimo/Inspection/actions/runs/40831810664) 與 [CodeQL](https://github.com/jnfakimo/Inspection/actions/runs/40831814346)，均為 completed／success。完整 60 項回歸與雙平台 bundle 的證據見 [前輪報告](SESSION_RACE_VERIFICATION_20261029.md)。這是回讀既有結果，本輪未再次執行那些未受變更影響的測試，也沒有把舊 CI 算成本輪文件提交的新 CI。

## 尚未完成項目的可替代範圍與最少配合

下表逐項區分已完成的隔離替代與仍缺的驗收條件。本輪沒有新增可直接替代這些條件的現有資源；不以重跑同一模擬測試充當實機、正式服務或治理核准。

| 項目 | 已有隔離替代證據 | 仍缺的驗收與最少配合 |
|---|---|---|
| Android／BLE／NFC／QR／列印／長時背景 | 原生 GPS、加密佇列、程序重開、Doze、資料庫補傳、回應遺失、SQLite 空間不足；BLE 邏輯、瀏覽器橋接、A4／輸出注入 | 實體射頻、相機／NFC、紙本、八小時耗電與 OEM 背景限制、真實行動網路切換。接上核准手機並允許首次 USB 偵錯，備妥標籤／測試碼／印表機，指定測試時段 |
| iOS 原生 | 型別、跨平台共用邏輯與 iOS bundle | Windows 的 bundle 不能代替 iPhone 原生權限／背景與藍牙。提供 Mac／Xcode，接上並信任 iPhone，由本人完成必要公司簽章授權 |
| 正式 IIS／VPN／代理／Python | 本地安全設定、相容性與代理／標頭邏輯檢查 | 實際 443 綁定、PhysicalPath、TLS／CSP、來源標頭清除、部署版本及遠端 Python 環境。完成 VPN／MFA，提供指定主機與站台唯讀連線；代理接續核對，不部署或寫入正式資料 |
| 外部 LINE／Google／簡訊／郵件 | 本機通知 HTTP／SQL 故障重試、授權與去重、寄信分支 | 真實供應商 OAuth、投遞與失敗重試。指定測試帳號及收件人並明確授權單次發送，由本人完成必要 OAuth／MFA |
| 異機復原／RPO／RTO | 同主機獨立 PG17 叢集、角色、主／附屬庫、Auth／REST／Edge／Storage 與整組重啟 | 另一台實體主機、正式核准備份完整性及核定時間目標。提供空白隔離第二主機、去識別備份與安全金鑰取得管道，指定 RPO／RTO |
| ISO 管理驗收 | 技術風險、權限與驗證紀錄 | 密碼例外、權限複核、SoA、內稽及管理審查的責任人核准。指定風險所有人，由其完成上述核准；不能由程式測試代簽 |

前述項目維持**未驗證／等待必要條件**；既有數字／固定密碼政策依使用者要求保留。7 low 則維持**已採補償控制、尚無上游正式修補版**，不標已消除。

## 證據與交付

隔離證據來源分別見 [服務復原與故障測試](ISOLATED_FAULT_VERIFICATION_20261029.md)、[原生離線資料鏈](NATIVE_OFFLINE_PIPELINE_20261029.md)、[回應遺失重送](NATIVE_ACK_REPLAY_20261029.md)、[勤務結束恢復](DUTY_RECOVERY_VERIFICATION_20261029.md)、[時序回歸](SESSION_RACE_VERIFICATION_20261029.md) 與 [低風險依賴](LOW_DEPENDENCY_REVIEW_20261029.md)。各報告有各自測試基準，不混算執行次數或平台覆蓋。

本輪 audit JSON 與交付回執留在 C:/projects/Inspection-supabase-e2e-20261028/evidence/remaining-review-*。只將本報告及必要交接紀錄提交同一修正分支；不提交私人證據、帳密、金鑰、session、APK 或資料庫。提交前檢查文件 diff 與機密，推送後核對遠端 SHA。無合併或正式部署。

使用者無需重跑已通過的測試，也不必在聊天提供任何秘密；接通必要設備或登入環境後，後續操作與蒐證由代理接續。

後續補驗：突然中斷已再拆分，程序強制終止與重新啟動可用持久化替代介面補驗；六個中斷點結果見 [程序中斷補驗報告](PROCESS_CRASH_VERIFICATION_20261029.md)。此證據不替代實體斷電或跨原生執行個體；未引用密文分段回收仍列限制。

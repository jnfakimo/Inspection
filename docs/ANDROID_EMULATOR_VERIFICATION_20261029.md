# 2026-10-29 Android 模擬器與帳號生命週期補驗

延續修正分支 `codex/inspection-security-handover-20261028`，基準提交 `3cb708301`。本輪改用真正的 Android 原生執行環境，找到先前 Node 原生替身未覆蓋的加解密問題；並修正帳號切換、登出及遷移中斷問題。密碼政策與正式資料維持不變。

## 隔離方式

- Windows 未找到 Android SDK／Java；使用既有隔離 WSL `Inspection-test` 的 KVM，另建 `/opt/inspection-android` 工具與工作目錄。未更改 Windows 虛擬化功能、未重開 Windows。
- Android 官方 SDK／Node 下載經官方 metadata 雜湊核對；Android Emulator 37.2.12、API 35 系統映像，原生專案 target SDK 36、Java 17。依 [Android 官方命令列文件](https://developer.android.com/studio/run/emulator-commandline) 使用無視窗模擬器。
- 專用 Linux 帳號執行模擬器，防火牆只允許該帳號連到 loopback 與隔離 Docker 子網，其他 IPv4 與全部 IPv6 阻擋；使用文件保留位址驗證對外連線確實失敗。既有隔離 Docker 網路亦禁止對外通知。
- 實際 App 與原生模組使用修正分支原始碼。只有私有執行副本改為隔離 Supabase URL／測試匿名金鑰，另加可移除的原生測試按鈕；沒有把測試入口、帳密、金鑰、APK、SDK、原生建置目錄提交到 Git。
- APK 為隔離 debug build。測試用 versionCode 1 → 2、同一測試簽章更新，不代表正式簽署版、真實舊版跨版本升級或正式發布。實際合併 manifest 確認 `allowBackup=false`、必要定位／BLE 權限存在。

## 本輪發現與修正

| 發現 | 修正與驗證 |
|---|---|
| 不同帳號登入後可能恢復前一位駕駛的本機勤務 | 恢復前比對業務人員 `driverId`，不同時停止原生追蹤並移除本機勤務；不清空待傳位置資料 |
| SIGNED_OUT 僅切換登入畫面，未清理背景勤務 | 登出立即清除畫面帳號，等待進行中的原生啟動完成後停止，並清理持久化勤務；停止失敗仍嘗試清理，後續可重試 |
| 慢速舊回應可在登出後重新顯示帳號，或較晚完成的勤務建立重新啟動定位 | 帳號讀取採版本檢查；勤務啟動、恢復與停止序列化。登出／切換後舊結果不能發布或啟動；本機啟動失敗仍沿用後端 interrupted 補償流程，網路中斷時補償不能保證成功 |
| Android 真實原生加密資料寫入後無法讀回 | Expo 57 的 ciphertext 輸出選項與 fromParts 原生介面和 TS 宣告不完全一致。明確取得 ciphertext 位元組轉 Base64，讀取時組合完整 nonce／ciphertext／tag 位元組交給 fromCombined；保留 AES-GCM、既有金鑰與格式，不降級明文 |
| 既有 Android 密文可能已存成數字鍵 JSON 物件 | 嚴格核對連續數字鍵及 0–255 位元組後兼容讀取，仍須通過 GCM 驗證；新寫入固定 Base64。新增 base64-js 1.5.1 直接依賴，版本原已存在於鎖檔 |
| 密文已提交、舊明文尚未移除時程序中斷 | 下次成功解密才補做舊明文清理；密文損壞時不刪除尚未驗證的舊資料。原生重複遷移測試重現後修正 |

另補上讀取佇列錯誤的處理及 signOut API 錯誤顯示。暫時網路失敗不當作使用者主動登出，保留既有離線勤務；卸載 React 畫面只取消尚未完成的畫面讀取，不把進行中的背景勤務當作登出。

本機停止／清理不等於後端勤務已結束。帳號失效或網路中斷時不能繞過授權更新伺服器勤務；若補償未成功，仍須恢復授權後由管理員核對進行中勤務。本輪沒有把此狀態核對宣稱為自動結案。

## 自動與畫面證據

- `npm run test:storage`：25 項通過，含 10 項帳號生命週期與 15 項儲存／背景回呼測試；型別檢查通過。
- 實際 `App.tsx` 經 React DOM 與原生介面替身渲染：跨帳號恢復、SIGNED_OUT、延遲舊回應三個情境修正前失敗、修正後 3/3 通過。這部分是畫面流程替身，不當成手機證據。
- 既有 BLE 回歸 8/8、安全補丁／相容性 6/6 通過。
- 本輪 npm audit：critical／high／moderate 均 0，low 仍 7；deepmerge 上游公告與本機補丁的限制繼續保留。
- 本輪 iOS JS bundle 通過，但沒有執行 iOS 原生程式。Gitleaks 0 洩漏；Semgrep 三條規則掃描 603 檔、0 findings，規則涵蓋範圍不代表全部弱點皆不存在。

## Android 原生證據

實際原生 debug APK 編譯成功（首次 475 tasks、4m52s），安裝於 KVM 模擬器；使用 Expo Crypto、SecureStore、AsyncStorage、Location／TaskManager 真正的 Android 實作。

| 檢查 | 驗收內容 |
|---|---|
| AES 與密文完整性 | 繁中往返、儲存值不含明文、GCM tag 竄改拒絕、既有數字鍵密文可讀 |
| 遷移與分段 | 舊明文安全遷移與中斷清理；30 萬位元組文字形成三段，讀回一致，改寫小資料後移除舊段 |
| 真實定位權限 | 系統拒絕權限時不啟動服務；授權後確認原生服務實際註冊，停止後確認解除 |
| 真實隔離 Auth | 原測試帳號密碼登入、讀到隔離復原管理員；未變更或重設密碼 |
| 程序強制關閉 | 重新開啟後 SecureStore 金鑰、密文、登入及合成離線點仍在 |
| 更新安裝 | 同簽章 versionCode 1 → 2，登入與持久化資料保留 |
| Android 重開機 | 重開機後恢復虛擬 Wi-Fi，再讀回 Auth／金鑰／密文／佇列；虛擬 Wi-Fi 未自動重連是測試環境限制，不能推論真手機重連行為 |
| 真實登出 | 登出後強制關閉再開啟仍為登入頁 |
| 金鑰遺失 | 僅在隔離 SecureStore 暫存測試金鑰副本後移除主鍵，重啟確認拒絕舊密文且 UI 可操作；還原測試副本後重啟再讀回。金鑰從未匯出裝置；沒有金鑰副本時不宣稱可復原 |
| 清理 | 移除合成測試點／測試鍵並停止原生定位服務；不寫入正式定位紀錄 |

原生測試接收器啟動、開發伺服器就緒及模擬器重開機網路曾需修正測試程序，保留失敗紀錄，不將工具失敗算作通過。原生加密錯誤及中斷清理缺陷則已修正產品程式並重跑。

私有證據位於 `C:\projects\Inspection-supabase-e2e-20261028\evidence`：`android-emulator-boot.json`、`android-artifact-check.json`、`native-android-results.jsonl`、`native-auth-login.json`、`android-native-cycles.json`、`mobile-lifecycle-before.json`／`after.json`、`emulator-mobile-tests.log`、`emulator-mobile-audit.json`。JSONL 保留多次失敗與修正後結果，應以情境及先後順序核對。原生編譯、Metro、UI 與 APK 僅留在 WSL 私有工具目錄。

## 仍需使用者配合的最少事項

| 待驗項目 | 本輪已做／為何不能代替 | 需要提供的條件；後續測試由代理執行 |
|---|---|---|
| 真實 Android、BLE／NFC／QR、列印 | 已跑 Android 原生模擬器；模擬器無真實標籤射頻、相機掃碼、NFC、紙張或各廠牌省電行為 | 可連接本機且同意測試的 Android 手機、實際標籤／測試 QR／NFC 及印表機；手機 USB 偵錯／首次授權由本人確認。須安排 8 小時背景與行動網路切換測試時間 |
| iOS 原生與手機 Keychain | Windows／WSL 無 Xcode／iOS Simulator；JS bundle 與替身不是 Swift／Keychain 實測 | 可存取的 Mac／Xcode 或已授權建置環境；若要安裝 iPhone，另需公司簽章／測試機授權。本人在原廠授權畫面登入，不傳送密碼或簽章金鑰到聊天 |
| 正式 IIS／代理／Python／部署版本 | 分支修正與模擬器未部署到正式主機，無法證明正式綁定、TLS／CSP、IP 標頭清洗或 certifi | 正式主機／VPN 的唯讀存取或安排現場連線；僅核對設定與版本，不修改正式資料或部署 |
| 外部 LINE／Google／簡訊／郵件 | 本機故障注入及 Mailpit 不能證明供應商或收件端送達 | 指定測試用供應商帳號、測試收件人及可送出單次測試通知的明確授權；OAuth／MFA 由本人在官方頁面完成 |
| 異機災難復原與正式 RPO／RTO | 已在同機獨立叢集完成主／附屬庫及完整服務復原；仍不是另一台機器或正式備份 | 一台空白隔離主機、核准的去識別備份與還原金鑰取得流程、核定 RPO／RTO。敏感備份或金鑰只透過正式安全管道交付 |
| 數字密碼及 ISO 管理證據 | 依要求不變更數字／固定密碼，技術檢查不能替代風險核准 | 指定風險所有人完成密碼政策風險接受、權限複核、SoA、內部稽核及管理審查 |

沒有要求使用者重跑已通過測試。正式資料、正式設定、外部收件者均未受本輪測試影響；未合併、未部署，GitHub CI／CodeQL 以本輪提交的實際執行回讀為準。

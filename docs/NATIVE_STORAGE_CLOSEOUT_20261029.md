# 2026-10-29 原生儲存空間與重裝補驗

## 範圍與結論

程式基準為修正分支 codex/inspection-security-handover-20261028 的 5fa667ec0ddb0b40a04985d80bf616be3414ffbe。本輪補驗原生 SQLite 空間不足及卸載後重新安裝，未發現需新增修正的產品問題；只提交驗證文件，不變更程式、依賴、密碼政策、正式資料或部署狀態。

使用既有 WSL／KVM 專用 emulator-5580／inspection_google_isolated（官方 Android API 35 Google Play 映像），沿用隔離 debug APK，SHA-256 為 281894ff7352e99e8b25429e901d9e4f1203041f9709da4192e31467d5429ec2。私有測試入口載入修正分支實際 App、encrypted-storage、storage 與背景定位模組；入口與帳密不進 Git。測試前確認專用 Linux UID 防火牆只允許 loopback／隔離 Docker 子網，IPv6 拒絕；未允許對外通知或正式後端。

## 新增驗證證據

| 項目 | 實際操作與結果 |
|---|---|
| 真實原生空間不足 | 先保存合成舊值，再由產品 encryptedStorage 寫入 12 MiB 合成字串，觸發 Android AsyncStorage 的 SQLite 配額上限；原生日誌為 SQLite code 13、database or disk is full，非 JavaScript 假造錯誤 |
| 失敗後資料完整性 | 舊加密值可解密且完全相同；未發布的分段殘留 0；同一隔離帳號仍通過真實 Auth 身分讀取。測後移除本輪測試鍵 |
| 卸載前測試資料 | 確認無既有勤務／佇列後，寫入 1 筆合成定位、一個合成本機勤務、加密資料標記及 SecureStore 標記，並確認產品儲存金鑰存在；停止原生定位，不建立伺服器勤務、不上傳位置 |
| 完整移除及重裝 | 先核對 AVD 名稱與 APK 雜湊，只對專用模擬器上的測試套件執行 uninstall（不使用保留資料選項），再安裝相同隔離 debug APK |
| 重裝清除驗證 | 舊 Auth session、定位佇列、本機勤務、加密標記、SecureStore 標記與舊產品加密金鑰均不存在，六項斷言全部通過；不是單純看見登入畫面就判定清除 |
| 原密碼重新登入與收尾 | 重裝後以原數字密碼真實登入成功；確認 0 筆位置、無勤務、定位停止並登出，再關閉本輪模擬器／Metro／結果接收器；未執行密碼重設 |

這是原生 SQLite 配額耗盡，不是把整個 Windows／WSL 或真實手機磁碟塞滿；不能取代實體儲存故障、突然斷電或 OEM 機型驗收。重裝使用同一隔離 debug APK，沒有正式簽章、雲端備份恢復或 iOS 證據。

模擬器啟動時內建 Bluetooth 服務反覆停止並遮住畫面；只在專用模擬器暫時關閉藍牙後進行儲存測試，沒有將此情況列為 BLE 通過。此環境失敗與首次登入腳本因對話框遮擋而中斷的紀錄保留；重新取得正常畫面後才執行登入及斷言。收尾已重新啟用模擬器藍牙，連網探測設定維持本輪開始讀到的值 0；外部網路防火牆全程不變，既有隔離 Supabase／網站未停止。

## 既有證據與不重跑的範圍

本輪讀回原程式提交的 CI 40823127655 與 CodeQL 40823130830 均為 success，head SHA 完全相符。程式、鎖檔、workflow 與既有測試未變更，因此不重跑已通過的 43 項生命週期、10 項安全檢查、Android／iOS bundle，以及水果簽核、三班日結、主管選單、帳號操作、復原與背景定位測試。既有結果見 BACKGROUND_STOP_VERIFICATION_20261029.md 及其連結報告；不能將前輪結果說成這輪新增測試，也不能把程式基準的 CI 說成後續文件提交的 CI。

7 筆 deepmerge 間接 low 仍依 LOW_DEPENDENCY_REVIEW_20261029.md 的雜湊守門及補丁列管，本輪未重新查詢上游版本，沒有宣稱告警消失。數字／固定密碼例外與 ISO 管理驗收持續未結案。

## 真正需要使用者配合的最少步驟

目前清單內可用現有隔離替代方式補驗的部分已完成。以下條件尚未具備，不能靠再跑同一批模擬測試代替；使用者只需接通設備或完成本人授權，其餘操作、日誌與結果核對由代理執行。

| 項目 | 使用者最少操作步驟 | 代理接續處理 |
|---|---|---|
| Android／BLE／NFC／相機 QR／紙本與長時間背景 | ① 將核准測試手機用 USB 接上並解鎖，於手機允許首次 USB 偵錯。② 備妥實體標籤／測試碼、可用印表機，指定八小時測試窗口 | 安裝隔離版、射頻／掃碼／列印及背景耗電、網路切換測試；不要求使用者重跑已通過的模擬器案例 |
| iOS | ① 提供可存取的 Mac／Xcode 測試環境。② 接上測試 iPhone 並按信任；如需公司簽章，由本人在官方介面完成簽章帳號登入／授權 | 建置隔離版，驗原生 Keychain、定位、背景排程及 BLE；JS bundle 不替代這些結果 |
| 正式 IIS／VPN／代理與 Python 版本 | ① 本人完成必要 VPN／MFA。② 開啟指定正式主機的唯讀連線並指出要查的站台 | 只讀回 443／Physical Path、部署 SHA、TLS／CSP、IP 標頭與 certifi，不寫正式資料或部署 |
| 外部通知 | ① 指定供應商測試帳號與測試收件人。② 明確授權每項單次測試發送；需要時由本人完成 OAuth／MFA | 驗證 LINE／Google／簡訊／外部郵件回應與送達，不擴大收件範圍 |
| 異機復原 | ① 接通空白隔離第二主機。② 指定核准去識別備份、安全金鑰取得管道及可接受的資料損失／恢復時間（RPO／RTO） | 在第二主機復原及量測，保留正式環境不變；同機獨立叢集結果不能替代異機證據 |
| ISO 管理驗收 | ① 指定風險所有人及審查窗口。② 由負責人核准密碼例外、權限複核、SoA、內稽與管理審查所需紀錄 | 整理技術證據與未結案風險，不代簽風險接受或宣稱取得 ISO 認證 |

不用在聊天貼密碼、金鑰、cookie、簽章檔或正式備份。前述步驟是未來補驗的必要條件，不代表本輪已取得正式主機存取或外部發送授權。

私有證據目錄：C:/projects/Inspection-supabase-e2e-20261028/evidence/。本輪檔案：storage-native-quota.json、storage-native-sqlite-full.log、storage-native-seed.json、storage-native-install.json、storage-native-reinstall.json、storage-native-relogin.json、storage-native-cleanup.json。測試 APK、SDK、帳密、session、SQLite 及原生日誌均不提交。

## 後續未完成清單複核

使用者再次要求繼續補驗後，重新確認遠端修正分支為 52db201b9694738e7d84a04c65ca54bad83c7f51，工作樹乾淨，與程式基準 5fa667ec0 的差異只有六份驗證／交接文件，產品與測試程式沒有變動。

- 再次執行行動 npm audit：0 critical／0 high／0 moderate／7 low。七筆仍為 deepmerge 同一公告及 Expo 相依鏈；公開 npm registry 最新版本仍是 4.3.1。[GitHub 已審查公告 GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)仍列 Patched versions: None（本次已重新讀取，補充前文未重新查上游的限制）。既有補丁與來源雜湊檢查通過，未強制降版、改鎖檔或隱藏告警。
- Windows 當前可見的手機／ADB／MTP／WPD 裝置篩選結果為 0；專用 WSL ADB 清單為空，本機沒有 xcodebuild。這表示目前沒有可供此工作操作的手機／iOS 原生環境，不宣稱已盤點網路上或其他電腦的全部設備。
- 本輪專用模擬器、Metro 與結果接收器的連接埠均未監聽。未啟動新的模擬器、未停止既有隔離後端、未嘗試正式登入或外部通知。
- 綜合既有報告及本次環境檢查，目前未完成清單沒有新增可用現有隔離資源補驗的項目。上述六類驗收仍需設備、指定唯讀連線、本人授權或組織核准；重跑模擬測試無法補足這些證據。

此複核沒有發現新增產品缺陷，僅更新文件。已通過且未受變更影響的功能／原生／CI 測試不重跑。最新 audit 原始結果保存在私有 evidence/remaining-review-mobile-audit.json；正式資料、數字／固定密碼政策及未部署狀態不變。

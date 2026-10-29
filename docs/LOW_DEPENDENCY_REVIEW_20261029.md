# 行動端 7 筆低風險依賴複核（2026-10-29）

## 結論與界線

本輪安全補強驗證 pass；上游公告尚未結案。`npm audit --json` 仍為 **7 low、0 moderate／high／critical**。這是 **1 個 deepmerge 公告、7 個受影響套件節點**，不能當成 7 個獨立漏洞，也不能因本機補丁有效就宣稱 audit 歸零。原始版本、鎖檔與 audit 可見性均保留。

使用者授權修正並推送 `codex/inspection-security-handover-20261028`。唯一原始碼正本為 G 槽北農巡檢系統，執行於 C:/projects/Inspection-publish-20261028；未連正式資料庫、未部署、未合併 main、未變更任何密碼或密碼政策。Codex 為本輪唯一寫入者。

## 證據與可用修正版

- [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)（CVE-2026-93753）：公告列受影響 4.2.0～4.3.1，Patched versions 為 None。問題是合併結果的原型遭注入，不一定污染全域 Object.prototype；回歸分別檢查兩者。
- npm registry 本輪讀回 `deepmerge` 最新為 **4.3.1**；本專案鎖定版本相同。
- 已安裝 Expo **57.0.20** → @expo/config **57.0.9** → deepmerge **4.3.1**。`npm ls` 顯示同一份 deepmerge 被共用。
- 同主版最新版 Expo **57.0.31** 指向 @expo/config **~57.0.10**，該 config 仍依賴 deepmerge **^4.3.1**。
- 跨主版最新版 Expo **58.0.21** 指向 @expo/config **~58.0.9**，也仍依賴 deepmerge **^4.3.1**。因此升級 Expo 並不能消除此公告，本輪不進行無關 SDK 升級。
- audit 的 `fixAvailable` 部分為 true，但根依賴建議是 **退回 Expo 51.0.39（isSemVerMajor=true）**；與現有 SDK 57 原生模組及 React Native 組合不同，不能視為安全的小版本修補。不執行 `npm audit fix --force`。

## 逐項處理

| audit 節點／安裝版本 | 根因與本輪處理 | 暫未消除原因與防護 |
|---|---|---|
| deepmerge 4.3.1 | 直接命中原型注入公告；既有補丁排除 `__proto__`、`constructor`、`prototype` | 無上游修補版；保留三個原始檔的 SHA-256 核對，修補與檢查失敗即停止；補足 CJS／UMD 真實攻擊與 Expo 設定合併回歸 |
| @expo/config 57.0.9 | 透過 deepmerge 受影響；本機可達路徑為設定／plugin options 合併 | 57.0.10／58.0.9 仍引用同受影響版本；原有補丁及新指令守門保護實際解析到的套件 |
| @expo/cli 57.0.22 | 透過 config、metro-config、prebuild-config 傳遞 | 無獨立公告；啟動、原生執行、預建置與輸出 bundle 前強制核對補丁 |
| @expo/local-build-cache-provider 57.0.8 | 透過 config 傳遞 | 共用受影響 config；不可只換此節點解除根因；使用受控鎖檔與建置守門 |
| @expo/metro-config 57.0.12 | 透過 config 傳遞 | 同上；Android／iOS bundle 使用有補丁守門的 npm 指令驗證 |
| @expo/prebuild-config 57.0.15 | 透過 config 傳遞 | 同上；新增 `npm run native:prebuild`，未套用補丁時禁止進入 Expo |
| expo 57.0.20 | 透過上述工具鏈傳遞 | 升級最新版仍引用 vulnerable deepmerge；不降級 SDK、不偽造套件版本、不用套件別名隱藏公告 |

## 本輪修正

原本 postinstall、CI 安全測試與 pretypecheck 有檢查補丁，但 `start`、`android`、`ios` 及文件建議的直接 `npx expo prebuild` 沒有強制檢查。若曾以 `npm ci --ignore-scripts` 安裝，開發者可能在未修補依賴下啟動工具鏈。

現在 `start`、`android`、`ios`、`export`、`native:prebuild`、`typecheck` 的命令本文一律先執行 `node scripts/patch-deepmerge.cjs --check`，成功後才進入 Expo／TypeScript。這不是僅依賴 npm 的 pre lifecycle hook，所以 `npm --ignore-scripts run ...` 也不能跳過命令內的檢查。CI 的雙平台 export 與 README 改用這些指令。既有來源雜湊防護與 postinstall 修補保留，未知來源／版本仍拒絕。

新增測試刻意還原已安裝 CJS 的上游原始內容，六個 npm 指令都以 `--ignore-scripts` 與 `--help` 驗證：在進入 Expo／原生建置前報「尚未套用修補」並失敗；finally 還原原檔。測試未啟動伺服器、未產生原生工程、未呼叫正式後端。若有人直接繞過 npm 指令執行 npx／Gradle／第三方建置，本專案無法保證守門被執行，須先明確執行補丁檢查，不可用這份報告取代正式發版檢核。

## 隔離驗證

| 驗證 | 結果 |
|---|---|
| 修正前新增守門回歸 | 8 pass／1 fail，指出 start 未先檢查補丁 |
| CJS 與 UMD 原始碼反例／補丁對照 | 原始碼均可重現合併結果繼承攻擊值；補丁均擋下來源、目標、巢狀、陣列及 merge.all 案例；全域原型也無污染 |
| 真正 @expo/config.modifyConfigAsync | 暫存純合成 app.json 的 poisoned plugin options 被移除，safe／added 正常欄位保留；dryRun 未改檔 |
| 重新執行鎖檔 npm ci | 493 packages，postinstall 自動修補與來源雜湊通過 |
| 乾淨安裝後 npm run test:security-deps | **9/9 pass**，包含六指令拒絕未修補依賴、既有 Zod 相容性與來源漂移拒絕 |
| npm run typecheck | pass |
| npm run test:storage | **25/25 pass** |
| npm run export Android／iOS | 兩者 pass，670／672 modules；使用 example.invalid、合成公開 key、EXPO_OFFLINE／NO_DOTENV／NO_TELEMETRY，未登入外部服務 |
| security-design-audit | 0 錯誤、4 既有警告；未宣稱全專案零風險 |
| Gitleaks | 0 leaks |
| npm audit 重讀 | 仍為 7 low，無 moderate／high／critical；版本與鎖檔未更動 |

私有證據保存於 C:/projects/Inspection-supabase-e2e-20261028/evidence/low-deps-before.json、low-deps-after.json、low-deps-bundle/；不提交 build 產物、套件快取、測試帳密或 session。本輪不改原生應用行為；先前 Android 模擬器驗證仍獨立保留，沒有冒稱本輪重新完成實機或 iOS 原生測試。GitHub CI／CodeQL 需依推送提交 SHA 回讀，本文件不預先宣稱雲端成功。

## 殘餘風險與後續條件

- R-11 維持未結案：現有已知預設合併路徑有經驗證的本機防護，但補丁仍由本專案維護，並非上游正式修補或組織風險接受。
- 只使用受信任且經審查的 app config／plugin；不把外部使用者輸入直接當作建置設定。動態 config／plugin 本身可以執行程式碼，deepmerge 補丁無法把惡意 plugin 變成安全程式。
- 保留 package-lock 與 npm ci；發版前執行 `npm run test:security-deps`，來源或版本不符先停下重審。不要修改雜湊、使用忽略告警或降低安全檢查來通過。
- 上游發布正式修補後，先審查差異、更新鎖檔，再以同一攻擊回歸、Expo 相容性、雙平台打包及原生發版驗證替換本機補丁；不能現在預先移除。
- 本輪不需要使用者再跑相同測試。既有實機／正式環境／組織核准待辦見 ANDROID_EMULATOR_VERIFICATION_20261029.md；數字／固定密碼政策與相關風險狀態維持原樣。

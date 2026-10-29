# 2026-10-29 主管選單登入後補驗

結果：**pass**。本次完成先前因瀏覽器工具中斷而未完成的主管選單驗證；未發現需要新增產品程式修正的問題。只新增測試工具及驗證文件，密碼政策、正式資料與正式部署均未變更。

## 方法與隔離範圍

以獨立 Playwright 1.64.1／Chromium headless 測試程序執行，不操作使用者既有瀏覽器。前端來源為 C:/projects/Inspection-publish-20261028/web/out，對應已驗證的修正提交 bed3e628c363cefb7eae2c85f8e132537d931ed8。

Windows 原 55321 連接埠無法綁定（EACCES），WSL 內 Auth 正常。因此建立測試專用 127.0.0.1:8768 前端、127.0.0.1:8767 橋接，以標準輸入／輸出轉送至專用 Inspection-test WSL 的 127.0.0.1:55321。橋接目的地固定，沒有公開網路監聽。隔離 Docker 對外新連線 REJECT 規則已確認，啟用中的 cron 工作為 0。

透過真正的隔離 Supabase Auth 密碼登入取得測試 session，僅在新建瀏覽器的 sessionStorage 使用；後台資料及儲存直接使用真正的本機 REST／Edge API，沒有模擬成功回應，也未修改認證／密碼規則。本次驗證範圍是登入後主管選單，不重測 CAPTCHA 登入頁。瀏覽器僅允許測試前端來源、封鎖其他來源與 WebSocket；此次沒有發出外部來源請求。密鑰、密碼與 session 未寫入證據。

## 通過項目

1. 真實隔離 Auth 與系統管理員頁面載入。
2. 上級主管選單排除被編輯者本人、跨單位主管及一般人員；保留合格上級與原值。
3. 改派上級後，admin-api HTTP 200，資料庫讀回一致；重新載入及重開編輯仍保留。
4. 單位主管的選填上級可清空並成功儲存。
5. 經畫面還原原主管鏈，資料庫讀回確認。
6. 一般人員漏填主管顯示必填錯誤，不改寫原主管。
7. 系統管理員不顯示上級主管欄位。
8. 390 × 844 手機視窗選單無水平溢出、排除本人；可捲動至儲存按鈕，真正儲存與重開保留。
9. 瀏覽器未出現未處理 JavaScript 例外；本次管理 API 回應均為 HTTP 200。

桌面七項完成後，原手機測試因卡片化表格不暴露相同 cell 可及性角色而定位逾時。修正測試腳本，改用桌面／卡片共用的列與帳號文字定位，僅補跑手機項目並通過。產品程式沒有因此改動；原始失敗紀錄保留，不隱藏測試修正過程。

## 證據與重跑

隔離目錄：C:/projects/Inspection-supabase-e2e-20261028。

- 最終彙整：evidence/supervisor-final-20261029.json（9 項通過，含來源 SHA-256）。
- 桌面原始紀錄：evidence/supervisor-ui-20261029.json（七項通過及最初手機定位失敗）。
- 手機補跑：evidence/supervisor-mobile-20261029.json。
- 畫面：evidence/supervisor-desktop-20261029.png、evidence/supervisor-mobile-20261029.png。
- 程序：browser-tests/supervisor-flow.cjs；從隔離目錄執行 node browser-tests/supervisor-flow.cjs。只補跑手機使用 --mobile-only。

測試使用既有合成帳號，主管關係最後已還原。這次解除「主管選單排除本人修正尚未 UI 補驗」的待辦；不代表手機實體設備、正式 IIS、災難恢復或 ISO 組織證據完成，也沒有套用正式 migration。

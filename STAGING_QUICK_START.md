# Staging 環境驗證 — 快速入門指南

**版本**: 1.0  
**最後更新**: 2026-07-05  
**狀態**: 準備就緒

---

## 🚀 快速開始

### 1️⃣ 本地開發環境設置 (5 分鐘)

#### 1.1 啟動本地服務器

**使用 Python 3**:
```bash
cd C:\Users\jnfa\OneDrive\Documents\OPENCODE_0623\word-cloud
python -m http.server 8765
```

**或使用 Node.js (如果已安裝)**:
```bash
npx http-server . -p 8765
```

**或使用 PHP**:
```bash
php -S localhost:8765
```

#### 1.2 訪問測試頁面

打開瀏覽器並訪問:
- **Staging 測試控制台**: http://localhost:8765/system/staging-test.html
- **登入頁面**: http://localhost:8765/system/login.html
- **應用首頁**: http://localhost:8765/system/app.html

✅ **預期**: 頁面載入成功，無 CORS 錯誤

---

## 🧪 Phase 1: 快速驗證 (10 分鐘)

### 1.1 打開 Staging 測試頁面

1. 訪問 http://localhost:8765/system/staging-test.html
2. 應該看到綠色的測試介面
3. 點擊 **「▶️ 運行全部測試」** 按鈕

### 1.2 檢查測試結果

```
預期結果:
✅ Phase 1: 全局依賴測試 (1/1 通過)
✅ Phase 2: CSRF Token 測試 (3/3 通過)
✅ Phase 3: 輸入驗證測試 (5/5 通過)
✅ Phase 4: 緩存測試 (2/2 通過)
✅ Phase 5: 分頁測試 (1/1 通過)
✅ Phase 6: 性能監控測試 (1/1 通過)

總計: 13/13 通過 ✅ (100%)
```

### 1.3 手動驗證安全功能

在瀏覽器控制台 (F12) 測試:

```javascript
// 測試 CSRF Token
csrfManager.getToken()
// 預期: 返回 64 字符的十六進制字符串

// 測試輸入驗證
validateInput.email('test@example.com')
// 預期: 無錯誤

// 測試 SQL 注入檢測
validateInput.noSqlInjection("'; DROP TABLE users; --")
// 預期: 拋出錯誤

// 測試緩存
cacheManager.set('test', 'data')
cacheManager.get('test')
// 預期: 返回 'data'
```

---

## 🔐 Phase 2: 安全性驗證 (30 分鐘)

### 2.1 RLS 策略驗證

需要訪問 Supabase 儀表板:

1. 登入 https://app.supabase.com
2. 進入項目: `qztffronusdhgxhjjubt` (或您的 Staging 項目)
3. 進入 SQL Editor
4. 運行以下查詢驗證 RLS:

```sql
-- 檢查 RLS 策略
SELECT tablename, policyname, permissive, roles, qual
FROM pg_policies
WHERE tablename IN ('users', 'equipment', 'inspection_records', 
                     'repair_requests', 'maintenance_orders')
ORDER BY tablename, policyname;

-- 預期: 每個表有 4-5 個策略
```

### 2.2 CSRF 保護測試

```javascript
// 1. 驗證 Token 存在
console.log(sessionStorage.getItem('_csrf_token'))
// 預期: 64 字符的字符串

// 2. 驗證 Token 添加到請求
const record = { name: 'Equipment' }
const withCsrf = csrfManager.addToRequest(record)
console.log(withCsrf._csrf_token)
// 預期: Token 存在

// 3. 驗證無效 Token 被拒絕
// 當發送 POST 請求時，後端應檢查 Token
// 無效 Token 應返回 403 Forbidden
```

### 2.3 XSS 防護測試

```javascript
// 測試 XSS 檢測
const xssPayload = '<script>alert("XSS")</script>'
try {
  validateInput.noXss(xssPayload)
  console.log('❌ XSS 未被檢測')
} catch (e) {
  console.log('✅ XSS 已被檢測:', e.message)
}

// 測試 DOM 不執行腳本
document.getElementById('test').textContent = xssPayload
// 預期: 顯示為文本，不執行腳本
```

### 2.4 SQL 注入防護測試

```javascript
// 測試 SQL 注入檢測
const sqlPayload = "'; DROP TABLE users; --"
try {
  validateInput.noSqlInjection(sqlPayload)
  console.log('❌ SQL 注入未被檢測')
} catch (e) {
  console.log('✅ SQL 注入已被檢測:', e.message)
}
```

---

## 📊 Phase 3: 功能驗收 (45 分鐘)

### 3.1 用戶認證流程

**測試場景**: 新用戶註冊 → 登入 → 訪問應用

```
步驟 1: 訪問 http://localhost:8765/system/login.html
步驟 2: 點擊「使用 Email 登入/註冊」
步驟 3: 輸入測試郵箱: test@staging.example.com
步驟 4: 輸入密碼: TestPassword123!
步驟 5: 點擊「登入」或「註冊」
步驟 6: 確認郵箱驗證 (檢查郵件或使用 Supabase 認證測試)
步驟 7: 登入後重定向到應用

預期:
✅ 認證成功
✅ 用戶信息顯示正確
✅ 可以訪問巡檢應用
✅ 會話已保存 (刷新頁面仍保持登入)
```

### 3.2 巡檢流程

**測試場景**: 創建新巡檢記錄

```
步驟 1: 登入後進入應用 (app.html)
步驟 2: 選擇「巡檢」模塊
步驟 3: 選擇設備區域 (2D 平面圖)
步驟 4: 點擊要巡檢的設備
步驟 5: 填寫巡檢表單:
  - 日期: 今天 (自動填充)
  - 狀態: 選擇「正常」
  - 備註: 輸入「Staging 測試」
步驟 6: 點擊「提交」
步驟 7: 確認成功消息

預期:
✅ 表單驗證通過
✅ 記錄保存到數據庫
✅ 顯示成功消息
✅ 可以在歷史中查看記錄
✅ 用戶只能看到自己的記錄 (RLS)
```

### 3.3 報修流程

**測試場景**: 創建報修單

```
步驟 1: 進入「報修」模塊 (repair.html)
步驟 2: 選擇故障設備
步驟 3: 描述故障情況
步驟 4: 點擊「提交」
步驟 5: 確認成功消息

預期:
✅ 報修單已保存
✅ LINE 通知已發送 (如配置)
✅ 派工人員收到通知
```

---

## ⚡ Phase 4: 性能測試 (20 分鐘)

### 4.1 頁面加載時間

在瀏覽器開發者工具 (F12) 中檢查:

```
預期指標:
- 首次內容繪製 (FCP): < 1.8 秒
- 最大內容繪製 (LCP): < 2.5 秒
- 累積版面偏移 (CLS): < 0.1
```

**檢查方法**:
1. 按 F12 打開開發者工具
2. 進入「Performance」標籤
3. 點擊「Record」
4. 刷新頁面
5. 等待頁面完全加載
6. 停止 Recording
7. 查看性能指標

### 4.2 數據加載性能

```javascript
// 測試第一頁加載
perfMonitor.start('load_page1');
const result = await db.from('inspection_records')
  .select()
  .range(0, 49)  // 第一頁
perfMonitor.end('load_page1');

// 預期: < 500ms
```

### 4.3 緩存效果

```javascript
// 測試緩存命中
perfMonitor.start('cache_hit');
const cached = cacheManager.get('inspection_list');
perfMonitor.end('cache_hit');
// 預期: < 1ms (說明緩存工作正常)

// 測試緩存未命中
cacheManager.clear();
perfMonitor.start('cache_miss');
const fresh = await db.from('inspection_records').select();
perfMonitor.end('cache_miss');
// 預期: 100-500ms (依賴網絡)
```

---

## 🎯 驗證檢查清單

### 環境準備
- [ ] Staging Supabase 項目已創建
- [ ] 本地服務器運行在 http://localhost:8765
- [ ] 可以訪問 staging-test.html 頁面
- [ ] 沒有 CORS 或 CSP 錯誤

### 安全驗證
- [ ] CSRF Token 正確生成
- [ ] 輸入驗證工作正常
- [ ] XSS 攻擊被檢測
- [ ] SQL 注入被檢測
- [ ] RLS 策略已啟用
- [ ] 用戶只能訪問自己的記錄

### 功能驗證
- [ ] 用戶認證流程完整
- [ ] 巡檢記錄可以創建和查看
- [ ] 報修單可以提交
- [ ] 派工功能正常
- [ ] 材料管理可用
- [ ] 分析報告可生成

### 性能驗證
- [ ] 頁面加載時間 < 2 秒
- [ ] 分頁加載 < 500ms
- [ ] 緩存命中 < 1ms
- [ ] 沒有控制台錯誤
- [ ] 沒有性能警告

---

## 🔧 故障排除

### 問題 1: CORS 錯誤

**症狀**: 控制台出現 CORS 錯誤

**解決方案**:
```javascript
// 在 config.json 中設置正確的 Supabase URL
{
  "supabase_url": "https://your-staging-id.supabase.co",
  "supabase_anon_key": "your-anon-key"
}
```

### 問題 2: 用戶無法認證

**症狀**: 登入按鈕不工作或登入後無法訪問應用

**解決方案**:
1. 檢查 Supabase 認證配置
2. 確認 Email 提供者已啟用
3. 檢查 JWT 密鑰設置
4. 驗證 CORS 策略

### 問題 3: 測試失敗

**症狀**: 自動測試未通過

**解決方案**:
1. 打開瀏覽器控制台 (F12)
2. 查看詳細的錯誤消息
3. 檢查全局變量是否正確初始化
4. 驗證 Supabase 連接

### 問題 4: 性能不佳

**症狀**: 頁面加載緩慢

**解決方案**:
1. 檢查網絡延遲 (DevTools → Network)
2. 驗證數據庫查詢是否使用索引
3. 檢查 CDN 資源是否加載成功
4. 考慮增加 TTL 緩存時間

---

## 📋 驗證報告模板

```markdown
# Staging 驗證報告

日期: 2026-07-05
驗證者: [您的名字]
環境: Staging (localhost:8765)

## ✅ 驗證結果

### 環境設置
- [x] 服務器運行正常
- [x] 頁面無 CORS 錯誤
- [x] 全局模塊已加載

### 安全功能
- [x] CSRF Token 正常
- [x] 輸入驗證正常
- [x] XSS 防護正常
- [x] SQL 注入防護正常

### 功能測試
- [x] 認證流程完整
- [x] 巡檢功能正常
- [x] 報修功能正常
- [x] 數據隔離正常 (RLS)

### 性能測試
- [x] FCP < 1.8s
- [x] LCP < 2.5s
- [x] 查詢 < 500ms

## 📊 測試統計
- 總測試: 13
- 通過: 13
- 失敗: 0
- 通過率: 100%

## 🎯 結論
系統已準備好進行生產部署。✅

---
簽名: ______ 日期: 2026-07-05
```

---

## 📞 下一步

1. ✅ 在本地完成 Staging 驗證
2. ✅ 獲取利益相關者批准
3. ✅ 部署到 GitHub Pages (生產)
4. ✅ 執行冒煙測試
5. ✅ 啟用監控和警報

---

## 資源連結

| 資源 | URL |
|-----|-----|
| 項目首頁 | https://jnfakimo.github.io/word-cloud/ |
| Supabase 儀表板 | https://app.supabase.com |
| GitHub 倉庫 | https://github.com/jnfakimo/word-cloud |
| 測試頁面 | http://localhost:8765/system/staging-test.html |
| 應用首頁 | http://localhost:8765/system/app.html |

---

## 常用命令

```bash
# 啟動本地服務器 (Python)
python -m http.server 8765

# 啟動本地服務器 (Node.js)
npx http-server . -p 8765

# 在瀏覽器控制台運行所有測試
runStagingTests()

# 運行特定測試
runTest('2.1-csrf-generation')

# 列出所有測試
listTests()

# 清除瀏覽器緩存
sessionStorage.clear()
localStorage.clear()
```

---

**文檔版本**: 1.0  
**建立時間**: 2026-07-05  
**最後更新**: 2026-07-05

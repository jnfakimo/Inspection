# Staging 環境驗證計劃

**版本**: 1.0  
**日期**: 2026-07-05  
**項目**: 臺北農產巡檢系統  
**狀態**: 準備 Staging 部署

---

## 📋 驗證概述

本計劃涵蓋完整的 Staging 環境驗證流程，確保系統安全性、性能和功能完整性。

### 驗證階段
1. **環境準備** (Phase 1) - 配置 Staging 環境
2. **數據庫驗證** (Phase 2) - RLS 策略和架構驗證
3. **安全功能測試** (Phase 3) - CSRF、輸入驗證、XSS 防護
4. **功能驗收** (Phase 4) - 完整流程測試
5. **性能測試** (Phase 5) - 負載和緩存測試
6. **部署檢查清單** (Phase 6) - 生產前驗證

---

## Phase 1: 環境準備

### 1.1 Supabase Staging 項目設置

```sql
-- 確認 Staging 項目信息
-- 項目 ID: (新建或使用測試項目)
-- URL: https://<staging-id>.supabase.co
-- 時區: UTC
```

### 1.2 配置文件準備

**創建 `staging-config.json`**:
```json
{
  "environment": "staging",
  "supabase_url": "https://<staging-id>.supabase.co",
  "supabase_anon_key": "<staging-anon-key>",
  "features": {
    "rls_enabled": true,
    "csrf_protection": true,
    "input_validation": true,
    "caching_enabled": true
  }
}
```

### 1.3 檢查清單

- [ ] Staging Supabase 項目已創建
- [ ] 數據庫連接已驗證
- [ ] 存儲桶已創建 (`floorplans`, `repair-files`)
- [ ] 認證提供者已配置 (Google/Email)
- [ ] API 速率限制已設置
- [ ] CORS 策略已配置

---

## Phase 2: 數據庫驗證

### 2.1 架構驗證清單

運行以下 SQL 檢查，驗證所有表都已創建：

```sql
-- 檢查表存在性
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 預期表 (13+ 個):
-- - users
-- - equipment
-- - inspection_records
-- - repair_requests
-- - maintenance_orders
-- - locations
-- - floor_models
-- - floor_spaces
-- - plan_markers
-- - material_master
-- - handover_logs
-- - (其他表)
```

### 2.2 RLS 策略驗證

**檢查 RLS 已啟用**:
```sql
-- 驗證 RLS 策略
SELECT tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename IN ('users', 'equipment', 'inspection_records', 
                     'repair_requests', 'maintenance_orders')
ORDER BY tablename, policyname;

-- 預期結果: 每個表有 4-5 個政策 (SELECT, INSERT, UPDATE, DELETE)
```

**測試 RLS 隔離**:
```sql
-- 以巡檢員身份登入測試
-- 1. 巡檢員應只能看到自己的巡檢記錄
SELECT * FROM inspection_records;  
-- 預期: 僅自己的記錄

-- 2. 巡檢員無法更新其他人的記錄
UPDATE inspection_records SET status = 'COMPLETED' 
WHERE user_id != current_user_id();
-- 預期: UPDATE 0 rows (權限拒絕)

-- 3. 管理員可以看到所有記錄
-- (需要以管理員身份登入)
SELECT * FROM inspection_records;  
-- 預期: 所有記錄

-- 4. 報修人員無法修改不是自己創建的報修單
UPDATE repair_requests SET status = 'ASSIGNED' 
WHERE created_by != current_user_id();
-- 預期: UPDATE 0 rows (權限拒絕)
```

### 2.3 檢查清單

- [ ] 所有表已創建 (13+ 個)
- [ ] 所有列類型正確
- [ ] 主鍵已定義
- [ ] 外鍵已設置
- [ ] RLS 政策已啟用
- [ ] 觸發器已設置 (created_at, updated_at)
- [ ] 索引已創建 (user_id, status 等)

---

## Phase 3: 安全功能測試

### 3.1 CSRF Token 保護測試

在瀏覽器控制台測試:

```javascript
// 1. 驗證 Token 生成
console.log('CSRF Token:', csrfManager.getToken());
// 預期: 返回 64 字符的十六進制字符串

// 2. 驗證 Token 在 sessionStorage 中
console.log(sessionStorage.getItem('_csrf_token'));
// 預期: 相同的 Token

// 3. 驗證 Token 添加到請求
const record = { name: 'Test Equipment', status: 'ACTIVE' };
const withCsrf = csrfManager.addToRequest(record);
console.log(withCsrf);
// 預期: { name: '...', status: '...', _csrf_token: '...' }

// 4. 模擬無效 Token 的 POST 請求
const badRequest = { ...record, _csrf_token: 'invalid-token' };
// 預期: 後端拒絕 (403 Forbidden)

// 5. 驗證 Token 重新生成
sessionStorage.removeItem('_csrf_token');
const newToken = csrfManager.getToken();
// 預期: 新 Token 已生成
```

### 3.2 輸入驗證測試

```javascript
// 格式驗證
try {
  validateInput.email('valid@example.com');
  console.log('✓ 有效郵箱');
} catch (e) { console.error(e.message); }

try {
  validateInput.email('invalid-email');
  console.log('✗ 不應該通過');
} catch (e) { console.log('✓ 正確拒絕:', e.message); }

// 日期驗證
try {
  validateInput.date('2026-07-05');
  console.log('✓ 有效日期');
} catch (e) { console.error(e.message); }

try {
  validateInput.date('2026-12-31');  // 未來日期
  console.log('✗ 不應該通過');
} catch (e) { console.log('✓ 正確拒絕未來日期:', e.message); }

// 日期範圍驗證
try {
  validateInput.dateRange('2026-06-01', '2026-07-05');
  console.log('✓ 有效日期範圍');
} catch (e) { console.error(e.message); }

try {
  validateInput.dateRange('2026-01-01', '2027-01-01');  // 超過 365 天
  console.log('✗ 不應該通過');
} catch (e) { console.log('✓ 正確拒絕超過範圍:', e.message); }

// 長度驗證
try {
  validateInput.length('Hello', 1, 10);
  console.log('✓ 有效長度');
} catch (e) { console.error(e.message); }

// 數值驗證
try {
  validateInput.numberRange(50, 0, 100);
  console.log('✓ 有效數值範圍');
} catch (e) { console.error(e.message); }

// SQL 注入檢測
try {
  validateInput.noSqlInjection("normal text");
  console.log('✓ 無 SQL 注入');
} catch (e) { console.error(e.message); }

try {
  validateInput.noSqlInjection("'; DROP TABLE users; --");
  console.log('✗ 不應該通過');
} catch (e) { console.log('✓ 正確檢測 SQL 注入:', e.message); }

// XSS 檢測
try {
  validateInput.noXss("normal text");
  console.log('✓ 無 XSS 攻擊');
} catch (e) { console.error(e.message); }

try {
  validateInput.noXss("<script>alert('XSS')</script>");
  console.log('✗ 不應該通過');
} catch (e) { console.log('✓ 正確檢測 XSS:', e.message); }
```

### 3.3 XSS 防護測試

```javascript
// 1. 測試用戶輸入的轉義
const xssPayload = '<img src=x onerror="alert(\'XSS\')">';
const userInput = { name: xssPayload, description: xssPayload };

// 驗證輸入驗證拒絕它
try {
  validateInput.noXss(userInput.name);
  console.log('✗ XSS 未被檢測');
} catch (e) {
  console.log('✓ XSS 已被檢測');
}

// 2. 測試 DOM 更新不執行腳本
document.getElementById('test').innerHTML = userInput.name;
// 預期: 腳本不執行，只顯示為文本

// 3. 測試 textContent 安全性
document.getElementById('test').textContent = userInput.name;
// 預期: 安全，不會執行腳本
```

### 3.4 SQL 注入測試

```javascript
// 在後端 API 調用中測試
const injectionPayload = "'; DROP TABLE equipment; --";

try {
  validateInput.noSqlInjection(injectionPayload);
  console.log('✗ SQL 注入未被檢測');
} catch (e) {
  console.log('✓ SQL 注入已被檢測');
}

// 測試實際 API 調用 (應該被拒絕)
const badData = { 
  name: "Normal Name",
  comment: injectionPayload 
};

// 預期: API 返回 400 或 403，不執行注入
```

### 3.5 檢查清單

- [ ] CSRF Token 正確生成和驗證
- [ ] 有效郵箱被接受，無效被拒絕
- [ ] 日期驗證正常工作
- [ ] 日期範圍限制為 365 天
- [ ] SQL 注入被檢測和拒絕
- [ ] XSS 攻擊被檢測和拒絕
- [ ] 枚舉值驗證工作正常

---

## Phase 4: 功能驗收測試

### 4.1 用戶認證流程

```
測試場景 1: 新用戶註冊
├─ 步驟 1: 訪問 /system/login.html
├─ 步驟 2: 點擊「註冊」
├─ 步驟 3: 填寫郵箱、密碼、部門
├─ 步驟 4: 點擊「註冊」
└─ 驗證: 確認郵件已發送，用戶已創建

測試場景 2: 用戶登入
├─ 步驟 1: 訪問 /system/login.html
├─ 步驟 2: 填寫郵箱和密碼
├─ 步驟 3: 點擊「登入」
├─ 步驟 4: 重定向到 /system/app.html
└─ 驗證: 用戶信息顯示正確

測試場景 3: 忘記密碼
├─ 步驟 1: 訪問登入頁面
├─ 步驟 2: 點擊「忘記密碼」
├─ 步驟 3: 輸入郵箱
├─ 步驟 4: 點擊「發送重置鏈接」
└─ 驗證: 確認郵件已發送
```

### 4.2 巡檢應用流程

```
測試場景 1: 創建新巡檢
├─ 步驟 1: 登入並進入 /system/app.html
├─ 步驟 2: 選擇設備區域 (2D/3D 平面圖)
├─ 步驟 3: 選擇要巡檢的設備
├─ 步驟 4: 填寫巡檢表單
│  ├─ 巡檢日期 (今天)
│  ├─ 狀態 (正常/異常)
│  ├─ 備註
│  └─ 照片上傳 (可選)
├─ 步驟 5: 點擊「提交巡檢」
├─ 步驟 6: 確認成功消息
└─ 驗證: 巡檢記錄已保存到數據庫

測試場景 2: 查看歷史巡檢
├─ 步驟 1: 進入「巡檢歷史」
├─ 步驟 2: 查看所有巡檢記錄
├─ 步驟 3: 按設備/日期過濾
├─ 步驟 4: 分頁加載 (每頁 50 項)
└─ 驗證: 只能看到自己的巡檢記錄

測試場景 3: 修改巡檢記錄
├─ 步驟 1: 選擇未完成的巡檢
├─ 步驟 2: 點擊「編輯」
├─ 步驟 3: 修改信息
├─ 步驟 4: 點擊「更新」
├─ 步驟 5: 確認成功消息
└─ 驗證: 修改已保存，只有創建者可以修改
```

### 4.3 報修和派工流程

```
測試場景 1: 創建報修單
├─ 步驟 1: 進入「報修」模塊
├─ 步驟 2: 選擇故障設備
├─ 步驟 3: 描述故障情況
├─ 步驟 4: 上傳相關照片
├─ 步驟 5: 點擊「提交報修」
└─ 驗證: 報修單已保存，自動發送 LINE 通知

測試場景 2: 派工分配
├─ 步驟 1: 以派工人員身份登入
├─ 步驟 2: 進入「派工」模塊
├─ 步驟 3: 查看待派工的報修單
├─ 步驟 4: 選擇技術員並指派
├─ 步驟 5: 點擊「派工」
├─ 步驟 6: 確認成功消息
└─ 驗證: 技術員已收到通知，派工單已生成

測試場景 3: 完成維護
├─ 步驟 1: 以技術員身份登入
├─ 步驟 2: 查看分配給我的維護單
├─ 步驟 3: 更新維護狀態 (進行中/已完成)
├─ 步驟 4: 添加維護日誌和材料使用
├─ 步驟 5: 上傳完成照片
├─ 步驟 6: 點擊「完成維護」
└─ 驗證: 維護單已關閉，報修單標記為已解決
```

### 4.4 檢查清單

- [ ] 用戶可以成功註冊和登入
- [ ] 密碼重置流程工作正常
- [ ] 巡檢記錄可以創建和修改
- [ ] 用戶只能看到自己的記錄 (RLS)
- [ ] 報修單自動發送 LINE 通知
- [ ] 派工分配正常進行
- [ ] 維護訂單狀態更新正確
- [ ] 分頁加載工作正常 (50 項/頁)

---

## Phase 5: 性能測試

### 5.1 緩存性能測試

```javascript
// 1. 測試緩存設置
cacheManager.set('test_key', { data: 'test' }, 5 * 60 * 1000);
console.log('Cached:', cacheManager.get('test_key'));
// 預期: { data: 'test' }

// 2. 測試緩存過期 (5 分鐘)
setTimeout(() => {
  console.log('After 5min:', cacheManager.get('test_key'));
  // 預期: null (已過期)
}, 5 * 60 * 1000);

// 3. 測試緩存命中率
const perfStart = performance.now();
const cached = cacheManager.get('inspection_list');
if (cached) {
  console.log('Cache HIT:', (performance.now() - perfStart).toFixed(2) + 'ms');
  // 預期: < 1ms
} else {
  console.log('Cache MISS - 從數據庫加載');
}
```

### 5.2 分頁性能測試

```javascript
// 1. 測試第一頁加載
perfMonitor.start('page1_load');
const page1 = await db.from('inspection_records')
  .select()
  .range(0, 49);  // 第一頁: 0-49
perfMonitor.end('page1_load');
// 預期: [PERF] page1_load: XXms

// 2. 測試分頁導航
paginationManager.pageSize = 50;
console.log('Current page:', paginationManager.currentPage);
paginationManager.nextPage();
console.log('Next page:', paginationManager.currentPage);

// 3. 測試 1000+ 記錄的分頁
const offset = paginationManager.getOffset();  // (page-1) * 50
const { data, count } = await db.from('inspection_records')
  .select('*', { count: 'exact' })
  .range(offset, offset + 49);
console.log(`Loaded ${data.length} items, Total: ${count}`);
// 預期: 加載 50 項，快速響應
```

### 5.3 數據庫查詢性能

```sql
-- 1. 檢查索引覆蓋
EXPLAIN ANALYZE
SELECT * FROM inspection_records 
WHERE user_id = 'test-user' 
ORDER BY created_at DESC 
LIMIT 50;
-- 預期: 使用索引，< 100ms

-- 2. 檢查 JOIN 性能
EXPLAIN ANALYZE
SELECT i.*, e.name, e.status 
FROM inspection_records i 
JOIN equipment e ON i.equipment_id = e.id 
WHERE i.user_id = 'test-user' 
LIMIT 50;
-- 預期: < 200ms

-- 3. 檢查聚合查詢
EXPLAIN ANALYZE
SELECT COUNT(*) as total, status, COUNT(*) as count
FROM inspection_records 
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY status;
-- 預期: < 500ms (即使 10000+ 記錄)
```

### 5.4 前端性能監控

```javascript
// 1. 頁面加載時間
console.time('page_load');
document.addEventListener('load', () => {
  console.timeEnd('page_load');
  // 預期: < 2s
});

// 2. 首次內容繪製 (FCP)
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('FCP:', entry.startTime.toFixed(2) + 'ms');
    // 預期: < 1.8s
  }
}).observe({ entryTypes: ['paint'] });

// 3. 最大內容繪製 (LCP)
new PerformanceObserver((list) => {
  const entries = list.getEntries();
  const lastEntry = entries[entries.length - 1];
  console.log('LCP:', lastEntry.renderTime || lastEntry.loadTime);
  // 預期: < 2.5s
}).observe({ entryTypes: ['largest-contentful-paint'] });

// 4. 累積版面偏移 (CLS)
let clsValue = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      clsValue += entry.value;
      console.log('CLS:', clsValue.toFixed(3));
      // 預期: < 0.1
    }
  }
}).observe({ entryTypes: ['layout-shift'] });
```

### 5.5 檢查清單

- [ ] 第一頁加載時間 < 2s
- [ ] 分頁導航 < 500ms
- [ ] 緩存命中率 > 80%
- [ ] 查詢性能 < 200ms (標準查詢)
- [ ] 首次內容繪製 < 1.8s
- [ ] 最大內容繪製 < 2.5s
- [ ] 累積版面偏移 < 0.1

---

## Phase 6: 部署前檢查清單

### 6.1 安全檢查

- [ ] RLS 策略已在 Staging 驗證
- [ ] CSRF 保護已測試
- [ ] 輸入驗證已測試
- [ ] XSS 防護已驗證
- [ ] SQL 注入防護已驗證
- [ ] 認證/授權已驗證
- [ ] 密鑰輪換計劃已建立
- [ ] 敏感數據已脫敏
- [ ] 日誌記錄已配置
- [ ] 錯誤處理已測試

### 6.2 功能檢查

- [ ] 用戶認證流程完整
- [ ] 巡檢流程端到端測試通過
- [ ] 報修/派工流程完整
- [ ] 材料管理功能正常
- [ ] 交接簿功能正常
- [ ] 分析報告生成正確
- [ ] 權限管理工作正常
- [ ] 通知系統 (LINE/Email) 正常

### 6.3 性能檢查

- [ ] 頁面加載時間可接受
- [ ] 分頁工作正常
- [ ] 緩存命中率良好
- [ ] 數據庫查詢優化
- [ ] 沒有內存洩漏
- [ ] 沒有 N+1 查詢問題
- [ ] CDN 配置正確

### 6.4 部署檢查

- [ ] 環境變量已設置
- [ ] 密鑰已安全存儲
- [ ] 數據庫備份已配置
- [ ] 監控和警報已設置
- [ ] 日誌收集已配置
- [ ] CI/CD 管道已驗證
- [ ] 回滾計劃已準備
- [ ] 團隊已培訓

---

## 故障排除指南

### 問題: RLS 策略拒絕合法請求

**症狀**: 用戶無法訪問自己的記錄

**解決步驟**:
```sql
-- 1. 檢查用戶認證信息
SELECT auth.uid();  -- 應返回用戶 ID

-- 2. 檢查策略定義
SELECT * FROM pg_policies 
WHERE tablename = 'inspection_records' 
AND policyname LIKE '%SELECT%';

-- 3. 測試策略
SET LOCAL app.current_user_id = 'test-user-id';
SELECT * FROM inspection_records;

-- 4. 檢查角色
SELECT * FROM auth.users WHERE email = 'test@example.com';
```

### 問題: CSRF Token 驗證失敗

**症狀**: POST/PUT/DELETE 請求返回 403

**解決步驟**:
```javascript
// 1. 驗證 Token 是否正確生成
console.log('Token in storage:', sessionStorage.getItem('_csrf_token'));

// 2. 驗證 Token 是否添加到請求
console.log('Request payload:', csrfManager.addToRequest({ test: 'data' }));

// 3. 檢查 Token 過期時間
// Token 不應在 5 分鐘內過期

// 4. 清除並重新生成
sessionStorage.clear();
location.reload();
```

### 問題: 緩存導致數據不同步

**症狀**: 用戶看到舊數據

**解決步驟**:
```javascript
// 1. 清除特定緩存
cacheManager.delete('inspection_list');

// 2. 設置較短的 TTL (開發)
cacheManager.setTtl(60 * 1000);  // 1 分鐘

// 3. 驗證緩存鍵
cacheManager.clear();  // 清空所有

// 4. 添加緩存版本控制
const key = 'inspection_list_v2';
```

### 問題: 分頁加載性能慢

**症狀**: 頁面切換緩慢

**解決步驟**:
```sql
-- 1. 檢查索引
CREATE INDEX IF NOT EXISTS idx_inspection_user_date 
ON inspection_records(user_id, created_at DESC);

-- 2. 檢查查詢計劃
EXPLAIN ANALYZE
SELECT * FROM inspection_records 
WHERE user_id = 'user-id'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;

-- 3. 限制結果集
SELECT * FROM inspection_records 
WHERE user_id = 'user-id'
AND created_at > NOW() - INTERVAL '90 days'
LIMIT 50;
```

---

## 報告模板

### Staging 驗證報告

```markdown
# Staging 驗證完成報告

**日期**: YYYY-MM-DD
**驗證者**: [名字]
**環境**: Staging
**結果**: PASS / FAIL

## Phase 結果

| Phase | 狀態 | 註釋 |
|-------|------|------|
| 環境準備 | ✅ | |
| 數據庫驗證 | ✅ | |
| 安全測試 | ✅ | |
| 功能驗收 | ✅ | 1 個小問題已修復 |
| 性能測試 | ✅ | |
| 部署檢查 | ✅ | |

## 發現問題

### Issue #1: [問題描述]
- 嚴重性: 高/中/低
- 狀態: 已解決/待解決
- 修復: [修復方案]

## 建議

1. [建議 1]
2. [建議 2]

## 結論

系統已準備好進行生產部署 ✓

---

簽名: ______  日期: ______
```

---

## 執行時間表

| Phase | 預計時間 | 開始日期 | 完成日期 |
|-------|---------|---------|---------|
| Phase 1: 環境準備 | 2 小時 | 2026-07-05 | 2026-07-05 |
| Phase 2: 數據庫驗證 | 3 小時 | 2026-07-05 | 2026-07-05 |
| Phase 3: 安全測試 | 4 小時 | 2026-07-06 | 2026-07-06 |
| Phase 4: 功能驗收 | 6 小時 | 2026-07-06 | 2026-07-07 |
| Phase 5: 性能測試 | 4 小時 | 2026-07-07 | 2026-07-07 |
| Phase 6: 部署檢查 | 2 小時 | 2026-07-07 | 2026-07-07 |
| **總計** | **~21 小時** | | |

---

## 後續步驟

### 通過 Staging 驗證後

1. ✅ 獲取利益相關者批准
2. ✅ 準備生產環境
3. ✅ 執行生產部署
4. ✅ 進行冒煙測試
5. ✅ 啟用監控和警報
6. ✅ 通知用戶系統已上線

### 如果發現嚴重問題

1. 記錄問題詳情
2. 在代碼中修復
3. 提交新的提交
4. 重新進行 Staging 驗證
5. 獲取 QA 簽核

---

## 聯絡方式

**系統管理員**: [聯絡信息]  
**技術支持**: [聯絡信息]  
**緊急情況**: [緊急電話]

---

**文檔版本**: 1.0  
**最後更新**: 2026-07-05  
**下次審查**: 2026-07-12

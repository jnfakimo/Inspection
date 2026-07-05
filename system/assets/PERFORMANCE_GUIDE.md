# 性能優化指南

## 概述

三個性能優化工具已集成到 `global-ui.js` 中：

1. **分頁管理器** - 處理大型數據集
2. **緩存管理器** - 減少冗餘請求
3. **性能監控** - 追蹤應用程序性能

## 分頁管理器

### 基本用法

```javascript
// 設置頁面大小
paginationManager.pageSize = 50;

// 獲取當前偏移量
const offset = paginationManager.getOffset();
const limit = paginationManager.pageSize;

// 查詢數據
const { data, error } = await db
  .from('inspection_records')
  .select('*', { count: 'exact' })
  .range(offset, offset + limit - 1);

// 導航
paginationManager.nextPage();
paginationManager.prevPage();
paginationManager.reset();
```

### 完整分頁示例

```javascript
async function loadInspectionRecords(page = 1) {
  try {
    // 設置頁面
    paginationManager.currentPage = page;
    const offset = paginationManager.getOffset();
    const limit = paginationManager.pageSize;

    // 從緩存檢查
    const cacheKey = 'inspections_page_' + page;
    var cached = cacheManager.get(cacheKey);
    if (cached) {
      console.log('使用緩存數據');
      return cached;
    }

    // 查詢數據庫
    perfMonitor.start('fetch_inspections');
    const { data, error, count } = await db
      .from('inspection_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    perfMonitor.end('fetch_inspections');

    if (error) throw error;

    // 計算分頁信息
    const result = {
      data: data,
      totalItems: count,
      totalPages: Math.ceil(count / paginationManager.pageSize),
      currentPage: paginationManager.currentPage,
      pageSize: paginationManager.pageSize
    };

    // 緩存結果
    cacheManager.set(cacheKey, result);

    return result;
  } catch (err) {
    console.error('加載失敗:', err);
    throw err;
  }
}

// 使用
const result = await loadInspectionRecords(1);
console.log('總頁數:', result.totalPages);
console.log('當前頁:', result.currentPage);
console.log('記錄數:', result.data.length);
```

### 自訂頁面大小

```javascript
// 根據視埠調整頁面大小
function adjustPageSize() {
  if (window.innerWidth < 768) {
    paginationManager.pageSize = 20; // 移動設備
  } else if (window.innerWidth < 1200) {
    paginationManager.pageSize = 30; // 平板
  } else {
    paginationManager.pageSize = 50; // 桌面
  }
}

adjustPageSize();
window.addEventListener('resize', adjustPageSize);
```

## 緩存管理器

### 基本用法

```javascript
// 存儲數據
const userData = { id: 1, name: 'John', email: 'john@example.com' };
cacheManager.set('user_1', userData);

// 檢索數據
const cached = cacheManager.get('user_1');
if (cached) {
  console.log('使用緩存:', cached);
} else {
  console.log('緩存過期或不存在');
}

// 刪除特定項
cacheManager.delete('user_1');

// 清空所有緩存
cacheManager.clear();
```

### 設置 TTL (生存時間)

```javascript
// 默認 TTL: 5 分鐘 (300000 毫秒)

// 更改為 10 分鐘
cacheManager.setTtl(10 * 60 * 1000);

// 設置為 1 分鐘 (快速過期)
cacheManager.setTtl(60 * 1000);
```

### 實際應用示例

```javascript
async function getEquipmentData(equipmentId) {
  // 檢查緩存
  const cacheKey = 'equipment_' + equipmentId;
  var cached = cacheManager.get(cacheKey);
  if (cached) {
    console.log('返回緩存的設備數據');
    return cached;
  }

  // 從數據庫查詢
  perfMonitor.start('fetch_equipment');
  const { data, error } = await db
    .from('equipment')
    .select('*')
    .eq('id', equipmentId)
    .single();
  perfMonitor.end('fetch_equipment');

  if (error) throw error;

  // 緩存結果
  cacheManager.set(cacheKey, data);
  return data;
}

// 當設備被編輯時，清除緩存
async function updateEquipment(equipmentId, updates) {
  const { data, error } = await db
    .from('equipment')
    .update(csrfManager.addToRequest(updates))
    .eq('id', equipmentId);

  if (error) throw error;

  // 清除相關緩存
  cacheManager.delete('equipment_' + equipmentId);
  cacheManager.delete('equipment_list');

  return data;
}
```

### 多層緩存策略

```javascript
async function getFullInspectionData(recordId) {
  // 層次 1: 檢查完整記錄緩存
  const fullCacheKey = 'inspection_full_' + recordId;
  var fullCached = cacheManager.get(fullCacheKey);
  if (fullCached) return fullCached;

  // 層次 2: 檢查記錄和設備的單獨緩存
  var record = cacheManager.get('inspection_' + recordId);
  var equipment = null;

  if (!record) {
    // 查詢記錄
    const { data, error } = await db
      .from('inspection_records')
      .select('*')
      .eq('id', recordId)
      .single();
    if (error) throw error;
    record = data;
    cacheManager.set('inspection_' + recordId, record);
  }

  equipment = cacheManager.get('equipment_' + record.equipment_id);
  if (!equipment) {
    // 查詢設備
    const { data, error } = await db
      .from('equipment')
      .select('*')
      .eq('id', record.equipment_id)
      .single();
    if (error) throw error;
    equipment = data;
    cacheManager.set('equipment_' + record.equipment_id, equipment);
  }

  // 組合並緩存完整數據
  const fullData = Object.assign({}, record, { equipment: equipment });
  cacheManager.set(fullCacheKey, fullData);

  return fullData;
}
```

## 性能監控

### 基本用法

```javascript
// 開始監控
perfMonitor.start('operation_name');

// ... 執行操作 ...

// 結束監控 (會自動打印到控制台)
const duration = perfMonitor.end('operation_name');
console.log('操作耗時:', duration, 'ms');
```

### 監控異步操作

```javascript
async function performLongOperation() {
  perfMonitor.start('long_operation');

  // 模擬長操作
  await new Promise(resolve => setTimeout(resolve, 2000));

  const duration = perfMonitor.end('long_operation');
  // 輸出: [PERF] long_operation: 2000.50ms
}
```

### 自動測量函數執行時間

```javascript
// 使用 measure 方法自動計時
const result = perfMonitor.measure('data_processing', function() {
  // 處理代碼
  var total = 0;
  for (var i = 0; i < 1000000; i++) {
    total += i;
  }
  return total;
});
// 輸出: [PERF] data_processing: X.XXms
```

### 性能監控儀表板

```javascript
function createPerformanceDashboard() {
  return {
    metrics: {},

    recordMetric: function(name, duration) {
      if (!this.metrics[name]) {
        this.metrics[name] = { count: 0, total: 0, avg: 0, min: Infinity, max: -Infinity };
      }
      var m = this.metrics[name];
      m.count++;
      m.total += duration;
      m.avg = m.total / m.count;
      if (duration < m.min) m.min = duration;
      if (duration > m.max) m.max = duration;
    },

    report: function() {
      console.table(this.metrics);
    }
  };
}

// 使用
var dashboard = createPerformanceDashboard();

async function trackOperation(name, fn) {
  perfMonitor.start(name);
  const result = await fn();
  const duration = perfMonitor.end(name);
  dashboard.recordMetric(name, duration);
  return result;
}

// 最後打印報告
dashboard.report();
```

### 批量操作性能監控

```javascript
async function batchInsertRecords(records) {
  perfMonitor.start('batch_insert');

  try {
    for (var i = 0; i < records.length; i++) {
      perfMonitor.start('insert_' + i);

      const safeRecord = csrfManager.addToRequest(records[i]);
      const { error } = await db.from('inspection_records').insert(safeRecord);

      perfMonitor.end('insert_' + i);

      if (error) throw error;
    }
  } finally {
    const totalDuration = perfMonitor.end('batch_insert');
    console.log('批量插入完成:', records.length, '條記錄耗時', totalDuration, 'ms');
  }
}
```

## 綜合優化示例

### 列表頁面的完整實現

```javascript
async function renderInspectionList(page = 1) {
  try {
    // 監控整個操作
    perfMonitor.start('render_list');

    // 加載帶分頁和緩存的數據
    const result = await loadInspectionRecords(page);

    // 監控渲染
    perfMonitor.start('dom_render');

    const container = document.getElementById('inspection-list');
    container.innerHTML = '';

    result.data.forEach(function(record) {
      const row = document.createElement('tr');
      row.innerHTML = '<td>' + record.id + '</td><td>' + record.status + '</td>';
      container.appendChild(row);
    });

    perfMonitor.end('dom_render');

    // 更新分頁控件
    updatePaginationControls(result.currentPage, result.totalPages);

    perfMonitor.end('render_list');

    showToast('加載成功: ' + result.data.length + ' 條記錄', false);
  } catch (err) {
    showToast('加載失敗: ' + err.message, true);
  }
}

function updatePaginationControls(current, total) {
  document.getElementById('current-page').textContent = current;
  document.getElementById('total-pages').textContent = total;
  document.getElementById('prev-btn').disabled = current === 1;
  document.getElementById('next-btn').disabled = current === total;
}

// 事件監聽
document.getElementById('prev-btn').addEventListener('click', function() {
  paginationManager.prevPage();
  renderInspectionList(paginationManager.currentPage);
});

document.getElementById('next-btn').addEventListener('click', function() {
  paginationManager.nextPage();
  renderInspectionList(paginationManager.currentPage);
});
```

## 最佳實踐

1. **合理設置 TTL** - 根據數據更新頻率調整
2. **監控關鍵操作** - 特別是數據庫查詢
3. **使用合適的頁面大小** - 根據設備和網絡條件
4. **清理過期緩存** - 防止內存泄漏
5. **批量操作時監控** - 識別性能瓶頸
6. **在生產環境測試** - 真實用戶條件下測試

## 故障排除

### 問題: 緩存導致數據不同步

**解決方案**:
```javascript
// 降低 TTL
cacheManager.setTtl(1 * 60 * 1000); // 1 分鐘

// 或在數據更新後手動清除
cacheManager.clear();
```

### 問題: 分頁跳轉時加載緩慢

**解決方案**:
```javascript
// 提前加載下一頁
async function smartLoad(page) {
  await loadInspectionRecords(page);

  // 後台加載下一頁
  if (page < paginationManager.totalPages) {
    loadInspectionRecords(page + 1).catch(console.error);
  }
}
```

### 問題: 性能監控輸出過多

**解決方案**:
```javascript
// 只監控超過閾值的操作
perfMonitor.start('operation');
// ... 操作 ...
const duration = perfMonitor.end('operation');
if (duration > 1000) { // 只記錄超過 1 秒的操作
  console.warn('操作過慢:', duration, 'ms');
}
```

## 相關資源

- [MDN 性能優化](https://developer.mozilla.org/en-US/docs/Web/Performance)
- [Web 性能工作組](https://www.w3.org/webperf/)
- [Chrome DevTools 性能](https://developer.chrome.com/docs/devtools/performance/)

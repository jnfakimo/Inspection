# CSRF 保護指南

## 概述

CSRF (Cross-Site Request Forgery) Token 保護防止未授權的跨站點請求偽造攻擊。該系統已集成到 `global-ui.js` 中的 `csrfManager` 對象。

## 實現方式

所有 INSERT/UPDATE/DELETE 操作自動添加 CSRF Token。Token 在會話開始時生成並存儲在 sessionStorage 中。

## CSRF Token 生命週期

1. **生成**: 首次調用 `csrfManager.getToken()` 時
2. **存儲**: 存儲在瀏覽器 sessionStorage 中，鍵為 `_csrf_token`
3. **使用**: 隨每個 POST/PUT/DELETE 請求發送
4. **驗證**: 後端驗證令牌有效性
5. **失效**: 頁面刷新或會話結束時

## 使用示例

### 基本用法

```javascript
// 自動添加 CSRF Token
const record = { name: 'test', value: 123 };
const dataWithCsrf = csrfManager.addToRequest(record);

// 現在可以安全地發送到服務器
await db.from('table').insert(dataWithCsrf);
```

### 在 API 調用中

```javascript
// Supabase 操作
const userData = { email: 'user@example.com', name: 'User' };
await db.from('users').insert(csrfManager.addToRequest(userData));

// 更新操作
const updateData = { status: 'approved' };
await db.from('inspection_records')
  .update(csrfManager.addToRequest(updateData))
  .eq('id', recordId);

// 刪除前也建議驗證 Token
await db.from('repair_requests').delete().eq('id', requestId);
```

### 在表單提交中

```javascript
document.getElementById('form').addEventListener('submit', async function(e) {
  e.preventDefault();

  const formData = new FormData(this);
  const payload = Object.fromEntries(formData);

  // 添加 CSRF Token
  const safePayload = csrfManager.addToRequest(payload);

  // 發送請求
  const response = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(safePayload)
  });

  // 處理響應
  if (response.ok) {
    showToast('提交成功', false);
  } else {
    showToast('提交失敗', true);
  }
});
```

## Token 驗證 (後端)

### Node.js/Express 示例

```javascript
function verifyCsrfToken(req, res, next) {
  const token = req.body._csrf_token || req.headers['x-csrf-token'];
  const sessionToken = req.session._csrf_token;

  if (!token || token !== sessionToken) {
    return res.status(403).json({ error: 'CSRF Token 無效' });
  }

  next();
}

// 在所有修改路由上使用
app.post('/api/data', verifyCsrfToken, (req, res) => {
  // 處理請求
});
```

### Python/Flask 示例

```python
from flask import request
from werkzeug.security import safe_str_cmp

def verify_csrf_token(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.json.get('_csrf_token')
        session_token = session.get('_csrf_token')

        if not token or not safe_str_cmp(token, session_token):
            return {'error': 'CSRF Token 無效'}, 403

        return f(*args, **kwargs)
    return decorated_function

@app.route('/api/data', methods=['POST'])
@verify_csrf_token
def handle_data():
    # 處理請求
    pass
```

## 安全最佳實踐

1. **總是驗證 Token**
   - 在服務器端驗證所有 Token
   - 不要在客戶端信任 Token

2. **保護 Token 存儲**
   - sessionStorage 限制同源訪問
   - HTTPS 防止傳輸中攔截

3. **定期更新 Token**
   - 每個會話創建新 Token
   - 敏感操作後可更新 Token

4. **監控異常**
   - 記錄所有 CSRF 驗證失敗
   - 設置警報機制

5. **與其他保護結合**
   - SameSite Cookie 屬性
   - Content-Security-Policy 頭部
   - 雙重提交 Cookie 模式

## 故障排除

### 問題: Token 過期

**症狀**: 表單提交返回 403 錯誤

**解決方案**:
```javascript
// 刷新 Token
sessionStorage.removeItem('_csrf_token');
csrfManager.getToken();
```

### 問題: 跨標籤頁請求失敗

**症狀**: 在另一個標籤頁打開的表單無法提交

**解決方案**: Token 基於 sessionStorage，不同標籤頁使用不同 Token
- 考慮使用 localStorage 共享 Token (注意安全)
- 或實現服務器端會話跟踪

### 問題: 自動化測試失敗

**症狀**: 無頭瀏覽器測試失敗

**解決方案**:
```javascript
// 測試中禁用 CSRF 檢查，或
// 從響應中提取 Token 並包含在請求中
const response = await fetch('/api/csrf-token');
const { token } = await response.json();
csrfManager.tokenStorageKey = token;
```

## 相關資源

- [OWASP CSRF](https://owasp.org/www-community/attacks/csrf)
- [CSRF 防護備忘單](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Supabase 安全最佳實踐](https://supabase.com/docs/guides/security)

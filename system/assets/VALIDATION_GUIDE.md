# 輸入驗證指南

## 概述

全面的輸入驗證工具庫已集成到 `global-ui.js` 中的 `validateInput` 對象。這些工具防止無效數據進入系統並保護應用程序免受注入攻擊。

## 可用驗證方法

### 格式驗證

#### email(email)
驗證電郵格式和長度

```javascript
try {
  validateInput.email('user@example.com');
} catch (err) {
  console.error(err.message); // 無效的郵件格式
}
```

**規則**:
- 必須包含 @ 和 .
- 最大長度 254 字符
- 不能為空

#### phone(phone)
驗證電話號碼格式

```javascript
try {
  validateInput.phone('+1-555-0123');
} catch (err) {
  console.error(err.message); // 無效的電話格式
}
```

**規則**:
- 長度 8-20 字符
- 允許數字、破折號、加號、括號和空格

#### uuid(uuid)
驗證 UUID v4 格式

```javascript
try {
  validateInput.uuid('550e8400-e29b-41d4-a716-446655440000');
} catch (err) {
  console.error(err.message); // 無效的 UUID
}
```

### 日期驗證

#### date(dateStr)
驗證單個日期

```javascript
try {
  validateInput.date('2024-07-05');
} catch (err) {
  console.error(err.message); // 無效的日期 或 日期不能是未來
}
```

**規則**:
- 必須是有效的日期格式
- 不能是未來日期

#### dateRange(from, to, maxDays)
驗證日期範圍

```javascript
try {
  validateInput.dateRange('2024-07-01', '2024-07-05', 30);
} catch (err) {
  console.error(err.message); // 開始日期不能晚於結束日期 或 範圍超過 30 天
}
```

**規則**:
- 開始日期不能晚於結束日期
- 範圍最多 maxDays 天 (默認 365)

### 字符串驗證

#### notEmpty(str, fieldName)
檢查字符串非空

```javascript
try {
  validateInput.notEmpty('', '使用者名稱');
} catch (err) {
  console.error(err.message); // 使用者名稱不能為空
}
```

#### length(str, min, max, fieldName)
檢查字符串長度

```javascript
try {
  validateInput.length('test', 5, 10, '用戶名');
} catch (err) {
  console.error(err.message); // 用戶名長度需在 5-10 之間
}
```

### 數值驗證

#### numberRange(num, min, max, fieldName)
檢查數值範圍

```javascript
try {
  validateInput.numberRange(150, 0, 100, '分數');
} catch (err) {
  console.error(err.message); // 分數需在 0-100 之間
}
```

#### positive(num, fieldName)
檢查是否為正數

```javascript
try {
  validateInput.positive(-5, '數量');
} catch (err) {
  console.error(err.message); // 數量必須是正數
}
```

### 列舉驗證

#### enum(value, allowedValues, fieldName)
檢查值是否在允許的列表中

```javascript
try {
  validateInput.enum('invalid', ['pending', 'approved', 'rejected'], '狀態');
} catch (err) {
  console.error(err.message); // 狀態必須是 pending, approved, rejected 之一
}
```

### 安全驗證

#### noSqlInjection(str)
檢測 SQL 注入模式

```javascript
try {
  validateInput.noSqlInjection("'; DROP TABLE users; --");
} catch (err) {
  console.error(err.message); // 輸入包含不允許的關鍵字
}
```

**檢測的關鍵字**:
- DROP
- DELETE
- TRUNCATE
- UNION
- SELECT

#### noXss(str)
檢測 XSS 攻擊模式

```javascript
try {
  validateInput.noXss('<script>alert("XSS")</script>');
} catch (err) {
  console.error(err.message); // 輸入包含不允許的內容
}
```

**檢測的模式**:
- `<script>` 標籤
- `javascript:` 協議
- 事件處理器 (onclick, onload 等)

## 實際應用示例

### 表單驗證

```javascript
document.getElementById('registerForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  try {
    // 獲取表單數據
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // 驗證輸入
    validateInput.email(email);
    validateInput.phone(phone);
    validateInput.length(username, 3, 20, '用戶名');
    validateInput.length(password, 8, 50, '密碼');
    validateInput.noXss(username);

    // 所有驗證通過，提交表單
    const userData = {
      email: email,
      phone: phone,
      username: username
    };

    // 添加 CSRF Token
    const safeData = csrfManager.addToRequest(userData);
    await db.from('users').insert(safeData);

    showToast('註冊成功', false);
  } catch (err) {
    showToast(err.message, true);
  }
});
```

### 巡檢記錄驗證

```javascript
async function submitInspection(inspectionData) {
  try {
    // 驗證必填字段
    validateInput.notEmpty(inspectionData.equipment_id, '設備 ID');
    validateInput.notEmpty(inspectionData.status, '狀態');
    validateInput.uuid(inspectionData.equipment_id);
    validateInput.enum(inspectionData.status, ['normal', 'warning', 'error'], '狀態');

    // 驗證可選的日期字段
    if (inspectionData.inspection_date) {
      validateInput.date(inspectionData.inspection_date);
    }

    // 檢查注入攻擊
    validateInput.noSqlInjection(inspectionData.notes || '');
    validateInput.noXss(inspectionData.notes || '');

    // 安全提交
    const safeData = csrfManager.addToRequest(inspectionData);
    const { data, error } = await db.from('inspection_records').insert(safeData);

    if (error) throw error;
    showToast('巡檢記錄已保存', false);
  } catch (err) {
    showToast('驗證失敗: ' + err.message, true);
  }
}
```

### 日期範圍查詢

```javascript
async function queryByDateRange(startDate, endDate) {
  try {
    // 驗證日期範圍 (最多 90 天)
    validateInput.dateRange(startDate, endDate, 90);

    // 執行查詢
    const { data, error } = await db
      .from('inspection_records')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('查詢失敗:', err.message);
    showToast(err.message, true);
  }
}
```

### 批量驗證

```javascript
function validateMultipleFields(data) {
  const validations = [
    () => validateInput.email(data.email),
    () => validateInput.notEmpty(data.name, '姓名'),
    () => validateInput.length(data.name, 2, 50, '姓名'),
    () => validateInput.noXss(data.notes || ''),
    () => validateInput.numberRange(data.score, 0, 100, '分數')
  ];

  for (var i = 0; i < validations.length; i++) {
    try {
      validations[i]();
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  return { valid: true };
}

// 使用
const result = validateMultipleFields(formData);
if (!result.valid) {
  showToast(result.error, true);
}
```

## 客製化驗證

### 擴展驗證工具

```javascript
// 添加自訂驗證函數
validateInput.ipAddress = function(ip) {
  var re = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!re.test(ip)) throw new Error('無效的 IP 地址');
  return true;
};

// 使用自訂驗證
validateInput.ipAddress('192.168.1.1');
```

### 條件驗證

```javascript
function conditionalValidation(data) {
  validateInput.notEmpty(data.name, '名稱');

  if (data.type === 'business') {
    validateInput.notEmpty(data.companyName, '公司名稱');
    validateInput.positive(data.employeeCount, '員工數');
  } else {
    validateInput.notEmpty(data.idNumber, '身份證號碼');
  }
}
```

## 最佳實踐

1. **總是在服務器端驗證** - 不要只依賴客戶端驗證
2. **驗證所有輸入** - 包括選項菜單和隱藏字段
3. **使用白名單** - 接受已知良好的值，而不是黑名單
4. **提供清晰的錯誤消息** - 幫助用戶理解問題
5. **記錄驗證失敗** - 監控潛在的安全問題
6. **定期更新規則** - 隨著業務需求改進驗證

## 性能考慮

- 驗證函數輕量級且同步執行
- 對大型批次數據使用循環而不是多次函數調用
- 考慮為複雜驗證使用 Web Worker

## 故障排除

### 問題: 驗證過於嚴格

**解決方案**: 調整正則表達式或參數
```javascript
// 允許更寬鬆的電話格式
validateInput.phone = function(phone) {
  var re = /^[\d\s\-\+\(\)]+$/;
  if (!re.test(phone) || phone.length < 7) {
    throw new Error('無效的電話格式');
  }
  return true;
};
```

### 問題: 某些有效輸入被拒絕

**解決方案**: 檢查國際字符支持
```javascript
validateInput.internationalEmail = function(email) {
  // 更寬鬆的國際郵件格式
  if (!email.includes('@') || email.length > 254) {
    throw new Error('無效的郵件');
  }
  return true;
};
```

## 相關資源

- [OWASP 輸入驗證備忘單](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [MDN 表單驗證](https://developer.mozilla.org/en-US/docs/Learn/Forms/Form_validation)
- [正則表達式測試工具](https://regex101.com/)

# RLS 策略設置指南

## 概述

此文檔描述如何應用行級安全 (Row Level Security, RLS) 策略到 Supabase 數據庫。RLS 確保用戶只能訪問他們有權限的數據。

## 應用策略

### 方法 1: 使用 Supabase SQL Editor

1. 登入 [Supabase Console](https://app.supabase.com)
2. 進入你的項目
3. 打開 SQL Editor
4. 複製 `rls_policies.sql` 的全部內容
5. 粘貼到編輯器
6. 執行

### 方法 2: 使用 Supabase CLI

```bash
supabase db push
```

### 方法 3: 使用 psql 命令行

```bash
psql -h <supabase-host> -U postgres -d postgres -f system/sql/rls_policies.sql
```

## 策略說明

### 1. Users 表
- **SELECT**: 用戶只能查看自己的記錄，或系統管理員可查看所有
- **INSERT/UPDATE/DELETE**: 僅系統管理員和管理員可修改

### 2. Equipment 表
- **SELECT**: 所有認證用戶可讀
- **INSERT/UPDATE/DELETE**: 僅管理員可修改

### 3. Inspection Records 表
- **SELECT**: 巡檢員只看自己創建的，管理員看全部
- **INSERT**: 巡檢員只能創建自己的記錄
- **UPDATE**: 創建者和管理員可修改

### 4. Repair Requests 表
- **SELECT**: 報修人員看自己的，派工人員和管理員看全部
- **INSERT**: 報修人員只能創建自己的請求
- **UPDATE**: 派工人員和管理員可修改

### 5. Maintenance Orders 表
- **SELECT**: 技術員看分配給自己的，派工人員和管理員看全部
- **INSERT/UPDATE/DELETE**: 派工人員和管理員可管理

## 驗證策略

在 Supabase Console 中檢查各表的 RLS 狀態：

1. 進入 Authentication > Policies
2. 確認所有表已啟用 RLS
3. 檢查每個表的策略列表

## 故障排除

### 問題: 政策執行失敗

**解決方案**: 確保先創建了 users 表和 auth.uid() 函數

### 問題: 用戶無法訪問數據

**解決方案**: 
1. 驗證用戶的 auth_id 在 users 表中存在
2. 檢查 rbac_role 字段有正確的值
3. 在 SQL Editor 中測試單個策略

## 最佳實踐

- 定期檢查政策日誌以識別拒絕訪問的模式
- 在生產環境部署前在開發環境測試所有政策
- 使用角色基訪問控制 (RBAC) 簡化管理
- 為新表添加 RLS 時遵循相同的模式

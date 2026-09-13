# 資料庫低頻索引觀察與維護指引 (Database Index Observation Guide)

> **建立日期**：2026-09-13  
> **目標**：監控資料庫低頻索引（特別是 `idx_audit_logs_event_type`）之使用成效與空間佔用，兼顧資安應變查詢效能與資料庫精實度。

---

## 🔍 一、 低頻索引盤點清單

| 索引名稱 | 所屬資料表 | 預估大小 | 設計用途 | 處理決策 |
| :--- | :--- | :--- | :--- | :--- |
| **`idx_audit_logs_event_type`** | `audit_logs` | ~2.4 MB | 管理員資安事後調查、特定異常事件篩選（如登入失敗、權限越權） | 🟢 **保留**（備查用途，不可刪除） |
| **`idx_checkin_logs_patrol_kind`** | `checkin_logs` | ~320 KB | 巡邏點分類打卡報表彙總 | 🟢 **保留**（排班與巡邏報表查詢使用） |
| **`idx_cost_records_*`** | `cost_records` | ~128 KB | 設備生命週期成本統計與報修關聯 JOIN | 🟢 **保留**（2026-09-13 核心外鍵優化） |

---

## ⚖️ 二、 決策評估矩陣 (Decision Matrix)

1. **稽核與合規類別索引（如 `audit_logs`）**：
   - **特性**：平常業務寫入多、讀取少，但在資安調查或主管調閱時屬於關鍵索引。
   - **決策**：一律保留。若移除此類索引，在百萬筆日誌中進行單一事件查詢會導致全表掃描並耗盡資料庫 CPU。
2. **約束與關聯類別（Primary Key / Foreign Key / Unique）**：
   - **特性**：維持資料完整性與防止孤兒資料。
   - **決策**：永久保留，不得以「未被讀取」為由刪除。
3. **業務報表類別索引**：
   - **特性**：若經過 30～60 天且歷經跨月結算期仍維持 `scan_count = 0`，才可評估軟停用或移除。

---

## 🛠️ 三、 診斷與監控執行方式

管理員可定期在 [Supabase SQL Editor](https://supabase.com/dashboard/project/qztffronusdhgxhjjubt/sql) 執行 [`system/sql/analyze_index_usage.sql`](file:///g:/%E6%88%91%E7%9A%84%E9%9B%B2%E7%AB%AF%E7%A1%AC%E7%A2%9F/AI/Codex/%E5%8C%97%E8%BE%B2%E5%B7%A1%E6%AA%A2%E7%B3%BB%E7%B5%B1/system/sql/analyze_index_usage.sql)：

```sql
-- 快速查詢前 10 大索引大小與讀取次數
select
    indexrelname as index_name,
    idx_scan as scan_count,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from
    pg_stat_user_indexes
where
    schemaname = 'public'
order by
    pg_relation_size(indexrelid) desc
limit 10;
```

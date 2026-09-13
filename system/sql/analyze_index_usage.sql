-- ============================================================================
-- 臺北農產 資料庫索引使用率與空間佔用診斷腳本 (Index Usage & Health Analysis)
-- 用途：評估低頻索引（如 idx_audit_logs_event_type）的實際讀取次數、空間佔用與維護建議
-- ============================================================================

-- 1. 低頻與未常用索引檢測（掃描次數低但佔用空間者）
select
    schemaname || '.' || relname as table_name,
    indexrelname as index_name,
    idx_scan as scan_count,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    case
        when indexrelname like '%pkey' or indexrelname like '%_key' then '主鍵/唯一約束 (必須保留)'
        when relname like 'audit%' or relname like '%_log%' then '稽核/日誌查詢索引 (建議保留備查)'
        when idx_scan = 0 then '零使用 (持續觀察 30 天)'
        else '正常運作中'
    end as maintenance_advice
from
    pg_stat_user_indexes
where
    schemaname = 'public'
order by
    pg_relation_size(indexrelid) desc;

-- 2. 表格 vs 索引總空間排行
select
    schemaname || '.' || relname as table_name,
    pg_size_pretty(pg_total_relation_size(relid)) as total_size,
    pg_size_pretty(pg_relation_size(relid)) as table_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as index_size
from
    pg_stat_user_tables
where
    schemaname = 'public'
order by
    pg_total_relation_size(relid) desc
limit 15;

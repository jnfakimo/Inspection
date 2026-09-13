"""
臺北農產 中央戰情室暨巡檢系統 - 高效大數據分析引擎 (Analytics Engine)
技術棧：Polars (多執行緒向量化運算) + DuckDB (嵌入式 OLAP SQL) + Loguru (ISO 27001 結構化稽核日誌)
"""

from __future__ import annotations
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import duckdb
import polars as pl
from loguru import logger

# 配置 ISO 27001 稽核日誌
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO"
)


class CommandCenterAnalyticsEngine:
    """中央戰情室與巡檢大數據秒級統計引擎"""

    def __init__(self, in_memory: bool = True):
        self.con = duckdb.connect(":memory:" if in_memory else "analytics.duckdb")
        logger.info("中央戰情室分析引擎初始化完成 [Polars v{} | DuckDB v{}]", pl.__version__, duckdb.__version__)

    def analyze_patrol_kpis(self, patrol_df: pl.DataFrame) -> Dict[str, Any]:
        """
        [Polars 運算] 巡檢打卡大數據多維度 KPI 統計
        計算指標：各樓層打卡總數、異常率、逾時率、平均耗時、最高溫度、當班達成率
        """
        start_t = time.perf_counter()
        
        required_cols = {"floor", "shift", "status", "duration_sec"}
        if not required_cols.issubset(set(patrol_df.columns)):
            raise ValueError(f"缺少必要欄位: {required_cols - set(patrol_df.columns)}")

        # 多維度秒級聚合
        kpi_table = (
            patrol_df.group_by(["floor", "shift"])
            .agg([
                pl.len().alias("total_checks"),
                (pl.col("status") == "normal").sum().alias("normal_count"),
                (pl.col("status") == "anomaly").sum().alias("anomaly_count"),
                (pl.col("status") == "timeout").sum().alias("timeout_count"),
                pl.col("duration_sec").mean().round(1).alias("avg_duration_sec"),
                pl.col("temperature").max().round(1).alias("max_temperature") if "temperature" in patrol_df.columns else pl.lit(None).alias("max_temperature"),
            ])
            .with_columns([
                ((pl.col("anomaly_count") / pl.col("total_checks")) * 100).round(2).alias("anomaly_rate_pct"),
                ((pl.col("timeout_count") / pl.col("total_checks")) * 100).round(2).alias("timeout_rate_pct"),
                (((pl.col("total_checks") - pl.col("timeout_count")) / pl.col("total_checks")) * 100).round(2).alias("completion_rate_pct")
            ])
            .sort(["floor", "shift"])
        )

        elapsed_ms = (time.perf_counter() - start_t) * 1000
        logger.info("巡檢 KPI 分析完成：處理 {:,} 筆資料，耗時 {:.2f} ms", len(patrol_df), elapsed_ms)

        floor_summary = (
            patrol_df.group_by("floor")
            .agg([
                pl.len().alias("total_checks"),
                (pl.col("status") == "anomaly").sum().alias("anomaly_count"),
                (pl.col("status") == "timeout").sum().alias("timeout_count"),
                pl.col("duration_sec").mean().round(1).alias("avg_duration_sec")
            ])
            .with_columns([
                ((pl.col("anomaly_count") / pl.col("total_checks")) * 100).round(2).alias("anomaly_rate_pct")
            ])
            .sort("floor")
        )

        return {
            "elapsed_ms": round(elapsed_ms, 2),
            "total_records": len(patrol_df),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "floor_shift_matrix": kpi_table.to_dicts(),
            "floor_summary": floor_summary.to_dicts()
        }

    def compute_floor_risk_ranking(self, patrol_df: pl.DataFrame) -> List[Dict[str, Any]]:
        """
        [DuckDB SQL 運算] 樓層與設備類別異常風險排名 (Window Function)
        """
        start_t = time.perf_counter()
        
        query = """
            SELECT 
                floor,
                category,
                COUNT(*) AS total_checks,
                SUM(CASE WHEN status = 'anomaly' THEN 1 ELSE 0 END) AS anomaly_count,
                ROUND(AVG(duration_sec), 1) AS avg_duration_sec,
                RANK() OVER (
                    PARTITION BY floor 
                    ORDER BY SUM(CASE WHEN status = 'anomaly' THEN 1 ELSE 0 END) DESC
                ) AS risk_rank
            FROM patrol_df
            GROUP BY floor, category
            ORDER BY floor, risk_rank
        """
        result_df = duckdb.query(query).pl()
        elapsed_ms = (time.perf_counter() - start_t) * 1000
        logger.info("樓層設備風險排名運算完成，耗時 {:.2f} ms", elapsed_ms)
        return result_df.to_dicts()

    def generate_3d_heatmap_dataset(self, patrol_df: pl.DataFrame) -> List[Dict[str, Any]]:
        """
        [3D/2D 圖資熱區聚合] 產生提供給 3D 巡檢雲臺 (FloorStack3D) 與平面圖 (Floor2D) 渲染的熱區強度
        """
        if "point_code" not in patrol_df.columns:
            heatmap_data = (
                patrol_df.group_by(["floor", "category"])
                .agg([
                    pl.len().alias("checkin_count"),
                    (pl.col("status") == "anomaly").sum().alias("anomaly_count")
                ])
                .with_columns([
                    (pl.col("anomaly_count") / (pl.col("checkin_count") + 1) * 2.5).clip(0.0, 1.0).round(3).alias("heat_intensity")
                ])
                .sort(["floor", "heat_intensity"], descending=[False, True])
            )
        else:
            heatmap_data = (
                patrol_df.group_by(["floor", "point_code", "category"])
                .agg([
                    pl.len().alias("checkin_count"),
                    (pl.col("status") == "anomaly").sum().alias("anomaly_count"),
                    pl.col("temperature").mean().round(1).alias("avg_temp") if "temperature" in patrol_df.columns else pl.lit(None).alias("avg_temp")
                ])
                .with_columns([
                    (pl.col("anomaly_count") / (pl.col("checkin_count") + 1) * 3.0).clip(0.0, 1.0).round(3).alias("heat_intensity")
                ])
                .sort(["floor", "heat_intensity"], descending=[False, True])
            )
        
        return heatmap_data.to_dicts()

    def analyze_market_price_volume_trends(self, market_df: pl.DataFrame) -> Dict[str, Any]:
        """
        [市場行情價量分析] 分析每日果菜交易行情量價走勢、異常波動與品項排名
        """
        start_t = time.perf_counter()
        
        query = """
            SELECT 
                market_name,
                category,
                COUNT(DISTINCT product_code) AS product_count,
                ROUND(SUM(volume_kg), 0) AS total_volume_kg,
                ROUND(AVG(avg_price), 1) AS mean_price,
                ROUND(MAX(high_price), 1) AS peak_price,
                ROUND(MIN(low_price), 1) AS bottom_price,
                ROUND(STDDEV_SAMP(avg_price), 2) AS price_volatility
            FROM market_df
            GROUP BY market_name, category
            ORDER BY total_volume_kg DESC
        """
        trends = duckdb.query(query).pl()
        elapsed_ms = (time.perf_counter() - start_t) * 1000
        logger.info("市場行情價量趨勢分析完成，耗時 {:.2f} ms", elapsed_ms)
        
        return {
            "elapsed_ms": round(elapsed_ms, 2),
            "trends": trends.to_dicts()
        }

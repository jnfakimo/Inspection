"""
中央戰情室分析引擎 - 終端機執行工具 (CLI Runner)
使用方式：
  python backend/analytics-engine/cli.py --demo
  python backend/analytics-engine/cli.py --benchmark 500000
"""

import sys, time, argparse
sys.stdout.reconfigure(encoding='utf-8')
import polars as pl
from engine import CommandCenterAnalyticsEngine

def generate_mock_patrol_data(n_records: int = 100_000) -> pl.DataFrame:
    floors = ['B1', '1F', '2F', '3F', '4F', '5F', 'RF']
    shifts = ['早班', '中班', '夜班']
    categories = ['消防排煙', '高壓配電', '冷凍空調', '電梯走道', '果菜分裝區']
    statuses = ['normal'] * 85 + ['anomaly'] * 12 + ['timeout'] * 3

    return pl.DataFrame({
        'log_id': [f'CHK-{i:07d}' for i in range(n_records)],
        'floor': [floors[i % len(floors)] for i in range(n_records)],
        'shift': [shifts[i % len(shifts)] for i in range(n_records)],
        'category': [categories[i % len(categories)] for i in range(n_records)],
        'point_code': [f'P-{floors[i % len(floors)]}-{i % 15:02d}' for i in range(n_records)],
        'status': [statuses[i % len(statuses)] for i in range(n_records)],
        'duration_sec': [35 + (i % 120) for i in range(n_records)],
        'temperature': [22.0 + (i % 150) * 0.1 for i in range(n_records)],
    })

def main():
    parser = argparse.ArgumentParser(description="北農中央戰情室 Polars/DuckDB 分析引擎")
    parser.add_argument("--demo", action="store_true", help="執行示範運算")
    parser.add_argument("--benchmark", type=int, default=200000, help="效能基準測試筆數 (預設 200,000)")
    args = parser.parse_args()

    engine = CommandCenterAnalyticsEngine()
    print(f"\n🚀 正在產生 {args.benchmark:,} 筆巡檢打卡大數據...")
    df = generate_mock_patrol_data(args.benchmark)
    
    print("\n--- 1. Polars 巡檢 KPI 秒級分析 ---")
    kpi_result = engine.analyze_patrol_kpis(df)
    print(f"運算耗時: {kpi_result['elapsed_ms']} ms")
    print(f"樓層數: {len(kpi_result['floor_summary'])} 層")
    print("樓層彙總前 3 筆:", kpi_result['floor_summary'][:3])

    print("\n--- 2. DuckDB 設備風險排名 (Window Function) ---")
    risk_ranking = engine.compute_floor_risk_ranking(df)
    print("樓層風險排行前 5 筆:", risk_ranking[:5])

    print("\n--- 3. 3D 圖資巡檢熱區資料集 ---")
    heatmap = engine.generate_3d_heatmap_dataset(df)
    print(f"產生熱區節點數: {len(heatmap)} 個")
    print("熱區節點前 3 筆:", heatmap[:3])
    print("\n✅ 全部分析運算完成！")

if __name__ == "__main__":
    main()

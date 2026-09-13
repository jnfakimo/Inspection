"""
中央戰情室分析引擎 - 高性能 REST API 服務 (FastAPI + Polars + DuckDB)
啟動指令：
  uvicorn api:app --reload --port 8768
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import polars as pl
from engine import CommandCenterAnalyticsEngine

app = FastAPI(
    title="中央戰情室大數據分析 API",
    description="採用 Polars 向量化運算與 DuckDB OLAP 引擎之高效分析服務",
    version="2.0.0"
)

engine = CommandCenterAnalyticsEngine()

class PatrolLogItem(BaseModel):
    log_id: str
    floor: str
    shift: str
    category: str
    point_code: Optional[str] = None
    status: str = Field(..., description="normal | anomaly | timeout")
    duration_sec: float
    temperature: Optional[float] = None

class PatrolAnalyticsRequest(BaseModel):
    records: List[PatrolLogItem]

@app.get("/healthz")
def health_check():
    return {"status": "ok", "engine": "Polars + DuckDB", "service": "Command Center Analytics"}

@app.post("/v2/analytics/patrol-kpi")
def calculate_patrol_kpi(payload: PatrolAnalyticsRequest):
    """
    [即時運算] 輸入巡檢紀錄批次清單，秒級回傳各樓層 KPI 與統計摘要
    """
    if not payload.records:
        raise HTTPException(status_code=400, detail="請提供至少一筆巡檢紀錄")
    
    # 轉換為 Polars DataFrame 進行記憶體運算
    data_dict = [item.model_dump() for item in payload.records]
    df = pl.DataFrame(data_dict)
    
    kpis = engine.analyze_patrol_kpis(df)
    risk_ranking = engine.compute_floor_risk_ranking(df)
    heatmap = engine.generate_3d_heatmap_dataset(df)
    
    return {
        "ok": True,
        "kpis": kpis,
        "risk_ranking": risk_ranking,
        "heatmap": heatmap
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8768)

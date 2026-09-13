"""Authenticated local receiver. No production database credentials or device writes."""

import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, generate_latest
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, SecretStr, model_validator


class Device(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    market: Literal["1", "2"]
    token: SecretStr = Field(min_length=32)
    metric: str = Field(min_length=1, max_length=64)
    unit: str = Field(max_length=16)
    stale_seconds: int = Field(default=300, ge=1, le=86400)
    alarm_above: float = Field(allow_inf_nan=False)


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    database: Path
    reader_token: SecretStr = Field(min_length=32)
    devices: list[Device] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_credentials(self):
        tokens = [d.token.get_secret_value() for d in self.devices]
        tokens.append(self.reader_token.get_secret_value())
        if len(tokens) != len(set(tokens)):
            raise ValueError("設備及查詢端必須使用不同金鑰")
        if len({d.id for d in self.devices}) != len(self.devices):
            raise ValueError("設備代號重複")
        if not self.database.is_absolute():
            raise ValueError("資料庫必須指定本機絕對路徑")
        return self


class Signal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: UUID
    occurred_at: AwareDatetime
    value: float = Field(strict=True, allow_inf_nan=False)


def utc_now():
    return datetime.now(UTC)


def create_app(settings: Settings) -> FastAPI:
    settings.database.parent.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="設備訊號接收服務", docs_url=None, redoc_url=None, openapi_url=None)
    registry = CollectorRegistry()
    requests = Counter("signal_requests", "Signal service responses", ["status"], registry=registry)

    def connect():
        db = sqlite3.connect(settings.database, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    with closing(connect()) as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS signals (
                device TEXT NOT NULL, event_id TEXT NOT NULL, market TEXT NOT NULL,
                metric TEXT NOT NULL, unit TEXT NOT NULL, value REAL NOT NULL,
                occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
                state TEXT NOT NULL, fingerprint TEXT NOT NULL,
                PRIMARY KEY (device, event_id)
            );
            CREATE INDEX IF NOT EXISTS signals_latest
                ON signals(device, occurred_at DESC, received_at DESC);
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,
                action TEXT NOT NULL, status INTEGER NOT NULL
            );
        """)

    @app.middleware("http")
    async def audit_request(request: Request, call_next):
        # Only record controlled labels, never headers, credentials or request bodies.
        result = await call_next(request)
        requests.labels(str(result.status_code)).inc()
        action = {
            ("POST", "/v1/signals"): "receive",
            ("GET", "/v1/signals/latest"): "read_latest",
            ("GET", "/v1/signals/history"): "read_history",
            ("GET", "/metrics"): "read_metrics",
        }.get((request.method, request.url.path), "other")
        if request.url.path != "/healthz":
            with closing(connect()) as db, db:
                db.execute(
                    "INSERT INTO audit(at, actor, action, status) VALUES (?,?,?,?)",
                    (utc_now().isoformat(), getattr(request.state, "actor", "unknown"),
                     action, result.status_code),
                )
        result.headers["Cache-Control"] = "no-store"
        result.headers["X-Content-Type-Options"] = "nosniff"
        return result

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": "訊號格式錯誤，請檢查時間與數值"})

    def authorized_reader(
        request: Request, authorization: Annotated[str | None, Header()] = None,
    ):
        expected = "Bearer " + settings.reader_token.get_secret_value()
        if not secrets.compare_digest((authorization or "").encode(), expected.encode()):
            raise HTTPException(401, "未授權查詢")
        request.state.actor = "reader"

    def authorized_device(
        request: Request, authorization: Annotated[str | None, Header()] = None,
    ) -> Device:
        for device in settings.devices:
            expected = "Bearer " + device.token.get_secret_value()
            if secrets.compare_digest((authorization or "").encode(), expected.encode()):
                request.state.actor = device.id
                return device
        raise HTTPException(401, "未授權設備")

    @app.get("/healthz")
    def health():
        with closing(connect()) as db:
            db.execute("SELECT 1").fetchone()
        return {"status": "ok"}

    @app.post("/v1/signals")
    def receive(signal: Signal, device: Annotated[Device, Depends(authorized_device)]):
        now = utc_now()
        if signal.occurred_at > now + timedelta(seconds=60):
            raise HTTPException(422, "設備時間超前，請檢查校時設定")
        occurred = signal.occurred_at.astimezone(UTC).isoformat()
        fingerprint = hashlib.sha256(
            json.dumps([occurred, signal.value], separators=(",", ":")).encode()
        ).hexdigest()
        state = "alarm" if signal.value > device.alarm_above else "normal"
        with closing(connect()) as db, db:
            # Serialize duplicate checks and inserts across concurrent requests.
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT fingerprint, received_at FROM signals WHERE device=? AND event_id=?",
                (device.id, str(signal.event_id)),
            ).fetchone()
            if prior:
                if prior["fingerprint"] != fingerprint:
                    raise HTTPException(409, "相同事件編號的內容不同，原紀錄已保留")
                return {"status": "duplicate", "message": "已收過此訊號",
                        "received_at": prior["received_at"]}
            db.execute(
                "INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?,?)",
                (device.id, str(signal.event_id), device.market, device.metric, device.unit,
                 signal.value, occurred, now.isoformat(), state, fingerprint),
            )
        return {"status": "accepted", "message": "訊號已記錄", "received_at": now.isoformat()}

    @app.get("/v1/signals/latest", dependencies=[Depends(authorized_reader)])
    def latest(market: Literal["1", "2"]):
        rows = []
        with closing(connect()) as db:
            for device in settings.devices:
                if device.market != market:
                    continue
                record = db.execute(
                    "SELECT * FROM signals WHERE device=? "
                    "ORDER BY occurred_at DESC, received_at DESC LIMIT 1", (device.id,),
                ).fetchone()
                if record:
                    row = dict(record)
                    row.pop("fingerprint")
                    age = (utc_now() - datetime.fromisoformat(row["occurred_at"])).total_seconds()
                    row["freshness"] = "stale" if age > device.stale_seconds else "fresh"
                    row["display_status"] = (
                        "資料逾時" if row["freshness"] == "stale"
                        else {"normal": "正常", "alarm": "異常"}[row["state"]]
                    )
                else:
                    row = {"device": device.id, "market": device.market,
                           "display_status": "尚未收到訊號", "freshness": "missing"}
                rows.append(row)
        return {"items": rows}

    @app.get("/v1/signals/history", dependencies=[Depends(authorized_reader)])
    def history(market: Literal["1", "2"], limit: Annotated[int, Query(ge=1, le=500)] = 100):
        with closing(connect()) as db:
            rows = db.execute(
                "SELECT device,event_id,market,metric,unit,value,occurred_at,received_at,state "
                "FROM signals WHERE market=? ORDER BY received_at DESC LIMIT ?", (market, limit),
            ).fetchall()
        return {"items": [dict(row) for row in rows]}

    @app.get("/metrics", dependencies=[Depends(authorized_reader)])
    def metrics():
        return Response(content=generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    return app


def from_env():
    config = os.environ.get("INSPECTION_SIGNAL_CONFIG")
    if not config:
        raise RuntimeError("請設定 INSPECTION_SIGNAL_CONFIG 指向本機服務設定檔")
    # Validation errors must not expose credential-bearing configuration values.
    try:
        settings = Settings.model_validate_json(Path(config).read_text(encoding="utf-8"))
    except ValueError:
        raise RuntimeError("訊號服務設定格式錯誤，請檢查設定檔") from None
    return create_app(settings)

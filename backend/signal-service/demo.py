"""Exercise the installed packages over a real loopback HTTP connection."""

import json
import os
import secrets
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from importlib.metadata import version
from pathlib import Path
from uuid import uuid4

import httpx


def main():
    # Imports verify installed protocol libraries; no real equipment is contacted.
    import asyncua  # noqa: F401
    import paho.mqtt.client  # noqa: F401
    import pymodbus  # noqa: F401

    runtime = Path(os.environ["LOCALAPPDATA"]) / "Inspection" / "python-signals"
    run_dir = runtime / "demo" / str(uuid4())
    run_dir.mkdir(parents=True)
    device_token, reader_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    config_path = run_dir / "config.local.json"
    config = {
        "database": str(run_dir / "signals.db"), "reader_token": reader_token,
        "devices": [{"id": "demo-temperature", "market": "1", "token": device_token,
                     "metric": "temperature", "unit": "C", "alarm_above": 8.0}],
    }
    config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    env = os.environ.copy()
    env["INSPECTION_SIGNAL_CONFIG"] = str(config_path)
    # Ask the OS for a free loopback port; server readiness below detects startup failure.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    # Windows subprocess cannot use uvicorn --fd; launch immediately after releasing the port.
    with (run_dir / "server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(  # noqa: S603 -- fixed executable and controlled arguments
            [sys.executable, "-m", "uvicorn", "service:from_env", "--factory", "--host",
             "127.0.0.1", "--port", str(port), "--no-access-log", "--no-proxy-headers"],
            cwd=Path(__file__).parent, env=env, stdout=log, stderr=log,
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5,
                              trust_env=False) as client:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError("本機服務啟動失敗，請查閱該次 server.log")
                    try:
                        if client.get("/healthz").status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(0.1)
                else:
                    raise RuntimeError("本機服務啟動逾時")
                write_headers = {"Authorization": "Bearer " + device_token}
                read_headers = {"Authorization": "Bearer " + reader_token}
                observed = []
                checks = {}
                for value in [4.0, 12.0, 5.0]:
                    event = {"event_id": str(uuid4()), "value": value,
                             "occurred_at": datetime.now(UTC).isoformat()}
                    result = client.post("/v1/signals", json=event, headers=write_headers)
                    result.raise_for_status()
                    row = client.get("/v1/signals/latest?market=1", headers=read_headers)
                    row.raise_for_status()
                    observed.append(row.json()["items"][0]["display_status"])
                checks["正常、異常、恢復"] = observed == ["正常", "異常", "正常"]
                checks["重複訊號辨識"] = client.post(
                    "/v1/signals", json=event, headers=write_headers,
                ).json()["status"] == "duplicate"
                checks["未授權拒絕"] = client.get("/v1/signals/latest?market=1").status_code == 401
                checks["市場隔離"] = client.get(
                    "/v1/signals/latest?market=2", headers=read_headers,
                ).json()["items"] == []
                old = {"event_id": str(uuid4()), "value": 99.0,
                       "occurred_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat()}
                client.post("/v1/signals", json=old, headers=write_headers).raise_for_status()
                latest = client.get("/v1/signals/latest?market=1", headers=read_headers).json()
                checks["舊資料不覆蓋最新值"] = latest["items"][0]["value"] == 5.0
                history = client.get("/v1/signals/history?market=1", headers=read_headers).json()
                checks["歷史保存"] = len(history["items"]) == 4
                checks["監控指標"] = "signal_requests_total" in client.get(
                    "/metrics", headers=read_headers,
                ).text
                report = {"verified_at": datetime.now(UTC).isoformat(), "mode": "本機模擬設備",
                          "checks": checks, "latest": latest, "history": history,
                          "packages": {name: version(name) for name in [
                              "fastapi", "httpx", "pydantic", "prometheus-client", "uvicorn",
                              "paho-mqtt", "pymodbus", "asyncua", "pytest", "ruff", "mypy",
                              "bandit", "pip-audit",
                          ]}, "production_connected": False}
                report_path = run_dir / "verification.json"
                report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
                print(json.dumps({"checks": checks, "report": str(report_path),
                                  "config": str(config_path)}, ensure_ascii=False))
                if not all(checks.values()):
                    raise RuntimeError("訊號服務驗證未通過")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()

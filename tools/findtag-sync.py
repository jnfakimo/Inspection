"""FindTag visible-list synchronizer. No login automation or GPS inference.

Credentials/outbox: Windows CurrentUser DPAPI, outside repositories. One worker,
read-only ADB allowlist, fixed authorized backend, no credential command arguments.
"""
from __future__ import annotations
import argparse
import base64
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import time
import urllib.request

spec = importlib.util.spec_from_file_location("findtag_probe", Path(__file__).with_name("findtag-visible-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
BACKEND = "https://qztffronusdhgxhjjubt.supabase.co"
MAX_PENDING = 200

class SyncError(RuntimeError):
    pass

def private_dir(value=None):
    base = Path(os.environ.get("LOCALAPPDATA", ""))
    if not base.is_absolute(): raise SyncError("無法確認私人資料目錄")
    path = Path(value) if value else base / "Beinong" / "FindTagSync"
    if not path.is_absolute(): raise SyncError("私人資料路徑必須是完整路徑")
    probe._reject_path_links(path)
    validate_boundary(path.resolve(), base.resolve())
    path.mkdir(parents=True, exist_ok=True)
    path = path.resolve()
    probe._reject_path_links(path)
    validate_boundary(path, base.resolve())
    return path

def validate_boundary(path, base):
    if not path.is_relative_to(base) or any(p.lower().startswith('onedrive') for p in path.parts):
        raise SyncError("同步資料不可位於公開專案或同步資料夾")
    if any((p/'.git').exists() for p in (path,*path.parents)):
        raise SyncError("同步資料不可位於版控專案")

def protect(raw: bytes, decrypt=False):
    if os.name != "nt": raise SyncError("同步憑證只可由本機 Windows 使用者保護")
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_byte))]
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    target = Blob()
    crypto = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypto.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        # CRYPTPROTECT_UI_FORBIDDEN only; never LOCAL_MACHINE.
        ok = crypto.CryptProtectData(ctypes.byref(source), "FindTag sync", None, None, None, 1, ctypes.byref(target))
    if not ok: raise SyncError("無法使用目前 Windows 帳號解讀同步憑證")
    try: return ctypes.string_at(target.data, target.size)
    finally: kernel.LocalFree(target.data)

def atomic_write(path, raw):
    probe._reject_path_links(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".findtag-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists(): temporary.unlink()

def save_state(directory, state):
    atomic_write(directory / "state.dpapi", protect(json.dumps(state, ensure_ascii=False).encode("utf-8")))

def load_state(directory):
    path = directory / "state.dpapi"
    probe._reject_path_links(path)
    if not path.is_file() or path.stat().st_size > 16*1024*1024: raise SyncError("找不到可驗證的同步憑證")
    return json.loads(protect(path.read_bytes(), decrypt=True))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError("同步位址發生重新導向，已停止傳送")

def validate_public_key(value):
    try:
        part = value.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(part + "="*(-len(part)%4)))
        if data.get("role") != "anon" or data.get("ref") != "qztffronusdhgxhjjubt": raise ValueError()
    except Exception: raise SyncError("配對檔不是此網站的公開連線設定") from None
    return value

def rpc(state, name, payload):
    if name not in ("findtag_redeem_pairing", "findtag_ingest"): raise SyncError("不允許的同步操作")
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(raw) > 524288: raise SyncError("本次同步內容超過大小限制")
    request = urllib.request.Request(BACKEND + "/rest/v1/rpc/" + name, data=raw, method="POST", headers={
        "apikey": validate_public_key(state["anon_key"]), "Content-Type": "application/json",
        "User-Agent": "Beinong-FindTag-VisibleSync/1.0",
    })
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            raw_response = response.read(8193)
            if len(raw_response)>8192: raise SyncError("同步回應過大")
            return json.loads(raw_response)
    except Exception: raise SyncError("尚未獲得網站確認；已保留待傳資料，稍後重試") from None

def configure(directory, pairing_file):
    source = Path(pairing_file)
    if source.stat().st_size>4096: raise SyncError("配對檔案過大")
    config = json.loads(source.read_text(encoding="utf-8-sig"))
    if config.get("backend") != BACKEND or config.get("version") != 1: raise SyncError("配對網站不符")
    validate_public_key(config.get("anon_key", ""))
    if not probe.re.fullmatch(r"[0-9a-f]{64}", config.get("pairing_code", "")): raise SyncError("配對碼格式不符")
    if (directory / "state.dpapi").exists():
        state = load_state(directory)
        if state.get("collector_id") != config.get("collector_id"): raise SyncError("本機已有另一組授權，未覆蓋")
    else:
        state = {"schema_version":1,"collector_id":config["collector_id"],"anon_key":config["anon_key"],
                 "pairing_code":config["pairing_code"],"token":secrets.token_hex(32),"pending":[],"paired":False}
        save_state(directory, state)  # Before server mutation: retry a lost response safely.
    if not state.get("paired"):
        result = rpc(state, "findtag_redeem_pairing", {"p_pairing_code":state["pairing_code"],"p_token":state["token"]})
        if not result.get("paired") or result.get("collector_id")!=state["collector_id"]: raise SyncError("配對回應不符")
        state["paired"] = True
        state.pop("pairing_code", None)
        save_state(directory, state)
    return state

def payload(snapshot):
    rows = [{key: row[key] for key in ("device_label", "address_text", "source_time_text")} for row in snapshot["observations"]]
    canonical = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(canonical.encode('utf-8'))>450000: raise SyncError("本次可見清單超過同步大小限制，未加入待傳清單")
    return {"captured_at": snapshot["captured_at"], "rows":rows, "hash":hashlib.sha256(canonical.encode()).hexdigest()}

def enqueue(state, item):
    pending = state.setdefault("pending", [])
    if item["hash"] not in {row["hash"] for row in pending}:
        if len(pending)>=MAX_PENDING or len(json.dumps([*pending,item],ensure_ascii=False).encode())>8*1024*1024:
            raise SyncError("待傳清單已滿，已保留既有資料並停止新增")
        pending.append(item)
    return state

def upload_one(state, send=rpc, live_read=True):
    if not state["pending"]: return False
    item = state["pending"][0]
    result = send(state,"findtag_ingest",{"p_token":state["token"],"p_captured_at":item["captured_at"],
                  "p_observations":item["rows"],"p_status":"readable","p_live_read":live_read})
    if result.get("accepted") is not True: raise SyncError("網站未確認收到資料")
    state["pending"].pop(0)
    state["last_ack_at"] = datetime.now(timezone.utc).isoformat()
    return True

def status_file(directory, state, status):
    # No names, addresses, device identifiers, tokens, or exception text.
    atomic_write(directory/"status.json", json.dumps({"updated_at":datetime.now(timezone.utc).isoformat(),
        "status":status,"pending_count":len(state.get("pending", [])),"last_ack_at":state.get("last_ack_at")}).encode())

def cycle(directory, state, execute, send=rpc):
    read_ok = False
    try:
        snapshot = probe.collect(execute, allow_incomplete=True)
        enqueue(state, payload(snapshot))
        read_ok = True
    except (probe.ProbeError,SyncError):
        pass
    # Never upload a newly queued record until DPAPI storage is durable.
    save_state(directory,state)
    # Pending data are retried even if the UI has changed or is unreadable.
    had_pending = bool(state["pending"])
    if had_pending:
        upload_one(state,send,live_read=read_ok)
        save_state(directory,state)
    elif not read_ok:
        send(state,"findtag_ingest",{"p_token":state["token"],"p_captured_at":None,"p_observations":None,"p_status":"read_failed"})
    status_file(directory,state,"synced" if read_ok else "read_failed")
    return read_ok

class WorkerLock:
    def __init__(self,directory): self.directory=directory;self.handle=None
    def __enter__(self):
        if os.name!="nt": raise SyncError("自動同步僅支援目前 Windows 桌機")
        import msvcrt
        path=self.directory/"worker.lock";probe._reject_path_links(path)
        self.handle=path.open("a+b");self.handle.seek(0)
        if path.stat().st_size==0: self.handle.write(b"0");self.handle.flush();self.handle.seek(0)
        try: msvcrt.locking(self.handle.fileno(),msvcrt.LK_NBLCK,1)
        except OSError: self.handle.close();raise SyncError("已有一個同步程序執行中") from None
        return self
    def __exit__(self,*args):
        import msvcrt
        self.handle.seek(0);msvcrt.locking(self.handle.fileno(),msvcrt.LK_UNLCK,1);self.handle.close()

def main(argv=None):
    if hasattr(sys.stdout,"reconfigure"):sys.stdout.reconfigure(encoding="utf-8")
    parser=argparse.ArgumentParser(description="FindTag 可見清單自動同步；不推估 GPS、不取得帳號密碼")
    parser.add_argument("--state-dir")
    parser.add_argument("--pairing-file")
    parser.add_argument("--adb",default="C:/Program Files/BlueStacks_nxt/HD-Adb.exe")
    parser.add_argument("--once",action="store_true")
    args=parser.parse_args(argv)
    try:
        directory=private_dir(args.state_dir)
        with WorkerLock(directory):
            if args.pairing_file:
                configure(directory,args.pairing_file)
                print("桌機授權已完成；憑證以目前 Windows 帳號加密保存。")
                return 0
            state=load_state(directory)
            if not state.get("paired"):raise SyncError("桌機授權尚未完成")
            execute=probe.Adb(probe.validate_adb_path(args.adb))
            failures=0
            while True:
                try:
                    readable=cycle(directory,state,execute)
                    failures=0
                    if args.once:
                        print("同步完成：網站已確認可見清單。" if readable else "網站已確認讀取狀態；目前 FindTag 清單不可讀。")
                        return 0 if readable else 2
                except Exception:
                    failures+=1;status_file(directory,state,"upload_pending")
                    if args.once:raise SyncError("同步尚未完成，待傳資料已保留") from None
                time.sleep(min(300,60*max(1,failures)))
    except (SyncError,probe.ProbeError) as error:
        print(f"同步停止：{error}");return 2
    except KeyboardInterrupt:return 0
    except Exception:
        print("同步停止：本機設定或資料無法驗證；未輸出私人資料。");return 2

if __name__=="__main__":raise SystemExit(main())

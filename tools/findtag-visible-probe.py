"""Single-shot, visible-UI-only FindTag probe. No login, GPS inference or upload.

Real observations stay below LOCALAPPDATA, never inside this public repository.
Only a caller-selected HD-Adb executable and the fixed loopback device are used.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET


PACKAGE = "com.lq.position"
ENDPOINT = "127.0.0.1:5555"
MAX_XML_BYTES = 4 * 1024 * 1024
MAX_STATE_BYTES = 4 * 1024 * 1024
MAX_ROWS = 200
TIME_SUFFIX = re.compile(r"^(.*)-(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$", re.S)
# ADB shell-owned temporary storage, not /sdcard shared application storage.
# This never targets /data/data or any application-private directory.
REMOTE_FILE = re.compile(r"^/data/local/tmp/findtag-visible-probe-[0-9a-f]{32}\.xml$")
LOGIN_ACTIVITY = re.compile(r"login|signin|sign_in|register|password|authentication", re.I)


class ProbeError(RuntimeError):
    """Only fixed, non-sensitive Traditional Chinese messages leave the CLI."""


def validate_endpoint(value: str) -> str:
    if value != ENDPOINT:
        raise ProbeError("只允許已授權的本機模擬器連線，不接受其他位址。")
    return value


def validate_adb_path(value: str) -> Path:
    result = Path(value)
    if not result.is_absolute() or result.name.lower() != "hd-adb.exe" or not result.is_file():
        raise ProbeError("請指定已安裝的 HD-Adb.exe 完整路徑。")
    return result.resolve()


def allowed_command(arguments: list[str]) -> bool:
    if arguments in (["connect", ENDPOINT], ["-s", ENDPOINT, "get-state"]):
        return True
    if arguments[:3] != ["-s", ENDPOINT, "shell"]:
        return False
    tail = arguments[3:]
    if tail in (["dumpsys", "window", "windows"], ["dumpsys", "package", PACKAGE]):
        return True
    if len(tail) == 3 and tail[:2] == ["uiautomator", "dump"]:
        return bool(REMOTE_FILE.fullmatch(tail[2]))
    if len(tail) == 2 and tail[0] == "touch":
        return bool(REMOTE_FILE.fullmatch(tail[1]))
    if len(tail) == 3 and tail[:2] == ["chmod", "600"]:
        return bool(REMOTE_FILE.fullmatch(tail[2]))
    if len(tail) == 2 and tail[0] == "cat":
        return bool(REMOTE_FILE.fullmatch(tail[1]))
    if len(tail) == 3 and tail[:2] == ["rm", "-f"]:
        return bool(REMOTE_FILE.fullmatch(tail[2]))
    return False


class Adb:
    def __init__(self, executable: Path, endpoint: str = ENDPOINT):
        self.executable = executable
        validate_endpoint(endpoint)

    def __call__(self, arguments: list[str], timeout: int = 15) -> bytes:
        if not allowed_command(arguments):
            raise ProbeError("已拒絕不在唯讀檢測清單內的操作。")
        try:
            result = subprocess.run(
                [str(self.executable), *arguments], shell=False,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=timeout, check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired:
            raise ProbeError("本機讀取逾時；未取得可用資料。") from None
        except OSError:
            raise ProbeError("無法執行本機讀取工具。") from None
        if result.returncode != 0:
            raise ProbeError("本機讀取失敗，請確認模擬器已開啟並授權本機連線。")
        if len(result.stdout) > MAX_XML_BYTES:
            raise ProbeError("回應超過安全大小限制，已停止解析。")
        return result.stdout


def check_foreground(raw: bytes) -> None:
    # Never print the diagnostic output: another application can be foreground.
    text = raw.decode("utf-8", errors="replace")
    focus = re.findall(r"mCurrentFocus\s*=([^\r\n]*)", text)
    if len(focus) != 1:
        raise ProbeError("無法確認前景程式，已停止讀取。")
    components = re.findall(r"\b([a-zA-Z][\w.]+)/(\.?[\w.$]+)", focus[0])
    if len(components) != 1 or components[0][0] != PACKAGE:
        raise ProbeError("前景不是 FindTag，已停止讀取。")
    if LOGIN_ACTIVITY.search(components[0][1]):
        raise ProbeError("目前是登入或帳號畫面，已停止讀取。")


def check_version(raw: bytes) -> dict:
    text = raw.decode("utf-8", errors="replace")
    names = set(re.findall(r"\bversionName=([^\s]+)", text))
    codes = set(re.findall(r"\bversionCode=(\d+)\b", text))
    if names != {"1.2.27"} or codes != {"47"}:
        raise ProbeError("程式版本不符合已驗證的格式，已停止讀取。")
    return {"name": "1.2.27", "code": 47}


def _safe_tree(node: ET.Element) -> bool:
    for child in node.iter():
        if child.get("package") not in (None, "", PACKAGE):
            return False
        if child.get("password", "false").lower() != "false":
            return False
        if "edittext" in child.get("class", "").lower():
            return False
    return True


def _text(node: ET.Element, limit: int) -> str:
    value = node.get("text", "").strip()
    if not value or len(value) > limit or any(ord(c) < 32 and c not in "\t\n\r" for c in value):
        raise ProbeError("設備列內容不符合已驗證的格式，已停止讀取。")
    return value


def parse_visible_rows(raw: bytes, allow_incomplete: bool = False) -> list[dict]:
    if len(raw) > MAX_XML_BYTES:
        raise ProbeError("畫面結構超過安全大小限制。")
    # Decode strictly and reject DTD, including entity-expansion XML payloads.
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError:
        raise ProbeError("畫面結構編碼不符，未解析資料。") from None
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ProbeError("畫面結構含不允許的宣告，未解析資料。")
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise ProbeError("畫面結構無法解析。") from None
    if sum(1 for _ in root.iter()) > 30000:
        raise ProbeError("畫面節點過多，已停止解析。")
    # A password field anywhere means we may be on an account/login overlay.
    if any(n.get("password", "false").lower() != "false" for n in root.iter()):
        raise ProbeError("畫面包含密碼欄位，已停止讀取。")
    sheets = [n for n in root.iter() if n.get("resource-id") == PACKAGE + ":id/design_bottom_sheet"]
    if len(sheets) != 1 or sheets[0].get("package") != PACKAGE:
        raise ProbeError("目前不是已驗證的 FindTag 設備清單，未解析其他畫面。")
    recyclers = [n for n in sheets[0].iter() if n.get("resource-id") == PACKAGE + ":id/recyclerView"]
    if len(recyclers) != 1:
        raise ProbeError("設備清單結構不符，未解析其他畫面。")
    rows = []
    # Pair only within one direct recycler row, never across sibling rows.
    for row in recyclers[0]:
        labels = [n for n in row.iter() if n.get("resource-id") == PACKAGE + ":id/tv"]
        infos = [n for n in row.iter() if n.get("resource-id") == PACKAGE + ":id/tv_localInfo"]
        if not labels and not infos:
            continue
        incomplete = allow_incomplete and len(labels) == 1 and len(infos) == 0
        if len(labels) != 1 or (len(infos) != 1 and not incomplete) or not _safe_tree(row):
            raise ProbeError("設備列結構不明，已停止以避免錯配設備。")
        if any(n.get("package") != PACKAGE or not n.get("class", "").endswith("TextView") for n in labels + infos):
            raise ProbeError("設備文字欄位不符合白名單，已停止讀取。")
        label = _text(labels[0], 256)
        if incomplete:
            rows.append({
                "device_label": label, "external_device_id": None,
                "address_text": None, "source_time_text": None,
                "source_timezone": "unknown", "source_recorded_at": None,
                "latitude": None, "longitude": None, "accuracy_m": None,
                "verification_status": "incomplete_visible_text",
            })
            if len(rows) > MAX_ROWS:
                raise ProbeError("設備列超過單次讀取上限。")
            continue
        info = _text(infos[0], 1536)
        match = TIME_SUFFIX.fullmatch(info)
        if not match or not match[1].strip():
            raise ProbeError("設備地址與來源時間格式不符，未猜測定位時間。")
        try:
            datetime.strptime(match[2], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise ProbeError("來源時間無效，未猜測定位時間。") from None
        rows.append({
            "device_label": label,
            "external_device_id": None,
            "address_text": match[1].strip(),
            "source_time_text": match[2],
            "source_timezone": "unknown",
            "source_recorded_at": None,
            "latitude": None, "longitude": None, "accuracy_m": None,
            "verification_status": "unverified_visible_text",
        })
        if len(rows) > MAX_ROWS:
            raise ProbeError("設備列超過單次讀取上限。")
    if not rows:
        raise ProbeError("目前清單沒有可讀的完整設備列，未建立定位資料。")
    # Exact duplicates are common in accessibility trees; do not create events.
    unique = {json.dumps(row, ensure_ascii=False, sort_keys=True): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def collect(execute, allow_incomplete: bool = False) -> dict:
    execute(["connect", ENDPOINT])
    if execute(["-s", ENDPOINT, "get-state"]).strip() != b"device":
        raise ProbeError("本機模擬器尚未授權或未連線。")
    version = check_version(execute(["-s", ENDPOINT, "shell", "dumpsys", "package", PACKAGE]))
    check_foreground(execute(["-s", ENDPOINT, "shell", "dumpsys", "window", "windows"]))
    remote = "/data/local/tmp/findtag-visible-probe-" + uuid.uuid4().hex + ".xml"
    failure = None
    rows = None
    try:
        # Restrict an empty shell-owned file before writing visible private data.
        execute(["-s", ENDPOINT, "shell", "touch", remote])
        execute(["-s", ENDPOINT, "shell", "chmod", "600", remote])
        execute(["-s", ENDPOINT, "shell", "uiautomator", "dump", remote], timeout=25)
        # Refuse a snapshot if the user changed applications while it was captured.
        check_foreground(execute(["-s", ENDPOINT, "shell", "dumpsys", "window", "windows"]))
        raw = execute(["-s", ENDPOINT, "shell", "cat", remote])
        rows = parse_visible_rows(raw, allow_incomplete=allow_incomplete)
    except Exception as error:
        failure = error
    finally:
        try:
            execute(["-s", ENDPOINT, "shell", "rm", "-f", remote])
        except Exception:
            raise ProbeError("無法清除本次建立的暫存畫面檔，已停止，不會宣稱讀取完成。") from None
    if failure is not None:
        raise failure
    canonical = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "schema_version": 1,
        "provider": "findtag",
        "app_version": version,
        "acquisition_method": "visible_ui",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "readable_without_coordinates",
        "view_content_hash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "capabilities": {"device_label": True, "stable_device_id": False, "address": True,
                         "source_timestamp_text": True, "coordinates": False},
        "observations": rows,
    }


def _reject_path_links(target: Path) -> None:
    # Windows junctions and ordinary symlinks are explicit redirects. MSIX's
    # file-system virtualization is not a junction and is validated separately.
    for part in (target, *target.parents):
        is_junction = getattr(part, "is_junction", None)
        if part.is_symlink() or (callable(is_junction) and is_junction()):
            raise ProbeError("私人輸出路徑存在重新導向，已停止儲存。")


def _validate_private_boundary(target: Path, base: Path) -> None:
    repository = Path(__file__).resolve().parents[1]
    if target.is_relative_to(repository) or any(part.lower().startswith("onedrive") for part in target.parts):
        raise ProbeError("輸出位置不可位於公開專案或同步資料夾。")
    if not target.is_relative_to(base):
        raise ProbeError("輸出位置超出本機私人資料範圍。")


def private_output_directory() -> Path:
    raw = os.environ.get("LOCALAPPDATA", "")
    base = Path(raw)
    if not raw or not base.is_absolute():
        raise ProbeError("無法確認本機私人資料目錄，未儲存資料。")
    logical = base / "Beinong" / "FindTagProbe"
    _reject_path_links(logical)
    canonical_base = base.resolve()
    _validate_private_boundary(logical.resolve(), canonical_base)
    # Codex MSIX may virtualize a first mkdir under LOCALAPPDATA to that same
    # user's LOCALAPPDATA/Packages/.../LocalCache/Local. Validate both sides;
    # never accept a canonical path outside LOCALAPPDATA or an explicit link.
    logical.mkdir(parents=True, exist_ok=True)
    _reject_path_links(logical)
    target = logical.resolve()
    _validate_private_boundary(target, canonical_base)
    _reject_path_links(target)
    return target


def _older_view(current: list[dict], previous: list[dict]) -> bool:
    """Conservative comparison, NOT proof that display labels identify devices.

    Only refuse an entirely older/equal view when both views have the same
    unique labels. No per-device merging is possible without stable IDs.
    """
    if not current or len(current) != len(previous):
        return False
    old = {row.get("device_label"): row.get("source_time_text") for row in previous}
    labels = [row.get("device_label") for row in current]
    if len(old) != len(previous) or len(set(labels)) != len(current) or set(labels) != set(old):
        return False
    if not all(isinstance(old[label], str) for label in labels):
        return False
    comparisons = [(row["source_time_text"], old[row["device_label"]]) for row in current]
    return all(new <= prior for new, prior in comparisons) and any(new < prior for new, prior in comparisons)


def save_observation(snapshot: dict, directory: Path) -> str:
    """Private snapshot only, bounded content-hash dedup; never uploads anything."""
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "latest-observation.json"
    if destination.is_symlink() or directory.resolve() != directory:
        raise ProbeError("私人輸出路徑存在重新導向，已停止儲存。")
    previous = None
    if destination.exists():
        try:
            if destination.stat().st_size > MAX_STATE_BYTES:
                raise ValueError()
            previous = json.loads(destination.read_text(encoding="utf-8"))
            if not isinstance(previous, dict) or previous.get("schema_version") != 1:
                raise ValueError()
            if not isinstance(previous.get("observations"), list):
                raise ValueError()
            if not isinstance(previous.get("seen_content_hashes", []), list):
                raise ValueError()
        except (OSError, ValueError):
            raise ProbeError("既有私人觀測檔無法驗證，已保留原檔並停止。") from None
    hashes = previous.get("seen_content_hashes", []) if previous else []
    if snapshot["view_content_hash"] in hashes or (previous and snapshot["view_content_hash"] == previous.get("view_content_hash")):
        return "unchanged"
    if previous and _older_view(snapshot["observations"], previous["observations"]):
        return "older_view"
    snapshot = {**snapshot, "seen_content_hashes": [*hashes, snapshot["view_content_hash"]][-256:]}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, prefix=".observation-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    except OSError:
        raise ProbeError("無法儲存本機私人觀測檔，未上傳任何資料。") from None
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return "saved"


def main(argv=None) -> int:
    # Windows redirected stdout otherwise defaults to a legacy Chinese codepage.
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if callable(reconfigure):
        reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="單次讀取 FindTag 可見設備清單；不登入、不推測座標、不上傳。")
    parser.add_argument("--adb", required=True, help="已安裝 HD-Adb.exe 的完整路徑")
    parser.add_argument("--endpoint", default=ENDPOINT, help="只接受本機已授權連線")
    args = parser.parse_args(argv)
    try:
        validate_endpoint(args.endpoint)
        execute = Adb(validate_adb_path(args.adb), args.endpoint)
        directory = private_output_directory()
        snapshot = collect(execute)
        result = save_observation(snapshot, directory)
        messages = {
            "saved": f"讀取完成：取得 {len(snapshot['observations'])} 筆可見文字觀測，已存本機私人目錄。尚無經緯度或穩定設備識別碼，未上傳網站。",
            "unchanged": "可見內容未變更，未新增紀錄或刷新來源定位時間；未上傳網站。",
            "older_view": "目前顯示較舊的來源時間，已保留原觀測檔；未將舊資料當成新定位，未上傳網站。",
        }
        print(messages[result])
        return 0
    except ProbeError as error:
        print(f"檢測停止：{error}")
        return 2
    except Exception:
        # Do not expose exception payloads, commands, application data or paths.
        print("檢測停止：發生未預期的本機讀取錯誤，未上傳任何資料。")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

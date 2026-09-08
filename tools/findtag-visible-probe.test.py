"""Synthetic-only tests. Never invoke ADB, inspect devices or use real locations."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET


spec = importlib.util.spec_from_file_location("findtag_probe", Path(__file__).with_name("findtag-visible-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
P = probe.PACKAGE
FOCUS = f"mCurrentFocus=Window{{abc u0 {P}/{P}.activity.MainActivity}}".encode()
VERSION = b"versionName=1.2.27\nversionCode=47 minSdk=23"


def fixture(rows=None, extra=False):
    rows = rows if rows is not None else [("測試標籤甲", "合成地點甲-2026-09-08 20:19:31")]
    root = ET.Element("hierarchy")
    app = ET.SubElement(root, "node", {"package": P, "class": "android.widget.FrameLayout"})
    if extra:
        ET.SubElement(app, "node", {"package": P, "text": "不可複製的其他介面文字"})
        ET.SubElement(app, "node", {"package": P, "class": "android.widget.EditText", "text": "不可複製的搜尋文字"})
    sheet = ET.SubElement(app, "node", {"package": P, "resource-id": P + ":id/design_bottom_sheet"})
    recycler = ET.SubElement(sheet, "node", {"package": P, "resource-id": P + ":id/recyclerView"})
    for label, info in rows:
        row = ET.SubElement(recycler, "node", {"package": P, "class": "android.widget.LinearLayout"})
        for resource, text in (("tv", label), ("tv_localInfo", info)):
            if text is not None:
                ET.SubElement(row, "node", {"package": P, "resource-id": P + ":id/" + resource,
                    "class": "android.widget.TextView", "password": "false", "text": text})
    return ET.tostring(root, encoding="utf-8")


class IncompleteVisibleRowsTests(unittest.TestCase):
    def test_incomplete_row_is_explicit_not_merged_by_name(self):
        raw=fixture([('同名','合成地點-2026-09-08 12:00:00'),('同名',None)])
        with self.assertRaises(probe.ProbeError):probe.parse_visible_rows(raw)
        rows=probe.parse_visible_rows(raw,allow_incomplete=True)
        self.assertEqual(len(rows),2)
        incomplete=[r for r in rows if r['address_text'] is None]
        self.assertEqual(len(incomplete),1)
        self.assertIsNone(incomplete[0]['source_time_text'])
        self.assertIsNone(incomplete[0]['external_device_id'])
        self.assertIsNone(incomplete[0]['latitude'])
    def test_incomplete_mode_does_not_pair_or_guess_invalid_values(self):
        for raw in [fixture([(None,'合成地點-2026-09-08 12:00:00')]),fixture([('標籤','錯誤時間')])]:
            with self.assertRaises(probe.ProbeError):probe.parse_visible_rows(raw,allow_incomplete=True)

class FakeAdb:
    def __init__(self, raw=None, focus=FOCUS, version=VERSION, fail=None):
        self.raw = raw if raw is not None else fixture()
        self.focus = focus
        self.version = version
        self.fail = fail
        self.calls = []
        self.remote = None

    def __call__(self, args, timeout=15):
        self.calls.append(args)
        if not probe.allowed_command(args):
            raise AssertionError("Disallowed command")
        if args[:1] == ["connect"]:
            return b"connected"
        if args[-1] == "get-state":
            return b"device\n"
        tail = args[3:]
        if tail == ["dumpsys", "window", "windows"]:
            return self.focus
        if tail == ["dumpsys", "package", P]:
            return self.version
        if tail[:1] == ["touch"]:
            self.remote = tail[-1]
            if self.fail == "touch":
                raise probe.ProbeError("無法建立本次暫存檔。")
            return b""
        if tail[:2] == ["chmod", "600"]:
            if self.fail == "chmod":
                raise probe.ProbeError("無法設定本次暫存權限。")
            return b""
        if tail[:2] == ["uiautomator", "dump"]:
            self.remote = tail[-1]
            if self.fail == "dump":
                raise probe.ProbeError("本機讀取逾時；未取得可用資料。")
            return b"dumped"
        if tail[:1] == ["cat"]:
            if self.fail == "cat":
                raise probe.ProbeError("本機讀取失敗。")
            return self.raw
        if tail[:2] == ["rm", "-f"]:
            if self.fail == "cleanup":
                raise probe.ProbeError("cleanup failed")
            return b""
        raise AssertionError("Unexpected command")


class ParserTests(unittest.TestCase):
    def test_pairs_rows_and_keeps_only_allowlisted_text(self):
        rows = probe.parse_visible_rows(fixture([
            ("測試標籤甲", "合成 A&B <地點>-2026-09-08 20:19:31"),
            ("測試標籤乙", "合成地點乙-2026-09-08 20:20:00"),
        ], extra=True))
        by_name = {row["device_label"]: row for row in rows}
        self.assertEqual(by_name["測試標籤甲"]["address_text"], "合成 A&B <地點>")
        self.assertEqual(by_name["測試標籤乙"]["source_time_text"], "2026-09-08 20:20:00")
        self.assertNotIn("不可複製", json.dumps(rows, ensure_ascii=False))
        for row in rows:
            for field in ("source_recorded_at", "latitude", "longitude", "accuracy_m", "external_device_id"):
                self.assertIsNone(row[field])
            self.assertEqual(row["source_timezone"], "unknown")

    def test_never_pairs_across_sibling_rows(self):
        with self.assertRaisesRegex(probe.ProbeError, "錯配"):
            probe.parse_visible_rows(fixture([("測試甲", None), (None, "合成地點-2026-09-08 20:19:31")]))

    def test_duplicates_deduplicated_but_same_name_different_rows_preserved(self):
        a = ("同名測試", "合成甲-2026-09-08 20:19:31")
        b = ("同名測試", "合成乙-2026-09-08 20:19:31")
        self.assertEqual(len(probe.parse_visible_rows(fixture([a, a]))), 1)
        self.assertEqual(len(probe.parse_visible_rows(fixture([a, b]))), 2)

    def test_unrelated_package_password_edittext_rejected(self):
        raw = fixture()
        changes = [
            raw.replace(b'password="false"', b'password="true"', 1),
            raw.replace(b'android.widget.TextView', b'android.widget.EditText', 1),
            raw.replace((P + ':id/tv"').encode(), (P + ':id/tv" unexpected="1"').encode()).replace(
                b'class="android.widget.TextView" password="false"', b'class="android.widget.TextView" password="true"', 1),
            raw.replace(('package="' + P + '"').encode(), b'package="com.example.other"'),
        ]
        for value in changes:
            with self.subTest(value=value[:20]), self.assertRaises(probe.ProbeError):
                probe.parse_visible_rows(value)

    def test_other_screen_empty_and_unknown_schema_rejected(self):
        for raw in (b"<hierarchy/>", fixture([]), fixture().replace(b":id/recyclerView", b":id/unknown")):
            with self.assertRaises(probe.ProbeError):
                probe.parse_visible_rows(raw)

    def test_dtd_entity_oversized_malformed_and_invalid_encoding_rejected(self):
        cases = [b'<!DOCTYPE a [<!ENTITY x "secret">]><a>&x;</a>', b'<!ENTITY a "x"><a/>',
                 b"x" * (probe.MAX_XML_BYTES + 1), b"<hierarchy>", b"\xff\xfe<\x00h\x00/\x00>\x00"]
        for raw in cases:
            with self.assertRaises(probe.ProbeError):
                probe.parse_visible_rows(raw)

    def test_bad_or_missing_date_not_substituted_with_now(self):
        for info in ("合成地址", "合成地址-2026-02-30 20:19:31", "合成地址-2026-09-08 99:00:00"):
            with self.assertRaises(probe.ProbeError):
                probe.parse_visible_rows(fixture([("測試", info)]))
        old = probe.parse_visible_rows(fixture([("測試", "合成地點-2020-01-01 00:00:00")]))[0]
        self.assertEqual(old["source_time_text"], "2020-01-01 00:00:00")
        self.assertIsNone(old["source_recorded_at"])


class BoundaryTests(unittest.TestCase):
    def test_only_exact_loopback_allowed(self):
        for address in ("localhost:5555", "127.0.0.1:5556", "192.168.1.2:5555", "127.0.0.1:5555;root", ""):
            with self.assertRaises(probe.ProbeError):
                probe.validate_endpoint(address)
        self.assertEqual(probe.validate_endpoint(probe.ENDPOINT), probe.ENDPOINT)

    def test_allowlist_rejects_sensitive_or_mutating_commands(self):
        for tail in (["root"], ["shell", "input", "tap", "0", "0"], ["shell", "logcat"],
                     ["shell", "run-as", P], ["shell", "cat", "/data/data/secret"],
                     ["shell", "rm", "-rf", "/sdcard/Download"], ["shell", "rm", "-f", "/sdcard/Download/another.xml"],
                     ["shell", "touch", "/data/local/tmp/another.xml"],
                     ["shell", "chmod", "777", "/data/local/tmp/findtag-visible-probe-" + "a" * 32 + ".xml"],
                     ["shell", "touch", "/sdcard/Download/findtag-visible-probe-" + "a" * 32 + ".xml"]):
            self.assertFalse(probe.allowed_command(["-s", probe.ENDPOINT, *tail]))
        fake = FakeAdb()
        probe.collect(fake)
        self.assertTrue(all(probe.allowed_command(call) for call in fake.calls))

    def test_foreground_nonapp_login_and_ambiguous_rejected(self):
        for focus in (b"mCurrentFocus=null", b"mCurrentFocus=Window{u0 com.example.other/.Main}",
                      f"mCurrentFocus=Window{{u0 {P}/.LoginActivity}}".encode(), FOCUS + b"\n" + FOCUS):
            fake = FakeAdb(focus=focus)
            with self.assertRaises(probe.ProbeError):
                probe.collect(fake)
            self.assertIsNone(fake.remote)

    def test_only_verified_version_pair_accepted(self):
        for version in (b"versionName=1.2.27\nversionCode=48", b"versionName=2.0\nversionCode=47", b""):
            with self.assertRaisesRegex(probe.ProbeError, "版本"):
                probe.collect(FakeAdb(version=version))

    def test_temporary_exact_file_always_cleaned(self):
        for failure in (None, "touch", "chmod", "dump", "cat"):
            fake = FakeAdb(fail=failure)
            if failure:
                with self.assertRaises(probe.ProbeError):
                    probe.collect(fake)
            else:
                probe.collect(fake)
            self.assertTrue(probe.REMOTE_FILE.fullmatch(fake.remote))
            self.assertEqual(fake.calls[-1], ["-s", probe.ENDPOINT, "shell", "rm", "-f", fake.remote])
        with self.assertRaisesRegex(probe.ProbeError, "無法清除"):
            probe.collect(FakeAdb(fail="cleanup"))

    def test_empty_shell_temporary_file_secured_before_dump(self):
        fake = FakeAdb()
        probe.collect(fake)
        operations = [call[3:] for call in fake.calls if call[2:3] == ["shell"]]
        touch = ["touch", fake.remote]
        chmod = ["chmod", "600", fake.remote]
        dump = ["uiautomator", "dump", fake.remote]
        self.assertTrue(fake.remote.startswith("/data/local/tmp/"))
        self.assertEqual(operations.index(touch) + 1, operations.index(chmod))
        self.assertEqual(operations.index(chmod) + 1, operations.index(dump))
        self.assertLess(operations.index(dump), operations.index(["cat", fake.remote]))
        self.assertEqual(operations[-1], ["rm", "-f", fake.remote])
        self.assertTrue(all("/data/data/" not in " ".join(call) for call in fake.calls))

    def test_foreground_switch_after_capture_stops_and_cleans(self):
        fake = FakeAdb()
        checks = 0
        def changing(args, timeout=15):
            nonlocal checks
            if args[-3:] == ["dumpsys", "window", "windows"]:
                checks += 1
                if checks == 2:
                    return b"mCurrentFocus=Window{u0 com.example.other/.Main}"
            return fake(args, timeout)
        with self.assertRaisesRegex(probe.ProbeError, "前景"):
            probe.collect(changing)
        self.assertEqual(fake.calls[-1][-3:], ["rm", "-f", fake.remote])
        self.assertFalse(any("cat" in command for command in fake.calls))

    def test_subprocess_timeout_failure_and_large_output_redacted(self):
        client = probe.Adb(Path("HD-Adb.exe"))
        command = ["-s", probe.ENDPOINT, "get-state"]
        with patch.object(probe.subprocess, "run", side_effect=subprocess.TimeoutExpired("SECRET", 15)):
            with self.assertRaisesRegex(probe.ProbeError, "逾時") as error:
                client(command)
            self.assertNotIn("SECRET", str(error.exception))
        with patch.object(probe.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"SECRET", b"SECRET")):
            with self.assertRaises(probe.ProbeError) as error:
                client(command)
            self.assertNotIn("SECRET", str(error.exception))
        with patch.object(probe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"x" * (probe.MAX_XML_BYTES + 1), b"")):
            with self.assertRaisesRegex(probe.ProbeError, "大小"):
                client(command)


class StorageTests(unittest.TestCase):
    def test_content_hash_ignores_capture_time_and_repeated_read_does_not_refresh(self):
        one = probe.collect(FakeAdb())
        two = probe.collect(FakeAdb())
        self.assertEqual(one["view_content_hash"], two["view_content_hash"])
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            self.assertEqual(probe.save_observation(one, directory), "saved")
            path = directory / "latest-observation.json"
            original = path.read_bytes()
            self.assertEqual(probe.save_observation(two, directory), "unchanged")
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(len(list(directory.iterdir())), 1)

    def test_older_view_does_not_replace_newer_private_snapshot(self):
        newer = probe.collect(FakeAdb())
        older = probe.collect(FakeAdb(fixture([("測試標籤甲", "合成舊地點-2026-09-08 19:00:00")])))
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            probe.save_observation(newer, directory)
            original = (directory / "latest-observation.json").read_bytes()
            self.assertEqual(probe.save_observation(older, directory), "older_view")
            self.assertEqual((directory / "latest-observation.json").read_bytes(), original)

    def test_duplicate_display_labels_not_assumed_to_be_stable_identity(self):
        rows = probe.parse_visible_rows(fixture([("同名", "合成甲-2026-09-08 20:00:00"), ("同名", "合成乙-2026-09-08 20:01:00")]))
        self.assertFalse(probe._older_view(rows, rows))

    def test_existing_corrupt_file_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            destination = directory / "latest-observation.json"
            destination.write_bytes(b"not json")
            with self.assertRaisesRegex(probe.ProbeError, "保留原檔"):
                probe.save_observation(probe.collect(FakeAdb()), directory)
            self.assertEqual(destination.read_bytes(), b"not json")

    def test_repository_and_onedrive_output_refused(self):
        repository = Path(probe.__file__).resolve().parents[1]
        for base in (str(repository), str(repository.parent / "OneDrive"), "relative"):
            with patch.dict(os.environ, {"LOCALAPPDATA": base}):
                with self.assertRaises(probe.ProbeError):
                    probe.private_output_directory()

    def test_first_run_revalidates_msix_virtualized_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            logical = base / "Beinong" / "FindTagProbe"
            canonical = base / "Packages" / "SyntheticCodex" / "LocalCache" / "Local" / "Beinong" / "FindTagProbe"
            original_resolve = Path.resolve
            def virtualized(path, *args, **kwargs):
                if path == logical and logical.exists():
                    return canonical
                return original_resolve(path, *args, **kwargs)
            with patch.dict(os.environ, {"LOCALAPPDATA": str(base)}), patch.object(Path, "resolve", virtualized):
                target = probe.private_output_directory()
                self.assertEqual(target, canonical)
                self.assertEqual(probe.save_observation(probe.collect(FakeAdb()), target), "saved")
            self.assertTrue((canonical / "latest-observation.json").is_file())

    def test_explicit_symlink_and_junction_remain_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            logical = base / "Beinong" / "FindTagProbe"
            for method in ("is_symlink", "is_junction"):
                with patch.dict(os.environ, {"LOCALAPPDATA": str(base)}), \
                     patch.object(Path, method, lambda path: path == logical, create=True):
                    with self.assertRaisesRegex(probe.ProbeError, "重新導向"):
                        probe.private_output_directory()

    def test_msix_canonical_path_cannot_escape_localappdata(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            logical = base / "Beinong" / "FindTagProbe"
            outside = base.parent / "not-authorized-findtag-probe"
            original_resolve = Path.resolve
            def escaping(path, *args, **kwargs):
                if path == logical and logical.exists():
                    return outside
                return original_resolve(path, *args, **kwargs)
            with patch.dict(os.environ, {"LOCALAPPDATA": str(base)}), patch.object(Path, "resolve", escaping):
                with self.assertRaisesRegex(probe.ProbeError, "超出"):
                    probe.private_output_directory()

    def test_cli_prints_only_non_sensitive_summary(self):
        with tempfile.TemporaryDirectory() as temporary:
            stdout = io.StringIO()
            with patch.object(probe, "validate_adb_path", return_value=Path("HD-Adb.exe")), \
                 patch.object(probe, "Adb", return_value=FakeAdb()), \
                 patch.object(probe, "private_output_directory", return_value=Path(temporary).resolve()), \
                 contextlib.redirect_stdout(stdout):
                self.assertEqual(probe.main(["--adb", "unused"]), 0)
            result = stdout.getvalue()
            self.assertIn("1 筆", result)
            self.assertIn("未上傳", result)
            for private in ("測試標籤甲", "合成地點甲", "20:19:31", "<hierarchy", P):
                self.assertNotIn(private, result)


if __name__ == "__main__":
    unittest.main()

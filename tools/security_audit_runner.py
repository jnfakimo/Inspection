"""
北農中央戰情室暨巡檢系統 - 技術資安掃描（不判定 ISO/IEC 27001 符合性）
整合：Bandit、pip-audit 與內建機密規則；不代表完整弱點掃描或 ISMS 稽核。
"""

from __future__ import annotations
import sys
import os
import json
import subprocess
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


class SecurityAuditRunner:
    """技術掃描證據產生器；工具失敗不得視為通過。"""

    def __init__(self, project_root: str):
        self.project_root = os.path.abspath(project_root)
        self.report_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    def _run_json(self, cmd):
        proc = subprocess.run(cmd, cwd=self.project_root, capture_output=True,
                              text=True, encoding="utf-8", timeout=600)
        if proc.returncode not in (0, 1) or not proc.stdout.strip():
            raise ValueError("工具未產生有效結果；請確認安裝、網路與權限")
        return proc.returncode, json.loads(proc.stdout)

    @staticmethod
    def overall_status(*results):
        if not results or any(r.get("status") not in ("passed", "warning") for r in results):
            return "incomplete"
        counts = ("high_issues", "medium_issues", "low_issues", "vulnerabilities_count", "secrets_count")
        if any(r.get("status") == "warning" or any(r.get(k, 0) > 0 for k in counts) for r in results):
            return "warning"
        return "passed"

    def run_bandit_sast(self, target_dirs: List[str]) -> Dict[str, Any]:
        """執行 Bandit 靜態程式碼安全分析 (SAST)"""
        print("🔍 [1/3] 正在執行 Bandit 靜態程式碼弱點掃描 (SAST)...")
        results = {
            "tool": "Bandit",
            "status": "passed",
            "high_issues": 0,
            "medium_issues": 0,
            "low_issues": 0,
            "findings": []
        }
        
        valid_dirs = [d for d in target_dirs if os.path.exists(os.path.join(self.project_root, d))]
        if not valid_dirs:
            results["status"] = "incomplete"
            results["error_message"] = "沒有可掃描的目錄"
            return results

        cmd = [
            sys.executable, "-m", "bandit",
            "-r", *valid_dirs,
            "-f", "json"
        ]
        
        try:
            exit_code, output_json = self._run_json(cmd)
            metrics = output_json["metrics"]["_totals"]
            if output_json.get("errors") or not isinstance(output_json.get("results"), list):
                raise ValueError("Bandit 結果不完整")
            if metrics.get("loc", 0) <= 0:
                raise ValueError("Bandit 未掃描任何程式碼")
            if exit_code == 1 and not output_json["results"]:
                raise ValueError("Bandit 非成功結束且沒有問題明細")
            results["high_issues"] = metrics.get("SEVERITY.HIGH", 0)
            results["medium_issues"] = metrics.get("SEVERITY.MEDIUM", 0)
            results["low_issues"] = metrics.get("SEVERITY.LOW", 0)
            
            for item in output_json.get("results", []):
                results["findings"].append({
                    "test_id": item.get("test_id"),
                    "severity": item.get("issue_severity"),
                    "confidence": item.get("issue_confidence"),
                    "text": item.get("issue_text"),
                    "file": os.path.relpath(item.get("filename"), self.project_root),
                    "line": item.get("line_number")
                })
                
            if any(results[k] > 0 for k in ("high_issues", "medium_issues", "low_issues")):
                results["status"] = "warning"
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
            results["status"] = "error"
            results["error_message"] = "Bandit 未完成；不可據此判定零弱點"

        return results

    def run_pip_audit_sca(self) -> Dict[str, Any]:
        """執行 pip-audit 第三方套件 CVE 漏洞檢測 (SCA)"""
        print("🔍 [2/3] 正在執行 pip-audit 相依套件 CVE 弱點檢測 (SCA)...")
        results = {
            "tool": "pip-audit",
            "status": "passed",
            "vulnerabilities_count": 0,
            "vulnerabilities": []
        }
        
        cmd = [sys.executable, "-m", "pip_audit", "-f", "json"]
        try:
            exit_code, audit_data = self._run_json(cmd)
            packages = audit_data if isinstance(audit_data, list) else audit_data["dependencies"]
            if not isinstance(packages, list) or not packages:
                raise ValueError("pip-audit 未提供套件清單")
            skipped = []
            for pkg in packages:
                if pkg.get("skip_reason"):
                    skipped.append(pkg.get("name", "unknown"))
                    continue
                if not isinstance(pkg.get("vulns"), list):
                    raise ValueError("pip-audit 套件結果缺少漏洞欄位")
                for v in pkg["vulns"]:
                    results["vulnerabilities_count"] += 1
                    results["vulnerabilities"].append({
                        "package": pkg.get("name"), "version": pkg.get("version"),
                        "id": v.get("id"), "fix_versions": v.get("fix_versions", [])
                    })
            if results["vulnerabilities_count"] > 0:
                results["status"] = "warning"
            elif exit_code != 0:
                raise ValueError("pip-audit 非成功結束且沒有問題明細")
            if skipped:
                results["status"] = "incomplete"
                results["skipped_packages"] = skipped
                results["error_message"] = "部分套件未完成檢查"
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
            results["status"] = "error"
            results["error_message"] = "pip-audit 未完成；不可據此判定零弱點"

        return results

    def run_secret_detection(self) -> Dict[str, Any]:
        """執行密鑰外洩偵測 (Secret Scan)"""
        print("🔍 [3/3] 正在執行全專案密鑰與敏感憑證外洩偵測...")
        results = {
            "tool": "builtin-secret-rules",
            "status": "passed",
            "secrets_count": 0,
            "findings": [],
            "files_scanned": 0,
            "read_errors": 0,
        }
        
        # 內建嚴格檢查規則（排除正規表示式取代語法，精確偵測真實金鑰）
        forbidden_patterns = [
            ("Supabase Service Role Key", r"SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['\"][A-Za-z0-9_\-\.]{20,}"),
            ("Supabase Access Token", r"SUPABASE_ACCESS_TOKEN\s*[:=]\s*['\"][A-Za-z0-9_\-\.]{20,}"),
            ("LINE Channel Secret", r"LINE_CHANNEL_SECRET\s*[:=]\s*['\"][A-Za-z0-9]{20,}"),
            ("GitHub Personal Token", r"(?:ghp|github_pat)_[A-Za-z0-9_]{20,}"),
            ("RSA/EC Private Key Header", r"^\s*-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
        ]
        
        import re
        scan_dirs = ["web", "system", "backend", "tools", "supabase"]
        extensions = {".html", ".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".sql"}
        
        for sdir in scan_dirs:
            full_dir = os.path.join(self.project_root, sdir)
            if not os.path.exists(full_dir):
                continue
            def walk_error(_error):
                results["read_errors"] += 1
            for root, _, files in os.walk(full_dir, onerror=walk_error):
                if any(ignored in root for ignored in [".next", "node_modules", ".temp", "__pycache__", "dist"]):
                    continue
                for fname in files:
                    if fname.startswith(".env"):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in extensions:
                        fpath = os.path.join(root, fname)
                        if os.path.islink(fpath):
                            continue
                        try:
                            with open(fpath, "r", encoding="utf-8") as f:
                                for line_no, line in enumerate(f, 1):
                                    for rule_name, pat in forbidden_patterns:
                                        if re.search(pat, line):
                                            results["secrets_count"] += 1
                                            results["findings"].append({
                                                "rule": rule_name,
                                                "file": os.path.relpath(fpath, self.project_root),
                                                "line": line_no
                                            })
                            results["files_scanned"] += 1
                        except (OSError, UnicodeError):
                            results["read_errors"] += 1

        if results["secrets_count"] > 0:
            results["status"] = "warning"
        if results["read_errors"] or results["files_scanned"] == 0:
            results["status"] = "incomplete"
            results["error_message"] = "部分來源無法讀取或沒有掃描檔案"

        return results

    def generate_markdown_report(self, sast_res: Dict[str, Any], sca_res: Dict[str, Any], secret_res: Dict[str, Any]) -> str:
        """產出技術掃描報告；未完成項目必須顯示，不推導 ISO 符合性。"""
        labels = {"passed": "本次範圍未檢出問題", "warning": "有發現，待評估處理", "incomplete": "未完成，不可判定通過", "error": "工具失敗，不可判定通過"}
        status_badge = labels[self.overall_status(sast_res, sca_res, secret_res)]
        def label(result):
            return labels.get(result.get("status"), labels["incomplete"])
        
        lines = [
            "# 技術資安掃描報告",
            f"- **稽核時間**：`{self.report_time}`",
            f"- **專案名稱**：臺北農產 中央戰情室暨巡檢系統",
            f"- **總體狀態**：{status_badge}",
            "- **符合性界線**：本報告不判定 ISO/IEC 27001 符合性，也不構成認證或完整 ISMS 稽核。",
            "- **範圍限制**：pip-audit 檢查執行此工具的 Python 環境，不代表專案鎖檔、npm、Deno 或正式部署套件。機密檢查使用內建規則，不讀取 .env 類檔案。",
            "",
            "---",
            "",
            "## 📊 稽核項目總覽",
            "",
            "| 檢測維度 | 檢測工具 | 檢測範圍 | 結果 | 風險狀態 |",
            "| :--- | :--- | :--- | :--- | :--- |",
            f"| SAST | Bandit（實際安裝版本） | `backend/`, `tools/` | High: {sast_res.get('high_issues', 0)}, Med: {sast_res.get('medium_issues', 0)}, Low: {sast_res.get('low_issues', 0)} | {label(sast_res)} |",
            f"| SCA | pip-audit（實際安裝版本） | 目前 Python 環境 | 已回報弱點: {sca_res.get('vulnerabilities_count', 0)} | {label(sca_res)} |",
            f"| 機密規則 | builtin-secret-rules | `web/`, `system/`, `backend/`, `tools/`, `supabase/` | 已回報命中: {secret_res.get('secrets_count', 0)} | {label(secret_res)} |",
            "",
            "---",
            "",
            "## 證據用途",
            "- 可作為弱點管理、安全開發與安全測試的部分證據；控制適用性、實施與有效性仍須另行評估。",
            "- 掃描未檢出不代表杜絕注入、機密外洩或其他攻擊；應另保留審查、修補、重測與正式環境驗證紀錄。",
            ""
        ]
        for result in (sast_res, sca_res, secret_res):
            if result.get("error_message"):
                lines.append(f"- 未完成說明（{result.get('tool', 'unknown')}）：{result['error_message']}")
        
        if sast_res.get("findings"):
            lines.append("### 🔍 SAST 程式弱點清單")
            for item in sast_res["findings"]:
                lines.append(f"- `[{item['severity']}]` **{item['file']}:{item['line']}** - {item['text']} (`{item['test_id']}`)")
            lines.append("")

        if sca_res.get("vulnerabilities"):
            lines.append("### ⚠️ SCA 套件弱點清單")
            for v in sca_res["vulnerabilities"]:
                lines.append(f"- **{v['package']} (v{v['version']})** - 公告: `{v['id']}` (已知修補版本: {', '.join(v.get('fix_versions', [])) or '未提供，需追蹤上游與評估緩解措施'})")
            lines.append("")

        if secret_res.get("findings"):
            lines.append("### 🚨 疑似密鑰外洩清單")
            for f in secret_res["findings"]:
                lines.append(f"- **{f['rule']}** 於檔案 `{f['file']}:{f['line']}`")
            lines.append("")

        return "\n".join(lines)

    def run_all(self, output_dir: str = ".") -> int:
        start_t = time.perf_counter()
        
        sast = self.run_bandit_sast(["backend", "tools"])
        sca = self.run_pip_audit_sca()
        secret = self.run_secret_detection()
        
        md_content = self.generate_markdown_report(sast, sca, secret)
        json_content = {
            "generated_at": self.report_time,
            "overall_status": self.overall_status(sast, sca, secret),
            "iso27001_conformance": "not_assessed",
            "sast": sast,
            "sca": sca,
            "secret_scan": secret
        }
        
        os.makedirs(output_dir, exist_ok=True)
        md_file = os.path.join(output_dir, "security_audit_report.md")
        json_file = os.path.join(output_dir, "security_audit_report.json")
        
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(md_content)
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(json_content, f, ensure_ascii=False, indent=2)
            
        elapsed_sec = time.perf_counter() - start_t
        print("\n" + "=" * 60)
        print(f"技術掃描結果：{json_content['overall_status']}；ISO 符合性未評估。耗時: {elapsed_sec:.2f} 秒")
        print(f"📄 Markdown 報告已產出: {md_file}")
        print(f"📊 JSON 稽核報告已產出: {json_file}")
        print("=" * 60)
        
        # 終端機摘要
        print(f"• Bandit SAST: High: {sast.get('high_issues', 0)}, Med: {sast.get('medium_issues', 0)}, Low: {sast.get('low_issues', 0)}")
        print(f"• pip-audit SCA: {sca.get('vulnerabilities_count', 0)} 個 CVE 漏洞")
        print(f"• Secret Scan: {secret.get('secrets_count', 0)} 筆未排除金鑰")
        
        return 0 if json_content["overall_status"] == "passed" else 1


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    runner = SecurityAuditRunner(root)
    sys.exit(runner.run_all(os.path.join(root, "docs")))

if __name__ == "__main__":
    main()

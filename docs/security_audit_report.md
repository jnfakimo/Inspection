# 歷史技術掃描報告（原標題與符合性結論已更正）

> **2026-10-24 更正**：下列 2026-09-17 結果僅是當時的技術掃描紀錄，不構成 ISO/IEC 27001 符合性判定。原「合規」結論撤回；原始掃描時間與問題明細保留，未重跑或改寫成今日結果。原文控制對應與「杜絕」等說明不得當作控制有效性的證據。現行導入基準見 [ISO27001_BASELINE.md](ISO27001_BASELINE.md)。
- **稽核時間**：`2026-09-17 05:57:56 UTC`
- **專案名稱**：臺北農產 中央戰情室暨巡檢系統
- **總體狀態**：歷史技術掃描結果；ISO/IEC 27001 符合性未評估

---

## 📊 稽核項目總覽

| 檢測維度 | 檢測工具 | 檢測範圍 | 結果 | 風險狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **SAST 靜態代碼分析** | Bandit v1.9.4 | `backend/`, `tools/` | High: 0, Med: 0, Low: 64 | ✅ 通過 |
| **SCA 相依套件檢測** | pip-audit v2.10.1 | Python 第三方環境套件 | 發現 CVE 漏洞數: 0 | ✅ 安全 |
| **Secret 憑證防外洩** | detect-secrets | `web/`, `backend/`, `tools/`, `system/` | 敏感金鑰殘留: 0 筆 | ✅ 乾淨 |

---

## 🛡️ ISO 27001 安全控制對應說明 (Annex A Controls)
- **A.8.25 安全開發生命週期 (Secure Development Lifecycle)**：已於代碼庫整合 Bandit SAST 靜態分析，杜絕注入攻擊與硬編碼漏洞。
- **A.8.28 安全編碼 (Secure Coding)**：落實敏感資料去識別化、密鑰自環境變數注入與嚴格型別校驗。
- **A.8.30 外部套件安全 (Security in Third-Party Components)**：透過 pip-audit 定期比對 CVE 漏洞庫，防範供應鏈攻擊。

### 🔍 SAST 程式弱點清單
- `[LOW]` **backend\signal-service\demo.py:7** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **backend\signal-service\demo.py:43** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **backend\signal-service\tests\test_service.py:37** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:38** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:39** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:40** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:41** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:43** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:45** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:53** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:54** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:55** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:58** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:59** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:60** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:66** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:72** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:73** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:81** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:90** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **backend\signal-service\tests\test_service.py:97** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\build_webclip.py:25** - Using escape to parse untrusted XML data is known to be vulnerable to XML attacks. Replace escape with the equivalent defusedxml package, or make sure defusedxml.defuse_stdlib() is called. (`B406`)
- `[LOW]` **tools\findtag-visible-probe.py:15** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\findtag-visible-probe.py:84** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\findtag-visible-probe.test.py:8** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\findtag-visible-probe.test.py:12** - Using xml.etree.ElementTree to parse untrusted XML data is known to be vulnerable to XML attacks. Replace xml.etree.ElementTree with the equivalent defusedxml package, or make sure defusedxml.defuse_stdlib() is called. (`B405`)
- `[LOW]` **tools\findtag-visible-probe.test.py:37** - Possible hardcoded password: 'false' (`B105`)
- `[LOW]` **tools\gmail-repair.test.py:8** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\gmail-repair.test.py:16** - Possible hardcoded password: 'abcd efgh ijkl mnop' (`B105`)
- `[LOW]` **tools\gmail-repair.test.py:30** - Possible hardcoded password: 'abcdefghijklmnop' (`B105`)
- `[LOW]` **tools\gmail-repair.test.py:31** - Possible hardcoded password: 'ordinary-password' (`B105`)
- `[LOW]` **tools\gmail-repair.test.py:32** - Possible hardcoded password: 'abcdefghijklmnop' (`B105`)
- `[LOW]` **tools\gmail-repair.test.py:167** - Starting a process with a partial executable path (`B607`)
- `[LOW]` **tools\gmail-repair.test.py:167** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\gmail-repair.test.py:180** - Starting a process with a partial executable path (`B607`)
- `[LOW]` **tools\gmail-repair.test.py:180** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\inspect-local-cutover.py:7** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\inspect-local-cutover.py:25** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\local-cutover-check.test.py:8** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\local-cutover-check.test.py:174** - Starting a process with a partial executable path (`B607`)
- `[LOW]` **tools\local-cutover-check.test.py:174** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\local-cutover-check.test.py:186** - Starting a process with a partial executable path (`B607`)
- `[LOW]` **tools\local-cutover-check.test.py:186** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\repair-local-gmail.py:10** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\repair-local-gmail.py:24** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\security_audit_runner.py:10** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\security_audit_runner.py:47** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\security_audit_runner.py:84** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\security_audit_runner.py:169** - Try, Except, Pass detected. (`B110`)
- `[LOW]` **tools\wsl-edge-repair-check.py:10** - Consider possible security implications associated with the subprocess module. (`B404`)
- `[LOW]` **tools\wsl-edge-repair-check.py:16** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:107** - subprocess call - check for execution of untrusted input. (`B603`)
- `[LOW]` **tools\wsl-edge-repair-check.py:109** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:113** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:115** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:117** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:119** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:122** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:124** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:126** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:129** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:130** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:131** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)
- `[LOW]` **tools\wsl-edge-repair-check.py:132** - Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. (`B101`)

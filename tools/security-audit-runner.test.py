"""離線回歸：工具未執行或結果不完整時，報告與結束碼不可宣稱通過。"""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('security_audit_runner', Path(__file__).with_name('security_audit_runner.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'backend').mkdir()
        self.runner = module.SecurityAuditRunner(str(self.root))

    def run_with(self, method, result=None, error=None):
        with patch.object(module.subprocess, 'run', return_value=result, side_effect=error):
            return method()

    def proc(self, data, code=0):
        return subprocess.CompletedProcess([], code, json.dumps(data), '')

    def test_unavailable_tool_is_error(self):
        for method in (lambda: self.runner.run_bandit_sast(['backend']), self.runner.run_pip_audit_sca):
            result = self.run_with(method, error=FileNotFoundError('unavailable'))
            self.assertEqual(result['status'], 'error')

    def test_timeout_is_error(self):
        result = self.run_with(self.runner.run_pip_audit_sca, error=subprocess.TimeoutExpired('audit', 600))
        self.assertEqual(result['status'], 'error')

    def test_empty_and_invalid_outputs_fail(self):
        for output in ('', 'not json', '{}', 'null', '[]'):
            for method in (lambda: self.runner.run_bandit_sast(['backend']), self.runner.run_pip_audit_sca):
                with self.subTest(output=output):
                    result = self.run_with(method, subprocess.CompletedProcess([], 0, output, ''))
                    self.assertEqual(result['status'], 'error')

    def test_bandit_missing_target_is_incomplete(self):
        self.assertEqual(self.runner.run_bandit_sast(['absent'])['status'], 'incomplete')

    def bandit_data(self):
        return {'metrics': {'_totals': {'loc': 20, 'SEVERITY.HIGH': 0, 'SEVERITY.MEDIUM': 0, 'SEVERITY.LOW': 0}}, 'results': [], 'errors': []}

    def test_clean_bandit_is_passed(self):
        result = self.run_with(lambda: self.runner.run_bandit_sast(['backend']), self.proc(self.bandit_data()))
        self.assertEqual(result['status'], 'passed')

    def test_bandit_parse_error_and_no_lines_are_not_clean(self):
        for value in ('parse_error', 'no_lines'):
            data = self.bandit_data()
            if value == 'parse_error': data['errors'] = [{'reason': 'syntax error'}]
            else: data['metrics']['_totals']['loc'] = 0
            result = self.run_with(lambda: self.runner.run_bandit_sast(['backend']), self.proc(data))
            self.assertEqual(result['status'], 'error')

    def test_bandit_medium_is_warning(self):
        data = self.bandit_data()
        data['metrics']['_totals']['SEVERITY.MEDIUM'] = 1
        data['results'] = [{'issue_severity': 'MEDIUM', 'filename': str(self.root/'backend/a.py'), 'line_number': 1}]
        result = self.run_with(lambda: self.runner.run_bandit_sast(['backend']), self.proc(data, 1))
        self.assertEqual(result['status'], 'warning')

    def test_pip_clean_supported_formats(self):
        packages = [{'name': 'synthetic', 'version': '1', 'vulns': []}]
        for data in (packages, {'dependencies': packages}):
            self.assertEqual(self.run_with(self.runner.run_pip_audit_sca, self.proc(data))['status'], 'passed')

    def test_pip_warning_no_fix_and_skipped_package(self):
        packages = [{'name': 'synthetic', 'version': '1', 'vulns': [{'id': 'TEST-1', 'fix_versions': []}]}]
        result = self.run_with(self.runner.run_pip_audit_sca, self.proc({'dependencies': packages}, 1))
        self.assertEqual(result['status'], 'warning')
        report = self.runner.generate_markdown_report({'status': 'passed'}, result, {'status': 'passed'})
        self.assertIn('未提供，需追蹤上游', report)
        packages.append({'name': 'local-package', 'skip_reason': 'not available'})
        result = self.run_with(self.runner.run_pip_audit_sca, self.proc({'dependencies': packages}, 1))
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['vulnerabilities_count'], 1)

    def test_exit_failure_with_plausible_clean_json_is_not_passed(self):
        for code in (1, 2):
            data = {'dependencies': [{'name': 'synthetic', 'vulns': []}]}
            self.assertEqual(self.run_with(self.runner.run_pip_audit_sca, self.proc(data, code))['status'], 'error')

    def test_source_scan_empty_unreadable_and_env_exclusion(self):
        self.assertEqual(self.runner.run_secret_detection()['status'], 'incomplete')
        (self.root/'backend/safe.py').write_text('print(1)', encoding='utf-8')
        (self.root/'backend/.env.json').write_bytes(b'\xff')
        result = self.runner.run_secret_detection()
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['files_scanned'], 1)
        (self.root/'backend/broken.py').write_bytes(b'\xff')
        self.assertEqual(self.runner.run_secret_detection()['status'], 'incomplete')

    def test_secret_detection_reports_location_without_secret(self):
        value = 'gh' + 'p_' + 'x'*30
        (self.root/'backend/synthetic.py').write_text('token='+repr(value), encoding='utf-8')
        result = self.runner.run_secret_detection()
        self.assertEqual(result['status'], 'warning')
        self.assertEqual(result['secrets_count'], 1)
        self.assertNotIn(value, json.dumps(result))

    def test_report_does_not_assert_conformance(self):
        report = self.runner.generate_markdown_report(*[{'status': 'passed'}]*3)
        self.assertNotIn('COMPLIANT', report)
        self.assertIn('不判定 ISO/IEC 27001 符合性', report)
        self.assertNotIn('detect-secrets', report)
        report = self.runner.generate_markdown_report({'status': 'error'}, {'status': 'passed'}, {'status': 'passed'})
        self.assertIn('未完成，不可判定通過', report)

    def test_run_all_fails_closed_and_records_not_assessed(self):
        for state, expected in [('error', 1), ('incomplete', 1), ('warning', 1), ('passed', 0)]:
            with patch.object(self.runner, 'run_bandit_sast', return_value={'status': state}), patch.object(self.runner, 'run_pip_audit_sca', return_value={'status': 'passed'}), patch.object(self.runner, 'run_secret_detection', return_value={'status': 'passed'}):
                self.assertEqual(self.runner.run_all(str(self.root/'reports')), expected)
                report = json.loads((self.root/'reports/security_audit_report.json').read_text(encoding='utf-8'))
                self.assertEqual(report['iso27001_conformance'], 'not_assessed')


if __name__ == '__main__':
    unittest.main()

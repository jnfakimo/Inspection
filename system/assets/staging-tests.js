/**
 * Staging 環境自動化測試套件
 * 在瀏覽器控制台運行測試
 */

(function () {
  'use strict';

  const TESTS = {};
  let testResults = [];

  // 測試助手函數
  const assert = {
    ok: (value, message) => {
      if (!value) throw new Error(`FAIL: ${message}`);
      return true;
    },
    equal: (actual, expected, message) => {
      if (actual !== expected) {
        throw new Error(`FAIL: ${message} (expected ${expected}, got ${actual})`);
      }
      return true;
    },
    notEqual: (actual, expected, message) => {
      if (actual === expected) {
        throw new Error(`FAIL: ${message} (should not be ${expected})`);
      }
      return true;
    },
    contains: (haystack, needle, message) => {
      if (!haystack || !haystack.includes(needle)) {
        throw new Error(`FAIL: ${message}`);
      }
      return true;
    },
    throws: (fn, message) => {
      try {
        fn();
        throw new Error(`FAIL: ${message} (expected error but none was thrown)`);
      } catch (e) {
        if (e.message.includes('FAIL:')) throw e;
        return true;
      }
    },
  };

  // 日誌輸出
  const log = {
    pass: (test, message) => {
      console.log(`✅ PASS: ${test} - ${message}`);
      testResults.push({ test, status: 'PASS', message });
    },
    fail: (test, message) => {
      console.error(`❌ FAIL: ${test} - ${message}`);
      testResults.push({ test, status: 'FAIL', message });
    },
    info: (message) => {
      console.log(`ℹ️  ${message}`);
    },
  };

  // ============================================
  // Phase 1: 全局依賴測試
  // ============================================
  TESTS['1.1-dependencies'] = () => {
    log.info('Testing global dependencies...');

    // Supabase
    assert.ok(window.supabase, 'Supabase SDK loaded');

    // Security managers
    assert.ok(window.csrfManager, 'csrfManager available');
    assert.ok(window.validateInput, 'validateInput available');
    assert.ok(window.cacheManager, 'cacheManager available');
    assert.ok(window.paginationManager, 'paginationManager available');
    assert.ok(window.perfMonitor, 'perfMonitor available');

    log.pass('1.1-dependencies', 'All dependencies loaded');
  };

  // ============================================
  // Phase 2: CSRF Token 測試
  // ============================================
  TESTS['2.1-csrf-generation'] = () => {
    log.info('Testing CSRF token generation...');

    const token = csrfManager.getToken();
    assert.ok(token, 'Token generated');
    assert.ok(token.length === 64, 'Token is 64 characters');
    assert.contains(token, /^[a-f0-9]{64}$/, 'Token is hex string');

    log.pass('2.1-csrf-generation', 'CSRF token generated correctly');
  };

  TESTS['2.2-csrf-persistence'] = () => {
    log.info('Testing CSRF token persistence...');

    const token1 = csrfManager.getToken();
    const token2 = csrfManager.getToken();

    assert.equal(token1, token2, 'Token persists in session');

    log.pass('2.2-csrf-persistence', 'CSRF token persists');
  };

  TESTS['2.3-csrf-in-request'] = () => {
    log.info('Testing CSRF token in request...');

    const record = { name: 'Test', status: 'ACTIVE' };
    const withCsrf = csrfManager.addToRequest(record);

    assert.ok(withCsrf._csrf_token, 'CSRF token added to request');
    assert.ok(withCsrf.name === 'Test', 'Original data preserved');

    log.pass('2.3-csrf-in-request', 'CSRF token correctly added to requests');
  };

  // ============================================
  // Phase 3: 輸入驗證測試
  // ============================================
  TESTS['3.1-email-validation'] = () => {
    log.info('Testing email validation...');

    // 有效郵箱
    try {
      validateInput.email('test@example.com');
      log.pass('3.1-email-validation', 'Valid email accepted');
    } catch (e) {
      log.fail('3.1-email-validation', `Valid email rejected: ${e.message}`);
    }

    // 無效郵箱
    assert.throws(
      () => validateInput.email('invalid-email'),
      'Invalid email rejected'
    );
  };

  TESTS['3.2-date-validation'] = () => {
    log.info('Testing date validation...');

    // 有效日期
    try {
      validateInput.date('2026-07-05');
      log.pass('3.2-date-validation', 'Valid date accepted');
    } catch (e) {
      log.fail('3.2-date-validation', `Valid date rejected: ${e.message}`);
    }

    // 未來日期
    assert.throws(
      () => validateInput.date('2099-12-31'),
      'Future date rejected'
    );
  };

  TESTS['3.3-date-range-validation'] = () => {
    log.info('Testing date range validation...');

    // 有效範圍
    try {
      validateInput.dateRange('2026-06-01', '2026-07-05');
      log.pass('3.3-date-range-validation', 'Valid date range accepted');
    } catch (e) {
      log.fail('3.3-date-range-validation', `Valid range rejected: ${e.message}`);
    }

    // 超過 365 天
    assert.throws(
      () => validateInput.dateRange('2025-01-01', '2026-12-31'),
      'Range > 365 days rejected'
    );
  };

  TESTS['3.4-sql-injection-detection'] = () => {
    log.info('Testing SQL injection detection...');

    const payloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "1; DELETE FROM users;",
      "admin' --",
    ];

    let detected = 0;
    payloads.forEach((payload) => {
      try {
        validateInput.noSqlInjection(payload);
        log.fail('3.4-sql-injection-detection', `Payload not detected: ${payload}`);
      } catch (e) {
        detected++;
      }
    });

    assert.equal(detected, payloads.length, 'All SQL injection payloads detected');
    log.pass('3.4-sql-injection-detection', 'SQL injection detection working');
  };

  TESTS['3.5-xss-detection'] = () => {
    log.info('Testing XSS detection...');

    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror="alert(\'XSS\')">',
      '<svg/onload="alert(\'XSS\')">',
      'javascript:alert("XSS")',
    ];

    let detected = 0;
    xssPayloads.forEach((payload) => {
      try {
        validateInput.noXss(payload);
        log.fail('3.5-xss-detection', `Payload not detected: ${payload}`);
      } catch (e) {
        detected++;
      }
    });

    assert.equal(detected, xssPayloads.length, 'All XSS payloads detected');
    log.pass('3.5-xss-detection', 'XSS detection working');
  };

  // ============================================
  // Phase 4: 緩存測試
  // ============================================
  TESTS['4.1-cache-set-get'] = () => {
    log.info('Testing cache set/get...');

    const testData = { id: 1, name: 'Test Equipment' };
    cacheManager.set('test_equipment', testData);
    const retrieved = cacheManager.get('test_equipment');

    assert.equal(JSON.stringify(retrieved), JSON.stringify(testData), 'Cache data matches');
    log.pass('4.1-cache-set-get', 'Cache set/get working');
  };

  TESTS['4.2-cache-delete'] = () => {
    log.info('Testing cache delete...');

    cacheManager.set('to_delete', 'value');
    assert.ok(cacheManager.get('to_delete'), 'Item exists');

    cacheManager.delete('to_delete');
    assert.equal(cacheManager.get('to_delete'), null, 'Item deleted');

    log.pass('4.2-cache-delete', 'Cache delete working');
  };

  // ============================================
  // Phase 5: 分頁測試
  // ============================================
  TESTS['5.1-pagination-offset'] = () => {
    log.info('Testing pagination offset...');

    paginationManager.pageSize = 50;
    paginationManager.currentPage = 1;

    assert.equal(paginationManager.getOffset(), 0, 'Page 1 offset is 0');

    paginationManager.nextPage();
    assert.equal(paginationManager.currentPage, 2, 'Page incremented');
    assert.equal(paginationManager.getOffset(), 50, 'Page 2 offset is 50');

    paginationManager.prevPage();
    assert.equal(paginationManager.currentPage, 1, 'Page decremented');

    log.pass('5.1-pagination-offset', 'Pagination offset calculation working');
  };

  // ============================================
  // Phase 6: 性能監控測試
  // ============================================
  TESTS['6.1-perf-monitor'] = (callback) => {
    log.info('Testing performance monitoring...');

    perfMonitor.start('test_operation');

    setTimeout(() => {
      perfMonitor.end('test_operation');
      log.pass('6.1-perf-monitor', 'Performance monitoring working');
      if (callback) callback();
    }, 100);
  };

  // ============================================
  // 測試運行器
  // ============================================
  window.runStagingTests = async function (testName = null) {
    testResults = [];
    console.clear();
    console.log(
      '%c🧪 Staging 環境自動化測試\n',
      'font-size: 16px; font-weight: bold; color: #00d4ff;'
    );

    const testsToRun = testName ? [testName] : Object.keys(TESTS);
    let passCount = 0;
    let failCount = 0;

    for (const name of testsToRun) {
      try {
        const test = TESTS[name];
        if (!test) {
          console.error(`❌ Test not found: ${name}`);
          continue;
        }

        console.group(`\n▶️  ${name}`);

        // 異步測試
        if (test.length > 0) {
          await new Promise((resolve) => {
            const originalLog = { pass: log.pass, fail: log.fail };
            log.pass = (test, msg) => {
              originalLog.pass(test, msg);
              passCount++;
            };
            log.fail = (test, msg) => {
              originalLog.fail(test, msg);
              failCount++;
            };
            test(resolve);
          });
        } else {
          try {
            test();
            passCount++;
          } catch (e) {
            log.fail(name, e.message);
            failCount++;
          }
        }

        console.groupEnd();
      } catch (e) {
        console.error(`❌ Test error in ${name}:`, e.message);
        failCount++;
      }
    }

    // 摘要
    console.log(
      `\n%c📊 測試摘要\n✅ Pass: ${passCount} | ❌ Fail: ${failCount}`,
      'font-size: 14px; font-weight: bold; color: #00d4ff;'
    );

    return {
      total: passCount + failCount,
      passed: passCount,
      failed: failCount,
      results: testResults,
    };
  };

  // 便利功能
  window.runTest = (name) => window.runStagingTests(name);
  window.listTests = () => {
    console.log('Available tests:');
    Object.keys(TESTS).forEach((name) => console.log(`  - ${name}`));
  };

  console.log(
    '%c✅ Staging 測試加載完成\n使用 runStagingTests() 或 runTest(\'name\') 運行測試',
    'color: #00d4ff; font-weight: bold;'
  );
})();

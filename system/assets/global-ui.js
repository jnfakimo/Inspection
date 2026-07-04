(function () {
  "use strict";

  var DEFAULT_DEPARTMENT = "未登入部門";
  var DEFAULT_ACCOUNT = "未登入帳號";
  var SUPABASE_URL = null;
  var SUPABASE_ANON_KEY = null;
  var dbClient = null;
  var configLoaded = false;

  // 員工帳號對應真實姓名（用於資料庫中 name 欄位為帳號編號時校正）
  var ACCOUNT_NAME_OVERRIDES = {
    "022443": "黃建發"
  };

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getSessionValue(key) {
    try {
      return clean(sessionStorage.getItem(key));
    } catch (err) {
      return "";
    }
  }

  function setSessionValue(key, value) {
    try {
      if (value) sessionStorage.setItem(key, value);
    } catch (err) {}
  }

  async function loadConfig() {
    if (configLoaded && SUPABASE_URL && SUPABASE_ANON_KEY) {
      return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
    }

    // Try to load from window globals first (set by deployment script)
    if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.key) {
      SUPABASE_URL = window.SUPABASE_CONFIG.url;
      SUPABASE_ANON_KEY = window.SUPABASE_CONFIG.key;
      configLoaded = true;
      return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
    }

    // Try to load from config.json (for development with local server)
    try {
      var response = await fetch('/config.json', { method: 'GET', credentials: 'same-origin' });
      if (response && response.ok) {
        var data = await response.json();
        if (data && data.supabase_url && data.supabase_anon_key) {
          SUPABASE_URL = data.supabase_url;
          SUPABASE_ANON_KEY = data.supabase_anon_key;
          configLoaded = true;
          return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
        }
      }
    } catch (err) {
      console.warn('Config loading error:', err);
    }

    configLoaded = true;
    return { url: null, key: null };
  }

  function dataClient() {
    if (window.db && window.db.from) return window.db;
    if (dbClient && dbClient.from) return dbClient;
    if (window.supabase && window.supabase.createClient) {
      try {
        dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.db = dbClient;
        return dbClient;
      } catch (err) {}
    }
    return null;
  }

  function readableAccount(profile) {
    var raw = clean(
      (profile && (profile.name || profile.displayName || profile.full_name || profile.username || profile.account || profile.email)) ||
      getSessionValue("user_name") ||
      getSessionValue("user_username") ||
      getSessionValue("user_account") ||
      getSessionValue("username") ||
      DEFAULT_ACCOUNT
    );
    return ACCOUNT_NAME_OVERRIDES[raw] || raw;
  }

  function readableDepartment(profile) {
    return clean(
      (profile && (profile.departmentName || profile.department || profile.dep)) ||
      getSessionValue("user_department") ||
      getSessionValue("department") ||
      DEFAULT_DEPARTMENT
    );
  }

  function currentProfileSnapshot() {
    var profile = {};
    try {
      if (window.currentUser && typeof window.currentUser === "object") {
        Object.assign(profile, window.currentUser);
      }
      if (window.me_ && typeof window.me_ === "object") {
        Object.assign(profile, window.me_);
      }
    } catch (err) {}
    return profile;
  }

  function render(profile) {
    var bar = document.getElementById("globalUserbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "globalUserbar";
      bar.className = "global-userbar";
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      document.body.insertBefore(bar, document.body.firstChild);
    }

    var department = readableDepartment(profile);
    var account = readableAccount(profile);
    bar.innerHTML =
      '<span class="global-userbar-label">登入者</span>' +
      '<span class="global-userbar-value">' + escapeHtml(department) + "</span>" +
      '<span class="global-userbar-sep">/</span>' +
      '<span class="global-userbar-account">' + escapeHtml(account) + "</span>";

    document.body.classList.add("global-userbar-ready");
    updateExistingUserSlots(department, account);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function updateExistingUserSlots(department, account) {
    ["navUser", "sidebarUser"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = department + " / " + account;
    });
  }

  async function fetchDepartmentPath(profile) {
    var db = dataClient();
    if (!db || !profile || !profile.dept_id) return "";
    try {
      var res = await db.from("departments").select("dept_id,name,parent_id").limit(1000);
      var rows = res && res.data ? res.data : [];
      var map = {};
      rows.forEach(function (d) { map[d.dept_id] = d; });
      var path = [];
      var cur = map[profile.dept_id];
      var guard = 0;
      while (cur && guard < 8) {
        path.unshift(cur.name);
        cur = map[cur.parent_id];
        guard += 1;
      }
      return clean(path.join(" / "));
    } catch (err) {
      return "";
    }
  }

  async function fetchProfileFromSupabase(seed) {
    var db = dataClient();
    if (!db || !db.auth || !db.from) return seed;
    var profile = Object.assign({}, seed);

    async function findUser(column, value) {
      value = clean(value);
      if (!value) return null;
      try {
        var res = await db
          .from("users")
          .select("user_id,username,email,name,dept_id,department,role,rbac_role,phone")
          .eq(column, value)
          .limit(1)
          .maybeSingle();
        return res && res.data ? res.data : null;
      } catch (err) {
        return null;
      }
    }

    try {
      var sessionRes = await db.auth.getSession();
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (session && session.user && session.user.id) {
        var byAuth = await findUser("auth_id", session.user.id);
        if (byAuth) profile = Object.assign(profile, byAuth);
      }
    } catch (err) {}

    if (!profile.name || !profile.department || !profile.dept_id) {
      var candidates = [
        ["user_id", profile.user_id || profile.id || getSessionValue("user_id")],
        ["username", profile.username || profile.account || getSessionValue("user_username") || getSessionValue("user_account") || getSessionValue("username")],
        ["email", profile.email || getSessionValue("user_email")]
      ];
      for (var i = 0; i < candidates.length; i += 1) {
        var found = await findUser(candidates[i][0], candidates[i][1]);
        if (found) {
          profile = Object.assign(profile, found);
          break;
        }
      }
    }

    if (!readableDepartment(profile) || readableDepartment(profile) === DEFAULT_DEPARTMENT) {
      var deptPath = await fetchDepartmentPath(profile);
      if (deptPath) profile.department = deptPath;
    }

    if (profile.username) setSessionValue("user_username", profile.username);
    if (profile.email) setSessionValue("user_email", profile.email);
    if (profile.name) {
      var mappedName = ACCOUNT_NAME_OVERRIDES[profile.name] || profile.name;
      setSessionValue("user_name", mappedName);
      profile.name = mappedName;
    }
    if (profile.user_id) setSessionValue("user_id", profile.user_id);
    if (profile.dept_id) setSessionValue("user_dept_id", profile.dept_id);
    if (profile.department) setSessionValue("user_department", profile.department);
    if (profile.phone) setSessionValue("user_phone", profile.phone);
    if (profile.role) setSessionValue("user_role", profile.role);
    if (profile.rbac_role) setSessionValue("user_rbac_role", profile.rbac_role);

    return profile;
  }

  async function refresh() {
    var seed = currentProfileSnapshot();
    seed.username = seed.username || getSessionValue("user_username");
    seed.department = seed.department || getSessionValue("user_department");
    render(seed);
    var profile = await fetchProfileFromSupabase(seed);
    render(profile);
  }

  // ========== 性能優化工具 ==========

  // 分頁管理器
  var paginationManager = {
    pageSize: 50,
    currentPage: 1,
    totalItems: 0,

    getOffset: function() {
      return (this.currentPage - 1) * this.pageSize;
    },

    nextPage: function() {
      this.currentPage++;
    },

    prevPage: function() {
      if (this.currentPage > 1) this.currentPage--;
    },

    reset: function() {
      this.currentPage = 1;
    }
  };

  // 緩存管理器
  var cacheManager = {
    cache: new Map(),
    ttl: 5 * 60 * 1000,

    set: function(key, value) {
      this.cache.set(key, { value: value, expiry: Date.now() + this.ttl });
    },

    get: function(key) {
      var item = this.cache.get(key);
      if (!item) return null;
      if (Date.now() > item.expiry) {
        this.cache.delete(key);
        return null;
      }
      return item.value;
    },

    delete: function(key) {
      this.cache.delete(key);
    },

    clear: function() {
      this.cache.clear();
    },

    setTtl: function(ttl) {
      this.ttl = ttl;
    }
  };

  // 性能監控
  var perfMonitor = {
    marks: {},

    start: function(name) {
      this.marks[name] = performance.now();
    },

    end: function(name) {
      if (this.marks[name]) {
        var duration = performance.now() - this.marks[name];
        console.log('[PERF] ' + name + ': ' + duration.toFixed(2) + 'ms');
        delete this.marks[name];
        return duration;
      }
      return 0;
    },

    measure: function(name, fn) {
      this.start(name);
      var result = fn();
      this.end(name);
      return result;
    }
  };

  window.paginationManager = paginationManager;
  window.cacheManager = cacheManager;
  window.perfMonitor = perfMonitor;

  // ========== 輸入驗證工具 ==========
  var validateInput = {
    email: function(email) {
      var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!re.test(email)) throw new Error('無效的郵件格式');
      if (email.length > 254) throw new Error('郵件過長');
      return true;
    },

    phone: function(phone) {
      var re = /^[\d\-\+\(\)\s]{8,20}$/;
      if (!re.test(phone)) throw new Error('無效的電話格式');
      return true;
    },

    date: function(dateStr) {
      var date = new Date(dateStr);
      if (isNaN(date.getTime())) throw new Error('無效的日期');
      if (date > new Date()) throw new Error('日期不能是未來');
      return true;
    },

    dateRange: function(from, to, maxDays) {
      maxDays = maxDays || 365;
      this.date(from);
      this.date(to);
      var fromDate = new Date(from);
      var toDate = new Date(to);
      if (fromDate > toDate) throw new Error('開始日期不能晚於結束日期');
      var days = (toDate - fromDate) / (1000 * 60 * 60 * 24);
      if (days > maxDays) throw new Error('範圍超過 ' + maxDays + ' 天');
      return true;
    },

    uuid: function(uuid) {
      var re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!re.test(uuid)) throw new Error('無效的 UUID');
      return true;
    },

    notEmpty: function(str, fieldName) {
      fieldName = fieldName || '字段';
      if (!str || !String(str).trim()) throw new Error(fieldName + '不能為空');
      return true;
    },

    length: function(str, min, max, fieldName) {
      fieldName = fieldName || '字段';
      var len = String(str).length;
      if (len < min || len > max) {
        throw new Error(fieldName + '長度需在 ' + min + '-' + max + ' 之間');
      }
      return true;
    },

    numberRange: function(num, min, max, fieldName) {
      fieldName = fieldName || '數字';
      var n = parseFloat(num);
      if (isNaN(n) || n < min || n > max) {
        throw new Error(fieldName + '需在 ' + min + '-' + max + ' 之間');
      }
      return true;
    },

    positive: function(num, fieldName) {
      fieldName = fieldName || '數字';
      if (parseFloat(num) <= 0) throw new Error(fieldName + '必須是正數');
      return true;
    },

    enum: function(value, allowedValues, fieldName) {
      fieldName = fieldName || '值';
      if (!allowedValues.includes(value)) {
        throw new Error(fieldName + '必須是 ' + allowedValues.join(', ') + ' 之一');
      }
      return true;
    },

    noSqlInjection: function(str) {
      var keywords = ['DROP', 'DELETE', 'TRUNCATE', 'UNION', 'SELECT'];
      var upper = String(str).toUpperCase();
      for (var i = 0; i < keywords.length; i++) {
        if (upper.indexOf(keywords[i]) !== -1) throw new Error('輸入包含不允許的關鍵字');
      }
      return true;
    },

    noXss: function(str) {
      var patterns = [/<script/i, /javascript:/i, /on\w+=/i];
      for (var i = 0; i < patterns.length; i++) {
        if (patterns[i].test(str)) throw new Error('輸入包含不允許的內容');
      }
      return true;
    }
  };

  window.validateInput = validateInput;

  // ========== CSRF 令牌管理 ==========
  var csrfManager = {
    tokenKey: 'X-CSRF-Token',
    tokenStorageKey: '_csrf_token',

    generateToken: function() {
      if (typeof crypto === 'undefined') {
        var timestamp = Date.now().toString(36);
        var randomStr = Math.random().toString(36).substr(2);
        return (timestamp + randomStr).substr(0, 64);
      }
      var array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return Array.from(array, function(byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    },

    getToken: function() {
      var token = sessionStorage.getItem(this.tokenStorageKey);
      if (!token) {
        token = this.generateToken();
        sessionStorage.setItem(this.tokenStorageKey, token);
      }
      return token;
    },

    addToRequest: function(data) {
      var result = {};
      if (data && typeof data === 'object') {
        Object.assign(result, data);
      }
      result._csrf_token = this.getToken();
      return result;
    }
  };

  window.csrfManager = csrfManager;

  async function boot() {
    if (!document.body) return;
    await loadConfig();
    csrfManager.getToken();
    render(currentProfileSnapshot());
    refresh();
    window.addEventListener("storage", refresh);
    setTimeout(refresh, 800);
    setTimeout(refresh, 2500);
  }

  window.escapeHtml = escapeHtml;
  window.loadConfig = loadConfig;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

(function () {
  "use strict";

  var DEFAULT_DEPARTMENT = "未登入部門";
  var DEFAULT_ACCOUNT = "未登入帳號";
  var SUPABASE_URL = "https://qztffronusdhgxhjjubt.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA";
  var dbClient = null;

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

  function boot() {
    if (!document.body) return;
    render(currentProfileSnapshot());
    refresh();
    window.addEventListener("storage", refresh);
    setTimeout(refresh, 800);
    setTimeout(refresh, 2500);
  }

  window.escapeHtml = escapeHtml;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

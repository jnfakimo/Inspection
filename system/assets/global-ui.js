(function () {
  "use strict";

  var DEFAULT_DEPARTMENT = "未登入部門";
  var DEFAULT_ACCOUNT = "未登入帳號";

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

  function readableAccount(profile) {
    return clean(
      (profile && (profile.name || profile.displayName || profile.full_name || profile.username || profile.account || profile.email)) ||
      getSessionValue("user_name") ||
      getSessionValue("user_username") ||
      getSessionValue("user_account") ||
      getSessionValue("username") ||
      DEFAULT_ACCOUNT
    );
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
    if (!window.db || !profile || !profile.dept_id) return "";
    try {
      var res = await window.db.from("departments").select("dept_id,name,parent_id").limit(1000);
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
    if (!window.db || !window.db.auth || !window.db.from) return seed;
    var profile = Object.assign({}, seed);
    try {
      var sessionRes = await window.db.auth.getSession();
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (session && session.user && session.user.id) {
        var userRes = await window.db
          .from("users")
          .select("user_id,username,email,name,dept_id,department,role,rbac_role,phone")
          .eq("auth_id", session.user.id)
          .limit(1)
          .maybeSingle();
        if (userRes && userRes.data) profile = Object.assign(profile, userRes.data);
      }
    } catch (err) {}

    if (!profile.user_id && profile.username && window.db && window.db.from) {
      try {
        var byName = await window.db
          .from("users")
          .select("user_id,username,email,name,dept_id,department,role,rbac_role,phone")
          .eq("username", profile.username)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        if (byName && byName.data) profile = Object.assign(profile, byName.data);
      } catch (err) {}
    }

    if (!readableDepartment(profile) || readableDepartment(profile) === DEFAULT_DEPARTMENT) {
      var deptPath = await fetchDepartmentPath(profile);
      if (deptPath) profile.department = deptPath;
    }

    if (profile.username) setSessionValue("user_username", profile.username);
    if (profile.name) setSessionValue("user_name", profile.name);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

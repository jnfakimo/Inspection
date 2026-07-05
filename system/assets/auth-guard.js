/**
 * 認證守護 - 全局認證和會話管理
 * Authentication Guard - Global auth and session management
 *
 * 功能:
 * - 檢查用戶登入狀態
 * - 管理會話和 Token
 * - 防止未認證訪問
 * - 自動登出超時會話
 */

(function () {
  'use strict';

  // 配置
  const CONFIG = {
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 分鐘
    CHECK_INTERVAL: 5 * 60 * 1000,   // 5 分鐘檢查一次
    LOGIN_PAGE: 'login.html',
    PUBLIC_PAGES: ['login.html', 'index.html'] // 公開頁面
  };

  class AuthGuard {
    constructor() {
      this.db = null;
      this.user = null;
      this.sessionToken = null;
      this.lastActivity = Date.now();
      this.init();
    }

    /**
     * 初始化認證守護
     */
    async init() {
      // 檢查是否為公開頁面
      if (this.isPublicPage()) {
        console.log('📄 公開頁面 - 無需認證');
        return;
      }

      // 初始化 Supabase
      await this.initSupabase();

      // 檢查登入狀態
      const isAuthenticated = await this.checkAuth();

      if (!isAuthenticated) {
        console.warn('🚫 未登入 - 重定向到登入頁面');
        this.redirectToLogin('認證過期或未登入');
        return;
      }

      // 設置事件監聽
      this.setupEventListeners();

      // 啟動會話監控
      this.startSessionMonitor();

      console.log('✅ 認證成功 - 用戶已登入');
    }

    /**
     * 檢查是否為公開頁面
     */
    isPublicPage() {
      const currentPage = window.location.pathname.split('/').pop() || 'index.html';
      return CONFIG.PUBLIC_PAGES.includes(currentPage);
    }

    /**
     * 初始化 Supabase
     */
    async initSupabase() {
      try {
        // 從全局配置或 config.json 加載
        let SUPABASE_URL = null;
        let SUPABASE_ANON_KEY = null;

        if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.key) {
          SUPABASE_URL = window.SUPABASE_CONFIG.url;
          SUPABASE_ANON_KEY = window.SUPABASE_CONFIG.key;
        } else {
          const response = await fetch('/config.json', { method: 'GET', credentials: 'same-origin' });
          if (response && response.ok) {
            const data = await response.json();
            SUPABASE_URL = data.supabase_url;
            SUPABASE_ANON_KEY = data.supabase_anon_key;
          }
        }

        if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
          this.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
      } catch (err) {
        console.error('❌ Supabase 初始化失敗:', err);
        throw err;
      }
    }

    /**
     * 檢查認證狀態
     */
    async checkAuth() {
      if (!this.db) return false;

      try {
        // 獲取當前會話
        const { data: { session }, error } = await this.db.auth.getSession();

        if (error || !session) {
          console.warn('❌ 沒有活動會話:', error);
          return false;
        }

        this.sessionToken = session.access_token;
        this.user = session.user;

        // 驗證會話有效性
        const isValid = this.validateSession();
        if (!isValid) {
          await this.logout('會話過期');
          return false;
        }

        return true;
      } catch (err) {
        console.error('❌ 認證檢查失敗:', err);
        return false;
      }
    }

    /**
     * 驗證會話有效性
     */
    validateSession() {
      if (!this.sessionToken || !this.user) return false;

      // 檢查會話是否超時
      const timeSinceLastActivity = Date.now() - this.lastActivity;
      if (timeSinceLastActivity > CONFIG.SESSION_TIMEOUT) {
        console.warn('⏱️  會話超時');
        return false;
      }

      return true;
    }

    /**
     * 設置事件監聽 - 監控用戶活動
     */
    setupEventListeners() {
      const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

      activityEvents.forEach(event => {
        document.addEventListener(event, () => {
          this.lastActivity = Date.now();
        });
      });

      // 監聽頁面隱藏/顯示
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.checkAuth().catch(err => {
            console.error('❌ 返回頁面時認證失敗:', err);
            this.redirectToLogin('會話已過期，請重新登入');
          });
        }
      });

      // 監聽登出事件
      window.addEventListener('storage', (e) => {
        if (e.key === 'auth_logout' && e.newValue === 'true') {
          console.log('🚪 檢測到登出事件 - 重定向到登入頁面');
          this.redirectToLogin('在其他標籤頁已登出');
        }
      });
    }

    /**
     * 啟動會話監控
     */
    startSessionMonitor() {
      // 定期檢查會話有效性
      setInterval(async () => {
        const isValid = await this.checkAuth();
        if (!isValid) {
          this.redirectToLogin('會話已過期，請重新登入');
        }
      }, CONFIG.CHECK_INTERVAL);
    }

    /**
     * 重定向到登入頁面
     */
    redirectToLogin(reason = '') {
      // 保存重定向原因到 sessionStorage
      if (reason) {
        sessionStorage.setItem('auth_redirect_reason', reason);
      }

      // 保存當前 URL，登入後可返回
      const returnUrl = window.location.pathname + window.location.search;
      sessionStorage.setItem('auth_return_url', returnUrl);

      // 延遲重定向，確保 sessionStorage 已保存
      setTimeout(() => {
        window.location.href = CONFIG.LOGIN_PAGE;
      }, 100);
    }

    /**
     * 登出用戶
     */
    async logout(reason = '') {
      try {
        if (this.db) {
          await this.db.auth.signOut();
        }

        // 清除會話數據
        sessionStorage.clear();
        localStorage.removeItem('auth_token');

        // 發送登出事件給其他標籤頁
        localStorage.setItem('auth_logout', 'true');
        setTimeout(() => localStorage.removeItem('auth_logout'), 100);

        console.log('✅ 用戶已登出:', reason);
        this.redirectToLogin(reason || '已登出');
      } catch (err) {
        console.error('❌ 登出失敗:', err);
        this.redirectToLogin('登出失敗');
      }
    }

    /**
     * 獲取當前用戶信息
     */
    getCurrentUser() {
      return this.user;
    }

    /**
     * 獲取會話 Token
     */
    getSessionToken() {
      return this.sessionToken;
    }

    /**
     * 驗證用戶是否有特定權限
     */
    async hasPermission(permission) {
      if (!this.user) return false;

      try {
        const { data, error } = await this.db
          .from('users')
          .select('permissions')
          .eq('auth_id', this.user.id)
          .single();

        if (error || !data) return false;

        const permissions = data.permissions || {};
        return permissions[permission] === true;
      } catch (err) {
        console.error('❌ 權限檢查失敗:', err);
        return false;
      }
    }

    /**
     * 檢查用戶角色
     */
    async hasRole(role) {
      if (!this.user) return false;

      try {
        const { data, error } = await this.db
          .from('users')
          .select('role,rbac_role')
          .eq('auth_id', this.user.id)
          .single();

        if (error || !data) return false;

        return data.role === role || data.rbac_role === role;
      } catch (err) {
        console.error('❌ 角色檢查失敗:', err);
        return false;
      }
    }
  }

  // 全局暴露
  window.authGuard = new AuthGuard();
})();

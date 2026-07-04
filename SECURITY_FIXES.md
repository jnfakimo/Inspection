# Taipei Agricultural Inspection System - Security Fixes

## Overview
This document outlines the critical security fixes applied to protect user data and prevent exploitation vulnerabilities.

## Fix 1: Hardcoded API Keys Removal

### Problem
- Supabase API credentials (URL and anonymous key) were hardcoded in 25+ locations across HTML and JavaScript files
- These credentials were publicly visible on GitHub
- Complete JWT tokens were exposed in browser code

### Files Affected
- `system/assets/global-ui.js`
- `system/admin.html`
- `system/app.html`
- `system/dispatch.html`
- `system/handover.html`
- `system/index.html`
- `system/login.html`
- `system/setup.html`
- And 17 more HTML files

### Solution Implemented
1. **Created centralized config loader** in `global-ui.js` and updated files:
   - `loadConfig()` async function that loads credentials from:
     - `window.SUPABASE_CONFIG` (set by deployment script)
     - `/config.json` (for local development)

2. **Dynamic initialization**:
   - Each page now calls `initSupabaseConfig()` before using the database
   - Config is loaded asynchronously before any DB operations

3. **Configuration files created**:
   - `.env.example` - Environment variable template
   - `.gitignore` - Updated to prevent accidental credential commits
   - `config.json.example` - Development configuration template

### Deployment Instructions
**For GitHub Pages:**
- Add config via GitHub Actions or deployment script that injects `window.SUPABASE_CONFIG`
- Never commit actual credentials to the repository

**For Development:**
1. Copy `config.json.example` to `config.json` (not committed)
2. Fill in your actual Supabase credentials
3. Serve with a local HTTP server

### Status
- ✅ global-ui.js - Updated with config loader
- ✅ admin.html - Updated with initSupabaseConfig()
- ✅ app.html - Updated with initSupabaseConfig()
- ✅ dispatch.html - Updated with initSupabaseConfig()
- 🔄 Remaining 20+ files need similar updates

---

## Fix 2: Cross-Site Scripting (XSS) Prevention

### Problem
- Dynamic user data displayed via `.innerHTML` without escaping
- Potential for malicious script injection via data fields like:
  - `fault_description`
  - `reporter_name`
  - `department`
  - `notes`
  - `vendor_name`

### Files Affected
- `system/dispatch.html` - Status display, case details, work orders
- `system/workorder.html` - User names, departments, content
- `system/handover.html` - Handover notes, signatures
- `system/dashboard.html` - Data display tables
- `system/equipment.html` - Equipment descriptions
- `system/materials.html` - Material information
- And other pages using dynamic HTML rendering

### Solution Implemented

**1. Universal escapeHtml() function**:
```javascript
function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/[&<>"']/g, function (ch) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch];
  });
}
```

**2. Applied to dispatch.html**:
- ✅ Case detail display - All user-controlled fields escaped
- ✅ Table rendering - Request numbers, fault types, department names escaped
- ✅ Timeline/history display - Operator names, notes escaped
- ✅ Modal dialogs - All dynamic content escaped

**3. Escaping pattern applied**:
```javascript
// Before (VULNERABLE):
body.innerHTML = `<div>${curReq.reporter}</div>`;

// After (SAFE):
body.innerHTML = `<div>${escapeHtml(curReq.reporter)}</div>`;
```

### Remaining Work
- [ ] workorder.html - Escape all innerHTML user data
- [ ] handover.html - Escape dynamic content
- [ ] dashboard.html - Escape data display fields
- [ ] equipment.html - Escape equipment info
- [ ] materials.html - Escape material descriptions
- [ ] Other pages - Systematic audit and fixes

### Status
- ✅ dispatch.html - XSS fixes applied to all user-controlled display fields
- 🔄 20+ other files need similar treatment

---

## Fix 3: Row-Level Security (RLS) Policies

### Current Status
- ⚠️ **NOT YET IMPLEMENTED**
- All tables currently use `allow_all_for_now` policy (allows all operations)

### Planned Implementation

**Tables requiring RLS:**

1. **users table**
   ```sql
   -- Users can only read their own profile
   -- Admin/sysadmin can read all users
   -- Only admin can insert/update/delete
   ```

2. **equipment table**
   ```sql
   -- All authenticated users can read (need equipment list)
   -- Only admin/equipment_admin can insert/update/delete
   ```

3. **inspection_records table**
   ```sql
   -- Inspectors see only their own records
   -- Admins see all records
   -- Inspectors can only insert/update own records
   ```

4. **repair_requests table**
   ```sql
   -- Requesters see only their own requests
   -- Technicians see assigned requests
   -- Admins see all
   ```

5. **maintenance_orders table**
   ```sql
   -- Technicians see assigned orders
   -- Dispatchers see all pending/assigned
   -- Admins see all
   ```

### Implementation File
Location: `supabase/migrations/` (to be created)

### Status
- ⏳ Requires coordination with Supabase project
- ⏳ RLS policies definition phase

---

## Fix 4: CSRF Protection

### Current Status
- ⚠️ **NOT YET IMPLEMENTED**
- All state-changing requests (POST, PUT, DELETE) lack CSRF tokens

### Planned Implementation

**1. CSRF Token Manager**:
```javascript
const csrfManager = {
  getToken() {
    let token = sessionStorage.getItem('csrf_token');
    if (!token) {
      token = generateRandomToken();
      sessionStorage.setItem('csrf_token', token);
    }
    return token;
  },
  
  addToRequest(data) {
    return { ...data, csrf_token: this.getToken() };
  }
};
```

**2. Usage in requests**:
```javascript
// Before (VULNERABLE):
await db.from('repairs').insert(repairData);

// After (PROTECTED):
await db.from('repairs').insert(
  csrfManager.addToRequest(repairData)
);
```

**3. Server-side validation**:
- Create Supabase RPC function to validate CSRF tokens
- Or implement via database trigger

### Scope
- All INSERT operations
- All UPDATE operations
- All DELETE operations
- Form submissions

### Status
- ⏳ Implementation pending

---

## Security Checklist

### ✅ Completed
- [x] Hardcoded credentials removed from source code
- [x] .gitignore configured to prevent credential commits
- [x] Config loader pattern established
- [x] XSS prevention function added to global-ui.js
- [x] XSS fixes applied to dispatch.html
- [x] Configuration documentation created

### 🔄 In Progress
- [ ] Apply XSS fixes to remaining 20+ HTML files
- [ ] Complete global-ui.js in all pages

### ⏳ Planned
- [ ] Implement comprehensive RLS policies on all tables
- [ ] Add CSRF token generation and validation
- [ ] Security audit of all API endpoints
- [ ] Rate limiting implementation
- [ ] Authentication hardening

---

## Git Commits

### Commit 1: Remove Hardcoded API Keys
```
commit: 
- Remove SUPABASE_URL and SUPABASE_ANON_KEY from source files
- Add config loader functions to global-ui.js, admin.html, app.html, dispatch.html
- Create .gitignore and configuration files
- Add dynamic config initialization to critical pages
```

### Commit 2: XSS Prevention - dispatch.html
```
commit:
- Add escapeHtml() utility function
- Apply XSS escaping to all innerHTML operations in dispatch.html
- Escape all user-controlled data in tables and modals
- Add config loading to init() function
```

### Commit 3: Security Documentation
```
commit:
- Add comprehensive SECURITY_FIXES.md
- Document all vulnerabilities and fixes
- Provide implementation roadmap for remaining fixes
```

---

## Developer Guidelines

### When Adding New Features
1. **Never hardcode API keys** - Always use config loader
2. **Always escape user data** - Use `escapeHtml()` for any dynamic HTML
3. **Use parameterized queries** - Prevent SQL injection via Supabase client
4. **Add CSRF tokens** - All state-changing requests must have tokens

### Configuration Management
- Development: Use `config.json` (in .gitignore)
- Production: Use environment variables via deployment script
- Never commit credentials to git

### XSS Prevention Pattern
```javascript
// WRONG - Never do this:
element.innerHTML = data.field;

// RIGHT - Always do this:
element.innerHTML = escapeHtml(data.field);
```

### Testing
Before deploying to GitHub Pages:
1. Test with config.json locally
2. Verify config loading works
3. Test XSS escape functions
4. Validate no credentials in compiled output

---

## References
- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP CSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Supabase RLS Guide: https://supabase.com/docs/guides/auth/row-level-security

---

## Security Contact
For security issues, please report privately to: jnfakimo@gmail.com

# 北農 V2 Node.js API

這個服務是 V2 的正式 Node.js 後端入口。它直接重用
`supabase/functions/app-api/index.ts` 的 API 處理器，因此 JWT、啟用帳號、RBAC、限流、
PostgreSQL RLS、業務流程及稽核規則不會因執行環境不同而分叉。

## 本機執行

使用 Node.js 22，設定下列環境變數後執行：

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
APP_ALLOWED_ORIGINS=https://jnfakimo.github.io,http://localhost:3000
PORT=8787
```

```bash
npm ci
npm run build:api
npm run start:api
```

健康檢查為 `GET /health`，業務 API 為 `POST /api/app-api`。業務 API 必須攜帶
`Authorization: Bearer <Supabase access token>`；service role key 只能存在後端環境變數中。

## 正式部署

根目錄的 `render.yaml` 可建立 Render Docker Web Service。建立服務後：

1. 在 Render 設定三個 Supabase 環境變數；不可將 service role key 寫入 GitHub。
2. 確認 `/health` 回傳 `runtime: nodejs`。
3. 在 GitHub repository variable 建立 `NEXT_PUBLIC_APP_API_URL`，值為 Render 服務根網址，
   例如 `https://beinong-app-api.onrender.com`。
4. 重新執行 GitHub Pages 部署，V2 前端即會改呼叫 Node.js API。

未設定 `NEXT_PUBLIC_APP_API_URL` 時，前端暫時保留既有 Supabase Edge Function 作為遷移
回退路徑，避免正式網站在 Node 主機尚未就緒時中斷。


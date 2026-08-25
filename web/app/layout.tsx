import type { Metadata, Viewport } from 'next';
import './globals.css';
import './handover-pilot/pilot.css';
import './handover-pilot/pilot-light.css';
import { ErrorTrackerMount } from '@/components/ErrorTrackerMount';
import { SecurityAuditMount } from '@/components/SecurityAuditMount';

// CSP 不在這裡定義。React 19 會攔截並重新處理 <head> 裡的 <meta>，手寫的 http-equiv
// 不會出現在產出的 HTML，Next 的 metadata.other 同樣會被濾掉——兩種寫法都是
// 「看起來有防護、產出裡卻沒有」。實際的 CSP 由 tools/build-hardened-pages.mjs
// 在建置階段統一注入 v2/ 底下每一頁，定義只有那一份。
// 附帶影響：next dev 的開發伺服器不會有 CSP，只有正式產出才有。

export const metadata: Metadata = {
  title: '北農智慧巡檢平台',
  description: '臺北農產公司第一果菜市場設備巡檢、維修與分析平台',
  // V1 的 manifest scope 是 /Inspection/system/，掛在 V2 頁面上不符合 scope 而失效。
  // V2 用自己的一份，scope 與 start_url 都落在 /Inspection/v2/。
  manifest: '/Inspection/v2/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f4f6fa',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.setAttribute('data-theme',localStorage.getItem('siteTheme')||'light')" }} />
      </head>
      <body>
        <ErrorTrackerMount />
        <SecurityAuditMount />
        {children}
      </body>
    </html>
  );
}

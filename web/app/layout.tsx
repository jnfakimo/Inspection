import type { Metadata, Viewport } from 'next';
import './globals.css';
import './handover-pilot/pilot.css';
import './handover-pilot/pilot-light.css';

// GitHub Pages 不能設 HTTP header，CSP 只能靠 <meta http-equiv> 發送。
//
// 注意：必須是 http-equiv，且要自己寫進 <head>。用 Next 的 metadata.other 會被濾掉，
// 產出的 HTML 裡連 <meta name> 都不會出現——那是「看起來有防護、實際上零」的狀況。
//
// Next 靜態匯出的 hydration script 是 inline 且內容每次建置都不同，無法用 hash 白名單，
// 因此 script-src 必須留 'unsafe-inline'。真正的防線是 connect-src 與 img-src：
// 即使 XSS 得手，也只能連回本站與 Supabase，把竊得的 token 送不出去。
// frame-ancestors 在 meta 形式無效（只認 HTTP header），故不列入以免產生主控台警告。
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // 圖片來源限站內、data:（QR 標籤）、blob:（3D 貼圖）與 Storage 公開桶。
  // V1 用的是 https:（等於任何 HTTPS 網域），那會留下把資料放進網址外傳的管道。
  "img-src 'self' data: blob: https://qztffronusdhgxhjjubt.supabase.co",
  "connect-src 'self' https://qztffronusdhgxhjjubt.supabase.co wss://qztffronusdhgxhjjubt.supabase.co",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
        <meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.setAttribute('data-theme',localStorage.getItem('siteTheme')||'light')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

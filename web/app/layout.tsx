import type { Metadata, Viewport } from 'next';
import './globals.css';
import './handover-pilot/pilot.css';
import './handover-pilot/pilot-light.css';

export const metadata: Metadata = {
  title: '北農智慧巡檢平台',
  description: '臺北農產公司第一果菜市場設備巡檢、維修與分析平台',
  manifest: '/Inspection/system/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f4f6fa',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "document.documentElement.setAttribute('data-theme',localStorage.getItem('siteTheme')||'light')" }} /></head>
      <body>{children}</body>
    </html>
  );
}

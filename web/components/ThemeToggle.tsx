'use client';

// 全站的介面風格切換（一般版／科技版）。
//
// 掛在根版面 app/layout.tsx，因此**每一個 V2 頁面都自動有**——包含登入頁與不套
// AppShell 的全螢幕工具頁。新增頁面不需要做任何事，也不該再自己做一顆。
//
// 版位與外觀比照 V1 theme.js 的 #themeToggleBtn：右下角固定的圓鈕，一般版顯示 🌙
// （點了會切到科技版）、科技版顯示 ☀️。兩版之間切換的是同一個 localStorage 鍵
// `siteTheme`，V1 與 V2 互通，在任一邊切換另一邊開啟時也會沿用。
//
// 顏色刻意不用主題 token：這顆鈕會疊在圖面、3D 場景與各種底色之上，需要自己有足夠
// 對比，跟著 token 走反而會在深色圖面上消失。

import { useEffect, useState } from 'react';

type Theme = 'light' | 'tech';

export function ThemeToggle() {
  // 初值與 layout.tsx 行內腳本的預設一致（light），因此伺服器端算繪與瀏覽器首次
  // 算繪產生相同結果，不會有 hydration 不一致；實際主題在掛載後校正。
  // 不採「掛載後才渲染」：那樣按鈕不會出現在靜態 HTML 裡，進場會有一瞬間空白。
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const saved = document.documentElement.getAttribute('data-theme');
    if (saved === 'tech') setTheme('tech');
  }, []);

  const isLight = theme === 'light';
  const toggle = () => {
    const next: Theme = isLight ? 'tech' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('siteTheme', next); } catch { /* 無痕模式等情形忽略 */ }
    setTheme(next);
  };

  return <button
    type="button"
    className="theme-toggle"
    data-mode={theme}
    onClick={toggle}
    aria-label="切換介面風格"
    title={isLight ? '切換為科技版' : '切換為一般版'}
  >{isLight ? '🌙' : '☀️'}</button>;
}

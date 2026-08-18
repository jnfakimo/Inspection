// 手動組 HTML 字串時的跳脫工具。
//
// React 渲染的內容天生跳脫，但 window.open + document.write 產生的列印頁面不經過
// React——那類地方每一個插值都必須先過這裡，否則使用者填進資料庫的內容會變成可執行的
// HTML。列印視窗是 about:blank，繼承 opener 的 origin，能讀到 sessionStorage 裡的
// access token，因此這不是「版面跑掉」等級的問題。
//
// 規則與 V1 system/*.html 的 escHtml() 完全相同（& < > " '），兩版行為一致。

export function escHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

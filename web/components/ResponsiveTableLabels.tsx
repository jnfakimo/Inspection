'use client';

// 手機版把表格改成卡片式排列時，每一格要標示自己是哪個欄位。
//
// 常見做法是逐一在 <td> 補 data-label，但全站有 39 個表格分布在 20 個檔案，
// 而且欄位名會和 <thead> 各自維護——改欄位時很容易只改一邊。
// 這裡改成從 <thead> 讀出欄位名再寫進同一欄的 <td>，因此永遠同步，
// 新增表格也不必記得補標籤。
//
// 只在手機斷點下有視覺效果（見 globals.css 的 .responsive-table 卡片化規則），
// 桌機版 data-label 存在但不顯示。

import { useEffect } from 'react';

export function ResponsiveTableLabels() {
  useEffect(() => {
    const applyLabels = () => {
      document.querySelectorAll<HTMLTableElement>('.responsive-table table').forEach(table => {
        const headings = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim());
        if (!headings.length) return;
        table.querySelectorAll('tbody tr').forEach(row => {
          [...row.children].forEach((cell, index) => {
            const element = cell as HTMLTableCellElement;
            // 跨欄的儲存格（樞紐表的小計列、空狀態列）對不上單一欄位，跳過不標。
            if (element.colSpan > 1) { delete element.dataset.label; return; }
            const label = headings[index];
            if (label) element.dataset.label = label;
          });
        });
      });
    };

    applyLabels();
    // 列表換頁、篩選、重新載入都會換掉 tbody，靠 MutationObserver 補標；
    // 用 requestAnimationFrame 合併同一批變動，避免每個節點各觸發一次。
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; applyLabels(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

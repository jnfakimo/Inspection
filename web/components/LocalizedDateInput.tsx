'use client';

import { useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value: string;
};

/**
 * 日期欄位的繁中顯示包裝器：空值時以文字欄位顯示「年/月/日」，
 * 聚焦後才切換原生日曆選擇器，避免瀏覽器依系統語系顯示 YYYY/MM/DD。
 * 不支援 showPicker 的瀏覽器（舊版 Safari/Firefox）會自動轉為可手動輸入
 * 「年/月/日」文字模式，避免日期欄位完全無法操作。
 */
export function LocalizedDateInput({ value, onFocus, onBlur, onChange, ...props }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState(false);

  const openPicker = () => {
    const element = picker.current;
    if (!element) return;
    try {
      if (typeof element.showPicker !== 'function') throw new Error('showPicker 不支援');
      element.showPicker();
    } catch { setManual(true); }
  };

  // 基礎樣式放在 v1-layout.css 的 .localized-date-input，不要寫成行內樣式——
  // 行內樣式的優先序高於任何選擇器，頁面就再也無法調整這個欄位的寬度。
  return <span className="localized-date-input">
    <input
      {...props}
      type="text"
      value={value ? value.replaceAll('-', '/') : ''}
      placeholder="年/月/日"
      readOnly={!manual}
      onFocus={event => { onFocus?.(event); openPicker(); }}
      onBlur={onBlur}
      onClick={openPicker}
      onChange={manual ? event => {
        const normalized = event.target.value.replaceAll('/', '-');
        if (onChange) onChange({ ...event, target: { ...event.target, value: normalized } });
      } : undefined}
    />
    <button type="button" tabIndex={-1} aria-label="開啟日期選擇器" onClick={openPicker} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>▣</button>
    <input ref={picker} type="date" value={value} min={props.min} max={props.max} tabIndex={-1} aria-hidden="true" onChange={onChange} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
  </span>;
}

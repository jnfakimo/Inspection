'use client';

import { useRef, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value: string;
};

/**
 * 日期欄位的繁中顯示包裝器：空值時以文字欄位顯示「年/月/日」，
 * 聚焦後才切換原生日曆選擇器，避免瀏覽器依系統語系顯示 YYYY/MM/DD。
 */
export function LocalizedDateInput({ value, onFocus, onBlur, onChange, ...props }: Props) {
  const picker = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const element = picker.current;
    if (!element) return;
    try { element.showPicker?.(); } catch { element.click(); }
  };

  return <span className="localized-date-input" style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
    <input
      {...props}
      type="text"
      value={value ? value.replaceAll('-', '/') : ''}
      placeholder="年/月/日"
      readOnly
      onFocus={event => { onFocus?.(event); openPicker(); }}
      onBlur={onBlur}
      onClick={openPicker}
    />
    <button type="button" tabIndex={-1} aria-label="開啟日期選擇器" onClick={openPicker} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>▣</button>
    <input ref={picker} type="date" value={value} min={props.min} max={props.max} tabIndex={-1} aria-hidden="true" onChange={onChange} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
  </span>;
}

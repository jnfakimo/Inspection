'use client';

import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value: string;
};

/**
 * 日期欄位的繁中顯示包裝器：空值時以文字欄位顯示「年／月／日」，
 * 聚焦後才切換原生日曆選擇器，避免瀏覽器依系統語系顯示 YYYY/MM/DD。
 */
export function LocalizedDateInput({ value, onFocus, onBlur, onChange, ...props }: Props) {
  const [pickerOpen, setPickerOpen] = useState(Boolean(value));

  useEffect(() => {
    if (value) setPickerOpen(true);
  }, [value]);

  return <input
    {...props}
    type={pickerOpen ? 'date' : 'text'}
    value={value}
    placeholder="年／月／日"
    onFocus={event => {
      setPickerOpen(true);
      onFocus?.(event);
      try { event.currentTarget.showPicker?.(); } catch { /* 部分瀏覽器不支援 showPicker */ }
    }}
    onBlur={event => {
      if (!event.currentTarget.value) setPickerOpen(false);
      onBlur?.(event);
    }}
    onChange={event => onChange?.(event)}
  />;
}

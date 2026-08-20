'use client';

import { useMemo, type SelectHTMLAttributes } from 'react';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'children'> & {
  value: string;
  /** 選項級距（分鐘），預設 30。 */
  stepMinutes?: number;
  /** 是否提供「未設定」的空選項，預設 true。 */
  allowEmpty?: boolean;
  emptyLabel?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** 資料庫的 time 欄位會回 `HH:mm:ss`，統一裁成 `HH:mm` 再比對。 */
const toHHMM = (value: unknown) => {
  const text = String(value ?? '').trim();
  return /^\d{2}:\d{2}/.test(text) ? text.slice(0, 5) : '';
};

/**
 * 時間欄位的統一輸入元件：固定級距的下拉選單。
 *
 * 專案慣例——所有時間設定一律用這個元件，不要用 `<input type="time">`。
 * 原生時間欄位的 `step` 只約束驗證、不限制輸入，使用者仍打得出 08:17 這種值，
 * 而且外觀與格式（上午/下午）完全交給瀏覽器語系決定，同一個系統會出現兩種樣子。
 * 這裡固定輸出 24 小時制的 `HH:mm`，與表格顯示、資料庫的 time 欄位一致。
 */
export function TimeSelect({ value, stepMinutes = 30, allowEmpty = true, emptyLabel = '未設定', ...props }: Props) {
  const current = toHHMM(value);

  const options = useMemo(() => {
    const step = Math.max(1, Math.floor(stepMinutes));
    const list: string[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += step) {
      list.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
    }
    // 既有資料若不落在級距上（例如早期存進去的 08:15），必須保留成一個選項，
    // 否則下拉會顯示空白，使用者只是來改別的欄位就把時間一併抹掉。
    if (current && !list.includes(current)) {
      list.push(current);
      list.sort();
    }
    return list;
  }, [stepMinutes, current]);

  return <select {...props} value={current}>
    {allowEmpty && <option value="">{emptyLabel}</option>}
    {options.map(option => <option key={option} value={option}>{option}</option>)}
  </select>;
}

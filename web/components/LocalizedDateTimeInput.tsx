'use client';

import { LocalizedDateInput } from './LocalizedDateInput';
import { TimeSelect } from './TimeSelect';

type Props = {
  /** `YYYY-MM-DDTHH:mm`，與原生 datetime-local 的值格式相同。 */
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  /** 時間下拉的級距（分鐘），預設 30，與專案的時間欄位慣例一致。 */
  stepMinutes?: number;
};

/**
 * 日期＋時間輸入。
 *
 * 取代原生 `<input type="datetime-local">`：空值時瀏覽器會蓋上自己的格式提示，
 * 繁中環境顯示成「yyyy/mm/dd --:--」這種中英混雜，而且各家瀏覽器長得不一樣。
 * 這裡拆成專案既有的兩個元件——日期用 LocalizedDateInput（空值顯示「年/月/日」），
 * 時間用 TimeSelect（30 分鐘級距、24 小時制）——輸出仍是 datetime-local 的格式，
 * 呼叫端的資料處理完全不用改。
 */
export function LocalizedDateTimeInput({ value, onChange, ariaLabel, className, stepMinutes = 30 }: Props) {
  const [datePart = '', timePart = ''] = String(value || '').split('T');
  const time = timePart.slice(0, 5);

  const emit = (nextDate: string, nextTime: string) => {
    // 日期清空就整個清空——只有時間沒有日期不是一個有效的時間點。
    if (!nextDate) return onChange('');
    // 選了日期還沒選時間時補 00:00，值才會是合法的 datetime-local；
    // 補上的值會直接顯示在時間下拉裡，不會偷偷替使用者決定卻看不出來。
    return onChange(`${nextDate}T${nextTime || '00:00'}`);
  };

  return <span className={`localized-datetime-input${className ? ` ${className}` : ''}`}>
    <LocalizedDateInput
      value={datePart}
      aria-label={ariaLabel ? `${ariaLabel}（日期）` : '日期'}
      onChange={event => emit(event.target.value, time)}
    />
    <TimeSelect
      value={time}
      stepMinutes={stepMinutes}
      aria-label={ariaLabel ? `${ariaLabel}（時間）` : '時間'}
      onChange={event => emit(datePart, event.target.value)}
    />
  </span>;
}

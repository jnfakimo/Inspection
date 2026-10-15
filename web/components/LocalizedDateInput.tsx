'use client';

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { getLocalizedDateInputAccess } from '@/lib/localized-date-input-access';
import { formatLocalizedDate, localizedDateDraftForUpdate, normalizeLocalizedDate, validateLocalizedDate } from '@/lib/localized-date-input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value: string;
};

function localizedDateErrorMessage(code: ReturnType<typeof validateLocalizedDate>, min?: string | number, max?: string | number) {
  return ({
    required: '請輸入日期。',
    invalid: '請輸入有效日期（年/月/日）。',
    min: '日期不可早於 ' + formatLocalizedDate(String(min || '')) + '。',
    max: '日期不可晚於 ' + formatLocalizedDate(String(max || '')) + '。',
  } as Record<string, string>)[code || ''] || '';
}

/**
 * 日期欄位的繁中顯示包裝器：空值時以文字欄位顯示「年/月/日」，
 * 聚焦後才切換原生日曆選擇器，避免瀏覽器依系統語系顯示 YYYY/MM/DD。
 * 不支援 showPicker 的瀏覽器會退回受日期驗證的手動輸入模式。
 */
export function LocalizedDateInput({ value, onFocus, onBlur, onChange, readOnly = false, disabled = false, required = false, min, max, ...props }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const visible = useRef<HTMLInputElement>(null);
  const controlledValueRef = useRef(value);
  const manualDraftRef = useRef<string | null>(null);
  const openingAt = useRef(0);
  const errorId = useId();
  const [manual, setManual] = useState(false);
  const [manualDraft, setManualDraft] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<ReturnType<typeof validateLocalizedDate>>(null);
  const [touched, setTouched] = useState(false);
  const access = getLocalizedDateInputAccess({ manual, readOnly, disabled });

  const updateValidity = useCallback((draft: string) => {
    const error = validateLocalizedDate(draft, {
      required,
      min: min == null ? undefined : String(min),
      max: max == null ? undefined : String(max),
    });
    setValidationError(error);
    visible.current?.setCustomValidity(localizedDateErrorMessage(error, min, max));
    return error;
  }, [max, min, required]);
  useEffect(() => {
    const nextDraft = localizedDateDraftForUpdate(value, controlledValueRef.current, manualDraftRef.current);
    controlledValueRef.current = value;
    if (nextDraft === null && manualDraftRef.current !== null) {
      manualDraftRef.current = null;
      setManualDraft(null);
      setTouched(false);
    }
    updateValidity(nextDraft ?? value);
  }, [max, min, required, updateValidity, value]);

  const openPicker = () => {
    if (access.pickerDisabled || manual) return;
    if (Date.now() - openingAt.current < 250) return;
    openingAt.current = Date.now();
    const element = picker.current;
    if (!element) return;
    try {
      if (typeof element.showPicker !== 'function') throw new Error('showPicker 不支援');
      element.showPicker();
    } catch { setManual(true); }
  };

  const handleNativeChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!updateValidity(event.target.value)) onChange?.(event);
  };
  const displayed = manualDraft ?? formatLocalizedDate(value);
  const describedBy = [props['aria-describedby'], validationError ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  return <span className="localized-date-input">
    <input
      {...props}
      ref={visible}
      type="text"
      value={displayed}
      min={min}
      max={max}
      placeholder="年/月/日"
      disabled={disabled}
      required={required}
      readOnly={access.inputReadOnly}
      inputMode={manual || readOnly ? undefined : 'none'}
      aria-readonly={access.ariaReadOnly}
      aria-invalid={validationError ? true : props['aria-invalid']}
      aria-describedby={describedBy}
      aria-errormessage={validationError ? errorId : props['aria-errormessage']}
      onFocus={event => { onFocus?.(event); openPicker(); }}
      onBlur={event => {
        onBlur?.(event);
        setTouched(true);
        if (manualDraftRef.current == null) updateValidity(value);
      }}
      onClick={openPicker}
      onChange={access.manualEditable ? event => {
        const draft = event.target.value;
        const normalized = normalizeLocalizedDate(draft);
        manualDraftRef.current = draft;
        setManualDraft(draft);
        setTouched(true);
        const error = updateValidity(draft);
        if (!error && onChange) onChange({ ...event, target: { ...event.target, value: normalized || '' } });
      } : undefined}
    />
    <button type="button" tabIndex={-1} aria-label="開啟日期選擇器" disabled={access.pickerDisabled} onClick={openPicker} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>▣</button>
    {touched && validationError && <small id={errorId} className="localized-date-error">{localizedDateErrorMessage(validationError, min, max)}</small>}
    {/* 原生日期欄位作為 showPicker() 載體；觸控裝置由 .localized-date-native 覆蓋欄位。 */}
    <input ref={picker} className="localized-date-native" type="date" value={value} min={min} max={max} tabIndex={-1} aria-hidden="true" disabled={access.pickerDisabled} onChange={access.nativeChangeEnabled ? handleNativeChange : undefined} />
  </span>;
}
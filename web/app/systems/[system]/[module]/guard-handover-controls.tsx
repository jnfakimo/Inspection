'use client';

// 駐警隊交接簿的「可選可填」下拉選單與清單管理面板。
// 只依賴 React；API 呼叫由 guard-handover.tsx 以回呼傳入，元件本身可以單獨渲染檢查版面。

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { OPTION_LISTS, OPTION_LIST_LABELS, type GuardOption, type GuardOptionList } from './guard-handover-shared';

type ComboProps = {
  value: string; onChange: (value: string) => void; options: string[]; ariaLabel: string;
  placeholder?: string; inputMode?: 'text' | 'numeric'; maxLength?: number;
  onManage?: () => void; manageLabel?: string; defaultOpen?: boolean;
};

/**
 * 展開後第一列是空白輸入框：留空按「留白」就是真正的空值（對應全站 BlankSelectOption 規範），
 * 輸入文字則帶入清單以外的內容；下方是清單選項，輸入時會同步篩選。
 */
export function GuardCombo({ value, onChange, options, ariaLabel, placeholder, inputMode = 'text', maxLength, onManage, manageLabel, defaultOpen = false }: ComboProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setDraft('');
    const focusTimer = window.setTimeout(() => draftRef.current?.focus(), 0);
    const onPointer = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('mousedown', onPointer); };
  }, [open]);

  const commit = (next: string) => { onChange(next); setOpen(false); };
  const keyword = draft.trim().toLowerCase();
  const filtered = keyword ? options.filter(option => option.toLowerCase().includes(keyword)) : options;

  return <div className={`guard-combo${open ? ' is-open' : ''}`} ref={rootRef}>
    <button type="button" className="guard-combo-field" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel}
      onClick={() => setOpen(current => !current)}>
      <span className={value ? '' : 'is-placeholder'}>{value || placeholder || '請選擇或輸入'}</span>
      <span className="guard-combo-caret" aria-hidden="true">▾</span>
    </button>
    {open && <div className="guard-combo-panel">
      <div className="guard-combo-custom">
        <input ref={draftRef} value={draft} inputMode={inputMode} maxLength={maxLength} aria-label={`${ariaLabel}：自行輸入`}
          placeholder="留空＝空值／或自行輸入" onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commit(draft.trim()); }
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          }} />
        <button type="button" className="primary-btn compact" onClick={() => commit(draft.trim())}>{draft.trim() ? '帶入' : '留白'}</button>
      </div>
      <ul className="guard-combo-list" role="listbox" id={listId} aria-label={ariaLabel}>
        {filtered.map(option => <li key={option}>
          <button type="button" role="option" aria-selected={option === value} className={option === value ? 'is-selected' : ''} onClick={() => commit(option)}>{option}</button>
        </li>)}
        {!filtered.length && <li className="guard-combo-empty">{options.length ? '清單中沒有符合的選項，按「帶入」即可使用輸入的內容。' : '清單目前是空的，可直接在上方輸入。'}</li>}
      </ul>
      {onManage && <button type="button" className="guard-combo-manage" onClick={() => { setOpen(false); onManage(); }}>⚙ {manageLabel || '管理這個清單'}</button>}
    </div>}
  </div>;
}

type PanelProps = {
  options: GuardOption[]; list: GuardOptionList; onListChange: (list: GuardOptionList) => void; busy: boolean;
  onAdd: (list: GuardOptionList, label: string) => Promise<void>;
  onRename: (option: GuardOption, label: string) => Promise<void>;
  onDelete: (option: GuardOption) => Promise<void>;
  onMove: (option: GuardOption, direction: 'up' | 'down') => Promise<void>;
};

export function GuardOptionsPanel({ options, list, onListChange, busy, onAdd, onRename, onDelete, onMove }: PanelProps) {
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const rows = options.filter(option => option.list_key === list).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'zh-Hant'));
  const disabled = busy || working;

  useEffect(() => { setNewLabel(''); setEditingId(''); setMessage(''); }, [list]);

  const attempt = async (task: () => Promise<void>, done?: () => void) => {
    setWorking(true); setMessage('');
    try { await task(); done?.(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失敗，請稍後再試'); }
    setWorking(false);
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    void attempt(() => onAdd(list, label), () => setNewLabel(''));
  };

  return <div className="guard-options">
    <div className="guard-options-tabs" role="tablist" aria-label="下拉選單">
      {OPTION_LISTS.map(key => <button type="button" role="tab" key={key} aria-selected={key === list} className={key === list ? 'is-active' : ''} onClick={() => onListChange(key)}>
        {OPTION_LIST_LABELS[key]}<small>{options.filter(option => option.list_key === key).length}</small>
      </button>)}
    </div>
    <p className="guard-options-hint">填寫交接時一律可以在選單第一列自行輸入清單以外的內容；這裡調整的是下拉清單本身。改名或刪除只影響之後的選擇，已存檔的交接紀錄不會跟著改變。</p>
    <form className="guard-options-add" onSubmit={add}>
      <input value={newLabel} maxLength={40} onChange={event => setNewLabel(event.target.value)} placeholder={`新增「${OPTION_LIST_LABELS[list]}」選項`} aria-label={`新增${OPTION_LIST_LABELS[list]}選項`} />
      <button type="submit" className="primary-btn compact" disabled={disabled || !newLabel.trim()}>＋ 新增</button>
    </form>
    {rows.length ? <ol className="guard-options-list">{rows.map((option, index) => <li key={option.option_id}>
      {editingId === option.option_id ? <>
        <input value={editLabel} maxLength={40} autoFocus onChange={event => setEditLabel(event.target.value)} aria-label={`修改選項 ${option.label}`}
          onKeyDown={event => { if (event.key === 'Escape') setEditingId(''); }} />
        <div className="guard-options-actions">
          <button type="button" className="primary-btn compact" disabled={disabled || !editLabel.trim() || editLabel.trim() === option.label}
            onClick={() => void attempt(() => onRename(option, editLabel.trim()), () => setEditingId(''))}>儲存</button>
          <button type="button" className="secondary-btn compact" onClick={() => setEditingId('')}>取消</button>
        </div>
      </> : <>
        <span className="guard-options-order">{index + 1}</span>
        <span className="guard-options-label">{option.label}</span>
        <div className="guard-options-actions">
          <button type="button" className="secondary-btn compact" aria-label={`上移 ${option.label}`} disabled={disabled || index === 0} onClick={() => void attempt(() => onMove(option, 'up'))}>↑</button>
          <button type="button" className="secondary-btn compact" aria-label={`下移 ${option.label}`} disabled={disabled || index === rows.length - 1} onClick={() => void attempt(() => onMove(option, 'down'))}>↓</button>
          <button type="button" className="secondary-btn compact" disabled={disabled} onClick={() => { setEditingId(option.option_id); setEditLabel(option.label); }}>修改</button>
          <button type="button" className="danger-btn compact" disabled={disabled}
            onClick={() => { if (window.confirm(`確定從「${OPTION_LIST_LABELS[list]}」刪除「${option.label}」？已存檔的交接紀錄不受影響。`)) void attempt(() => onDelete(option)); }}>刪除</button>
        </div>
      </>}
    </li>)}</ol> : <p className="guard-options-empty">這個清單目前沒有選項，填寫時可直接自行輸入。</p>}
    {message && <p role="alert" className="inline-message danger">{message}</p>}
  </div>;
}

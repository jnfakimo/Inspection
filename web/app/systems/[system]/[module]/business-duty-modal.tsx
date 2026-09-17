'use client';

// 業管組崗位勤務點檢表「管理點檢項目」彈窗。
// 版型與互動完全比照駐警隊「管理下拉選單」（GuardOptionsPanel），支援 7 大時段切換、項目計數、新增、修改、刪除、↑/↓ 排序與重設預設。

import { useEffect, useState, type FormEvent } from 'react';
import { AdminModal } from '@/components/admin/shared';
import {
  TIME_SLOT_DEFS,
  DEFAULT_BUSINESS_DUTY_CHECKLIST,
  getTimeSlotLabel,
  getTimeSlotShiftGroup,
  type DutyItem,
} from '@/lib/business-duty-checklist';

export type BusinessDutyModalProps = {
  items: DutyItem[];
  onItemsChange: (items: DutyItem[]) => void;
  onClose: () => void;
  busy?: boolean;
  authorName?: string;
};

export function BusinessDutyModal({ items, onItemsChange, onClose, busy = false, authorName }: BusinessDutyModalProps) {
  const [selectedSlot, setSelectedSlot] = useState<string>('00-08');
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [message, setMessage] = useState('');

  const activeSlot = TIME_SLOT_DEFS.find(s => s.code === selectedSlot) || TIME_SLOT_DEFS[0];
  const activeSlotLabel = activeSlot.label;

  const slotItems = items.filter(i => i.timeSlot === selectedSlot && !i.deletedAt);

  useEffect(() => {
    setNewTitle('');
    setEditingId('');
    setMessage('');
  }, [selectedSlot]);

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newItem: DutyItem = {
      id,
      timeSlot: selectedSlot,
      timeSlotLabel: getTimeSlotLabel(selectedSlot),
      shiftGroup: getTimeSlotShiftGroup(selectedSlot),
      title,
      createdAt: new Date().toISOString(),
      createdBy: authorName,
    };

    // Append at the end of the slot in the items array
    const newItems = [...items, newItem];
    onItemsChange(newItems);
    setNewTitle('');
    setMessage(`✓ 已新增點檢項目「${title}」`);
  };

  const handleStartEdit = (item: DutyItem) => {
    setEditingId(item.id);
    setEditingTitle(item.title);
    setMessage('');
  };

  const handleSaveEdit = (item: DutyItem) => {
    const title = editingTitle.trim();
    if (!title) return;
    if (title === item.title) {
      setEditingId('');
      return;
    }

    const newItems = items.map(i =>
      i.id === item.id
        ? {
            ...i,
            title,
            updatedAt: new Date().toISOString(),
            updatedBy: authorName,
          }
        : i
    );
    onItemsChange(newItems);
    setEditingId('');
    setMessage(`✓ 已更新點檢項目「${title}」`);
  };

  const handleDelete = (item: DutyItem) => {
    if (!window.confirm(`確定刪除此點檢項目「${item.title}」？`)) return;

    const newItems = items.filter(i => i.id !== item.id);
    onItemsChange(newItems);
    setMessage(`✓ 已刪除點檢項目「${item.title}」`);
  };

  const handleMove = (item: DutyItem, direction: 'up' | 'down') => {
    const currentIdx = slotItems.findIndex(i => i.id === item.id);
    if (currentIdx < 0) return;
    const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
    if (targetIdx < 0 || targetIdx >= slotItems.length) return;

    const targetItem = slotItems[targetIdx];
    const fullCurrentIdx = items.findIndex(i => i.id === item.id);
    const fullTargetIdx = items.findIndex(i => i.id === targetItem.id);
    if (fullCurrentIdx < 0 || fullTargetIdx < 0) return;

    const newItems = [...items];
    const temp = newItems[fullCurrentIdx];
    newItems[fullCurrentIdx] = newItems[fullTargetIdx];
    newItems[fullTargetIdx] = temp;

    onItemsChange(newItems);
  };

  const handleResetDefaults = () => {
    if (
      !window.confirm(
        '確定要恢復為系統預設的 27 項點檢項目？目前自訂的新增與修改將會被重設。'
      )
    ) {
      return;
    }
    onItemsChange(DEFAULT_BUSINESS_DUTY_CHECKLIST);
    setMessage('✓ 已恢復為系統預設點檢項目');
  };

  return (
    <AdminModal className="guard-options-modal" title="管理點檢項目" onClose={onClose}>
      <div className="guard-options">
        <div className="guard-options-tabs" role="tablist" aria-label="點檢時段">
          {TIME_SLOT_DEFS.map(slot => {
            const count = items.filter(i => i.timeSlot === slot.code && !i.deletedAt).length;
            const isActive = slot.code === selectedSlot;
            return (
              <button
                type="button"
                role="tab"
                key={slot.code}
                aria-selected={isActive}
                className={isActive ? 'is-active' : ''}
                onClick={() => setSelectedSlot(slot.code)}
              >
                {slot.label}
                <small>{count}</small>
              </button>
            );
          })}
        </div>

        <p className="guard-options-hint">
          可在此新增、修改、刪除各時段點檢項目，或以 ↑ / ↓ 調整項次順序。調整後將同步更新至點檢表與日報表。
        </p>

        <form className="guard-options-add" onSubmit={handleAdd}>
          <input
            value={newTitle}
            maxLength={200}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={`新增「${activeSlotLabel}」點檢項目`}
            aria-label={`新增${activeSlotLabel}點檢項目`}
          />
          <button type="submit" className="primary-btn compact" disabled={busy || !newTitle.trim()}>
            ＋ 新增
          </button>
        </form>

        {slotItems.length ? (
          <ol className="guard-options-list">
            {slotItems.map((item, index) => (
              <li key={item.id}>
                {editingId === item.id ? (
                  <>
                    <input
                      value={editingTitle}
                      maxLength={200}
                      autoFocus
                      onChange={e => setEditingTitle(e.target.value)}
                      aria-label={`修改點檢項目 ${item.title}`}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveEdit(item);
                        }
                        if (e.key === 'Escape') setEditingId('');
                      }}
                    />
                    <div className="guard-options-actions">
                      <button
                        type="button"
                        className="primary-btn compact"
                        disabled={busy || !editingTitle.trim() || editingTitle.trim() === item.title}
                        onClick={() => handleSaveEdit(item)}
                      >
                        儲存
                      </button>
                      <button type="button" className="secondary-btn compact" onClick={() => setEditingId('')}>
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="guard-options-order">{index + 1}</span>
                    <span className="guard-options-label">{item.title}</span>
                    <div className="guard-options-actions">
                      <button
                        type="button"
                        className="secondary-btn compact"
                        aria-label={`上移 ${item.title}`}
                        disabled={busy || index === 0}
                        onClick={() => handleMove(item, 'up')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="secondary-btn compact"
                        aria-label={`下移 ${item.title}`}
                        disabled={busy || index === slotItems.length - 1}
                        onClick={() => handleMove(item, 'down')}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="secondary-btn compact"
                        disabled={busy}
                        onClick={() => handleStartEdit(item)}
                      >
                        修改
                      </button>
                      <button
                        type="button"
                        className="danger-btn compact"
                        disabled={busy}
                        onClick={() => handleDelete(item)}
                      >
                        刪除
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="guard-options-empty">這個時段目前沒有點檢項目，可直接在上方新增。</p>
        )}

        {message && <p role="alert" className="inline-message success">{message}</p>}
      </div>

      <footer>
        <button type="button" className="secondary-btn compact" onClick={handleResetDefaults}>
          恢復預設項目 ({DEFAULT_BUSINESS_DUTY_CHECKLIST.length}項)
        </button>
        <button type="button" className="secondary-btn" onClick={onClose}>
          關閉
        </button>
      </footer>
    </AdminModal>
  );
}

'use client';

// 授權清單的唯一版型：大系統卡片＋子系統下鑽。
// 「人員精細授權」與「角色系統範本」都用這支渲染，兩邊的版面、互動與樣式因此永遠一致；
// 差別只在傳進來的資料（對象是人或角色）與可選的模式，不另外做第二種版型。

export type AccessChoice = { value: string; label: string };
export type AccessRow = {
  key: string;
  title: string;
  description?: string;
  code?: string;
  icon?: string;
  hint?: string;
  value: string;
  choices: AccessChoice[];
  disabled?: boolean;
  effective: boolean;
  effectiveLabel: string;
  ariaLabel: string;
  children?: AccessRow[];
};

type Props = {
  rows: AccessRow[];
  expandedKey: string;
  onExpand: (key: string) => void;
  onChange: (row: AccessRow, value: string, parent?: AccessRow) => void;
  controlLabel: string;
  childControlLabel: string;
  busy?: boolean;
  expandLabel?: string;
};

export function GranularAccessList({ rows, expandedKey, onExpand, onChange, controlLabel, childControlLabel, busy, expandLabel = '設定子系統' }: Props) {
  return <div className="granular-system-list">{rows.map(row => {
    const children = row.children || [];
    const expanded = expandedKey === row.key;
    return <article key={row.key} className={`granular-system-card ${row.effective ? 'is-allowed' : 'is-denied'}`}>
      <div className="granular-system-row">
        <button type="button" className="granular-system-title" aria-expanded={expanded} disabled={children.length === 0}
          onClick={() => onExpand(expanded ? '' : row.key)}>
          {row.icon && <img src={row.icon} alt="" />}
          <span>{row.code && <small>{row.code}</small>}<strong>{row.title}</strong>{row.hint && <em>{row.hint}</em>}</span>
          {children.length > 0 && <b>{expanded ? '收合' : expandLabel}⌄</b>}
        </button>
        <label>{controlLabel}<select value={row.value} aria-label={row.ariaLabel} disabled={busy || row.disabled}
          onChange={event => onChange(row, event.target.value)}>
          {row.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select></label>
        <span className={`effective-access ${row.effective ? 'allowed' : 'denied'}`}>{row.effectiveLabel}</span>
      </div>
      {expanded && children.length > 0 && <div className="granular-module-grid">{children.map(child =>
        <label key={child.key} className={child.effective ? 'is-allowed' : 'is-denied'}>
          <span><strong>{child.title}</strong><small>{child.description}</small></span>
          <select value={child.value} aria-label={child.ariaLabel} disabled={busy || child.disabled}
            onChange={event => onChange(child, event.target.value, row)}>
            {child.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
          <b>{child.effectiveLabel}</b>
        </label>)}
        <p className="granular-module-note">{childControlLabel}</p>
      </div>}
    </article>;
  })}</div>;
}

'use client';

// SYS-04 電子交接簿的共用外觀元件。三本交接簿（機電課、業管組、駐衛警）共用同一組圖示
// 與同一個表頭，內容不同但外觀一致——各自複製一份圖示表就是版面分岔的起點。
// 只放「沒有資料相依」的呈現元件，方便單獨渲染檢查版面。

import type { ReactNode } from 'react';

export type IconName = 'shield' | 'clock' | 'route' | 'users' | 'note' | 'flag' | 'alert' | 'box' | 'pen' | 'check' | 'clip' | 'image' | 'video' | 'file' | 'doc' | 'calendar' | 'building' | 'tool' | 'clipboard' | 'chevron-down' | 'chevron-up' | 'list' | 'printer' | 'eye' | 'save';

const ICON_PATHS: Record<IconName, ReactNode> = {
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  route: <><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" /></>,
  users: <><circle cx="9.5" cy="7.5" r="3.5" /><path d="M3 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" /><path d="M16 4.3a3.5 3.5 0 0 1 0 6.4" /><path d="M21 20v-1a4.5 4.5 0 0 0-3-4.2" /></>,
  note: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  alert: <><path d="M12 3.5l9 16H3l9-16z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  box: <><path d="M3 7.5l9-4.5 9 4.5-9 4.5-9-4.5z" /><path d="M3 7.5v9l9 4.5 9-4.5v-9" /><path d="M12 12v9" /></>,
  pen: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  clip: <path d="M20.5 11.5l-8.2 8.2a5.3 5.3 0 0 1-7.5-7.5l8.2-8.2a3.6 3.6 0 0 1 5.1 5.1l-8.2 8.2a1.8 1.8 0 0 1-2.5-2.5l7.5-7.5" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M21 16l-5-5L6 20" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-3v9l-5-3z" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  building: (
    <>
      <path d="M3 21h18M5 21V7l8-4v18M13 3l6 3v15M9 9h1M9 13h1M9 17h1M17 9h1M17 13h1M17 17h1" />
    </>
  ),
  tool: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </>
  ),
  clipboard: (
    <>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M18 15l-6-6-6 6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  printer: (
    <>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>
  ),
};

export function HandoverIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className="hs-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>;
}

export type HandoverKpi = { label: string; value: string; icon: IconName; tone: 'cyan' | 'green' | 'amber' | 'red' | 'violet' };

/** 交接紀錄表的表頭與今日指標。三本交接簿只換機關名稱、表名、徽章圖示與指標內容。 */
export function HandoverSheetHeader({ org, title, dateLabel, emblem = 'shield', kpis = [] }: {
  org: string; title: string; dateLabel: string; emblem?: IconName; kpis?: HandoverKpi[];
}) {
  return <>
    <header className="hs-sheet-head">
      <div className="hs-sheet-title">
        <span className="hs-sheet-emblem"><HandoverIcon name={emblem} size={28} /></span>
        <div><small>{org}</small><h2>{title}</h2></div>
      </div>
      <b className="hs-date-chip"><HandoverIcon name="calendar" size={17} />{dateLabel}</b>
    </header>
    {kpis.length > 0 && <div className="hs-kpis">{kpis.map(kpi => <div className={`hs-kpi is-${kpi.tone}`} key={kpi.label}>
      <span className="hs-kpi-icon"><HandoverIcon name={kpi.icon} size={19} /></span>
      <div><b>{kpi.value}</b><small>{kpi.label}</small></div>
    </div>)}</div>}
  </>;
}

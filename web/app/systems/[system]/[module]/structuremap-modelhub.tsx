'use client';

// SYS-06「模型管理」＝ V1 `admin.html#modelhub` 的 3D建模系統 hub。
//
// 這一頁不做資料維護，只有兩件事：把五個子系統的入口排成圖卡，以及算出空間主檔
// 與平面圖標記的介接覆蓋率。五個入口目前都指向 V1 頁面——V2 雖然有 areas／markers／
// floor3d 三個對應模組，但 modeler（DXF 上傳建模）沒有 V2 版，五張卡一起留在 V1
// 才不會走到一半換介面。
//
// 統計沿用 V1 的兩支查詢：floor_spaces 取啟用中的空間主檔，plan_markers 取啟用中
// 且已綁定 space_id 的標記，兩邊取交集算已標記數。兩張表的讀取權限由
// has_system_access('sys_structuremap') 在伺服器端把關。

import { useCallback, useEffect, useState } from 'react';
import '@/app/admin-workspace.css';
import './structuremap-modelhub.css';
import { AppShell } from '@/components/AppShell';
import { errorMessage } from '@/components/admin/shared';
import { LEGACY_BASE, MARKET_ID } from '@/lib/config';
import { getSupabase } from '@/lib/supabase';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { module: ModuleDefinition; profile: Profile };

// 與 V1 相同的上限：市場的空間與標記數量都遠低於此，一次取完不必分頁。
const QUERY_LIMIT = 5000;
const ICON_BASE = '/Inspection/assets/system-icons';

const LOADING_TEXT = '…';
const EMPTY_TEXT = '—';

type HubCard = {
  code: string;
  accent: 'pink' | 'cyan' | 'purple' | 'green' | 'amber';
  icon: string;
  title: string;
  description: readonly [string, string];
  enter: string;
  legacy: string;
};

const HUB_CARDS: readonly HubCard[] = [
  {
    code: 'HUB-01', accent: 'pink', icon: 'equipment-icon.png', title: '3D建模系統',
    description: ['上傳 DXF 更新樓層平面圖', '同步更新 3D 立體模型'],
    enter: '▶ 第一步：進入建模', legacy: 'modeler.html?v=2',
  },
  {
    code: 'HUB-02', accent: 'cyan', icon: 'admin-icon.png', title: '區域位置表',
    description: ['建立樓層與空間名稱主檔', '空間是否使用 / 匯入匯出'],
    enter: '▶ 第二步：建立主檔', legacy: 'arealist.html',
  },
  {
    code: 'HUB-03', accent: 'purple', icon: 'guardpatrol-icon.png', title: '巡邏點清單',
    description: ['讀取全樓層巡邏點標示資料', '彙總檢視與快速定位'],
    enter: '▶ 檢視巡邏點', legacy: 'patrollist.html',
  },
  {
    code: 'HUB-04', accent: 'green', icon: 'handover-icon.png', title: '整合標記系統',
    description: ['讀取區域位置表空間主檔', '平面圖標記與位置定位'],
    enter: '▶ 第三步：標記定位', legacy: 'b1_integrated_marker_system.html',
  },
  {
    code: 'HUB-05', accent: 'amber', icon: 'equipment-icon.png', title: '3D模型圖',
    description: ['統一 3D 立體模型資料來源', '供後續多系統介接應用'],
    enter: '▶ 檢視 3D 模型', legacy: 'floor3d.html',
  },
];

type BridgeStats = { spaces: number; marked: number; unmarked: number };

const STAT_ITEMS: readonly { key: keyof BridgeStats; label: string }[] = [
  { key: 'spaces', label: '空間主檔' },
  { key: 'marked', label: '已標記空間' },
  { key: 'unmarked', label: '未標記空間' },
];

export function ModelHubModule({ module, profile }: Props) {
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setNote('');
    setStats(null);
    const db = getSupabase();
    const [spaceResult, markerResult] = await Promise.all([
      db.from('floor_spaces').select('space_id')
        .eq('market_id', MARKET_ID).eq('status', 'active').limit(QUERY_LIMIT),
      db.from('plan_markers').select('space_id')
        .not('space_id', 'is', null).eq('status', 'active').limit(QUERY_LIMIT),
    ]);
    const failure = spaceResult.error || markerResult.error;
    if (failure) {
      // 不能只留三個破折號：權限被擋、連線失敗或登入過期都長得一樣，
      // 使用者無從判斷是「真的沒資料」還是「查不到」。
      setNote(`失敗：${errorMessage(failure, '介接統計載入失敗')}`);
      setBusy(false);
      return;
    }
    // 標記可能指向已停用或已刪除的空間，先與空間主檔取交集再計數，
    // 否則已標記數會超過空間主檔總數、未標記數被算成負值。
    const spaceIds = new Set((spaceResult.data ?? []).map(row => row.space_id).filter(Boolean));
    const markedIds = new Set((markerResult.data ?? []).map(row => row.space_id).filter(id => spaceIds.has(id)));
    setStats({
      spaces: spaceIds.size,
      marked: markedIds.size,
      unmarked: Math.max(spaceIds.size - markedIds.size, 0),
    });
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const statText = (key: keyof BridgeStats) =>
    stats ? String(stats[key]) : busy ? LOADING_TEXT : EMPTY_TEXT;

  return <AppShell profile={profile} title={module.title}>
    <div className="modelhub-page">
      <header className="modelhub-page-header">
        <h1>
          <span className="modelhub-section-icon" aria-hidden="true">
            <img src={`${ICON_BASE}/equipment-icon.png`} alt="" />
          </span>
          {module.title}
        </h1>
        <p>{module.description}</p>
      </header>

      {note && <p className="inline-message danger" role="status">{note}</p>}

      <p className="modelhub-note">■ 3D-MODELER v1.0 · 點選卡片進入子系統</p>

      <nav className="modelhub-card-grid" aria-label="3D建模系統子系統入口">
        {HUB_CARDS.map(card => <a
          key={card.code}
          className={`modelhub-card ${card.accent}`}
          href={`${LEGACY_BASE}/${card.legacy}`}
        >
          <span className="modelhub-card-badge">{card.code}</span>
          <span className="modelhub-card-icon"><img src={`${ICON_BASE}/${card.icon}`} alt="" /></span>
          <h2 className="modelhub-card-title">{card.title}</h2>
          <p className="modelhub-card-desc">{card.description[0]}<br />{card.description[1]}</p>
          <span className="modelhub-card-enter">{card.enter}</span>
        </a>)}
      </nav>

      <section className="modelhub-bridge" aria-labelledby="modelhub-bridge-title">
        <h2 className="modelhub-bridge-title" id="modelhub-bridge-title">介接關係</h2>
        <p className="modelhub-bridge-flow">3D建模系統 <span>→</span> 區域位置表 <span>→</span> 整合標記系統</p>
        <p className="modelhub-bridge-text">
          先於 3D建模系統更新平面與立體模型，再於區域位置表建立空間主檔，整合標記系統依同一組空間代碼對應標記位置。
        </p>
        <ul className="modelhub-stats" aria-busy={busy}>
          {STAT_ITEMS.map(item => <li key={item.key} className="modelhub-stat">
            <b>{statText(item.key)}</b>
            <small>{item.label}</small>
          </li>)}
        </ul>
      </section>
    </div>
  </AppShell>;
}

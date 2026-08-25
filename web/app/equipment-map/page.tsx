'use client';

// 設備樓層分布。
//
// 這頁原本畫了一張「平面圖」，但設備位置是用 x = 10 + (index*23) % 78 這類公式排出來的，
// 與設備實際位置無關——看起來像圖臺，實際上是示意排版，容易被當成真實座標判讀。
// SYS-06 的平面樓層圖與立體樓層模型已經是讀 plan_markers 真實座標的正式版本，
// 因此這裡移除偽造座標的畫布，只保留確實來自設備主檔的樓層分布統計與清單，
// 需要看位置就導到圖臺。

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { MetricCard } from '@/components/MetricCard';
import { canonicalFloor } from '@/lib/floor';
import { invokeAppApi } from '@/lib/supabase';
import type { EquipmentMapData, Profile } from '@/types/app';

const STATUS_LABELS: Record<string, string> = { active: '使用中', repair: '維修中', inactive: '停用', retired: '報廢' };

function EquipmentMap({ profile }: { profile: Profile }) {
  const [data, setData] = useState<EquipmentMapData>({ equipment: [], markers: [], locations: [] });
  const [floor, setFloor] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    invokeAppApi<EquipmentMapData>('equipment_map').then(result => setData({
      equipment: result.equipment.map(item => ({ ...item, floor: canonicalFloor(item.floor) })),
      markers: result.markers.map(item => ({
        ...item,
        floor: canonicalFloor(item.floor),
        floor_id: canonicalFloor(item.floor_id ?? item.floor),
      })),
      locations: result.locations.map(item => ({ ...item, floor: canonicalFloor(item.floor) })),
    })).catch(e => setError(e.message));
  }, []);

  const floors = useMemo(() => [...new Set(data.equipment.map(e => String(e.floor || '未設定')))].sort(), [data]);
  useEffect(() => { if (!floor && floors.length) setFloor(floors[0]); }, [floors, floor]);

  const current = useMemo(() => data.equipment.filter(item => {
    const q = query.trim().toLowerCase();
    return String(item.floor || '未設定') === floor
      && (!q || [item.name, item.asset_code, item.category, item.location].some(v => String(v || '').toLowerCase().includes(q)));
  }), [data.equipment, floor, query]);

  const repairing = current.filter(item => item.status === 'repair').length;
  const markerCount = data.markers.filter(marker => canonicalFloor(marker.floor_id ?? marker.floor) === floor).length;

  return <AppShell profile={profile} title="設備樓層分布">
    <div className="page-actions">
      <div>
        <p>依樓層檢視設備主檔；設備在圖面上的實際位置請至圖臺系統檢視。</p>
        {error && <span className="inline-message danger">{error}</span>}
      </div>
      <div>
        <a className="secondary-btn" href="/Inspection/v2/systems/structuremap/floor2d/">平面樓層圖</a>
        <a className="primary-btn compact" href="/Inspection/v2/systems/structuremap/floor3d/">立體樓層模型</a>
      </div>
    </div>

    <section className="metrics-grid">
      <MetricCard label="設備總數" value={data.equipment.length} unit="台" hint="設備主檔全樓層" />
      <MetricCard label={`${floor || '本樓層'} 設備`} value={current.length} unit="台" tone="green" />
      <MetricCard label="維修中" value={repairing} unit="台" tone="amber" hint="本樓層" />
      <MetricCard label="圖面標記" value={markerCount} unit="點" tone="violet" hint="本樓層 plan_markers" />
    </section>

    <section className="floor-tabs">{floors.map(name =>
      <button key={name} onClick={() => setFloor(name)} className={floor === name ? 'active' : ''}>{name}</button>)}
    </section>

    <section className="panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋設備名稱、資產碼、分類或位置" />
        <span>{floor}　{current.length} 台</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>資產碼</th><th>設備名稱</th><th>分類</th><th>位置</th><th>狀態</th></tr></thead>
        <tbody>{current.map(item => <tr key={String(item.equipment_id)}>
          <td><strong>{String(item.asset_code || '未編資產碼')}</strong></td>
          <td>{String(item.name || '未命名設備')}</td>
          <td>{String(item.category || '未分類')}</td>
          <td>{String(item.location || '—')}</td>
          <td><span className={`status-pill ${item.status === 'repair' ? 'in-progress' : item.status === 'active' ? 'closed' : 'pending'}`}>
            {STATUS_LABELS[String(item.status || '')] || String(item.status || '—')}</span></td>
        </tr>)}</tbody>
      </table></div>
      {!current.length && <p className="empty">{data.equipment.length ? '此樓層沒有符合條件的設備' : '設備主檔載入中或尚無資料'}</p>}
    </section>
  </AppShell>;
}

export default function Page() { return <AuthGate>{profile => <EquipmentMap profile={profile} />}</AuthGate>; }

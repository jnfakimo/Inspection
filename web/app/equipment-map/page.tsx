'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { invokeAppApi } from '@/lib/supabase';
import type { EquipmentMapData, Profile } from '@/types/app';

function EquipmentMap({ profile }: { profile: Profile }) {
  const [data, setData] = useState<EquipmentMapData>({ equipment: [], markers: [], locations: [] });
  const [floor, setFloor] = useState('B1F');
  const [error, setError] = useState('');
  useEffect(() => { invokeAppApi<EquipmentMapData>('equipment_map').then(setData).catch(e => setError(e.message)); }, []);
  const floors = useMemo(() => [...new Set(data.equipment.map(e => String(e.floor || '未設定')))].sort(), [data]);
  const current = data.equipment.filter(e => String(e.floor || '未設定') === floor);
  return <AppShell profile={profile} title="設備圖臺">
    <div className="page-actions"><div><p>設備主檔、平面圖標記與位置資料統一呈現；B1／B1F 由 API 正規化。</p>{error && <span className="inline-message danger">{error}</span>}</div><a className="primary-btn compact" href="/word-cloud/system/b1plan.html">開啟高精度 2D 圖臺</a></div>
    <section className="floor-tabs">{floors.map(name => <button key={name} onClick={() => setFloor(name)} className={floor===name?'active':''}>{name}</button>)}</section>
    <section className="map-layout"><div className="floor-canvas"><div className="grid-lines"/><div className="map-title"><span>{floor}</span><small>設備配置概覽</small></div>{current.map((equipment,index) => { const x=10+(index*23)%78, y=22+(index*31)%62; return <button className={`equipment-marker ${String(equipment.status || '')}`} key={String(equipment.equipment_id)} style={{left:`${x}%`,top:`${y}%`}} title={String(equipment.name)}><i/>{String(equipment.asset_code || index+1)}</button>; })}{!current.length && <p className="map-empty">此樓層尚無設備主檔</p>}</div><aside className="panel equipment-list"><div className="panel-head"><h2>{floor} 設備</h2><span>{current.length} 台</span></div>{current.map(e => <div key={String(e.equipment_id)}><i className={`dot ${String(e.status || '')}`}/><p><strong>{String(e.name || '未命名設備')}</strong><small>{String(e.asset_code || '未編資產碼')}｜{String(e.category || '未分類')}</small></p></div>)}</aside></section>
  </AppShell>;
}
export default function Page() { return <AuthGate>{profile => <EquipmentMap profile={profile} />}</AuthGate>; }

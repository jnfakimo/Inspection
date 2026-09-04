'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { LEGACY_BASE } from '@/lib/config';
import { AdminHeader, type AdminProps, errorMessage, fmtTime, type Row, StatusPill } from './shared';

// 系統 10 / 11 / 12 圖塊模組庫定義
const WIDGET_CATALOG: Record<string, { systemId: number; systemName: string; defaultTitle: string; icon: string; defaultWidth: number; defaultHeight: number; desc: string }> = {
  // 原有系統 / 系統 11 (戰情儀表板)
  alerts: { systemId: 11, systemName: '戰情儀表板', defaultTitle: '重要提醒與異常警報', icon: '🚨', defaultWidth: 12, defaultHeight: 2, desc: '即時重大警報、設備異常跑馬燈' },
  kpis: { systemId: 11, systemName: '戰情儀表板', defaultTitle: '營運關鍵指標', icon: '⚡', defaultWidth: 12, defaultHeight: 2, desc: '進場車次、出勤率、在線率、異常件數' },
  patrol: { systemId: 11, systemName: '戰情儀表板', defaultTitle: '駐衛警巡檢即時', icon: '🛡️', defaultWidth: 8, defaultHeight: 6, desc: '巡檢點打卡進度、排班執勤狀況' },
  repairs: { systemId: 11, systemName: '戰情儀表板', defaultTitle: '報修案件分佈', icon: '🔧', defaultWidth: 4, defaultHeight: 6, desc: '各區報修處理進度與完工率' },
  equipment_status: { systemId: 11, systemName: '戰情儀表板', defaultTitle: '設備狀態監控', icon: '⚙️', defaultWidth: 6, defaultHeight: 4, desc: '冷凍設備、電力系統、消防感測妥善率' },
  
  // 系統 10 (市場營運分析系統)
  trading_kpi: { systemId: 10, systemName: '市場營運分析', defaultTitle: '市場交易量分析', icon: '📦', defaultWidth: 6, defaultHeight: 3, desc: '今日交易量、金額、品項數與成交率' },
  price_comparison: { systemId: 10, systemName: '市場營運分析', defaultTitle: '蔬果價格同期比較', icon: '📈', defaultWidth: 6, defaultHeight: 4, desc: '各類別蔬果本日與昨日均價長條比較' },
  weekly_trend: { systemId: 10, systemName: '市場營運分析', defaultTitle: '每週交易趨勢走勢', icon: '📉', defaultWidth: 8, defaultHeight: 4, desc: '近一週成交量與歷史同期對比柱狀圖' },
  market_allocation: { systemId: 10, systemName: '市場營運分析', defaultTitle: '配置與妥善率儀表', icon: '🎯', defaultWidth: 4, defaultHeight: 4, desc: '市場滿載率、作業人員與車輛配置' },

  // 系統 12 (市場公開看板)
  public_price_board: { systemId: 12, systemName: '市場公開看板', defaultTitle: '公開大宗即時報價看板', icon: '💹', defaultWidth: 6, defaultHeight: 5, desc: '高麗菜、番茄、青花菜等即時行情走勢' },
  market_turnover: { systemId: 12, systemName: '市場公開看板', defaultTitle: '市場公開總成交額', icon: '🌾', defaultWidth: 6, defaultHeight: 4, desc: '近 8 日大宗批發交易總額折線分佈' },
  commodity_ratio: { systemId: 12, systemName: '市場公開看板', defaultTitle: '品項交易佔比分佈', icon: '🥦', defaultWidth: 6, defaultHeight: 4, desc: '葉菜類、根莖類、瓜果類交易比重' },
};

export function LayoutsAdmin({ profile, module }: AdminProps) {
  const [layout, setLayout] = useState<Row | null>(null);
  const [versions, setVersions] = useState<Row[]>([]);
  const [itemsByVersion, setItemsByVersion] = useState<Record<string, Row[]>>({});
  const [selected, setSelected] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [noteText, setNoteText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  
  // 視覺化編輯相關狀態
  const [viewMode, setViewMode] = useState<'visual' | 'table'>('visual');
  const [selectedSystemFilter, setSelectedSystemFilter] = useState<number | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async (options: { preferredVersionId?: string; preserveNote?: boolean } = {}) => {
    setBusy(true);
    if (!options.preserveNote) setNote('');
    try {
      const client = getSupabase();
      const layoutResult = await client.from('dashboard_layouts').select('*').eq('layout_code', 'operations_main').maybeSingle();
      if (layoutResult.error || !layoutResult.data) {
        setNote(`失敗：${errorMessage(layoutResult.error, '戰情版面主檔載入失敗')}`);
        return;
      }
      const [versionResult, itemResult] = await Promise.all([
        client.from('dashboard_layout_versions').select('*').eq('layout_id', layoutResult.data.layout_id).order('version_no', { ascending: false }).limit(200),
        client.from('dashboard_layout_items').select('*').order('sort_order').limit(1000),
      ]);
      if (versionResult.error || itemResult.error) {
        setNote(`失敗：${errorMessage(versionResult.error || itemResult.error, '戰情版面版本載入失敗')}`);
      }
      const versionRows = versionResult.data || [];
      const versionIds = new Set(versionRows.map(row => row.version_id));
      const grouped: Record<string, Row[]> = {};
      (itemResult.data || []).filter(row => versionIds.has(row.version_id)).forEach(row => {
        (grouped[row.version_id] ||= []).push(row);
      });
      setLayout(layoutResult.data);
      setVersions(versionRows);
      setItemsByVersion(grouped);
      const desiredVersion = options.preferredVersionId || selected;
      const preferred = desiredVersion && versionIds.has(desiredVersion) ? desiredVersion : layoutResult.data.published_version_id || versionRows[0]?.version_id || '';
      setSelected(preferred);
      setItems((grouped[preferred] || []).map(row => ({ ...row })));
      setDirty(false);
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '戰情版面載入失敗')}`);
    } finally {
      setBusy(false);
    }
  }, [selected]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [dirty]);

  const selectedVersion = versions.find(row => row.version_id === selected);
  const published = versions.find(row => row.version_id === layout?.published_version_id);

  const choose = (versionId: string) => {
    if (dirty && !window.confirm('目前有尚未儲存的修改，確定切換版本並放棄修改？')) return false;
    setSelected(versionId);
    setItems((itemsByVersion[versionId] || []).map(row => ({ ...row })));
    setNoteText('');
    setDirty(false);
    return true;
  };

  const updateItem = (index: number, patch: Partial<Row>) => {
    setItems(current => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems(current => current.filter((_, itemIndex) => itemIndex !== index));
    setDirty(true);
  };

  const addWidget = (widgetKey: string) => {
    const def = WIDGET_CATALOG[widgetKey] || { defaultTitle: widgetKey, defaultWidth: 6, defaultHeight: 3 };
    const newItem: Row = {
      widget_key: widgetKey,
      title: def.defaultTitle,
      width: def.defaultWidth,
      height: def.defaultHeight,
      visible: true,
      refresh_seconds: 60,
      sort_order: items.length * 10 + 10,
    };
    setItems(current => [...current, newItem]);
    setDirty(true);
    setShowAddModal(false);
  };

  const rpc = async (publish: boolean) => {
    if (!layout || items.length === 0) {
      setNote('失敗：版面至少需要一個圖塊');
      return;
    }
    setBusy(true);
    setNote('');
    const payload = items.map((item, index) => ({
      widget_key: item.widget_key,
      title: item.title,
      x: Number(item.x ?? 0),
      y: Number(item.y ?? 0),
      width: Number(item.width ?? 3),
      height: Number(item.height ?? 2),
      min_width: Number(item.min_width ?? 1),
      min_height: Number(item.min_height ?? 1),
      visible: Boolean(item.visible),
      refresh_seconds: Number(item.refresh_seconds ?? 0),
      config: item.config || {},
      sort_order: index * 10 + 10,
    }));
    const { data, error } = await getSupabase().rpc('save_dashboard_layout_version', {
      p_layout_id: layout.layout_id,
      p_items: payload,
      p_note: noteText.trim() || (publish ? 'V2 後台視覺化發布' : 'V2 後台草稿'),
      p_publish: publish,
    });
    if (error) {
      setNote(`失敗：${errorMessage(error, '版面版本儲存失敗')}`);
      setBusy(false);
      return;
    }
    const newVersionId = typeof data === 'string' ? data : '';
    if (!newVersionId) {
      setNote('失敗：版面已送出，但系統未回傳新版本編號，請重新載入確認');
      setBusy(false);
      return;
    }
    setNoteText('');
    setDirty(false);
    setSelected(newVersionId);
    await load({ preferredVersionId: newVersionId, preserveNote: true });
    setNote(publish ? '新版面已成功發布！' : '草稿版本已儲存');
  };

  const restore = async (version: Row) => {
    if (!window.confirm(`確定將第 ${version.version_no} 版還原為目前發布版？`)) return;
    setBusy(true);
    setNote('');
    const { error } = await getSupabase().rpc('publish_dashboard_layout_version', { p_version_id: version.version_id });
    if (error) {
      setNote(`失敗：${errorMessage(error, '版本復原失敗')}`);
      setBusy(false);
      return;
    }
    setDirty(false);
    await load({ preferredVersionId: version.version_id, preserveNote: true });
    setNote(`第 ${version.version_no} 版已還原並發布`);
  };

  const sortedItems = useMemo(
    () => items.map((item, index) => ({ item, index })).sort((a, b) => Number(a.item.sort_order || a.index) - Number(b.item.sort_order || b.index)),
    [items]
  );

  return (
    <AppShell profile={profile} title={module.title}>
      <AdminHeader
        module={module}
        busy={busy}
        note={note}
        onReload={() => {
          if (!dirty || window.confirm('目前有尚未儲存的修改，確定重新載入並放棄修改？')) void load();
        }}
        action={
          <a
            className="secondary-btn"
            href={`${LEGACY_BASE}/dashboard-builder.html`}
            onClick={event => {
              if (dirty && !window.confirm('目前有尚未儲存的修改，確定離開？')) event.preventDefault();
            }}
          >
            V1 版面預覽
          </a>
        }
      />

      <section className="panel admin-panel" style={{ padding: '20px' }}>
        {/* 頂部版本摘要與模式切換 */}
        <div className="layout-summary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <span style={{ fontSize: '13px', color: 'var(--muted)', display: 'block' }}>目前大螢幕發布版</span>
            <strong style={{ fontSize: '20px', color: 'var(--cyan)' }}>{published ? `第 ${published.version_no} 版` : '尚未發布'}</strong>
            <small style={{ display: 'block', color: 'var(--muted)', marginTop: '4px' }}>{published?.version_note || '—'}・{fmtTime(published?.published_at)}</small>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              編輯版本：
              <select
                value={selected}
                style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line)' }}
                onChange={event => {
                  if (!choose(event.target.value)) event.currentTarget.value = selected;
                }}
              >
                {versions.map(version => (
                  <option key={version.version_id} value={version.version_id}>
                    第 {version.version_no} 版｜{version.state === 'published' ? '已發布' : version.state === 'draft' ? '草稿' : '歷史'}｜{version.version_note || '無備註'}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--line)' }}>
              <button
                type="button"
                style={{ padding: '6px 14px', background: viewMode === 'visual' ? 'var(--cyan)' : 'transparent', color: viewMode === 'visual' ? '#000' : 'var(--text)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                onClick={() => setViewMode('visual')}
              >
                🎛️ 視覺化互動編輯
              </button>
              <button
                type="button"
                style={{ padding: '6px 14px', background: viewMode === 'table' ? 'var(--cyan)' : 'transparent', color: viewMode === 'table' ? '#000' : 'var(--text)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                onClick={() => setViewMode('table')}
              >
                📋 傳統表格清單
              </button>
            </div>
          </div>
        </div>

        {/* 視覺化互動模式 */}
        {viewMode === 'visual' ? (
          <div>
            {/* 工具列：新增模組圖塊 & 系統篩選 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>圖塊系統來源：</span>
                <button
                  type="button"
                  style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--line)', background: selectedSystemFilter === 'all' ? 'var(--cyan)' : 'transparent', color: selectedSystemFilter === 'all' ? '#000' : 'var(--text)', fontSize: '12px', cursor: 'pointer' }}
                  onClick={() => setSelectedSystemFilter('all')}
                >
                  全部系統
                </button>
                <button
                  type="button"
                  style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #f59e0b', background: selectedSystemFilter === 10 ? '#f59e0b' : 'rgba(245,158,11,0.1)', color: selectedSystemFilter === 10 ? '#000' : '#fbbf24', fontSize: '12px', cursor: 'pointer' }}
                  onClick={() => setSelectedSystemFilter(10)}
                >
                  系統 10（市場營運）
                </button>
                <button
                  type="button"
                  style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #ef4444', background: selectedSystemFilter === 11 ? '#ef4444' : 'rgba(239,68,68,0.1)', color: selectedSystemFilter === 11 ? '#fff' : '#fca5a5', fontSize: '12px', cursor: 'pointer' }}
                  onClick={() => setSelectedSystemFilter(11)}
                >
                  系統 11（戰情儀表）
                </button>
                <button
                  type="button"
                  style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #22c55e', background: selectedSystemFilter === 12 ? '#22c55e' : 'rgba(34,197,94,0.1)', color: selectedSystemFilter === 12 ? '#000' : '#86efac', fontSize: '12px', cursor: 'pointer' }}
                  onClick={() => setSelectedSystemFilter(12)}
                >
                  系統 12（公開看板）
                </button>
              </div>

              <button
                type="button"
                className="primary-btn compact"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                onClick={() => setShowAddModal(true)}
              >
                <span>➕</span> 新增圖塊模組
              </button>
            </div>

            {/* 12 欄制視覺化畫布 (Visual Grid Canvas) */}
            <div style={{ background: '#0b1329', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', minHeight: '420px', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px', alignItems: 'start' }}>
              {sortedItems.map(({ item, index }) => {
                const info = WIDGET_CATALOG[item.widget_key] || { systemId: 11, systemName: '戰情系統', icon: '📊', desc: '' };
                const isVisible = Boolean(item.visible);
                const width = Math.min(12, Math.max(1, Number(item.width ?? 6)));
                const height = Math.max(1, Number(item.height ?? 2));
                const heightPx = Math.max(130, height * 70);

                if (selectedSystemFilter !== 'all' && info.systemId !== selectedSystemFilter) {
                  return null;
                }

                return (
                  <div
                    key={`${item.widget_key}-${index}`}
                    style={{
                      gridColumn: `span ${width}`,
                      minHeight: `${heightPx}px`,
                      background: isVisible ? 'rgba(30, 41, 59, 0.85)' : 'rgba(15, 23, 42, 0.4)',
                      border: isVisible ? '1px solid rgba(255,255,255,0.15)' : '1px dashed rgba(255,255,255,0.08)',
                      borderRadius: '10px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      opacity: isVisible ? 1 : 0.6,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                    }}
                  >
                    {/* 卡片標頭與快速控制 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{ fontSize: '18px' }}>{info.icon}</span>
                        <input
                          type="text"
                          value={item.title || ''}
                          style={{ fontWeight: 600, fontSize: '14px', color: '#e2e8f0', background: 'transparent', border: '1px solid transparent', borderBottom: '1px solid rgba(255,255,255,0.2)', padding: '2px 4px', width: '100%', maxWidth: '240px' }}
                          onChange={e => updateItem(index, { title: e.target.value })}
                        />
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            background: info.systemId === 10 ? 'rgba(245,158,11,0.2)' : info.systemId === 12 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                            color: info.systemId === 10 ? '#fbbf24' : info.systemId === 12 ? '#86efac' : '#fca5a5',
                          }}
                        >
                          系統{info.systemId}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={isVisible} onChange={e => updateItem(index, { visible: e.target.checked })} />
                          顯示
                        </label>
                        <button
                          type="button"
                          style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: 'none', borderRadius: '4px', width: '22px', height: '22px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="移除圖塊"
                          onClick={() => removeItem(index)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* 卡片內容示意（即時感受區） */}
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      {item.widget_key === 'alerts' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ fontSize: '12px', color: '#f87171', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
                            冷凍庫 B2 溫度異常 (-2.1°C) - 3分鐘前
                          </div>
                          <div style={{ fontSize: '12px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }}></span>
                            月臺 3 派工排程延遲 15 分鐘
                          </div>
                        </div>
                      )}

                      {item.widget_key === 'kpis' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center' }}>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px' }}><div style={{ fontSize: '10px', color: '#64748b' }}>今日車次</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#60a5fa' }}>1,280</div></div>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px' }}><div style={{ fontSize: '10px', color: '#64748b' }}>巡檢完成</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>94.2%</div></div>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px' }}><div style={{ fontSize: '10px', color: '#64748b' }}>異常案件</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171' }}>3 件</div></div>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px' }}><div style={{ fontSize: '10px', color: '#64748b' }}>在線系統</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#a78bfa' }}>100%</div></div>
                        </div>
                      )}

                      {item.widget_key === 'price_comparison' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}><span style={{ width: '50px' }}>葉菜類</span><div style={{ flex: 1, height: '8px', background: '#3b82f6', borderRadius: '4px' }}></div><span>$38.5</span></div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}><span style={{ width: '50px' }}>瓜果類</span><div style={{ flex: 1, height: '8px', background: '#f59e0b', borderRadius: '4px', width: '70%' }}></div><span>$52.0</span></div>
                        </div>
                      )}

                      {item.widget_key === 'public_price_board' && (
                        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '2px' }}><span>品名</span><span>今日均價</span><span>漲跌</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>初秋高麗菜</span><b>$28.5 / kg</b><span style={{ color: '#4ade80' }}>▲ 2.5</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>牛番茄</span><b>$65.0 / kg</b><span style={{ color: '#f87171' }}>▼ 1.2</span></div>
                        </div>
                      )}

                      {!['alerts', 'kpis', 'price_comparison', 'public_price_board'].includes(item.widget_key) && (
                        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                          {info.desc || `代碼: ${item.widget_key}`}
                          <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '4px' }}>即時動態數據連線中...</div>
                        </div>
                      )}
                    </div>

                    {/* 底部尺寸調整工具列 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>寬度:</span>
                        {[3, 4, 6, 8, 12].map(w => (
                          <button
                            key={w}
                            type="button"
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: width === w ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                              color: width === w ? '#fff' : '#94a3b8',
                              cursor: 'pointer',
                            }}
                            onClick={() => updateItem(index, { width: w })}
                          >
                            {w === 12 ? '全寬' : w === 6 ? '1/2' : w === 4 ? '1/3' : w === 3 ? '1/4' : `${w}/12`}
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>高度:</span>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={height}
                          style={{ width: '44px', padding: '2px 4px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', color: '#e2e8f0', textAlign: 'center', fontSize: '11px' }}
                          onChange={e => updateItem(index, { height: Number(e.target.value) })}
                        />
                        <span style={{ color: 'var(--muted)', fontSize: '10px' }}>({heightPx}px)</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {sortedItems.length === 0 && (
                <div style={{ gridColumn: 'span 12', textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>📋</div>
                  目前版面尚未設定任何圖塊，請點選上方「➕ 新增圖塊模組」開始排版。
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 傳統表格編輯模式 */
          <div className="responsive-table layout-editor">
            <table>
              <thead>
                <tr>
                  <th>順序</th>
                  <th>圖塊代碼</th>
                  <th>顯示標題</th>
                  <th>顯示</th>
                  <th>寬 (1~12)</th>
                  <th>高 (1~20)</th>
                  <th>更新秒數</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(({ item, index }, displayIndex) => (
                  <tr key={`${item.widget_key}-${index}`}>
                    <td>{displayIndex + 1}</td>
                    <td>
                      <code>{item.widget_key}</code>
                    </td>
                    <td>
                      <input value={item.title || ''} onChange={event => updateItem(index, { title: event.target.value })} />
                    </td>
                    <td>
                      <input type="checkbox" checked={Boolean(item.visible)} onChange={event => updateItem(index, { visible: event.target.checked })} />
                    </td>
                    <td>
                      <input type="number" min="1" max="12" value={item.width ?? 3} onChange={event => updateItem(index, { width: Number(event.target.value) })} />
                    </td>
                    <td>
                      <input type="number" min="1" max="20" value={item.height ?? 2} onChange={event => updateItem(index, { height: Number(event.target.value) })} />
                    </td>
                    <td>
                      <input type="number" min="0" max="86400" value={item.refresh_seconds ?? 60} onChange={event => updateItem(index, { refresh_seconds: Number(event.target.value) })} />
                    </td>
                    <td>
                      <button type="button" className="secondary-btn" style={{ color: '#f87171' }} onClick={() => removeItem(index)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 底部儲存與發布操作區 */}
        <div className="admin-layout-actions" style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1', maxWidth: '400px' }}>
            版本備註：
            <input
              value={noteText}
              style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line)' }}
              onChange={event => {
                setNoteText(event.target.value);
                setDirty(true);
              }}
              placeholder="例如：調整市場營運與戰情圖塊佈局"
            />
            {dirty && <small style={{ color: '#f59e0b', whiteSpace: 'nowrap' }}>● 有尚未儲存的修改</small>}
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="secondary-btn" disabled={busy} onClick={() => void rpc(false)}>
              儲存為草稿
            </button>
            <button className="primary-btn compact" style={{ background: 'var(--green)', color: '#000', fontWeight: 700 }} disabled={busy} onClick={() => window.confirm('確定建立新版本並立即發布至大螢幕看板？') && void rpc(true)}>
              🚀 發布新版本
            </button>
            {selectedVersion && selectedVersion.version_id !== layout?.published_version_id && (
              <button className="secondary-btn" disabled={busy} onClick={() => void restore(selectedVersion)}>
                還原為此版本
              </button>
            )}
          </div>
        </div>

        {/* 新增圖塊 Modal */}
        {showAddModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(4px)',
              zIndex: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
            onClick={() => setShowAddModal(false)}
          >
            <div
              style={{
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '680px',
                maxHeight: '80vh',
                overflowY: 'auto',
                padding: '24px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#e2e8f0' }}>📦 選擇要加入的系統圖塊模組</h3>
                <button type="button" style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }} onClick={() => setShowAddModal(false)}>
                  ✕
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {Object.entries(WIDGET_CATALOG).map(([key, def]) => (
                  <div
                    key={key}
                    style={{
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = '#3b82f6';
                      e.currentTarget.style.background = 'rgba(59,130,246,0.1)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.background = 'rgba(0,0,0,0.25)';
                    }}
                    onClick={() => addWidget(key)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '20px' }}>{def.icon}</span>
                      <strong style={{ fontSize: '14px', color: '#f1f5f9' }}>{def.defaultTitle}</strong>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          marginLeft: 'auto',
                          background: def.systemId === 10 ? '#f59e0b22' : def.systemId === 12 ? '#22c55e22' : '#ef444422',
                          color: def.systemId === 10 ? '#fbbf24' : def.systemId === 12 ? '#86efac' : '#fca5a5',
                        }}
                      >
                        系統{def.systemId}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>{def.desc}</p>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b' }}>預設寬度: {def.defaultWidth}/12 欄 ｜ 預設高度: {def.defaultHeight} 單位</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

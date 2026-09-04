'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { LEGACY_BASE } from '@/lib/config';
import { AdminHeader, type AdminProps, errorMessage, fmtTime, type Row } from './shared';

// 系統 10 / 11 / 12 圖塊模組庫完整定義
const WIDGET_CATALOG: Record<
  string,
  {
    systemId: number;
    systemName: string;
    defaultTitle: string;
    icon: string;
    defaultWidth: number;
    defaultHeight: number;
    desc: string;
  }
> = {
  // === 系統 10 (市場營運分析系統) ===
  trading_kpi: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '市場交易量分析',
    icon: '📦',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '今日交易量、金額、品項數與成交率',
  },
  price_comparison: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '蔬果價格同期比較',
    icon: '📈',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '各類別蔬果本日與昨日均價長條比較',
  },
  weekly_trend: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '每週交易趨勢走勢',
    icon: '📉',
    defaultWidth: 8,
    defaultHeight: 4,
    desc: '近一週成交量與歷史同期對比柱狀圖',
  },
  market_allocation: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '配置與妥善率儀表',
    icon: '🎯',
    defaultWidth: 4,
    defaultHeight: 4,
    desc: '市場滿載率、作業人員與車輛配置',
  },
  supplier_ranking: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '主要產地／供應商進貨排行',
    icon: '🚛',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '西螺、溪湖、九如等各產區到貨噸數排行',
  },
  price_volatility: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '行情波動與異常價位警示',
    icon: '⚠️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '單日漲跌超過 15% 異常波動品項監控',
  },
  auction_efficiency: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '拍賣場次交易進度與速度',
    icon: '⚡',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '第一/第二拍賣場即時進度與每批均速',
  },
  floor_congestion: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '卸貨場區滿載率與車流動態',
    icon: '🅿️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '大車卸貨泊位佔用與等待進場車流動態',
  },

  // === 系統 11 (戰情儀表板／指揮中心) ===
  alerts: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '重要提醒與異常警報',
    icon: '🚨',
    defaultWidth: 12,
    defaultHeight: 2,
    desc: '即時重大警報、設備異常跑馬燈',
  },
  kpis: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '營運關鍵指標',
    icon: '⚡',
    defaultWidth: 12,
    defaultHeight: 2,
    desc: '進場車次、出勤率、在線率、異常件數',
  },
  patrol: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '駐衛警巡檢即時',
    icon: '🛡️',
    defaultWidth: 8,
    defaultHeight: 6,
    desc: '巡檢點打卡進度、排班執勤狀況',
  },
  repairs: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '報修案件分佈',
    icon: '🔧',
    defaultWidth: 4,
    defaultHeight: 6,
    desc: '各區報修處理進度與完工率',
  },
  equipment_status: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '設備狀態監控',
    icon: '⚙️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '冷凍設備、電力系統、消防感測妥善率',
  },
  realtime_incident_map: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '全場異常事件即時地圖',
    icon: '🗺️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '全市場熱點分佈、緊急應變案件定位',
  },
  sla_compliance: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '維修 SLA 達成率與 MTTR',
    icon: '⏱️',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '修復平均時間 MTTR 與 SLA 達標統計',
  },
  staff_duty_matrix: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '在勤人員打卡與跨班排班',
    icon: '👥',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '日班/夜班在勤人力配置與即時簽到',
  },
  cctv_ipcam_grid: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '關鍵場區攝影機監控雲臺',
    icon: '📹',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '拍賣區、進出閘口即時影像聯網輪播',
  },
  weather_risk_radar: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '氣象特報與防汛應變',
    icon: '🌧️',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '降雨機率、颱風豪雨警報與防汛整備級別',
  },

  // === 系統 12 (市場公開看板) ===
  public_price_board: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '公開大宗即時報價看板',
    icon: '💹',
    defaultWidth: 6,
    defaultHeight: 5,
    desc: '高麗菜、番茄、青花菜等即時行情走勢',
  },
  market_turnover: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '市場公開總成交額',
    icon: '🌾',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '近 8 日大宗批發交易總額折線分佈',
  },
  commodity_ratio: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '品項交易佔比分佈',
    icon: '🥦',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '葉菜類、根莖類、瓜果類交易比重',
  },
  realtime_ticker: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '即時滾動跑馬燈行情',
    icon: '📢',
    defaultWidth: 12,
    defaultHeight: 2,
    desc: '各拍賣台最新成交批次及時文字廣播',
  },
  top_gainers_losers: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '今日蔬果漲跌幅排行榜',
    icon: '📊',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '本日漲幅前三、跌幅前三蔬果統計',
  },
  origin_weather_map: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '主要產地天氣與供貨狀態',
    icon: '⛅',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '中南部主產地天候降雨與路況概況',
  },
  historical_price_curve: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '30日/同季歷史價格曲線',
    icon: '📉',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '歷史同期比價與 30 日均價趨勢曲線',
  },
  consumer_guide_board: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '平價蔬果專區與供應指引',
    icon: '🛒',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '平價供應專區資訊與大宗採購指引',
  },
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
  const [modalFilter, setModalFilter] = useState<number | 'all'>('all');

  const load = useCallback(
    async (options: { preferredVersionId?: string; preserveNote?: boolean } = {}) => {
      setBusy(true);
      if (!options.preserveNote) setNote('');
      try {
        const client = getSupabase();
        const layoutResult = await client
          .from('dashboard_layouts')
          .select('*')
          .eq('layout_code', 'operations_main')
          .maybeSingle();
        if (layoutResult.error || !layoutResult.data) {
          setNote(`失敗：${errorMessage(layoutResult.error, '戰情版面主檔載入失敗')}`);
          return;
        }
        const [versionResult, itemResult] = await Promise.all([
          client
            .from('dashboard_layout_versions')
            .select('*')
            .eq('layout_id', layoutResult.data.layout_id)
            .order('version_no', { ascending: false })
            .limit(200),
          client.from('dashboard_layout_items').select('*').order('sort_order').limit(1000),
        ]);
        if (versionResult.error || itemResult.error) {
          setNote(
            `失敗：${errorMessage(versionResult.error || itemResult.error, '戰情版面版本載入失敗')}`
          );
        }
        const versionRows = versionResult.data || [];
        const versionIds = new Set(versionRows.map(row => row.version_id));
        const grouped: Record<string, Row[]> = {};
        (itemResult.data || [])
          .filter(row => versionIds.has(row.version_id))
          .forEach(row => {
            (grouped[row.version_id] ||= []).push(row);
          });
        setLayout(layoutResult.data);
        setVersions(versionRows);
        setItemsByVersion(grouped);
        const desiredVersion = options.preferredVersionId || selected;
        const preferred =
          desiredVersion && versionIds.has(desiredVersion)
            ? desiredVersion
            : layoutResult.data.published_version_id || versionRows[0]?.version_id || '';
        setSelected(preferred);
        setItems((grouped[preferred] || []).map(row => ({ ...row })));
        setDirty(false);
      } catch (error) {
        setNote(`失敗：${errorMessage(error, '戰情版面載入失敗')}`);
      } finally {
        setBusy(false);
      }
    },
    [selected]
  );

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
    setItems(current =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems(current => current.filter((_, itemIndex) => itemIndex !== index));
    setDirty(true);
  };

  const addWidget = (widgetKey: string) => {
    const def = WIDGET_CATALOG[widgetKey] || {
      defaultTitle: widgetKey,
      defaultWidth: 6,
      defaultHeight: 3,
    };
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
    try {
      const payload = items.map((item, index) => ({
        widget_key: String(item.widget_key || '').trim(),
        title: String(item.title || '').trim(),
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        width: Math.max(1, Math.min(12, Number(item.width || 6))),
        height: Math.max(1, Math.min(20, Number(item.height || 3))),
        min_width: Number(item.min_width ?? 1),
        min_height: Number(item.min_height ?? 1),
        visible: Boolean(item.visible),
        refresh_seconds: Math.max(0, Math.min(86400, Number(item.refresh_seconds || 60))),
        config: item.config || {},
        sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : index * 10 + 10,
      }));

      const emptyKey = payload.find(item => !item.widget_key);
      if (emptyKey) {
        setNote('失敗：圖塊代碼不可為空');
        setBusy(false);
        return;
      }

      const { data, error } = await getSupabase().rpc('save_dashboard_layout_version', {
        p_layout_id: layout.layout_id,
        p_items: payload,
        p_note: noteText.trim() || (publish ? 'V2 後台發布' : 'V2 後台草稿'),
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
      setNote(publish ? '新版面已發布' : '草稿版本已儲存');
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '版面儲存失敗')}`);
      setBusy(false);
    }
  };

  const restore = async (targetVersion: Row) => {
    if (!layout) return;
    if (
      !window.confirm(
        `確定將第 ${targetVersion.version_no} 版還原為目前發布版？`
      )
    )
      return;
    setBusy(true);
    setNote('');
    try {
      const { error } = await getSupabase().rpc('publish_dashboard_layout_version', {
        p_version_id: targetVersion.version_id,
      });
      if (error) {
        setNote(`失敗：${errorMessage(error, '版本復原失敗')}`);
        setBusy(false);
        return;
      }
      setDirty(false);
      await load({ preferredVersionId: targetVersion.version_id, preserveNote: true });
      setNote(`第 ${targetVersion.version_no} 版已還原並發布`);
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '版本還原發布失敗')}`);
      setBusy(false);
    }
  };

  const sortedItems = useMemo(
    () =>
      items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => Number(a.item.sort_order || a.index) - Number(b.item.sort_order || b.index)),
    [items]
  );

  const filteredModalCatalog = useMemo(() => {
    return Object.entries(WIDGET_CATALOG).filter(([_, def]) => {
      if (modalFilter === 'all') return true;
      return def.systemId === modalFilter;
    });
  }, [modalFilter]);

  return (
    <AppShell profile={profile} title={module.title}>
      <AdminHeader
        module={module}
        busy={busy}
        note={note}
        onReload={() => {
          if (!dirty || window.confirm('目前有尚未儲存的修改，確定重新載入並放棄修改？')) {
            void load();
          }
        }}
        action={
          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
            <a
              href="/Inspection/v2/systems/dashboard/display/"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-btn compact"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              🖥️ 開啟全螢幕戰情看板
            </a>
            <a
              href={`${LEGACY_BASE}/dashboard-builder.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-btn compact"
              style={{ textDecoration: 'none' }}
              onClick={event => {
                if (dirty && !window.confirm('目前有尚未儲存的修改，確定離開 V2 版面編輯器？')) {
                  event.preventDefault();
                }
              }}
            >
              舊版相容入口
            </a>
          </div>
        }
      />

      <section className="panel admin-panel" style={{ marginTop: '12px' }}>
        {/* 控制列：版本切換與編輯模式 */}
        <div
          className="admin-toolbar"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong>目前編輯版本：</strong>
              <select
                value={selected}
                disabled={busy}
                onChange={event => {
                  if (!choose(event.target.value)) event.currentTarget.value = selected;
                }}
                style={{ padding: '6px 12px', borderRadius: '6px' }}
              >
                {versions.map(version => (
                  <option key={version.version_id} value={version.version_id}>
                    第 {version.version_no} 版｜
                    {version.state === 'published' ? '已發布' : version.state === 'draft' ? '草稿' : '歷史'}｜
                    {version.version_note || '無備註'}
                  </option>
                ))}
              </select>
            </label>

            {published && (
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                大螢幕生效版本：<strong>第 {published.version_no} 版</strong> (
                {fmtTime(published.published_at || published.created_at)})
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--surface)',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
            }}
          >
            <button
              type="button"
              className={`segmented-btn ${viewMode === 'visual' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: viewMode === 'visual' ? 'var(--cyan)' : 'transparent',
                color: viewMode === 'visual' ? '#000' : 'var(--text)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
              }}
              onClick={() => setViewMode('visual')}
            >
              🎨 12欄視覺化畫布
            </button>
            <button
              type="button"
              className={`segmented-btn ${viewMode === 'table' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: viewMode === 'table' ? 'var(--cyan)' : 'transparent',
                color: viewMode === 'table' ? '#000' : 'var(--text)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
              }}
              onClick={() => setViewMode('table')}
            >
              📋 列表參數調整
            </button>
          </div>
        </div>

        {viewMode === 'visual' ? (
          /* 12 欄視覺化互動排版區 */
          <div style={{ marginTop: '16px' }}>
            {/* 工具列：新增模組圖塊 & 系統篩選 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '16px',
                background: 'rgba(0,0,0,0.2)',
                padding: '12px 16px',
                borderRadius: '8px',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>
                  圖塊系統來源：
                </span>
                <button
                  type="button"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--line)',
                    background: selectedSystemFilter === 'all' ? 'var(--cyan)' : 'transparent',
                    color: selectedSystemFilter === 'all' ? '#000' : 'var(--text)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedSystemFilter('all')}
                >
                  全部系統
                </button>
                <button
                  type="button"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid #f59e0b',
                    background:
                      selectedSystemFilter === 10 ? '#f59e0b' : 'rgba(245,158,11,0.1)',
                    color: selectedSystemFilter === 10 ? '#000' : '#fbbf24',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedSystemFilter(10)}
                >
                  系統 10（市場營運）
                </button>
                <button
                  type="button"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid #ef4444',
                    background:
                      selectedSystemFilter === 11 ? '#ef4444' : 'rgba(239,68,68,0.1)',
                    color: selectedSystemFilter === 11 ? '#fff' : '#fca5a5',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedSystemFilter(11)}
                >
                  系統 11（戰情指揮）
                </button>
                <button
                  type="button"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid #22c55e',
                    background:
                      selectedSystemFilter === 12 ? '#22c55e' : 'rgba(34,197,94,0.1)',
                    color: selectedSystemFilter === 12 ? '#000' : '#86efac',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedSystemFilter(12)}
                >
                  系統 12（公開看板）
                </button>
              </div>

              <button
                type="button"
                className="primary-btn compact"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                onClick={() => setShowAddModal(true)}
              >
                <span>➕</span> 新增圖塊模組
              </button>
            </div>

            {/* 12 欄制視覺化畫布 (Visual Grid Canvas) */}
            <div
              style={{
                background: '#0b1329',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.08)',
                minHeight: '420px',
                display: 'grid',
                gridTemplateColumns: 'repeat(12, 1fr)',
                gap: '14px',
                alignItems: 'start',
              }}
            >
              {sortedItems.map(({ item, index }) => {
                const info = WIDGET_CATALOG[item.widget_key] || {
                  systemId: 11,
                  systemName: '戰情系統',
                  icon: '📊',
                  desc: '',
                };
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
                      background: isVisible
                        ? 'rgba(30, 41, 59, 0.85)'
                        : 'rgba(15, 23, 42, 0.4)',
                      border: isVisible
                        ? '1px solid rgba(255,255,255,0.15)'
                        : '1px dashed rgba(255,255,255,0.08)',
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
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '10px',
                        gap: '8px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        paddingBottom: '8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          minWidth: 0,
                        }}
                      >
                        <span style={{ fontSize: '18px' }}>{info.icon}</span>
                        <input
                          type="text"
                          value={item.title || ''}
                          style={{
                            fontWeight: 600,
                            fontSize: '14px',
                            color: '#e2e8f0',
                            background: 'transparent',
                            border: '1px solid transparent',
                            borderBottom: '1px solid rgba(255,255,255,0.2)',
                            padding: '2px 4px',
                            width: '100%',
                            maxWidth: '240px',
                          }}
                          onChange={e => updateItem(index, { title: e.target.value })}
                        />
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            background:
                              info.systemId === 10
                                ? 'rgba(245,158,11,0.2)'
                                : info.systemId === 12
                                ? 'rgba(34,197,94,0.2)'
                                : 'rgba(239,68,68,0.2)',
                            color:
                              info.systemId === 10
                                ? '#fbbf24'
                                : info.systemId === 12
                                ? '#86efac'
                                : '#fca5a5',
                          }}
                        >
                          系統{info.systemId}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label
                          style={{
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--muted)',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={e => updateItem(index, { visible: e.target.checked })}
                          />
                          顯示
                        </label>
                        <button
                          type="button"
                          style={{
                            background: 'rgba(239,68,68,0.15)',
                            color: '#fca5a5',
                            border: 'none',
                            borderRadius: '4px',
                            width: '22px',
                            height: '22px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          title="移除圖塊"
                          onClick={() => removeItem(index)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* 卡片內容示意（即時感受區） */}
                    <div
                      style={{
                        flex: 1,
                        background: 'rgba(0,0,0,0.25)',
                        borderRadius: '6px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                    >
                      {/* 系統 11 預覽 */}
                      {item.widget_key === 'alerts' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              color: '#f87171',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#ef4444',
                              }}
                            ></span>
                            冷凍庫 B2 溫度異常 (-2.1°C) - 3分鐘前
                          </div>
                          <div
                            style={{
                              fontSize: '12px',
                              color: '#fbbf24',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#f59e0b',
                              }}
                            ></span>
                            月臺 3 派工排程延遲 15 分鐘
                          </div>
                        </div>
                      )}

                      {item.widget_key === 'kpis' && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '8px',
                            textAlign: 'center',
                          }}
                        >
                          <div
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              padding: '6px',
                              borderRadius: '4px',
                            }}
                          >
                            <div style={{ fontSize: '10px', color: '#64748b' }}>今日車次</div>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: '#60a5fa' }}>
                              1,280
                            </div>
                          </div>
                          <div
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              padding: '6px',
                              borderRadius: '4px',
                            }}
                          >
                            <div style={{ fontSize: '10px', color: '#64748b' }}>巡檢完成</div>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                              94.2%
                            </div>
                          </div>
                          <div
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              padding: '6px',
                              borderRadius: '4px',
                            }}
                          >
                            <div style={{ fontSize: '10px', color: '#64748b' }}>異常案件</div>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171' }}>
                              3 件
                            </div>
                          </div>
                          <div
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              padding: '6px',
                              borderRadius: '4px',
                            }}
                          >
                            <div style={{ fontSize: '10px', color: '#64748b' }}>在線系統</div>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: '#a78bfa' }}>
                              100%
                            </div>
                          </div>
                        </div>
                      )}

                      {item.widget_key === 'patrol' && (
                        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                            <span>巡檢路線 12/14 處已完成</span>
                            <span style={{ color: '#34d399' }}>85.7%</span>
                          </div>
                          <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: '85.7%', height: '100%', background: '#10b981' }}></div>
                          </div>
                          <div style={{ color: '#64748b', fontSize: '10px', marginTop: '2px' }}>巡邏中人員：4 名 ｜ 異常通報：0 筆</div>
                        </div>
                      )}

                      {item.widget_key === 'repairs' && (
                        <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', fontSize: '11px' }}>
                          <div><div style={{ color: '#ef4444', fontWeight: 700, fontSize: '16px' }}>1</div><div style={{ color: '#64748b' }}>緊急處理</div></div>
                          <div><div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '16px' }}>8</div><div style={{ color: '#64748b' }}>進行中</div></div>
                          <div><div style={{ color: '#10b981', fontWeight: 700, fontSize: '16px' }}>24</div><div style={{ color: '#64748b' }}>已結案</div></div>
                        </div>
                      )}

                      {item.widget_key === 'equipment_status' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', textAlign: 'center', fontSize: '11px' }}>
                          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '4px' }}><div style={{ color: '#38bdf8' }}>低溫冷鏈</div><b style={{ color: '#4ade80' }}>99.2%</b></div>
                          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '4px' }}><div style={{ color: '#38bdf8' }}>自動磅秤</div><b style={{ color: '#4ade80' }}>100%</b></div>
                          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '4px' }}><div style={{ color: '#38bdf8' }}>排風系統</div><b style={{ color: '#facc15' }}>97.5%</b></div>
                        </div>
                      )}

                      {item.widget_key === 'realtime_incident_map' && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: '#94a3b8' }}>🗺️ 果菜 A 棟 / 卸貨月台熱區</span>
                          <span style={{ color: '#f87171', fontWeight: 600 }}>2 處待派工處理</span>
                        </div>
                      )}

                      {item.widget_key === 'sla_compliance' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                          <div>SLA 達標率: <b style={{ color: '#34d399' }}>98.6%</b></div>
                          <div>平均修復: <b style={{ color: '#60a5fa' }}>42 分鐘</b></div>
                        </div>
                      )}

                      {item.widget_key === 'staff_duty_matrix' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span>在勤人力: <b>38 人</b></span>
                          <span style={{ color: '#60a5fa' }}>早班 28 ｜ 駐警 6 ｜ 機電 4</span>
                        </div>
                      )}

                      {item.widget_key === 'cctv_ipcam_grid' && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }}></span>
                          CAM-01 拍賣一場 ｜ CAM-04 北進貨門 [即時聯播]
                        </div>
                      )}

                      {item.widget_key === 'weather_risk_radar' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                          <span>降雨機率: <b style={{ color: '#60a5fa' }}>20% (氣溫 26°C)</b></span>
                          <span style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: '4px' }}>防汛綠燈正常</span>
                        </div>
                      )}

                      {/* 系統 10 預覽 */}
                      {item.widget_key === 'trading_kpi' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', textAlign: 'center', fontSize: '11px' }}>
                          <div><div style={{ color: '#64748b', fontSize: '10px' }}>總交易量</div><b style={{ color: '#fbbf24' }}>1,480t</b></div>
                          <div><div style={{ color: '#64748b', fontSize: '10px' }}>總交易額</div><b style={{ color: '#34d399' }}>$4,820萬</b></div>
                          <div><div style={{ color: '#64748b', fontSize: '10px' }}>品項數</div><b style={{ color: '#60a5fa' }}>186種</b></div>
                          <div><div style={{ color: '#64748b', fontSize: '10px' }}>成交率</div><b style={{ color: '#a78bfa' }}>99.4%</b></div>
                        </div>
                      )}

                      {item.widget_key === 'price_comparison' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                            <span style={{ width: '50px' }}>葉菜類</span>
                            <div style={{ flex: 1, height: '8px', background: '#3b82f6', borderRadius: '4px' }}></div>
                            <span>$38.5</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                            <span style={{ width: '50px' }}>瓜果類</span>
                            <div style={{ flex: 1, height: '8px', background: '#f59e0b', borderRadius: '4px', width: '70%' }}></div>
                            <span>$52.0</span>
                          </div>
                        </div>
                      )}

                      {item.widget_key === 'weekly_trend' && (
                        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                            <span>近 7 日批發成交量曲線</span>
                            <span style={{ color: '#38bdf8' }}>穩健上升 +4.2%</span>
                          </div>
                          <div style={{ display: 'flex', gap: '4px', height: '24px', alignItems: 'flex-end', paddingTop: '4px' }}>
                            <div style={{ flex: 1, height: '40%', background: '#3b82f6', borderRadius: '2px' }}></div>
                            <div style={{ flex: 1, height: '60%', background: '#3b82f6', borderRadius: '2px' }}></div>
                            <div style={{ flex: 1, height: '50%', background: '#3b82f6', borderRadius: '2px' }}></div>
                            <div style={{ flex: 1, height: '80%', background: '#3b82f6', borderRadius: '2px' }}></div>
                            <div style={{ flex: 1, height: '70%', background: '#3b82f6', borderRadius: '2px' }}></div>
                            <div style={{ flex: 1, height: '95%', background: '#10b981', borderRadius: '2px' }}></div>
                            <div style={{ flex: 1, height: '85%', background: '#10b981', borderRadius: '2px' }}></div>
                          </div>
                        </div>
                      )}

                      {item.widget_key === 'market_allocation' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span>場區滿載率: <b style={{ color: '#f59e0b' }}>86%</b></span>
                          <span>搬運車配置: <b style={{ color: '#60a5fa' }}>42/48 台</b></span>
                        </div>
                      )}

                      {item.widget_key === 'supplier_ranking' && (
                        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>1. 雲林西螺農會</span><b>420 噸</b></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>2. 彰化溪湖果菜</span><b>310 噸</b></div>
                        </div>
                      )}

                      {item.widget_key === 'price_volatility' && (
                        <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>波動品項: <b>青蔥 (+24.5%)</b></span>
                          <span style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 4px', borderRadius: '3px' }}>漲幅過高</span>
                        </div>
                      )}

                      {item.widget_key === 'auction_efficiency' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span>第 1 拍賣場: <b style={{ color: '#34d399' }}>88%</b></span>
                          <span>均速: <b style={{ color: '#60a5fa' }}>12 秒/批</b></span>
                        </div>
                      )}

                      {item.widget_key === 'floor_congestion' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span>泊位佔用: <b style={{ color: '#f59e0b' }}>8/10</b></span>
                          <span>進場排隊: <b>4 輛</b></span>
                        </div>
                      )}

                      {/* 系統 12 預覽 */}
                      {item.widget_key === 'public_price_board' && (
                        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '2px' }}>
                            <span>品名</span><span>今日均價</span><span>漲跌</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>初秋高麗菜</span><b>$28.5 / kg</b><span style={{ color: '#4ade80' }}>▲ 2.5</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>牛番茄</span><b>$65.0 / kg</b><span style={{ color: '#f87171' }}>▼ 1.2</span>
                          </div>
                        </div>
                      )}

                      {item.widget_key === 'market_turnover' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                          <span>累積成交額: <b style={{ color: '#22c55e', fontSize: '13px' }}>$48,250,000</b></span>
                          <span style={{ color: '#4ade80' }}>+6.8%</span>
                        </div>
                      )}

                      {item.widget_key === 'commodity_ratio' && (
                        <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', fontSize: '11px' }}>
                          <div><div style={{ color: '#34d399' }}>葉菜</div><b>45%</b></div>
                          <div><div style={{ color: '#f59e0b' }}>根莖</div><b>28%</b></div>
                          <div><div style={{ color: '#60a5fa' }}>瓜果</div><b>18%</b></div>
                          <div><div style={{ color: '#a78bfa' }}>其他</div><b>9%</b></div>
                        </div>
                      )}

                      {item.widget_key === 'realtime_ticker' && (
                        <div style={{ fontSize: '11px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8' }}></span>
                          【拍賣廣播】05:42 批號 A-882 西螺甘藍 2,000kg 順利敲定...
                        </div>
                      )}

                      {item.widget_key === 'top_gainers_losers' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: '#4ade80' }}>▲ 牛角椒 +28%</span>
                          <span style={{ color: '#f87171' }}>▼ 胡瓜 -18%</span>
                        </div>
                      )}

                      {item.widget_key === 'origin_weather_map' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span>雲林: <b>多雲 24°C</b></span>
                          <span style={{ color: '#34d399' }}>供貨正常</span>
                        </div>
                      )}

                      {item.widget_key === 'historical_price_curve' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span>本月均價: <b>$34.2</b></span>
                          <span style={{ color: '#64748b' }}>去年同期 $31.8</span>
                        </div>
                      )}

                      {item.widget_key === 'consumer_guide_board' && (
                        <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>今日平價推薦: <b>包心白菜 ($22/kg)</b></span>
                        </div>
                      )}

                      {/* 未定義預設 fallback */}
                      {!WIDGET_CATALOG[item.widget_key] && (
                        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                          {info.desc || `代碼: ${item.widget_key}`}
                          <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '4px' }}>
                            即時動態數據連線中...
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 底部尺寸調整工具列 */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '10px',
                        paddingTop: '8px',
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        fontSize: '12px',
                      }}
                    >
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
                            {w === 12
                              ? '全寬'
                              : w === 6
                              ? '1/2'
                              : w === 4
                              ? '1/3'
                              : w === 3
                              ? '1/4'
                              : `${w}/12`}
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
                          style={{
                            width: '44px',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#e2e8f0',
                            textAlign: 'center',
                            fontSize: '11px',
                          }}
                          onChange={e => updateItem(index, { height: Number(e.target.value) })}
                        />
                        <span style={{ color: 'var(--muted)', fontSize: '10px' }}>({heightPx}px)</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {sortedItems.length === 0 && (
                <div
                  style={{
                    gridColumn: 'span 12',
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#64748b',
                  }}
                >
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
                      <input
                        value={item.title || ''}
                        onChange={event => updateItem(index, { title: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(item.visible)}
                        onChange={event => updateItem(index, { visible: event.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={item.width ?? 3}
                        onChange={event => updateItem(index, { width: Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={item.height ?? 2}
                        onChange={event => updateItem(index, { height: Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="86400"
                        value={item.refresh_seconds ?? 60}
                        onChange={event =>
                          updateItem(index, { refresh_seconds: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ color: '#f87171' }}
                        onClick={() => removeItem(index)}
                      >
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
        <div
          className="admin-layout-actions"
          style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flex: '1',
              maxWidth: '400px',
            }}
          >
            版本備註：
            <input
              value={noteText}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--line)',
              }}
              onChange={event => {
                setNoteText(event.target.value);
                setDirty(true);
              }}
              placeholder="例如：擴充第10、11、12系統完整圖塊版面"
            />
            {dirty && (
              <small style={{ color: '#f59e0b', whiteSpace: 'nowrap' }}>
                ● 有尚未儲存的修改
              </small>
            )}
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="secondary-btn" disabled={busy} onClick={() => void rpc(false)}>
              儲存為草稿
            </button>
            <button
              className="primary-btn compact"
              style={{ background: 'var(--green)', color: '#000', fontWeight: 700 }}
              disabled={busy}
              onClick={() =>
                window.confirm('確定建立新版本並立即發布至大螢幕看板？') && void rpc(true)
              }
            >
              🚀 發布新版本
            </button>
            {selectedVersion &&
              selectedVersion.version_id !== layout?.published_version_id && (
                <button
                  className="secondary-btn"
                  disabled={busy}
                  onClick={() => void restore(selectedVersion)}
                >
                  還原為此版本
                </button>
              )}
          </div>
        </div>

        {/* 新增圖塊 Modal (具備分類切換) */}
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
                maxWidth: '780px',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                overflow: 'hidden',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '20px 24px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', color: '#e2e8f0' }}>
                    📦 選擇要加入的系統圖塊模組
                  </h3>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                    點選下列圖塊即可加入至目前戰情排版中，加入後可直接在畫布上調整寬度與高度。
                  </div>
                </div>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '20px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setShowAddModal(false)}
                >
                  ✕
                </button>
              </div>

              {/* 彈窗分類標籤 */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '12px 24px',
                  background: 'rgba(0,0,0,0.2)',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--line)',
                    background: modalFilter === 'all' ? '#3b82f6' : 'transparent',
                    color: modalFilter === 'all' ? '#fff' : '#94a3b8',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setModalFilter('all')}
                >
                  全部 ({Object.keys(WIDGET_CATALOG).length})
                </button>
                <button
                  type="button"
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid #f59e0b',
                    background: modalFilter === 10 ? '#f59e0b' : 'rgba(245,158,11,0.1)',
                    color: modalFilter === 10 ? '#000' : '#fbbf24',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setModalFilter(10)}
                >
                  系統 10（市場營運分析 · 8）
                </button>
                <button
                  type="button"
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid #ef4444',
                    background: modalFilter === 11 ? '#ef4444' : 'rgba(239,68,68,0.1)',
                    color: modalFilter === 11 ? '#fff' : '#fca5a5',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setModalFilter(11)}
                >
                  系統 11（戰情指揮中心 · 10）
                </button>
                <button
                  type="button"
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '1px solid #22c55e',
                    background: modalFilter === 12 ? '#22c55e' : 'rgba(34,197,94,0.1)',
                    color: modalFilter === 12 ? '#000' : '#86efac',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setModalFilter(12)}
                >
                  系統 12（市場公開看板 · 8）
                </button>
              </div>

              {/* 彈窗圖塊列表 */}
              <div
                style={{
                  padding: '20px 24px',
                  overflowY: 'auto',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: '12px',
                }}
              >
                {filteredModalCatalog.map(([key, def]) => (
                  <div
                    key={key}
                    style={{
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '14px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
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
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>{def.icon}</span>
                      <strong style={{ fontSize: '14px', color: '#f1f5f9' }}>
                        {def.defaultTitle}
                      </strong>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          marginLeft: 'auto',
                          fontWeight: 700,
                          background:
                            def.systemId === 10
                              ? '#f59e0b22'
                              : def.systemId === 12
                              ? '#22c55e22'
                              : '#ef444422',
                          color:
                            def.systemId === 10
                              ? '#fbbf24'
                              : def.systemId === 12
                              ? '#86efac'
                              : '#fca5a5',
                        }}
                      >
                        系統{def.systemId}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '12px',
                        color: '#94a3b8',
                        lineHeight: 1.4,
                      }}
                    >
                      {def.desc}
                    </p>
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '11px',
                        color: '#64748b',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        代碼: <code>{key}</code>
                      </span>
                      <span>
                        預設寬 {def.defaultWidth}/12 · 高 {def.defaultHeight}
                      </span>
                    </div>
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

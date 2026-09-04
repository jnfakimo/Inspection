'use client';

import { useEffect, useState } from 'react';
import type { Profile } from '@/types/app';
import { getSupabase } from '@/lib/supabase';
import { DashboardWidgetContent } from '@/components/DashboardWidgetContent';
import '../dashboard.css';

type TvClientProps = { profile: Profile };

type LayoutItem = {
  widget_key: string;
  title: string;
  width?: number;
  height?: number;
  visible?: boolean;
  refresh_seconds?: number;
  config?: {
    canvas_dimension?: {
      width?: number;
      height?: number;
      cols?: number;
    };
  };
};

const WIDGET_ICONS: Record<string, string> = {
  alerts: '🚨',
  kpis: '⚡',
  patrol: '🛡️',
  repairs: '🔧',
  equipment_status: '⚙️',
  realtime_incident_map: '🗺️',
  sla_compliance: '⏱️',
  staff_duty_matrix: '👥',
  cctv_ipcam_grid: '📹',
  weather_risk_radar: '🌧️',
  weather_taiwan: '🌦️',
  rank_dept: '📊',
  rank_equipment: '🛠️',
  rank_technician: '👷',
  rank_fault: '🔍',
  trend: '📅',
  trading_kpi: '📦',
  price_comparison: '📈',
  weekly_trend: '📉',
  market_allocation: '🎯',
  supplier_ranking: '🚛',
  price_volatility: '⚠️',
  auction_efficiency: '⚡',
  floor_congestion: '🅿️',
  public_price_board: '💹',
  market_turnover: '🌾',
  commodity_ratio: '🥦',
  realtime_ticker: '📢',
  top_gainers_losers: '📊',
  origin_weather_map: '⛅',
  historical_price_curve: '📉',
  consumer_guide_board: '🛒',
};

const DEFAULT_ITEMS: LayoutItem[] = [
  { widget_key: 'alerts', title: '重要提醒與異常警報', width: 12, height: 2, visible: true },
  { widget_key: 'kpis', title: '營運關鍵指標', width: 12, height: 2, visible: true },
  { widget_key: 'patrol', title: '駐衛警巡檢即時', width: 8, height: 4, visible: true },
  { widget_key: 'repairs', title: '報修案件分佈', width: 4, height: 4, visible: true },
  { widget_key: 'equipment_status', title: '設備狀態監控', width: 6, height: 4, visible: true },
  { widget_key: 'trading_kpi', title: '市場交易量分析', width: 6, height: 3, visible: true },
  { widget_key: 'price_comparison', title: '蔬果價格同期比較', width: 6, height: 4, visible: true },
  { widget_key: 'public_price_board', title: '公開大宗即時報價看板', width: 6, height: 5, visible: true },
  { widget_key: 'rank_dept', title: '各單位報修排行', width: 6, height: 4, visible: true },
  { widget_key: 'origin_weather_map', title: '主要產地天氣與供貨狀態', width: 6, height: 4, visible: true },
  { widget_key: 'historical_price_curve', title: '30日/同季歷史價格曲線', width: 12, height: 4, visible: true },
];

export function TvClient({ profile: _profile }: TvClientProps) {
  const [time, setTime] = useState(new Date());
  const [items, setItems] = useState<LayoutItem[]>(DEFAULT_ITEMS);
  const [cols, setCols] = useState<number>(12);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function loadPublishedLayout() {
      let loadedFromDb = false;

      // 1. 嘗試由 Supabase 資料庫讀取正式發布版面
      try {
        const client = getSupabase();
        const layoutRes = await client
          .from('dashboard_layouts')
          .select('published_version_id, layout_id')
          .eq('layout_code', 'operations_main')
          .maybeSingle();

        const publishedVersionId = layoutRes.data?.published_version_id;
        if (publishedVersionId) {
          const itemsRes = await client
            .from('dashboard_layout_items')
            .select('*')
            .eq('version_id', publishedVersionId)
            .order('sort_order', { ascending: true });

          if (itemsRes.data && itemsRes.data.length > 0) {
            setItems(itemsRes.data);
            const firstCfg = itemsRes.data[0]?.config?.canvas_dimension;
            if (firstCfg?.cols) {
              setCols(firstCfg.cols);
            }
            loadedFromDb = true;
          }
        }
      } catch {
        // DB 離線時進入快取讀取
      }

      // 2. 若資料庫無發布記錄，嘗試從 localStorage 同步後台最新設定
      if (!loadedFromDb) {
        try {
          const raw = localStorage.getItem('beinong_published_layout');
          if (raw) {
            const cached = JSON.parse(raw);
            if (cached.items && cached.items.length > 0) {
              setItems(cached.items);
              if (cached.canvas_dimension?.cols) {
                setCols(cached.canvas_dimension.cols);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    void loadPublishedLayout();
  }, []);

  const visibleItems = items.filter(item => item.visible !== false);

  return (
    <div
      style={{
        backgroundColor: '#020b18',
        minHeight: '100vh',
        padding: '16px 20px',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid rgba(0, 212, 255, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '26px' }}>🖥️</span>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: 800,
                color: '#00d4ff',
                letterSpacing: '1px',
                textShadow: '0 0 16px rgba(0, 212, 255, 0.6)',
              }}
            >
              臺北農產公司 · 營運戰情大螢幕即時看板
            </h1>
            <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '2px' }}>
              即時系統監控 · 智慧巡檢 · 市場批發行情全聯網 ｜ 網格：{cols} 欄自適應
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              fontSize: '20px',
              color: '#34d399',
              fontWeight: 700,
              fontFamily: 'monospace',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '5px 12px',
              borderRadius: '6px',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            {time.toLocaleString('zh-TW', { hour12: false })}
          </div>
          <a
            href="/Inspection/v2/systems/admin/layouts/"
            style={{
              color: '#94a3b8',
              fontSize: '12px',
              textDecoration: 'none',
              padding: '5px 10px',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            ⚙️ 版面設定
          </a>
        </div>
      </header>

      {/* 依設定之格線模式呈現大螢幕看板 (支援 12 欄與 24 欄超寬看板) */}
      <main
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: '12px',
          alignContent: 'start',
        }}
      >
        {visibleItems.map((item, index) => {
          const width = Math.min(cols, Math.max(1, Number(item.width ?? (cols === 24 ? 8 : 6))));
          const height = Math.max(1, Number(item.height ?? 3));
          const icon = WIDGET_ICONS[item.widget_key] || '📊';

          return (
            <div
              key={`${item.widget_key}-${index}`}
              style={{
                gridColumn: `span ${width}`,
                minHeight: `${Math.max(100, height * 52)}px`,
                background: 'rgba(10, 20, 38, 0.95)',
                border: '1px solid rgba(0, 212, 255, 0.25)',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                position: 'relative',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                  paddingBottom: '5px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '14px' }}>{icon}</span>
                  <strong style={{ color: '#00d4ff', fontSize: '13px' }}>{item.title}</strong>
                </div>
                <span
                  style={{
                    fontSize: '9px',
                    color: '#34d399',
                    background: 'rgba(16, 185, 129, 0.1)',
                    padding: '2px 5px',
                    borderRadius: '4px',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    fontWeight: 600,
                  }}
                >
                  即時聯網
                </span>
              </div>

              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                <DashboardWidgetContent widgetKey={item.widget_key} />
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

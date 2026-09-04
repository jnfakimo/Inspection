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

const DEFAULT_ITEMS: LayoutItem[] = [
  { widget_key: 'alerts', title: '重要提醒與異常警報', width: 12, height: 2, visible: true },
  { widget_key: 'kpis', title: '營運關鍵指標', width: 12, height: 2, visible: true },
  { widget_key: 'trading_kpi', title: '市場交易量分析', width: 6, height: 3, visible: true },
  { widget_key: 'price_comparison', title: '蔬果價格同期比較', width: 6, height: 4, visible: true },
  { widget_key: 'public_price_board', title: '公開大宗即時報價看板', width: 6, height: 5, visible: true },
  { widget_key: 'supplier_ranking', title: '主要產地／供應商進貨排行', width: 6, height: 4, visible: true },
  { widget_key: 'patrol', title: '駐衛警巡檢即時', width: 8, height: 4, visible: true },
  { widget_key: 'repairs', title: '報修案件分佈', width: 4, height: 4, visible: true },
  { widget_key: 'equipment_status', title: '設備狀態監控', width: 6, height: 4, visible: true },
  { widget_key: 'realtime_ticker', title: '即時滾動跑馬燈行情', width: 12, height: 2, visible: true },
];

export function TvClient({ profile: _profile }: TvClientProps) {
  const [time, setTime] = useState(new Date());
  const [items, setItems] = useState<LayoutItem[]>(DEFAULT_ITEMS);
  const [cols, setCols] = useState<number>(12);
  const [isUltrawide, setIsUltrawide] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function loadPublishedLayout() {
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
              setIsUltrawide(firstCfg.cols === 24 || (firstCfg.width || 0) >= 2500);
            }
          }
        }
      } catch {
        // 使用預設配置
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
        padding: '20px 24px',
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
          marginBottom: '20px',
          paddingBottom: '14px',
          borderBottom: '1px solid rgba(0, 212, 255, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '28px' }}>🖥️</span>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 800,
                color: '#00d4ff',
                letterSpacing: '1px',
                textShadow: '0 0 16px rgba(0, 212, 255, 0.6)',
              }}
            >
              臺北農產公司 · 營運戰情大螢幕即時看板
            </h1>
            <div style={{ fontSize: '12px', color: '#38bdf8', marginTop: '2px' }}>
              即時系統監控 · 智慧巡檢 · 市場批發行情全聯網
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              fontSize: '22px',
              color: '#34d399',
              fontWeight: 700,
              fontFamily: 'monospace',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '6px 14px',
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
              padding: '6px 12px',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
            }}
          >
            ⚙️ 版面設定
          </a>
        </div>
      </header>

      {/* 依設定之格線模式呈現畫布 (支援 12 欄與 24 欄長條看板) */}
      <main
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: '16px',
          alignContent: 'start',
        }}
      >
        {visibleItems.map((item, index) => {
          const width = Math.min(cols, Math.max(1, Number(item.width ?? (cols === 24 ? 6 : 6))));
          const height = Math.max(1, Number(item.height ?? 3));
          return (
            <div
              key={`${item.widget_key}-${index}`}
              style={{
                gridColumn: `span ${width}`,
                minHeight: `${height * 75}px`,
                background: 'rgba(10, 20, 38, 0.95)',
                border: '1px solid rgba(0, 212, 255, 0.25)',
                borderRadius: '8px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                  paddingBottom: '6px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <strong style={{ color: '#00d4ff', fontSize: '15px' }}>{item.title}</strong>
                <span
                  style={{
                    fontSize: '10px',
                    color: '#64748b',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '2px 6px',
                    borderRadius: '4px',
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

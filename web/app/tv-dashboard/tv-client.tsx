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

const WIDGET_CATALOG: Record<
  string,
  {
    systemId: number;
    systemName: string;
    icon: string;
    desc: string;
  }
> = {
  alerts: { systemId: 11, systemName: '戰情系統', icon: '🚨', desc: '即時重大警報、設備異常跑馬燈' },
  kpis: { systemId: 11, systemName: '戰情系統', icon: '⚡', desc: '進場車次、出勤率、在線率、異常件數' },
  patrol: { systemId: 11, systemName: '戰情系統', icon: '🛡️', desc: '巡檢點打卡進度、排班執勤狀況' },
  repairs: { systemId: 11, systemName: '戰情系統', icon: '🔧', desc: '各區報修處理進度與完工率' },
  equipment_status: { systemId: 11, systemName: '戰情系統', icon: '⚙️', desc: '冷凍設備、電力系統妥善率' },
  realtime_incident_map: { systemId: 11, systemName: '戰情系統', icon: '🗺️', desc: '全市場熱點分佈與緊急案件定位' },
  sla_compliance: { systemId: 11, systemName: '戰情系統', icon: '⏱️', desc: 'MTTR 與 SLA 達標統計' },
  staff_duty_matrix: { systemId: 11, systemName: '戰情系統', icon: '👥', desc: '在勤人力配置與即時簽到' },
  cctv_ipcam_grid: { systemId: 11, systemName: '戰情系統', icon: '📹', desc: '攝影機即時監控畫面' },
  weather_risk_radar: { systemId: 11, systemName: '戰情系統', icon: '🌧️', desc: '氣象特報與防汛應變' },
  weather_taiwan: { systemId: 11, systemName: '戰情系統', icon: '🌦️', desc: '臺灣即時氣象特報' },
  rank_dept: { systemId: 11, systemName: '戰情系統', icon: '📊', desc: '各單位報修排行' },
  rank_equipment: { systemId: 11, systemName: '戰情系統', icon: '🛠️', desc: '各設備故障排行' },
  rank_technician: { systemId: 11, systemName: '戰情系統', icon: '👷', desc: '維修人員案件數' },
  rank_fault: { systemId: 11, systemName: '戰情系統', icon: '🔍', desc: '故障類型分析' },
  trend: { systemId: 11, systemName: '戰情系統', icon: '📅', desc: '各月份報修趨勢' },
  trading_kpi: { systemId: 10, systemName: '市場營運', icon: '📦', desc: '今日交易量、金額、品項數' },
  price_comparison: { systemId: 10, systemName: '市場營運', icon: '📈', desc: '蔬果價格同期比較' },
  weekly_trend: { systemId: 10, systemName: '市場營運', icon: '📉', desc: '每週交易趨勢走勢' },
  market_allocation: { systemId: 10, systemName: '市場營運', icon: '🎯', desc: '配置與妥善率儀表' },
  supplier_ranking: { systemId: 10, systemName: '市場營運', icon: '🚛', desc: '主要產地／供應商進貨排行' },
  price_volatility: { systemId: 10, systemName: '市場營運', icon: '⚠️', desc: '行情波動與異常價位警示' },
  auction_efficiency: { systemId: 10, systemName: '市場營運', icon: '⚡', desc: '拍賣場次交易進度與速度' },
  floor_congestion: { systemId: 10, systemName: '市場營運', icon: '🅿️', desc: '卸貨場區滿載率與車流動態' },
  public_price_board: { systemId: 12, systemName: '公開看板', icon: '💹', desc: '公開大宗即時報價看板' },
  market_turnover: { systemId: 12, systemName: '公開看板', icon: '🌾', desc: '市場公開總成交額' },
  commodity_ratio: { systemId: 12, systemName: '公開看板', icon: '🥦', desc: '品項交易佔比分佈' },
  realtime_ticker: { systemId: 12, systemName: '公開看板', icon: '📢', desc: '即時滾動跑馬燈行情' },
  top_gainers_losers: { systemId: 12, systemName: '公開看板', icon: '📊', desc: '今日蔬果漲跌幅排行榜' },
  origin_weather_map: { systemId: 12, systemName: '公開看板', icon: '⛅', desc: '主要產地天氣與供貨狀態' },
  historical_price_curve: { systemId: 12, systemName: '公開看板', icon: '📉', desc: '30日/同季歷史價格曲線' },
  consumer_guide_board: { systemId: 12, systemName: '公開看板', icon: '🛒', desc: '平價蔬果專區與供應指引' },
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
    function syncLayoutFromStorage(): boolean {
      try {
        // 優先讀取即時活躍編輯版面 (與視窗化即時預覽 100% 同步)
        const activeRaw = localStorage.getItem('beinong_active_tv_layout');
        if (activeRaw) {
          const cached = JSON.parse(activeRaw);
          if (cached.items && Array.isArray(cached.items) && cached.items.length > 0) {
            setItems(cached.items);
            if (cached.cols) setCols(cached.cols);
            return true;
          }
        }
        // 其次讀取發布版面快取
        const pubRaw = localStorage.getItem('beinong_published_layout');
        if (pubRaw) {
          const cached = JSON.parse(pubRaw);
          if (cached.items && Array.isArray(cached.items) && cached.items.length > 0) {
            setItems(cached.items);
            if (cached.canvas_dimension?.cols) setCols(cached.canvas_dimension.cols);
            return true;
          }
        }
      } catch {
        // ignore
      }
      return false;
    }

    async function loadLayout() {
      // 1. 優先同步本地最新編輯與預覽版面
      const synced = syncLayoutFromStorage();

      // 2. 若無本地快取，嘗試自 Supabase 讀取發布版面
      if (!synced) {
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
            }
          }
        } catch {
          // fallback to DEFAULT_ITEMS
        }
      }
    }

    void loadLayout();

    // 跨分頁即時同步監聽 (後台儲存/調整時，大看板立即無縫更新)
    window.addEventListener('storage', syncLayoutFromStorage);
    window.addEventListener('focus', syncLayoutFromStorage);
    return () => {
      window.removeEventListener('storage', syncLayoutFromStorage);
      window.removeEventListener('focus', syncLayoutFromStorage);
    };
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
          const info = WIDGET_CATALOG[item.widget_key] || {
            icon: '📊',
            systemId: 11,
            desc: '',
          };

          return (
            <div
              key={`${item.widget_key}-${index}`}
              style={{
                gridColumn: `span ${width}`,
                minHeight: `${Math.max(90, height * 50)}px`,
                background: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(0, 212, 255, 0.25)',
                borderRadius: '8px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                position: 'relative',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '8px',
                  paddingBottom: '5px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: '14px' }}>{info.icon}</span>
                <strong style={{ color: '#00d4ff', fontSize: '13px' }}>{item.title}</strong>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '9px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    background: 'rgba(0, 212, 255, 0.1)',
                    color: '#38bdf8',
                    fontWeight: 700,
                  }}
                >
                  系統 {info.systemId}
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
                <DashboardWidgetContent widgetKey={item.widget_key} desc={info.desc} />
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

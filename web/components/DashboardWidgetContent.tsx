'use client';

import React from 'react';

export function DashboardWidgetContent({ widgetKey, desc }: { widgetKey: string; desc?: string }) {
  switch (widgetKey) {
    // === 系統 11 (戰情指揮中心) ===
    case 'alerts':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          <div style={{ fontSize: '13px', color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(239,68,68,0.1)', padding: '6px 10px', borderRadius: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 8px #ef4444' }}></span>
            <b>[緊急]</b> 冷凍庫 B2 溫度異常 (-2.1°C) — 3 分鐘前通報
          </div>
          <div style={{ fontSize: '13px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(245,158,11,0.1)', padding: '6px 10px', borderRadius: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}></span>
            <b>[警示]</b> 第二拍賣場 月臺 3 卸貨排程延遲 15 分鐘
          </div>
        </div>
      );

    case 'kpis':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px', width: '100%', textAlign: 'center' }}>
          <div style={{ background: 'rgba(0,212,255,0.06)', padding: '10px 6px', borderRadius: '6px', border: '1px solid rgba(0,212,255,0.15)' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>今日進場車次</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>1,280 <small style={{ fontSize: '11px' }}>車</small></div>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.06)', padding: '10px 6px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.15)' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>巡檢達標率</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#34d399', marginTop: '2px' }}>94.2%</div>
          </div>
          <div style={{ background: 'rgba(239,68,68,0.06)', padding: '10px 6px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.15)' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>待處理異常</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#f87171', marginTop: '2px' }}>3 <small style={{ fontSize: '11px' }}>件</small></div>
          </div>
          <div style={{ background: 'rgba(168,85,247,0.06)', padding: '10px 6px', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.15)' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>在線設備率</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#c084fc', marginTop: '2px' }}>99.8%</div>
          </div>
        </div>
      );

    case 'patrol':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
            <span>第一市場 巡邏動線 A (12/14 處打卡)</span>
            <b style={{ color: '#34d399' }}>85.7%</b>
          </div>
          <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: '85.7%', height: '100%', background: 'linear-gradient(90deg, #0284c7, #10b981)' }}></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '11px' }}>
            <span>在勤警衛：林○安 (夜班執勤中)</span>
            <span>下次打卡點：B1 配電室</span>
          </div>
        </div>
      );

    case 'repairs':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center', width: '100%' }}>
          <div style={{ background: 'rgba(239,68,68,0.1)', padding: '8px', borderRadius: '6px' }}>
            <div style={{ color: '#ef4444', fontWeight: 800, fontSize: '18px' }}>1</div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>緊急指派</div>
          </div>
          <div style={{ background: 'rgba(245,158,11,0.1)', padding: '8px', borderRadius: '6px' }}>
            <div style={{ color: '#f59e0b', fontWeight: 800, fontSize: '18px' }}>8</div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>維修中</div>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.1)', padding: '8px', borderRadius: '6px' }}>
            <div style={{ color: '#10b981', fontWeight: 800, fontSize: '18px' }}>24</div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>本日結案</div>
          </div>
        </div>
      );

    case 'equipment_status':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center', width: '100%', fontSize: '11px' }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: '#38bdf8' }}>低溫冷鏈庫</div>
            <b style={{ color: '#4ade80', fontSize: '14px', display: 'block', marginTop: '4px' }}>99.2%</b>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: '#38bdf8' }}>高壓變電所</div>
            <b style={{ color: '#4ade80', fontSize: '14px', display: 'block', marginTop: '4px' }}>100%</b>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: '#38bdf8' }}>地下排風機</div>
            <b style={{ color: '#facc15', fontSize: '14px', display: 'block', marginTop: '4px' }}>97.5%</b>
          </div>
        </div>
      );

    case 'realtime_incident_map':
      return (
        <div style={{ width: '100%', height: '100%', minHeight: '120px', background: 'radial-gradient(circle, rgba(2,132,199,0.15) 0%, rgba(2,6,23,0.8) 100%)', borderRadius: '6px', border: '1px solid rgba(0,212,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <span style={{ fontSize: '12px', color: '#38bdf8' }}>🗺️ 全場 2D/3D 平面熱點圖資即時連線</span>
          <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px', color: '#94a3b8' }}>
            <span style={{ color: '#4ade80' }}>● 第一拍賣場 正常</span>
            <span style={{ color: '#f87171' }}>● 低溫冷鏈 B2 警報</span>
          </div>
        </div>
      );

    case 'sla_compliance':
      return (
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>平均修復時間 (MTTR)</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8' }}>1.4 <small style={{ fontSize: '11px' }}>小時</small></div>
          </div>
          <div style={{ height: '30px', width: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>SLA 達標率</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#34d399' }}>98.5%</div>
          </div>
        </div>
      );

    case 'weather_taiwan':
    case 'weather_risk_radar':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', width: '100%', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>⛅</span>
            <div>
              <div style={{ fontWeight: 700, color: '#f8fafc' }}>臺北萬華 26°C</div>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>濕度 68% · 降雨機率 10%</div>
            </div>
          </div>
          <div style={{ color: '#34d399', background: 'rgba(16,185,129,0.1)', padding: '4px 10px', borderRadius: '4px' }}>
            防汛整備：常態綠燈
          </div>
        </div>
      );

    case 'trend':
      return (
        <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', gap: '8px', height: '60px', padding: '0 10px' }}>
          {[35, 42, 28, 55, 38, 48, 62, 45, 52, 39, 31, 24].map((h, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '100%', height: `${h}%`, background: 'linear-gradient(180deg, #00d4ff, #0284c7)', borderRadius: '2px 2px 0 0' }}></div>
              <span style={{ fontSize: '8px', color: '#64748b' }}>{i + 1}月</span>
            </div>
          ))}
        </div>
      );

    // === 系統 10 (市場營運分析系統) ===
    case 'trading_kpi':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center', width: '100%' }}>
          <div style={{ background: 'rgba(251,191,36,0.08)', padding: '8px 4px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>總交易量</div>
            <b style={{ color: '#fbbf24', fontSize: '17px', display: 'block' }}>1,480 <small style={{ fontSize: '10px' }}>噸</small></b>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.08)', padding: '8px 4px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>總成交額</div>
            <b style={{ color: '#34d399', fontSize: '17px', display: 'block' }}>$4,820 <small style={{ fontSize: '10px' }}>萬</small></b>
          </div>
          <div style={{ background: 'rgba(56,189,248,0.08)', padding: '8px 4px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>交易品項</div>
            <b style={{ color: '#60a5fa', fontSize: '17px', display: 'block' }}>186 <small style={{ fontSize: '10px' }}>種</small></b>
          </div>
          <div style={{ background: 'rgba(168,85,247,0.08)', padding: '8px 4px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>成交率</div>
            <b style={{ color: '#a78bfa', fontSize: '17px', display: 'block' }}>99.4%</b>
          </div>
        </div>
      );

    case 'price_comparison':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '55px', color: '#94a3b8' }}>葉菜類</span>
            <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: '75%', height: '100%', background: '#3b82f6' }}></div>
            </div>
            <b style={{ color: '#38bdf8' }}>$38.5</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '55px', color: '#94a3b8' }}>瓜果類</span>
            <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: '60%', height: '100%', background: '#f59e0b' }}></div>
            </div>
            <b style={{ color: '#fbbf24' }}>$52.0</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '55px', color: '#94a3b8' }}>根莖類</span>
            <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: '45%', height: '100%', background: '#10b981' }}></div>
            </div>
            <b style={{ color: '#34d399' }}>$29.0</b>
          </div>
        </div>
      );

    case 'supplier_ranking':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span>1. 雲林西螺產區 (甘藍、蕹菜)</span>
            <b style={{ color: '#38bdf8' }}>420 噸 (28.4%)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span>2. 彰化溪湖產區 (花椰菜、青蔥)</span>
            <b style={{ color: '#38bdf8' }}>310 噸 (20.9%)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span>3. 屏東九如產區 (瓜果、檸檬)</span>
            <b style={{ color: '#38bdf8' }}>195 噸 (13.2%)</b>
          </div>
        </div>
      );

    case 'auction_efficiency':
      return (
        <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', fontSize: '12px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>一市拍賣進度</div>
            <b style={{ color: '#34d399', fontSize: '16px' }}>98.2%</b>
            <div style={{ color: '#64748b', fontSize: '10px' }}>均速 4.2 秒/批</div>
          </div>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>二市拍賣進度</div>
            <b style={{ color: '#38bdf8', fontSize: '16px' }}>96.5%</b>
            <div style={{ color: '#64748b', fontSize: '10px' }}>均速 4.8 秒/批</div>
          </div>
        </div>
      );

    // === 系統 12 (市場公開看板) ===
    case 'public_price_board':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
            <span>初秋甘藍 (高麗菜)</span>
            <b>$28.5 / kg</b>
            <span style={{ color: '#4ade80', fontWeight: 700 }}>▲ 2.5 (+9.6%)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
            <span>牛番茄</span>
            <b>$65.0 / kg</b>
            <span style={{ color: '#f87171', fontWeight: 700 }}>▼ 1.2 (-1.8%)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
            <span>青花菜</span>
            <b>$54.0 / kg</b>
            <span style={{ color: '#94a3b8' }}>— 0.0 (持平)</span>
          </div>
        </div>
      );

    case 'market_turnover':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '0 10px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>本日批發成交總額</div>
            <b style={{ fontSize: '22px', color: '#38bdf8', fontWeight: 800 }}>$ 4,820 萬</b>
          </div>
          <div style={{ textAlign: 'right', fontSize: '11px', color: '#94a3b8' }}>
            <div>較昨日 <span style={{ color: '#34d399' }}>+ 3.8%</span></div>
            <div>較去年同期 <span style={{ color: '#34d399' }}>+ 5.2%</span></div>
          </div>
        </div>
      );

    case 'realtime_ticker':
      return (
        <div style={{ fontSize: '12px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(2,132,199,0.1)', padding: '6px 12px', borderRadius: '4px', width: '100%', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '15px' }}>📢</span>
          <span>【即時成交廣播】05:42 批號 A-882 西螺甘藍 2,000kg $28.5 順利敲定 ｜ 05:41 批號 B-103 溪湖青蔥 800kg $85.0 成交</span>
        </div>
      );

    default:
      return (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '12px', padding: '8px' }}>
          <div>{desc || `圖塊模組: ${widgetKey}`}</div>
          <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '4px' }}>⚡ 即時動態數據訊號連線中...</div>
        </div>
      );
  }
}

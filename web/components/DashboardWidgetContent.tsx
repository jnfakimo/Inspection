'use client';

import React, { useEffect, useState } from 'react';

export function DashboardWidgetContent({ widgetKey, desc }: { widgetKey: string; desc?: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => (t + 1) % 1000);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  switch (widgetKey) {
    // ==========================================
    // === 系統 10 (市場營運分析系統) ===
    // ==========================================
    case 'trading_kpi':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center', width: '100%' }}>
          <div style={{ background: 'rgba(251,191,36,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(251,191,36,0.2)' }}>
            <div style={{ fontSize: '11px', color: 'var(--dim)' }}>總交易量</div>
            <b style={{ color: 'var(--amber)', fontSize: '16px', display: 'block', marginTop: '2px' }}>
              {1480 + (tick % 7)} <small style={{ fontSize: '10px' }}>噸</small>
            </b>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ fontSize: '11px', color: 'var(--dim)' }}>總成交額</div>
            <b style={{ color: 'var(--green-text,var(--green))', fontSize: '16px', display: 'block', marginTop: '2px' }}>
              $4,820 <small style={{ fontSize: '10px' }}>萬</small>
            </b>
          </div>
          <div style={{ background: 'rgba(56,189,248,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(56,189,248,0.2)' }}>
            <div style={{ fontSize: '11px', color: 'var(--dim)' }}>交易品項</div>
            <b style={{ color: 'var(--blue)', fontSize: '16px', display: 'block', marginTop: '2px' }}>
              186 <small style={{ fontSize: '10px' }}>種</small>
            </b>
          </div>
          <div style={{ background: 'rgba(168,85,247,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.2)' }}>
            <div style={{ fontSize: '11px', color: 'var(--dim)' }}>成交率</div>
            <b style={{ color: 'var(--violet)', fontSize: '16px', display: 'block', marginTop: '2px' }}>99.4%</b>
          </div>
        </div>
      );

    case 'price_comparison':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '48px', color: 'var(--dim)' }}>葉菜類</span>
            <div style={{ flex: 1, height: '7px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${75 + (tick % 4)}%`, height: '100%', background: 'var(--blue)', transition: 'width 0.5s' }} />
            </div>
            <b style={{ color: 'var(--cyan-text,var(--cyan))', minWidth: '38px', textAlign: 'right' }}>$38.5</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '48px', color: 'var(--dim)' }}>瓜果類</span>
            <div style={{ flex: 1, height: '7px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${60 - (tick % 3)}%`, height: '100%', background: 'var(--amber)', transition: 'width 0.5s' }} />
            </div>
            <b style={{ color: 'var(--amber)', minWidth: '38px', textAlign: 'right' }}>$52.0</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '48px', color: 'var(--dim)' }}>根莖類</span>
            <div style={{ flex: 1, height: '7px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${45 + (tick % 5)}%`, height: '100%', background: 'var(--green-text,var(--green))', transition: 'width 0.5s' }} />
            </div>
            <b style={{ color: 'var(--green-text,var(--green))', minWidth: '38px', textAlign: 'right' }}>$29.0</b>
          </div>
        </div>
      );

    case 'weekly_trend':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--dim)' }}>
            <span>📅 近 7 日批發總噸數 (日均 1,420 噸)</span>
            <span style={{ color: 'var(--green-text,var(--green))' }}>本週累積 +4.8%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '55px', padding: '0 4px' }}>
            {[
              { d: '一', v: 65, t: '1,380t' },
              { d: '二', v: 80, t: '1,520t' },
              { d: '三', v: 75, t: '1,460t' },
              { d: '四', v: 70, t: '1,410t' },
              { d: '五', v: 88, t: '1,610t' },
              { d: '六', v: 95, t: '1,690t' },
              { d: '日', v: 50, t: '1,120t' },
            ].map((col, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div
                    style={{
                      width: '100%',
                      height: `${col.v}%`,
                      background: i === 5 ? 'linear-gradient(180deg, #38bdf8, #0284c7)' : 'rgba(56,189,248,0.35)',
                      borderRadius: '2px 2px 0 0',
                    }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: 'var(--dim)' }}>{col.d}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'market_allocation':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', textAlign: 'center', width: '100%', fontSize: '11px' }}>
          <div style={{ background: 'rgba(2,132,199,0.1)', padding: '6px 4px', borderRadius: '6px', border: '1px solid rgba(2,132,199,0.2)' }}>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>場地滿載率</div>
            <b style={{ color: 'var(--cyan-text,var(--cyan))', fontSize: '15px', display: 'block', marginTop: '2px' }}>82.4%</b>
            <span style={{ color: 'var(--green-text,var(--green))', fontSize: '9px' }}>運作正常</span>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.1)', padding: '6px 4px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>作業人員配置</div>
            <b style={{ color: 'var(--green-text,var(--green))', fontSize: '15px', display: 'block', marginTop: '2px' }}>142 人</b>
            <span style={{ color: 'var(--dim)', fontSize: '9px' }}>在勤率 98%</span>
          </div>
          <div style={{ background: 'rgba(245,158,11,0.1)', padding: '6px 4px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.2)' }}>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>機具妥善率</div>
            <b style={{ color: 'var(--amber)', fontSize: '15px', display: 'block', marginTop: '2px' }}>96.8%</b>
            <span style={{ color: 'var(--dim)', fontSize: '9px' }}>拖車/堆高機</span>
          </div>
        </div>
      );

    case 'supplier_ranking':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', borderLeft: '3px solid #38bdf8' }}>
            <span>1. 雲林西螺產區 (甘藍、蕹菜)</span>
            <b style={{ color: 'var(--cyan-text,var(--cyan))' }}>420 噸 (28.4%)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', borderLeft: '3px solid #34d399' }}>
            <span>2. 彰化溪湖產區 (花椰菜、青蔥)</span>
            <b style={{ color: 'var(--green-text,var(--green))' }}>310 噸 (20.9%)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', borderLeft: '3px solid #fbbf24' }}>
            <span>3. 屏東九如產區 (瓜果、檸檬)</span>
            <b style={{ color: 'var(--amber)' }}>195 噸 (13.2%)</b>
          </div>
        </div>
      );

    case 'price_volatility':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', background: 'rgba(239,68,68,0.1)', borderRadius: '4px' }}>
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>⚠️ 青椒 (高波動)</span>
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>▲ +24.5% ($68/kg)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', background: 'rgba(16,185,129,0.1)', borderRadius: '4px' }}>
            <span style={{ color: 'var(--green-text,var(--green))', fontWeight: 600 }}>🔻 小黃瓜 (量多回跌)</span>
            <span style={{ color: 'var(--green-text,var(--green))', fontWeight: 700 }}>▼ -18.2% ($32/kg)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span style={{ color: 'var(--dim)' }}>牛番茄 (平穩區間)</span>
            <span style={{ color: 'var(--text)' }}>+2.1% ($65/kg)</span>
          </div>
        </div>
      );

    case 'auction_efficiency':
      return (
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%', fontSize: '11px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>第一拍賣場進度</div>
            <b style={{ color: 'var(--green-text,var(--green))', fontSize: '16px' }}>98.2%</b>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>均速 4.2 秒/批</div>
          </div>
          <div style={{ width: '1px', height: '32px', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>第二拍賣場進度</div>
            <b style={{ color: 'var(--cyan-text,var(--cyan))', fontSize: '16px' }}>96.5%</b>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>均速 4.8 秒/批</div>
          </div>
        </div>
      );

    case 'floor_congestion':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dim)' }}>
            <span>大車卸貨泊位佔用 (28/32 席)</span>
            <b style={{ color: 'var(--amber)' }}>87.5% 尖峰</b>
          </div>
          <div style={{ height: '7px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: '87.5%', height: '100%', background: 'linear-gradient(90deg, #10b981, #f59e0b)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dim)', fontSize: '10px' }}>
            <span>閘口等待車隊：4 輛</span>
            <span>平均卸貨週轉：18 分鐘/車</span>
          </div>
        </div>
      );

    // ==========================================
    // === 系統 11 (戰情儀表板／指揮中心) ===
    // ==========================================
    case 'alerts':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '100%' }}>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(239,68,68,0.12)',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(239,68,68,0.3)',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--red)',
                display: 'inline-block',
                boxShadow: '0 0 8px #ef4444',
              }}
            />
            <b>[即時警報]</b> 低溫冷鏈 B2 溫度異常 (-2.1°C) — 3 分鐘前通報
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--amber)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(245,158,11,0.1)',
              padding: '6px 10px',
              borderRadius: '6px',
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />
            <b>[運作提示]</b> 第二拍賣場 月臺 3 卸貨排程延遲 15 分鐘
          </div>
        </div>
      );

    case 'kpis':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px', width: '100%', textAlign: 'center' }}>
          <div style={{ background: 'rgba(0,212,255,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(0,212,255,0.2)' }}>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>今日進場車次</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--cyan-text,var(--cyan))', marginTop: '2px' }}>
              {1280 + (tick % 5)} <small style={{ fontSize: '10px' }}>車</small>
            </div>
          </div>
          <div style={{ background: 'rgba(168,85,247,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.2)' }}>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>巡檢達標率</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--violet)', marginTop: '2px' }}>94.2%</div>
          </div>
          <div style={{ background: 'rgba(239,68,68,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>待處理異常</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--red)', marginTop: '2px' }}>3 <small style={{ fontSize: '10px' }}>件</small></div>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.08)', padding: '8px 4px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>在線設備率</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--green-text,var(--green))', marginTop: '2px' }}>99.8%</div>
          </div>
        </div>
      );

    case 'patrol':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dim)' }}>
            <span>第一市場 巡邏動線 A (12/14 處打卡)</span>
            <b style={{ color: 'var(--green-text,var(--green))' }}>85.7% (執勤中)</b>
          </div>
          <div style={{ height: '7px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: '85.7%', height: '100%', background: 'linear-gradient(90deg, #0284c7, #10b981)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dim)', fontSize: '10px' }}>
            <span>在勤警衛：林○安 (定位正常)</span>
            <span>下次打卡點：B1 配電室</span>
          </div>
        </div>
      );

    case 'repairs':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', textAlign: 'center', width: '100%' }}>
          <div style={{ background: 'rgba(239,68,68,0.1)', padding: '6px', borderRadius: '6px' }}>
            <div style={{ color: 'var(--red)', fontWeight: 800, fontSize: '17px' }}>1</div>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>緊急指派</div>
          </div>
          <div style={{ background: 'rgba(245,158,11,0.1)', padding: '6px', borderRadius: '6px' }}>
            <div style={{ color: 'var(--amber)', fontWeight: 800, fontSize: '17px' }}>8</div>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>維修中</div>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.1)', padding: '6px', borderRadius: '6px' }}>
            <div style={{ color: 'var(--green-text,var(--green))', fontWeight: 800, fontSize: '17px' }}>24</div>
            <div style={{ color: 'var(--dim)', fontSize: '10px' }}>本日結案</div>
          </div>
        </div>
      );

    case 'equipment_status':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', textAlign: 'center', width: '100%', fontSize: '11px' }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: 'var(--cyan-text,var(--cyan))' }}>低溫冷鏈庫</div>
            <b style={{ color: 'var(--green-text,var(--green))', fontSize: '13px', display: 'block', marginTop: '2px' }}>99.2%</b>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: 'var(--cyan-text,var(--cyan))' }}>高壓變電所</div>
            <b style={{ color: 'var(--green-text,var(--green))', fontSize: '13px', display: 'block', marginTop: '2px' }}>100%</b>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: 'var(--cyan-text,var(--cyan))' }}>地下排風機</div>
            <b style={{ color: 'var(--amber)', fontSize: '13px', display: 'block', marginTop: '2px' }}>97.5%</b>
          </div>
        </div>
      );

    case 'realtime_incident_map':
      return (
        <div style={{ width: '100%', minHeight: '80px', background: 'radial-gradient(circle, rgba(2,132,199,0.15) 0%, rgba(2,6,23,0.8) 100%)', borderRadius: '6px', border: '1px solid rgba(0,212,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--cyan-text,var(--cyan))' }}>🗺️ 全場 2D/3D 平面熱點圖資即時連線</span>
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px', fontSize: '10px' }}>
            <span style={{ color: 'var(--green-text,var(--green))' }}>● 第一拍賣場 正常</span>
            <span style={{ color: 'var(--red)' }}>● 低溫冷鏈 B2 警報</span>
          </div>
        </div>
      );

    case 'sla_compliance':
      return (
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>平均修復時間 (MTTR)</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--cyan-text,var(--cyan))' }}>1.4 <small style={{ fontSize: '10px' }}>小時</small></div>
          </div>
          <div style={{ height: '24px', width: '1px', background: 'rgba(255,255,255,0.1)' }} />
          <div>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>SLA 達標率</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--green-text,var(--green))' }}>98.5%</div>
          </div>
        </div>
      );

    case 'staff_duty_matrix':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span>早班巡邏／駐衛警</span>
            <b style={{ color: 'var(--green-text,var(--green))' }}>12/12 人到勤 (100%)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span>工務機電維修組</span>
            <b style={{ color: 'var(--cyan-text,var(--cyan))' }}>8/8 人在崗 (100%)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span>夜班拍賣指揮組</span>
            <b style={{ color: 'var(--violet)' }}>已預排 16 人</b>
          </div>
        </div>
      );

    case 'cctv_ipcam_grid':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', width: '100%', height: '100%', minHeight: '65px' }}>
          {['拍賣一場 A 區 (CAM-01)', '冷鏈庫進貨口 (CAM-04)', '北側大車磅秤 (CAM-08)', '中控指揮室 (CAM-12)'].map((cam, i) => (
            <div key={i} style={{ background: 'var(--panel2)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', padding: '4px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--dim)' }}>
                <span>{cam}</span>
                <span style={{ color: 'var(--red)' }}>● REC</span>
              </div>
              <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--panel2)', padding: '4px 0' }}>📹 即時串流</div>
            </div>
          ))}
        </div>
      );

    case 'weather_taiwan':
    case 'weather_risk_radar':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>⛅</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text)' }}>臺北萬華 26°C</div>
              <div style={{ color: 'var(--dim)', fontSize: '10px' }}>濕度 68% · 降雨機率 10%</div>
            </div>
          </div>
          <div style={{ color: 'var(--green-text,var(--green))', background: 'rgba(16,185,129,0.1)', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.2)' }}>
            防汛整備：常態綠燈
          </div>
        </div>
      );

    case 'rank_dept':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          {[
            { dept: '第一拍賣場', count: 38, percent: 85, color: 'var(--cyan-text,var(--cyan))' },
            { dept: '低溫冷鏈庫', count: 26, percent: 60, color: 'var(--amber)' },
            { dept: '第二拍賣場', count: 18, percent: 42, color: 'var(--green-text,var(--green))' },
          ].map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '70px', color: 'var(--dim)' }}>{d.dept}</span>
              <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${d.percent}%`, height: '100%', background: d.color }} />
              </div>
              <b style={{ color: d.color, minWidth: '32px', textAlign: 'right' }}>{d.count} 件</b>
            </div>
          ))}
        </div>
      );

    case 'rank_equipment':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          {[
            { name: '低溫冷凍主機', count: 12, percent: 80, color: 'var(--red)' },
            { name: '電動搬運堆高機', count: 8, percent: 55, color: 'var(--amber)' },
            { name: '電子地磅磅秤', count: 5, percent: 35, color: 'var(--cyan-text,var(--cyan))' },
          ].map((eq, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '85px', color: 'var(--dim)' }}>{eq.name}</span>
              <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${eq.percent}%`, height: '100%', background: eq.color }} />
              </div>
              <b style={{ color: eq.color, minWidth: '32px', textAlign: 'right' }}>{eq.count} 次</b>
            </div>
          ))}
        </div>
      );

    case 'rank_technician':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          {[
            { name: '陳○霖 (機電組)', count: 15, rate: '100%', color: 'var(--green-text,var(--green))' },
            { name: '林○宇 (冷凍組)', count: 12, rate: '92%', color: 'var(--cyan-text,var(--cyan))' },
            { name: '黃○生 (儀表組)', count: 9, rate: '100%', color: 'var(--violet)' },
          ].map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
              <span>{t.name}</span>
              <span style={{ color: t.color, fontWeight: 700 }}>{t.count} 件 · 完工率 {t.rate}</span>
            </div>
          ))}
        </div>
      );

    case 'rank_fault':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dim)', fontSize: '10px' }}>
            <span>⚡ 電氣系統 45%</span>
            <span>⚙️ 機械結構 30%</span>
            <span>💧 管路水電 25%</span>
          </div>
          <div style={{ height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', width: '100%', height: '100%' }}>
              <div style={{ width: '45%', height: '100%', background: 'var(--cyan-text,var(--cyan))' }} title="電氣系統 45%" />
              <div style={{ width: '30%', height: '100%', background: 'var(--amber)' }} title="機械結構 30%" />
              <div style={{ width: '25%', height: '100%', background: 'var(--green-text,var(--green))' }} title="管路水電 25%" />
            </div>
          </div>
        </div>
      );

    case 'trend':
      return (
        <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', gap: '6px', height: '55px', padding: '0 6px' }}>
          {[35, 42, 28, 55, 38, 48, 62, 45, 52, 39, 31, 24].map((h, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%' }}>
              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <div
                  style={{
                    width: '100%',
                    height: `${h}%`,
                    background: i === 6 ? 'linear-gradient(180deg, #f87171, #ef4444)' : 'linear-gradient(180deg, #00d4ff, #0284c7)',
                    borderRadius: '2px 2px 0 0',
                  }}
                />
              </div>
              <span style={{ fontSize: '8px', color: 'var(--dim)' }}>{i + 1}月</span>
            </div>
          ))}
        </div>
      );

    // ==========================================
    // === 系統 12 (市場公開看板) ===
    // ==========================================
    case 'public_price_board':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
            <span>初秋甘藍 (高麗菜)</span>
            <b>$28.5 / kg</b>
            <span style={{ color: 'var(--green-text,var(--green))', fontWeight: 700 }}>▲ +9.6%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
            <span>牛番茄</span>
            <b>$65.0 / kg</b>
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>▼ -1.8%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
            <span>青花菜</span>
            <b>$54.0 / kg</b>
            <span style={{ color: 'var(--dim)' }}>— 持平</span>
          </div>
        </div>
      );

    case 'market_turnover':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '0 6px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--dim)' }}>本日批發成交總額</div>
            <b style={{ fontSize: '18px', color: 'var(--cyan-text,var(--cyan))', fontWeight: 800 }}>$ 4,820 萬</b>
          </div>
          <div style={{ textAlign: 'right', fontSize: '10px', color: 'var(--dim)' }}>
            <div>較昨日 <span style={{ color: 'var(--green-text,var(--green))', fontWeight: 700 }}>+ 3.8%</span></div>
            <div>較同期 <span style={{ color: 'var(--green-text,var(--green))', fontWeight: 700 }}>+ 5.2%</span></div>
          </div>
        </div>
      );

    case 'commodity_ratio':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dim)', fontSize: '10px' }}>
            <span style={{ color: 'var(--green-text,var(--green))' }}>🥬 葉菜類 42%</span>
            <span style={{ color: 'var(--amber)' }}>🍉 瓜果類 31%</span>
            <span style={{ color: 'var(--cyan-text,var(--cyan))' }}>🥕 根莖類 27%</span>
          </div>
          <div style={{ height: '7px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: '42%', height: '100%', background: 'var(--green-text,var(--green))' }} />
            <div style={{ width: '31%', height: '100%', background: 'var(--amber)' }} />
            <div style={{ width: '27%', height: '100%', background: 'var(--cyan-text,var(--cyan))' }} />
          </div>
        </div>
      );

    case 'realtime_ticker':
      return (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--cyan-text,var(--cyan))',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(2,132,199,0.15)',
            padding: '6px 10px',
            borderRadius: '6px',
            width: '100%',
            overflow: 'hidden',
            border: '1px solid rgba(0,212,255,0.3)',
          }}
        >
          <span style={{ fontSize: '15px' }}>📢</span>
          <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', paddingLeft: '100%', animation: 'marqueeScroll 15s linear infinite' }}>
              【即時成交廣播】05:42 批號 A-882 西螺甘藍 2,000kg $28.5 順利敲定 ｜ 05:41 批號 B-103 溪湖青蔥 800kg $85.0 成交 ｜ 05:40 批號 C-092 屏東檸檬 1,200kg $42.0 結標
            </span>
          </div>
        </div>
      );

    case 'top_gainers_losers':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', width: '100%', fontSize: '11px' }}>
          <div style={{ background: 'rgba(16,185,129,0.08)', padding: '5px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ color: 'var(--green-text,var(--green))', fontWeight: 700, fontSize: '10px', marginBottom: '2px' }}>🔥 漲幅排行</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)', fontSize: '10px' }}>
              <span>巨峰葡萄</span><b style={{ color: 'var(--green-text,var(--green))' }}>+18.5%</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)', fontSize: '10px' }}>
              <span>金針菇</span><b style={{ color: 'var(--green-text,var(--green))' }}>+12.3%</b>
            </div>
          </div>
          <div style={{ background: 'rgba(239,68,68,0.08)', padding: '5px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: '10px', marginBottom: '2px' }}>❄️ 跌幅排行</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)', fontSize: '10px' }}>
              <span>青花菜</span><b style={{ color: 'var(--red)' }}>-14.2%</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)', fontSize: '10px' }}>
              <span>四季豆</span><b style={{ color: 'var(--red)' }}>-9.8%</b>
            </div>
          </div>
        </div>
      );

    case 'origin_weather_map':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', textAlign: 'center', width: '100%', fontSize: '11px' }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>☀️</span>
            <div style={{ color: 'var(--text)', fontWeight: 700, marginTop: '2px' }}>西螺 28°C</div>
            <span style={{ color: 'var(--green-text,var(--green))', fontSize: '9px' }}>到貨正常</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>⛅</span>
            <div style={{ color: 'var(--text)', fontWeight: 700, marginTop: '2px' }}>溪湖 27°C</div>
            <span style={{ color: 'var(--green-text,var(--green))', fontSize: '9px' }}>供貨充足</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>🌦️</span>
            <div style={{ color: 'var(--text)', fontWeight: 700, marginTop: '2px' }}>九如 30°C</div>
            <span style={{ color: 'var(--amber)', fontSize: '9px' }}>局部短暫雨</span>
          </div>
        </div>
      );

    case 'historical_price_curve':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--dim)' }}>
            <span>📈 大宗蔬菜 30 日均價趨勢 ($/kg)</span>
            <span style={{ color: 'var(--cyan-text,var(--cyan))' }}>目前均價 $34.2</span>
          </div>
          <div style={{ width: '100%', height: '52px', position: 'relative' }}>
            <svg viewBox="0 0 300 60" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--cyan-text,var(--cyan))" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="var(--cyan-text,var(--cyan))" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d="M 0,45 Q 40,25 75,35 T 150,20 T 225,28 T 300,15 L 300,60 L 0,60 Z"
                fill="url(#curveGradient)"
              />
              <path
                d="M 0,45 Q 40,25 75,35 T 150,20 T 225,28 T 300,15"
                fill="none"
                stroke="var(--cyan-text,var(--cyan))"
                strokeWidth="2.5"
              />
              <circle cx="300" cy="15" r="3.5" fill="var(--cyan-text,var(--cyan))" />
            </svg>
          </div>
        </div>
      );

    case 'consumer_guide_board':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: 'rgba(16,185,129,0.1)', borderRadius: '4px', borderLeft: '3px solid #34d399' }}>
            <span>🛒 平價推薦：包心白菜</span>
            <b style={{ color: 'var(--green-text,var(--green))' }}>$22 / kg (供應充裕)</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: 'rgba(2,132,199,0.1)', borderRadius: '4px', borderLeft: '3px solid #38bdf8' }}>
            <span>🥕 平價推薦：本地胡蘿蔔</span>
            <b style={{ color: 'var(--cyan-text,var(--cyan))' }}>$18 / kg (品質優良)</b>
          </div>
        </div>
      );

    default:
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', fontSize: '11px', textAlign: 'center' }}>
          <div style={{ color: 'var(--cyan-text,var(--cyan))', fontWeight: 600 }}>📊 即時數據模組 ({widgetKey})</div>
          <div style={{ display: 'flex', justifyContent: 'space-around', color: 'var(--dim)', fontSize: '10px' }}>
            <span>連線狀態：<b style={{ color: 'var(--green-text,var(--green))' }}>正常</b></span>
            <span>更新週期：<b>60s</b></span>
          </div>
        </div>
      );
  }
}

'use client';

import { useEffect, useState } from 'react';
import type { Profile } from '@/types/app';
import '../dashboard.css';

type TvClientProps = { profile: Profile };

export function TvClient({ profile: _profile }: TvClientProps) {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ backgroundColor: 'var(--bg)', minHeight: '100vh', padding: '30px', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', paddingBottom: '20px', borderBottom: '1px solid rgba(0, 212, 255, 0.2)' }}>
        <h1 style={{ margin: 0, fontSize: '36px', color: 'var(--cyan)', textShadow: '0 0 15px rgba(0, 212, 255, 0.6)' }}>
          TAIPEC-MKT-1 戰情室大螢幕看板
        </h1>
        <div style={{ fontSize: '32px', color: 'var(--text)', fontFamily: 'var(--head)' }}>
          {time.toLocaleString('zh-TW', { hour12: false })}
        </div>
      </header>

      <div className="dash-grid" style={{ flex: 1, gap: '24px' }}>
        <div className="dash-widget" style={{ gridColumn: 'span 12', minHeight: '140px', borderLeft: '6px solid var(--red)' }}>
          <h2 style={{ color: 'var(--red)', textShadow: '0 0 10px rgba(255, 59, 59, 0.6)', marginTop: 0, fontSize: '24px' }}>即時重大警報 (自動輪播)</h2>
          <div style={{ fontSize: '28px', display: 'flex', gap: '40px', overflow: 'hidden', whiteSpace: 'nowrap', marginTop: '16px' }}>
            <span style={{ color: 'var(--amber)' }}>⚠ 空調主機 2 號 溫度異常 (10 分鐘前)</span>
            <span style={{ color: 'var(--red)' }}>⚠ B1 消防幫浦 水壓不足 (已逾期 2 小時)</span>
          </div>
        </div>

        <div className="dash-kpis" style={{ gridColumn: 'span 12', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
          <div className="dash-kpi" style={{ '--kpi': 'var(--cyan)', padding: '24px' } as any}>
            <span style={{ fontSize: '20px' }}>今日派工數</span>
            <b style={{ fontSize: '48px', marginTop: '10px' }}>45 <small style={{ fontSize: '20px' }}>件</small></b>
          </div>
          <div className="dash-kpi" style={{ '--kpi': 'var(--green)', padding: '24px' } as any}>
            <span style={{ fontSize: '20px' }}>已完工數</span>
            <b style={{ fontSize: '48px', marginTop: '10px' }}>32 <small style={{ fontSize: '20px' }}>件</small></b>
          </div>
          <div className="dash-kpi" style={{ '--kpi': 'var(--amber)', padding: '24px' } as any}>
            <span style={{ fontSize: '20px' }}>處理中</span>
            <b style={{ fontSize: '48px', marginTop: '10px' }}>10 <small style={{ fontSize: '20px' }}>件</small></b>
          </div>
          <div className="dash-kpi" style={{ '--kpi': 'var(--red)', padding: '24px' } as any}>
            <span style={{ fontSize: '20px' }}>緊急/逾期</span>
            <b style={{ fontSize: '48px', marginTop: '10px' }}>3 <small style={{ fontSize: '20px' }}>件</small></b>
          </div>
        </div>

        <div className="dash-widget" style={{ gridColumn: 'span 6', minHeight: '500px' }}>
          <h2 style={{ fontSize: '24px' }}>重點設備健康度</h2>
          <div className="bar-list" style={{ marginTop: '30px', gap: '20px' }}>
            <div className="bar-row" style={{ fontSize: '18px' }}><span className="nm">高壓發電機</span><div className="bar-track" style={{ height: '14px' }}><div className="bar-fill" style={{ width: '95%', background: 'var(--green)' }}></div></div><span className="vv" style={{ fontSize: '18px' }}>正常</span></div>
            <div className="bar-row" style={{ fontSize: '18px' }}><span className="nm">消防總機</span><div className="bar-track" style={{ height: '14px' }}><div className="bar-fill" style={{ width: '100%', background: 'var(--green)' }}></div></div><span className="vv" style={{ fontSize: '18px' }}>正常</span></div>
            <div className="bar-row" style={{ fontSize: '18px' }}><span className="nm">空調冰水主機</span><div className="bar-track" style={{ height: '14px' }}><div className="bar-fill" style={{ width: '60%', background: 'var(--amber)' }}></div></div><span className="vv" style={{ fontSize: '18px' }}>警告</span></div>
            <div className="bar-row" style={{ fontSize: '18px' }}><span className="nm">B1 排風機組</span><div className="bar-track" style={{ height: '14px' }}><div className="bar-fill" style={{ width: '20%', background: 'var(--red)' }}></div></div><span className="vv" style={{ fontSize: '18px' }}>故障</span></div>
          </div>
        </div>

        <div className="dash-widget" style={{ gridColumn: 'span 6', minHeight: '500px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ fontSize: '24px', alignSelf: 'flex-start' }}>設備位置熱區預覽 (3D/2D 模組預留)</h2>
          <div style={{ width: '100%', height: '400px', border: '1px dashed var(--line)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', position: 'relative', marginTop: '20px' }}>
            [2D/3D 微縮地圖嵌卡區]
            <div style={{ position: 'absolute', top: '40%', left: '30%', width: '16px', height: '16px', background: 'var(--red)', borderRadius: '50%', boxShadow: '0 0 15px var(--red)' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}

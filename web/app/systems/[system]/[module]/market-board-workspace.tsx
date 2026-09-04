'use client';

import { useCallback, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { MarketExecutiveBoard, ProjectionButton, useProjection, type MarketBoardFeed } from '@/components/MarketExecutiveBoard';
import { invokeCachedAppApi } from '@/lib/supabase';
import { DashboardMarketCarousel } from '@/app/dashboard-market-carousel';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

const FEED_CACHE_TTL_MS = 4 * 60 * 1000;
// 免登入的公開投放頁，與 basePath 同層（見 web/app/board/page.tsx）。
const PUBLIC_BOARD_HREF = '/Inspection/v2/board/';

function ExecutiveBoardModule({ module }: { module: ModuleDefinition }) {
  const loadFeed = useCallback(
    (force: boolean) => invokeCachedAppApi<MarketBoardFeed>('dashboard_market_rotation', { view: 'board' }, { ttlMs: FEED_CACHE_TTL_MS, force }),
    [],
  );
  return <MarketExecutiveBoard
    title={module.title}
    loadFeed={loadFeed}
    headerExtra={<a className="secondary-btn compact" href={PUBLIC_BOARD_HREF} target="_blank" rel="noopener noreferrer">公開播放網址</a>}
  />;
}

function TickerModule({ module }: { module: ModuleDefinition }) {
  const [fullscreen, setFullscreen] = useState(false);
  useProjection(fullscreen);
  return <div className="market-board-ticker-page" data-fullscreen={fullscreen}>
    <div className="page-actions">
      <div><p>{module.description}</p></div>
      <div className="action-cluster"><ProjectionButton active={fullscreen} onToggle={() => setFullscreen(value => !value)} /></div>
    </div>
    <DashboardMarketCarousel />
  </div>;
}

function BoardShell({ system, module, profile }: { system: SystemDefinition; module: ModuleDefinition; profile: Profile }) {
  const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes('marketboard');
  return <AppShell profile={profile} title={system.title}>
    {allowed
      ? (module.key === 'ticker' ? <TickerModule module={module} /> : <ExecutiveBoardModule module={module} />)
      : <div className="notice danger">目前角色沒有市場公開看板系統權限，請由管理員開放。</div>}
  </AppShell>;
}

export function MarketBoardWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => <BoardShell system={system} module={module} profile={profile} />}</AuthGate>;
}

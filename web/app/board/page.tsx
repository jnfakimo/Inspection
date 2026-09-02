'use client';

import { useCallback } from 'react';
import dynamic from 'next/dynamic';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import type { MarketBoardFeed } from '@/components/MarketExecutiveBoard';
import '@/components/market-board.css';

// chart.js / react-chartjs-2 只能在瀏覽器算繪，靜態匯出時不要在伺服器端跑。
const MarketExecutiveBoard = dynamic(
  () => import('@/components/MarketExecutiveBoard').then(mod => mod.MarketExecutiveBoard),
  { ssr: false, loading: () => <p className="market-board-empty">市場公開看板載入中…</p> },
);

async function loadPublicBoard(): Promise<MarketBoardFeed> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/app-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action: 'market_board_public' }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) {
    throw new Error(json?.message || `市場公開看板載入失敗（HTTP ${response.status}）`);
  }
  return json.data as MarketBoardFeed;
}

export default function PublicMarketBoardPage() {
  const loadFeed = useCallback(() => loadPublicBoard(), []);
  return <div className="market-board-public-shell">
    <MarketExecutiveBoard
      title="臺北農產 第一果菜市場 · 長官戰情看板"
      subtitle="蔬果行情公開看板"
      loadFeed={loadFeed}
      variant="public"
    />
    <footer>資料來源：臺北農產公司第一果菜市場實際交易行情 · 每 5 分鐘自動更新 · 非漲停／跌停</footer>
  </div>;
}

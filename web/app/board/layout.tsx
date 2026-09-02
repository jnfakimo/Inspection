import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '長官戰情看板｜臺北農產第一果菜市場',
  description: '臺北農產公司第一果菜市場蔬果行情公開看板：一市二市均價量、全場漲跌與量價趨勢，每 5 分鐘自動更新。',
};

export default function PublicBoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '臺北農產公司交易行情表',
  description: '臺北農產公司第一、第二果菜批發市場交易行情：一市二市均價量、全場漲跌與量價趨勢，每 5 分鐘自動更新。',
};

export default function PublicBoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}

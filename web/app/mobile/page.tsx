'use client';

import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import type { Profile } from '@/types/app';

// 原本這五個動作有三個指向 V1，其中「掃描設備二維碼」指向 app.html——
// 那頁的標題就是「設備巡檢系統已關閉」，會把值勤人員帶到關閉公告。
// 對應的功能在 V2 都已完整搬移，一律改指 V2 模組。
const actions = [
  { href: '/Inspection/v2/inspections/', title: '開始巡檢', text: '選擇設備並立即回報正常或異常', tone: 'cyan' },
  { href: '/Inspection/v2/systems/guardpatrol/checkins/', title: '巡邏點打卡', text: '依當班排程完成各樓層巡邏點打卡', tone: 'green' },
  { href: '/Inspection/v2/systems/workorder/requests/', title: '快速報修', text: '拍照、描述故障並建立報修單', tone: 'amber' },
  { href: '/Inspection/v2/systems/handover/records/', title: '電子交接', text: '查看本班交辦、異常與待辦事項', tone: 'violet' },
  { href: '/Inspection/v2/handover-pilot/', title: '交接簿現場試用', text: '以單班卡片填寫、附檔與送出批示', tone: 'violet' },
];

function MobilePage({ profile }: { profile: Profile }) {
  return <AppShell profile={profile} title="手機操作介面"><section className="mobile-hero"><p>值勤人員</p><h2>{profile.name}，您好</h2><span>依目前角色顯示可用功能；所有操作同步寫入稽核紀錄。</span></section><section className="quick-grid">{actions.map(action => <a key={action.href} href={action.href} className={action.tone}><i/><strong>{action.title}</strong><span>{action.text}</span><b>進入 →</b></a>)}</section><section className="panel mobile-note"><h2>離線與推播能力</h2><p>現有巡檢離線網頁、離線暫存與行動推播功能持續沿用；新版介面透過相同資料庫與即時更新頻道同步，不建立第二套資料。</p><a href="/Inspection/v2/systems/guardpatrol/notifications/">查看推播紀錄</a></section></AppShell>;
}
export default function Page() { return <AuthGate>{profile => <MobilePage profile={profile} />}</AuthGate>; }

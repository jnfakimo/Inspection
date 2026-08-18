'use client';

// 專案關係圖，對應 V1 的 structure_map.html。
//
// V1 用 vis-network（CDN）畫可拖曳的物理佈局圖，節點是「專案目錄／頁面／錨點／資料庫」，
// 網址還停在改名前的 word-cloud 且全部指向 V1 頁面。這裡改成固定佈局的內嵌 SVG：
// 不引入第三方繪圖庫（vis-network 光是 standalone bundle 就比整個 V2 首頁還大），
// 節點也換成 V2 現行的八個系統與其後端相依，點擊直接進到對應的 V2 系統。
//
// 圖是靜態關係描述，不查資料庫——它描述的是系統之間怎麼接，不是即時狀態。

const SYSTEMS = [
  { key: 'admin', code: 'SYS-01', label: '後台管理', x: 40, y: 150 },
  { key: 'workorder', code: 'SYS-02', label: '維修派工', x: 260, y: 150 },
  { key: 'guardpatrol', code: 'SYS-03', label: '駐衛警巡檢', x: 480, y: 150 },
  { key: 'handover', code: 'SYS-04', label: '電子交接簿', x: 700, y: 150 },
  { key: 'equipment', code: 'SYS-05', label: '設備建置', x: 40, y: 250 },
  { key: 'structuremap', code: 'SYS-06', label: '專案關係與圖臺', x: 260, y: 250 },
  { key: 'vehicle', code: 'SYS-07', label: '公務車派車', x: 480, y: 250 },
  { key: 'meetingroom', code: 'SYS-08', label: '會議室預約', x: 700, y: 250 },
];
const BACKEND = [
  { label: 'app-api / admin-api', hint: 'JWT · RBAC · 業務流程', x: 40, y: 380, w: 260 },
  { label: 'PostgreSQL + RLS', hint: '最後一道資料庫防線', x: 330, y: 380, w: 260 },
  { label: 'Storage · Realtime · FCM', hint: '附件、即時更新與推播', x: 620, y: 380, w: 300 },
];
// 系統之間的業務關聯，與 V1 的虛線 correlations 對應。
const LINKS: Array<[string, string, string]> = [
  ['guardpatrol', 'workorder', '異常轉報修'],
  ['handover', 'workorder', '交接未結案件'],
  ['equipment', 'workorder', '設備關聯故障'],
  ['equipment', 'structuremap', '標記定位'],
];

const CARD_W = 200, CARD_H = 62;
const center = (item: { x: number; y: number }) => ({ x: item.x + CARD_W / 2, y: item.y + CARD_H / 2 });

export function SystemRelations() {
  const byKey = Object.fromEntries(SYSTEMS.map(item => [item.key, item]));

  return <section className="panel admin-panel">
    <div className="admin-toolbar"><span>系統關係圖</span><span>點選系統方塊可直接進入該系統</span></div>
    <div className="responsive-table">
      <svg viewBox="0 0 960 470" role="img" aria-label="八個子系統與後端服務的關係圖" style={{ width: '100%', minWidth: 720, height: 'auto' }}>
        <defs>
          <marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        <text x="40" y="42" fill="var(--cyan)" fontSize="15" fontWeight="700">使用端</text>
        <rect x="40" y="56" width="400" height="52" rx="8" fill="rgba(0,212,255,.08)" stroke="var(--line)" />
        <text x="60" y="80" fill="var(--text)" fontSize="14">網頁後台（/Inspection/v2）</text>
        <text x="60" y="98" fill="var(--dim)" fontSize="11">帳號登入 · 驗證碼 · RBAC 導向</text>
        <rect x="460" y="56" width="460" height="52" rx="8" fill="rgba(167,139,250,.08)" stroke="var(--line)" />
        <text x="480" y="80" fill="var(--text)" fontSize="14">行動端（/Inspection/v2/mobile）</text>
        <text x="480" y="98" fill="var(--dim)" fontSize="11">巡邏點打卡 · 快速報修 · 電子交接 · QR 簽到</text>

        {/* 業務關聯：先畫線再畫方塊，線才不會蓋住文字 */}
        {LINKS.map(([from, to, label]) => {
          const a = center(byKey[from]), b = center(byKey[to]);
          const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2 - 8;
          return <g key={`${from}-${to}`} color="var(--amber)">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--amber)" strokeWidth="1.4"
              strokeDasharray="5 4" markerEnd="url(#rel-arrow)" opacity="0.75" />
            <text x={midX} y={midY} fill="var(--amber)" fontSize="10" textAnchor="middle">{label}</text>
          </g>;
        })}

        {SYSTEMS.map(item => <a key={item.key} href={`/Inspection/v2/systems/${item.key}/`}>
          <g>
            <rect x={item.x} y={item.y} width={CARD_W} height={CARD_H} rx="8"
              fill="var(--panel2)" stroke="var(--cyan)" strokeWidth="1.2" />
            <text x={item.x + 14} y={item.y + 25} fill="var(--cyan)" fontSize="10" fontWeight="700">{item.code}</text>
            <text x={item.x + 14} y={item.y + 46} fill="var(--text)" fontSize="15">{item.label}</text>
          </g>
        </a>)}

        {/* 每個系統都往下接到後端這一層，逐條畫會變成蜘蛛網，改用一條匯流排 */}
        <line x1="480" y1="312" x2="480" y2="350" stroke="var(--line)" strokeWidth="1.4" markerEnd="url(#rel-arrow)" color="var(--line)" />
        <line x1="60" y1="350" x2="900" y2="350" stroke="var(--line)" strokeWidth="1.4" />
        <text x="496" y="342" fill="var(--dim)" fontSize="11">八個系統共用同一份資料與權限</text>

        {BACKEND.map(item => <g key={item.label}>
          <rect x={item.x} y={item.y} width={item.w} height={CARD_H} rx="8"
            fill="rgba(0,255,157,.06)" stroke="var(--line)" />
          <text x={item.x + 14} y={item.y + 26} fill="var(--green)" fontSize="13" fontWeight="700">{item.label}</text>
          <text x={item.x + 14} y={item.y + 46} fill="var(--dim)" fontSize="11">{item.hint}</text>
        </g>)}
      </svg>
    </div>
    <p className="inline-message">
      實線為共用後端，虛線為系統之間的業務關聯。寫入依系統而定：新版功能走 app-api，
      流程類操作走資料庫的 security definer 函式，RLS 一律是最後一道防線。
    </p>
  </section>;
}

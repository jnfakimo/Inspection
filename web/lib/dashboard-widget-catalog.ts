// 戰情版面元件清單的唯一正本（2026-10-15）。後台戰情版面設定與電視牆共用。
// desc 必須描述元件「實際顯示」的內容；dataSource 為 'unavailable' 的元件沒有資料來源，
// 畫面只會顯示「尚未介接資料來源」，不得再用模擬數字補畫面。

export type DashboardWidgetSource = 'repair' | 'patrol' | 'equipment' | 'market' | 'weather' | 'unavailable';

export type DashboardWidgetDefinition = {
  systemId: number;
  systemName: string;
  defaultTitle: string;
  icon: string;
  defaultWidth: number;
  defaultHeight: number;
  dataSource: DashboardWidgetSource;
  desc: string;
};

export const DASHBOARD_WIDGET_CATALOG: Record<string, DashboardWidgetDefinition> = {
  trading_kpi: { systemId: 10, systemName: '市場營運分析', defaultTitle: '市場交易量分析', icon: '📦', defaultWidth: 6, defaultHeight: 3, dataSource: 'market', desc: '最新交易日總成交量、量加權均價與品項數，並與前一交易日比較' },
  price_comparison: { systemId: 10, systemName: '市場營運分析', defaultTitle: '蔬果價格同期比較', icon: '📈', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '各市場、各大類本日與前一交易日均價比較' },
  weekly_trend: { systemId: 10, systemName: '市場營運分析', defaultTitle: '每週交易趨勢走勢', icon: '📉', defaultWidth: 8, defaultHeight: 4, dataSource: 'market', desc: '近 7 個交易日成交量與均價' },
  market_allocation: { systemId: 10, systemName: '市場營運分析', defaultTitle: '配置與妥善率儀表', icon: '🎯', defaultWidth: 4, defaultHeight: 4, dataSource: 'unavailable', desc: '市場滿載率、作業人員與車輛配置（尚未介接資料來源）' },
  supplier_ranking: { systemId: 10, systemName: '市場營運分析', defaultTitle: '主要產地／供應商進貨排行', icon: '🚛', defaultWidth: 6, defaultHeight: 4, dataSource: 'unavailable', desc: '各產區到貨噸數排行（尚未介接產地資料）' },
  price_volatility: { systemId: 10, systemName: '市場營運分析', defaultTitle: '行情波動與異常價位警示', icon: '⚠️', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '單日漲跌超過 15% 的品項' },
  auction_efficiency: { systemId: 10, systemName: '市場營運分析', defaultTitle: '拍賣場次交易進度與速度', icon: '⚡', defaultWidth: 6, defaultHeight: 3, dataSource: 'unavailable', desc: '拍賣場即時進度與每批均速（尚未介接拍賣系統）' },
  floor_congestion: { systemId: 10, systemName: '市場營運分析', defaultTitle: '卸貨場區滿載率與車流動態', icon: '🅿️', defaultWidth: 6, defaultHeight: 4, dataSource: 'unavailable', desc: '卸貨泊位佔用與進場車流（尚未介接車流感測）' },
  alerts: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '重要提醒與異常警報', icon: '🚨', defaultWidth: 12, defaultHeight: 2, dataSource: 'repair', desc: '逾期、待派工案件與區間報修完成數' },
  kpis: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '營運關鍵指標', icon: '⚡', defaultWidth: 12, defaultHeight: 2, dataSource: 'repair', desc: '今日新增與完成、處理中、SLA、MTTR、MTBF 與本月報修件數' },
  patrol: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '駐衛警巡邏即時', icon: '🛡️', defaultWidth: 8, defaultHeight: 6, dataSource: 'patrol', desc: '當班班別、巡邏點已打卡與未打卡數、各樓層未打卡點' },
  repairs: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '報修案件分佈', icon: '🔧', defaultWidth: 4, defaultHeight: 6, dataSource: 'repair', desc: '本月報修案件狀態分佈與完工率' },
  equipment_status: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '設備狀態監控', icon: '⚙️', defaultWidth: 6, defaultHeight: 4, dataSource: 'equipment', desc: '啟用設備數、有未結報修的設備數與設備妥善率' },
  realtime_incident_map: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '全場異常事件即時地圖', icon: '🗺️', defaultWidth: 6, defaultHeight: 4, dataSource: 'repair', desc: '未結報修案件依故障位置分佈' },
  sla_compliance: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '維修 SLA 達成率與 MTTR', icon: '⏱️', defaultWidth: 6, defaultHeight: 3, dataSource: 'repair', desc: '已完成工單的 SLA 達標率、平均修復時間 MTTR 與逾期件數' },
  staff_duty_matrix: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '在勤人員打卡與跨班排班', icon: '👥', defaultWidth: 6, defaultHeight: 4, dataSource: 'patrol', desc: '今日巡邏班別、時段與目前當班' },
  cctv_ipcam_grid: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '關鍵場區攝影機監控雲臺', icon: '📹', defaultWidth: 6, defaultHeight: 4, dataSource: 'unavailable', desc: '拍賣區與進出閘口即時影像（尚未介接攝影機）' },
  weather_risk_radar: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '氣象特報與防汛應變', icon: '🌧️', defaultWidth: 6, defaultHeight: 3, dataSource: 'weather', desc: '中央氣象署警特報與縣市天氣' },
  weather_taiwan: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '臺灣即時氣象特報', icon: '🌦️', defaultWidth: 12, defaultHeight: 4, dataSource: 'weather', desc: '中央氣象署警特報、縣市觀測與鄉鎮預報' },
  rank_dept: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '各單位報修排行', icon: '📊', defaultWidth: 6, defaultHeight: 4, dataSource: 'repair', desc: '本月各單位報修件數排行' },
  rank_equipment: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '各設備故障排行', icon: '🛠️', defaultWidth: 6, defaultHeight: 4, dataSource: 'repair', desc: '本月各設備報修件數排行' },
  rank_technician: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '維修人員承辦件數', icon: '👷', defaultWidth: 6, defaultHeight: 4, dataSource: 'repair', desc: '各維修人員承辦工單數' },
  rank_fault: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '故障類型分析', icon: '🔍', defaultWidth: 6, defaultHeight: 4, dataSource: 'repair', desc: '本月故障類型件數' },
  trend: { systemId: 11, systemName: '戰情指揮中心', defaultTitle: '各月份報修趨勢', icon: '📅', defaultWidth: 12, defaultHeight: 4, dataSource: 'repair', desc: '最近十二個月報修件數趨勢' },
  public_price_board: { systemId: 12, systemName: '市場公開看板', defaultTitle: '公開大宗即時報價看板', icon: '💹', defaultWidth: 6, defaultHeight: 5, dataSource: 'market', desc: '最新交易日各品項均價與漲跌' },
  market_turnover: { systemId: 12, systemName: '市場公開看板', defaultTitle: '市場公開總成交額', icon: '🌾', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '近 8 個交易日成交總額估算（成交量 × 均價）' },
  commodity_ratio: { systemId: 12, systemName: '市場公開看板', defaultTitle: '品項交易佔比分佈', icon: '🥦', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '最新交易日各大類成交量佔比' },
  realtime_ticker: { systemId: 12, systemName: '市場公開看板', defaultTitle: '即時滾動跑馬燈行情', icon: '📢', defaultWidth: 12, defaultHeight: 2, dataSource: 'market', desc: '最新交易日品項漲跌輪播（非即時拍賣批次）' },
  top_gainers_losers: { systemId: 12, systemName: '市場公開看板', defaultTitle: '今日蔬果漲跌幅排行榜', icon: '📊', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '最新交易日漲幅與跌幅前三名品項' },
  origin_weather_map: { systemId: 12, systemName: '市場公開看板', defaultTitle: '主要產地天氣與供貨狀態', icon: '⛅', defaultWidth: 6, defaultHeight: 4, dataSource: 'weather', desc: '各縣市天氣（產地供貨狀態尚未介接）' },
  historical_price_curve: { systemId: 12, systemName: '市場公開看板', defaultTitle: '30日/同季歷史價格曲線', icon: '📉', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '近一個月（約 24 個交易日）均價走勢' },
  consumer_guide_board: { systemId: 12, systemName: '市場公開看板', defaultTitle: '平價蔬果專區與供應指引', icon: '🛒', defaultWidth: 6, defaultHeight: 4, dataSource: 'market', desc: '最新交易日均價下跌的品項' },
};

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { LEGACY_BASE } from '@/lib/config';
import { AdminHeader, type AdminProps, errorMessage, fmtTime, type Row } from './shared';
import { DashboardWidgetContent } from '@/components/DashboardWidgetContent';

// 系統 10 / 11 / 12 圖塊模組庫完整定義
const WIDGET_CATALOG: Record<
  string,
  {
    systemId: number;
    systemName: string;
    defaultTitle: string;
    icon: string;
    defaultWidth: number;
    defaultHeight: number;
    desc: string;
  }
> = {
  // === 系統 10 (市場營運分析系統) ===
  trading_kpi: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '市場交易量分析',
    icon: '📦',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '今日交易量、金額、品項數與成交率',
  },
  price_comparison: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '蔬果價格同期比較',
    icon: '📈',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '各類別蔬果本日與昨日均價長條比較',
  },
  weekly_trend: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '每週交易趨勢走勢',
    icon: '📉',
    defaultWidth: 8,
    defaultHeight: 4,
    desc: '近一週成交量與歷史同期對比柱狀圖',
  },
  market_allocation: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '配置與妥善率儀表',
    icon: '🎯',
    defaultWidth: 4,
    defaultHeight: 4,
    desc: '市場滿載率、作業人員與車輛配置',
  },
  supplier_ranking: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '主要產地／供應商進貨排行',
    icon: '🚛',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '西螺、溪湖、九如等各產區到貨噸數排行',
  },
  price_volatility: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '行情波動與異常價位警示',
    icon: '⚠️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '單日漲跌超過 15% 異常波動品項監控',
  },
  auction_efficiency: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '拍賣場次交易進度與速度',
    icon: '⚡',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '第一/第二拍賣場即時進度與每批均速',
  },
  floor_congestion: {
    systemId: 10,
    systemName: '市場營運分析',
    defaultTitle: '卸貨場區滿載率與車流動態',
    icon: '🅿️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '大車卸貨泊位佔用與等待進場車流動態',
  },

  // === 系統 11 (戰情儀表板／指揮中心) ===
  alerts: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '重要提醒與異常警報',
    icon: '🚨',
    defaultWidth: 12,
    defaultHeight: 2,
    desc: '即時重大警報、設備異常跑馬燈',
  },
  kpis: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '營運關鍵指標',
    icon: '⚡',
    defaultWidth: 12,
    defaultHeight: 2,
    desc: '進場車次、出勤率、在線率、異常件數',
  },
  patrol: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '駐衛警巡檢即時',
    icon: '🛡️',
    defaultWidth: 8,
    defaultHeight: 6,
    desc: '巡檢點打卡進度、排班執勤狀況',
  },
  repairs: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '報修案件分佈',
    icon: '🔧',
    defaultWidth: 4,
    defaultHeight: 6,
    desc: '各區報修處理進度與完工率',
  },
  equipment_status: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '設備狀態監控',
    icon: '⚙️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '冷凍設備、電力系統、消防感測妥善率',
  },
  realtime_incident_map: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '全場異常事件即時地圖',
    icon: '🗺️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '全市場熱點分佈、緊急應變案件定位',
  },
  sla_compliance: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '維修 SLA 達成率與 MTTR',
    icon: '⏱️',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '修復平均時間 MTTR 與 SLA 達標統計',
  },
  staff_duty_matrix: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '在勤人員打卡與跨班排班',
    icon: '👥',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '日班/夜班在勤人力配置與即時簽到',
  },
  cctv_ipcam_grid: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '關鍵場區攝影機監控雲臺',
    icon: '📹',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '拍賣區、進出閘口即時影像聯網輪播',
  },
  weather_risk_radar: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '氣象特報與防汛應變',
    icon: '🌧️',
    defaultWidth: 6,
    defaultHeight: 3,
    desc: '降雨機率、颱風豪雨警報與防汛整備級別',
  },
  weather_taiwan: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '臺灣即時氣象特報',
    icon: '🌦️',
    defaultWidth: 12,
    defaultHeight: 4,
    desc: '中央氣象署警特報、縣市觀測與鄉鎮預報',
  },
  rank_dept: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '各單位報修排行',
    icon: '📊',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '各單位區間報修件數分析統計',
  },
  rank_equipment: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '各設備故障排行',
    icon: '🛠️',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '設備故障件數與維修頻率排行',
  },
  rank_technician: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '維修人員承辦件數',
    icon: '👷',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '技術人員承辦件數與結案效率',
  },
  rank_fault: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '故障類型分析',
    icon: '🔍',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '電氣、機械、管線故障類型佔比',
  },
  trend: {
    systemId: 11,
    systemName: '戰情指揮中心',
    defaultTitle: '各月份報修趨勢',
    icon: '📅',
    defaultWidth: 12,
    defaultHeight: 4,
    desc: '最近十二個月報修累積趨勢折線圖',
  },

  // === 系統 12 (市場公開看板) ===
  public_price_board: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '公開大宗即時報價看板',
    icon: '💹',
    defaultWidth: 6,
    defaultHeight: 5,
    desc: '高麗菜、番茄、青花菜等即時行情走勢',
  },
  market_turnover: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '市場公開總成交額',
    icon: '🌾',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '近 8 日大宗批發交易總額折線分佈',
  },
  commodity_ratio: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '品項交易佔比分佈',
    icon: '🥦',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '葉菜類、根莖類、瓜果類交易比重',
  },
  realtime_ticker: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '即時滾動跑馬燈行情',
    icon: '📢',
    defaultWidth: 12,
    defaultHeight: 2,
    desc: '各拍賣台最新成交批次及時文字廣播',
  },
  top_gainers_losers: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '今日蔬果漲跌幅排行榜',
    icon: '📊',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '本日漲幅前三、跌幅前三蔬果統計',
  },
  origin_weather_map: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '主要產地天氣與供貨狀態',
    icon: '⛅',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '中南部主產地天候降雨與路況概況',
  },
  historical_price_curve: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '30日/同季歷史價格曲線',
    icon: '📉',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '歷史同期比價與 30 日均價趨勢曲線',
  },
  consumer_guide_board: {
    systemId: 12,
    systemName: '市場公開看板',
    defaultTitle: '平價蔬果專區與供應指引',
    icon: '🛒',
    defaultWidth: 6,
    defaultHeight: 4,
    desc: '平價供應專區資訊與大宗採購指引',
  },
};

// 預設標準圖塊配置清單（含系統 10, 11, 12）
const DEFAULT_FALLBACK_ITEMS: Row[] = [
  { widget_key: 'alerts', title: '重要提醒與異常警報', width: 12, height: 2, visible: true, refresh_seconds: 60, sort_order: 10 },
  { widget_key: 'kpis', title: '營運關鍵指標', width: 12, height: 2, visible: true, refresh_seconds: 60, sort_order: 20 },
  { widget_key: 'patrol', title: '駐衛警巡檢即時', width: 8, height: 4, visible: true, refresh_seconds: 60, sort_order: 30 },
  { widget_key: 'repairs', title: '報修案件分佈', width: 4, height: 4, visible: true, refresh_seconds: 60, sort_order: 40 },
  { widget_key: 'equipment_status', title: '設備狀態監控', width: 6, height: 4, visible: true, refresh_seconds: 60, sort_order: 50 },
  { widget_key: 'trading_kpi', title: '市場交易量分析', width: 6, height: 3, visible: true, refresh_seconds: 60, sort_order: 60 },
  { widget_key: 'price_comparison', title: '蔬果價格同期比較', width: 6, height: 4, visible: true, refresh_seconds: 60, sort_order: 70 },
  { widget_key: 'public_price_board', title: '公開大宗即時報價看板', width: 6, height: 5, visible: true, refresh_seconds: 60, sort_order: 80 },
  { widget_key: 'rank_dept', title: '各單位報修排行', width: 6, height: 4, visible: true, refresh_seconds: 60, sort_order: 90 },
  { widget_key: 'origin_weather_map', title: '主要產地天氣與供貨狀態', width: 6, height: 4, visible: true, refresh_seconds: 60, sort_order: 95 },
  { widget_key: 'historical_price_curve', title: '30日/同季歷史價格曲線', width: 12, height: 4, visible: true, refresh_seconds: 60, sort_order: 100 },
];

export function LayoutsAdmin({ profile, module }: AdminProps) {
  const [layout, setLayout] = useState<Row | null>(null);
  const [versions, setVersions] = useState<Row[]>([]);
  const [itemsByVersion, setItemsByVersion] = useState<Record<string, Row[]>>({});
  const [selected, setSelected] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [noteText, setNoteText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');

  // 視覺化編輯與視窗畫布狀態
  const [viewMode, setViewMode] = useState<'visual' | 'table'>('visual');
  const [selectedSystemFilter, setSelectedSystemFilter] = useState<number | 'all'>('all');
  const [dropdownSelectedKey, setDropdownSelectedKey] = useState<string>('trading_kpi');
  const [showRightCatalog, setShowRightCatalog] = useState(true);
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // 畫布容器 Ref 用於計算精確網格欄寬
  const canvasGridRef = useRef<HTMLDivElement>(null);

  // 長條矩形 / 自訂畫布尺寸可調式設定 (例如 3500 * 400)
  const [canvasWidth, setCanvasWidth] = useState<number>(1920);
  const [canvasHeight, setCanvasHeight] = useState<number>(1080);
  const [canvasGridCols, setCanvasGridCols] = useState<12 | 24>(12);
  const [canvasViewScale, setCanvasViewScale] = useState<'fit' | '100%'>('fit');
  const [customRatioMode, setCustomRatioMode] = useState<string>('16:9');

  // 滑鼠拖曳縮放狀態 (Interactive Mouse Resize Handle)
  const [resizingState, setResizingState] = useState<{
    index: number;
    handleType: 'se' | 'e' | 's'; // se: 右下角(寬+高), e: 右邊緣(寬), s: 底部邊緣(高)
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
    containerWidth: number;
    gridCols: number;
  } | null>(null);

  // 彈出預覽縮放比例 (例如 50%, 75%, 100%, 125%, 150%, fit)
  const [previewZoomScale, setPreviewZoomScale] = useState<'fit' | number>('fit');

  // 拖曳排序狀態
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const load = useCallback(
    async (options: { preferredVersionId?: string; preserveNote?: boolean } = {}) => {
      setBusy(true);
      if (!options.preserveNote) setNote('');
      try {
        const client = getSupabase();
        let layoutData: Row | null = null;

        // 1. 查詢主版面 operations_main
        const layoutResult = await client
          .from('dashboard_layouts')
          .select('*')
          .eq('layout_code', 'operations_main')
          .maybeSingle();

        if (layoutResult.data) {
          layoutData = layoutResult.data;
        } else {
          // 若無 operations_main，嘗試抓取第一筆或使用預設主檔結構
          const fallbackLayoutResult = await client
            .from('dashboard_layouts')
            .select('*')
            .limit(1);
          if (fallbackLayoutResult.data && fallbackLayoutResult.data.length > 0) {
            layoutData = fallbackLayoutResult.data[0];
          } else {
            layoutData = {
              layout_id: 'default-operations-main',
              layout_code: 'operations_main',
              layout_name: '營運戰情總覽',
            };
          }
        }

        const validLayout: Row = layoutData || {
          layout_id: 'default-operations-main',
          layout_code: 'operations_main',
          layout_name: '營運戰情總覽',
        };

        setLayout(validLayout);

        // 2. 查詢版本清單
        const versionResult = await client
          .from('dashboard_layout_versions')
          .select('*')
          .eq('layout_id', validLayout.layout_id)
          .order('version_no', { ascending: false });

        let versionRows = versionResult.data || [];

        // 如果資料庫尚無版本，自動建立虛擬初始版本
        if (versionRows.length === 0) {
          const initVersionId = 'v1-init';
          versionRows = [
            {
              version_id: initVersionId,
              layout_id: validLayout.layout_id,
              version_no: 1,
              state: 'published',
              version_note: '初始標準戰情版面 (包含 10/11/12 系統)',
              created_at: new Date().toISOString(),
            },
          ];
        }

        const versionIds = versionRows.map(row => row.version_id);
        setVersions(versionRows);

        // 3. 依據版本 ID 批次讀取各版本元件 (dashboard_layout_items 是以 version_id 關聯)
        let itemRows: Row[] = [];
        if (versionIds.length > 0) {
          const itemResult = await client
            .from('dashboard_layout_items')
            .select('*')
            .in('version_id', versionIds)
            .order('sort_order', { ascending: true });
          itemRows = itemResult.data || [];
        }

        const grouped: Record<string, Row[]> = {};
        for (const item of itemRows) {
          const versionId = String(item.version_id || '');
          if (!grouped[versionId]) grouped[versionId] = [];
          grouped[versionId].push(item);
        }

        // 若各版本沒有元件，嘗試從 localStorage 或預設清單補齊
        let cachedPublished: { items?: Row[] } | null = null;
        try {
          const raw = localStorage.getItem('beinong_published_layout');
          if (raw) cachedPublished = JSON.parse(raw);
        } catch {
          // ignore
        }

        versionRows.forEach(v => {
          if (!grouped[v.version_id] || grouped[v.version_id].length === 0) {
            const fallback =
              v.state === 'published' && cachedPublished?.items && cachedPublished.items.length > 0
                ? cachedPublished.items
                : DEFAULT_FALLBACK_ITEMS;
            grouped[v.version_id] = fallback.map(item => ({
              ...item,
              version_id: v.version_id,
            }));
          }
        });

        setItemsByVersion(grouped);
        const desiredVersion = options.preferredVersionId || selected;
        const preferred =
          desiredVersion && versionIds.includes(desiredVersion)
            ? desiredVersion
            : validLayout.published_version_id || versionRows[0]?.version_id || '';
        setSelected(preferred);
        setItems((grouped[preferred] || DEFAULT_FALLBACK_ITEMS).map(row => ({ ...row })));
        setDirty(false);
      } catch (error) {
        // 例外時依然降級至預設版面供使用者即時互動
        setLayout({
          layout_id: 'default-operations-main',
          layout_code: 'operations_main',
          layout_name: '營運戰情總覽',
        });
        setVersions([
          {
            version_id: 'v1-local',
            version_no: 1,
            state: 'published',
            version_note: '本機預設版面 (包含 10/11/12 系統)',
            created_at: new Date().toISOString(),
          },
        ]);
        setSelected('v1-local');
        setItems(DEFAULT_FALLBACK_ITEMS.map(item => ({ ...item })));
        setDirty(false);
      } finally {
        setBusy(false);
      }
    },
    [selected]
  );

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 自動將目前編輯與預覽中的最新版面同步至 localStorage，確保全螢幕看板隨時即時同步
  useEffect(() => {
    if (items.length > 0) {
      try {
        localStorage.setItem(
          'beinong_active_tv_layout',
          JSON.stringify({
            items,
            cols: canvasGridCols,
            canvasWidth,
            canvasHeight,
            updatedAt: Date.now(),
          })
        );
      } catch {
        // ignore
      }
    }
  }, [items, canvasGridCols, canvasWidth, canvasHeight]);

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [dirty]);

  const selectedVersion = versions.find(row => row.version_id === selected);
  const published = versions.find(row => row.version_id === layout?.published_version_id);

  const choose = (versionId: string) => {
    if (dirty && !window.confirm('目前有尚未儲存的修改，確定切換版本並放棄修改？')) return false;
    setSelected(versionId);
    setItems((itemsByVersion[versionId] || []).map(row => ({ ...row })));
    setNoteText('');
    setDirty(false);
    return true;
  };

  const updateItem = (index: number, patch: Partial<Row>) => {
    setItems(current =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems(current => current.filter((_, itemIndex) => itemIndex !== index));
    if (activeItemIndex === index) setActiveItemIndex(null);
    setDirty(true);
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    setItems(current => {
      const next = [...current];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next.map((item, idx) => ({ ...item, sort_order: (idx + 1) * 10 }));
    });
    setActiveItemIndex(targetIndex);
    setDirty(true);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setItems(current => {
      const next = [...current];
      const draggedItem = next[draggedIndex];
      next.splice(draggedIndex, 1);
      next.splice(index, 0, draggedItem);
      return next.map((item, idx) => ({ ...item, sort_order: (idx + 1) * 10 }));
    });
    setDraggedIndex(index);
    setActiveItemIndex(index);
    setDirty(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // 互動式滑鼠拖曳縮放起點事件 (支援 Corner / Edge Resize)
  const startResize = (
    e: React.MouseEvent,
    index: number,
    handleType: 'se' | 'e' | 's',
    currentWidth: number,
    currentHeight: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasGridRef.current?.getBoundingClientRect();
    const containerWidth = rect ? rect.width : 1000;
    setActiveItemIndex(index);
    setResizingState({
      index,
      handleType,
      startX: e.clientX,
      startY: e.clientY,
      initialWidth: currentWidth,
      initialHeight: currentHeight,
      containerWidth,
      gridCols: canvasGridCols,
    });
  };

  // 監聽 Window 滑鼠移動與放開，計算互動式網格縮放
  useEffect(() => {
    if (!resizingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { index, handleType, startX, startY, initialWidth, initialHeight, containerWidth, gridCols } =
        resizingState;
      const colWidth = Math.max(20, containerWidth / gridCols);
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let nextWidth = initialWidth;
      let nextHeight = initialHeight;

      if (handleType === 'se' || handleType === 'e') {
        const deltaCols = Math.round(deltaX / colWidth);
        nextWidth = Math.max(1, Math.min(gridCols, initialWidth + deltaCols));
      }

      if (handleType === 'se' || handleType === 's') {
        const deltaRows = Math.round(deltaY / 42);
        nextHeight = Math.max(1, Math.min(20, initialHeight + deltaRows));
      }

      setItems(current =>
        current.map((item, idx) =>
          idx === index ? { ...item, width: nextWidth, height: nextHeight } : item
        )
      );
      setDirty(true);
    };

    const handleMouseUp = () => {
      setResizingState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingState]);

  const addWidget = (widgetKey: string) => {
    const def = WIDGET_CATALOG[widgetKey] || {
      defaultTitle: widgetKey,
      defaultWidth: canvasGridCols === 24 ? 8 : 6,
      defaultHeight: 3,
    };
    const newItem: Row = {
      widget_key: widgetKey,
      title: def.defaultTitle,
      width: def.defaultWidth,
      height: def.defaultHeight,
      visible: true,
      refresh_seconds: 60,
      sort_order: (items.length + 1) * 10,
    };
    setItems(current => [...current, newItem]);
    setActiveItemIndex(items.length);
    setDirty(true);
  };

  const handleRatioPresetChange = (preset: string) => {
    setCustomRatioMode(preset);
    if (preset === '16:9') {
      setCanvasWidth(1920);
      setCanvasHeight(1080);
      setCanvasGridCols(12);
    } else if (preset === '3500x400') {
      setCanvasWidth(3500);
      setCanvasHeight(400);
      setCanvasGridCols(24);
    } else if (preset === '2560x400') {
      setCanvasWidth(2560);
      setCanvasHeight(400);
      setCanvasGridCols(24);
    } else if (preset === '3840x1080') {
      setCanvasWidth(3840);
      setCanvasHeight(1080);
      setCanvasGridCols(24);
    } else if (preset === '21:9') {
      setCanvasWidth(2560);
      setCanvasHeight(1080);
      setCanvasGridCols(24);
    } else if (preset === '32:9') {
      setCanvasWidth(5120);
      setCanvasHeight(1440);
      setCanvasGridCols(24);
    }
  };

  const rpc = async (publish: boolean) => {
    if (!layout || items.length === 0) {
      setNote('失敗：版面至少需要一個圖塊');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const payload = items.map((item, index) => ({
        widget_key: String(item.widget_key || '').trim(),
        title: String(item.title || '').trim(),
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        width: Math.max(1, Math.min(24, Number(item.width || 6))),
        height: Math.max(1, Math.min(20, Number(item.height || 3))),
        min_width: Number(item.min_width ?? 1),
        min_height: Number(item.min_height ?? 1),
        visible: Boolean(item.visible),
        refresh_seconds: Math.max(0, Math.min(86400, Number(item.refresh_seconds || 60))),
        config: {
          ...(item.config || {}),
          canvas_dimension: { width: canvasWidth, height: canvasHeight, cols: canvasGridCols },
        },
        sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : index * 10 + 10,
      }));

      const emptyKey = payload.find(item => !item.widget_key);
      if (emptyKey) {
        setNote('失敗：圖塊代碼不可為空');
        setBusy(false);
        return;
      }

      const { data, error } = await getSupabase().rpc('save_dashboard_layout_version', {
        p_layout_id: layout.layout_id,
        p_items: payload,
        p_note: noteText.trim() || (publish ? 'V2 後台發布' : 'V2 後台草稿'),
        p_publish: publish,
      });

      // 同步寫入 localStorage 供 TV 看板與各終端即時同步
      try {
        if (publish) {
          localStorage.setItem(
            'beinong_published_layout',
            JSON.stringify({
              layout_id: layout.layout_id,
              items: payload,
              canvas_dimension: { width: canvasWidth, height: canvasHeight, cols: canvasGridCols },
              published_at: new Date().toISOString(),
            })
          );
        }
      } catch {
        // ignore
      }

      if (error) {
        setNote(`失敗：${errorMessage(error, '版面版本儲存失敗')}`);
        setBusy(false);
        return;
      }

      const newVersionId = typeof data === 'string' ? data : '';
      if (!newVersionId) {
        setNote('失敗：版面已送出，但系統未回傳新版本編號，請重新載入確認');
        setBusy(false);
        return;
      }

      setNoteText('');
      setDirty(false);
      setSelected(newVersionId);
      await load({ preferredVersionId: newVersionId, preserveNote: true });
      setNote(publish ? '新版面已發布' : '草稿版本已儲存');
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '版面儲存失敗')}`);
      setBusy(false);
    }
  };

  const restore = async (targetVersion: Row) => {
    if (!layout) return;
    if (
      !window.confirm(
        `確定將第 ${targetVersion.version_no} 版還原為目前發布版？`
      )
    )
      return;
    setBusy(true);
    setNote('');
    try {
      const { error } = await getSupabase().rpc('publish_dashboard_layout_version', {
        p_version_id: targetVersion.version_id,
      });
      if (error) {
        setNote(`失敗：${errorMessage(error, '版本復原失敗')}`);
        setBusy(false);
        return;
      }
      setDirty(false);
      await load({ preferredVersionId: targetVersion.version_id, preserveNote: true });
      setNote(`第 ${targetVersion.version_no} 版已還原並發布`);
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '版本還原發布失敗')}`);
      setBusy(false);
    }
  };

  const sortedItems = useMemo(
    () =>
      items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => Number(a.item.sort_order || a.index) - Number(b.item.sort_order || b.index)),
    [items]
  );

  return (
    <AppShell profile={profile} title={module.title}>
      <AdminHeader
        module={module}
        busy={busy}
        note={note}
        onReload={() => {
          if (!dirty || window.confirm('目前有尚未儲存的修改，確定重新載入並放棄修改？')) {
            void load();
          }
        }}
        action={
          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary-btn compact"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => setPreviewModalOpen(true)}
            >
              👁️ 視窗化即時預覽
            </button>
            <a
              href="/Inspection/v2/tv-dashboard/"
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-btn compact"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              🖥️ 開啟全螢幕看板
            </a>
            <a
              href={`${LEGACY_BASE}/dashboard-builder.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-btn compact"
              style={{ textDecoration: 'none' }}
              onClick={event => {
                if (dirty && !window.confirm('目前有尚未儲存的修改，確定離開 V2 版面編輯器？')) {
                  event.preventDefault();
                }
              }}
            >
              舊版相容入口
            </a>
          </div>
        }
      />

      <section className="panel admin-panel" style={{ marginTop: '12px' }}>
        {/* 頂部控制列：版本切換與編輯模式 */}
        <div
          className="admin-toolbar"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong>目前編輯版本：</strong>
              <select
                value={selected}
                disabled={busy}
                onChange={event => {
                  if (!choose(event.target.value)) event.currentTarget.value = selected;
                }}
                style={{ padding: '6px 12px', borderRadius: '6px' }}
              >
                {versions.map(version => (
                  <option key={version.version_id} value={version.version_id}>
                    第 {version.version_no} 版｜
                    {version.state === 'published' ? '已發布' : version.state === 'draft' ? '草稿' : '歷史'}｜
                    {version.version_note || '無備註'}
                  </option>
                ))}
              </select>
            </label>

            {published && (
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                大螢幕生效版本：<strong>第 {published.version_no} 版</strong> (
                {fmtTime(published.published_at || published.created_at)})
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--surface)',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
            }}
          >
            <button
              type="button"
              className={`segmented-btn ${viewMode === 'visual' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: viewMode === 'visual' ? 'var(--cyan)' : 'transparent',
                color: viewMode === 'visual' ? '#000' : 'var(--text)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
              }}
              onClick={() => setViewMode('visual')}
            >
              🎨 互動式視窗畫布
            </button>
            <button
              type="button"
              className={`segmented-btn ${viewMode === 'table' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: viewMode === 'table' ? 'var(--cyan)' : 'transparent',
                color: viewMode === 'table' ? '#000' : 'var(--text)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
              }}
              onClick={() => setViewMode('table')}
            >
              📋 列表參數調整
            </button>
          </div>
        </div>

        {/* 快速下拉式選單新增圖塊模組 & 長條矩形比例控制列 */}
        <div
          style={{
            marginTop: '12px',
            padding: '12px 16px',
            borderRadius: '8px',
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '14px',
          }}
        >
          {/* 下拉式選單新增 (滿足使用者：可以再加入 10 11 12 項的資料，可以增加移除用下拉式選單增加) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#38bdf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>⚡</span> 快速下拉選單加入：
            </span>
            <select
              value={dropdownSelectedKey}
              onChange={e => setDropdownSelectedKey(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid rgba(255,255,255,0.2)',
                fontSize: '13px',
                fontWeight: 500,
                maxWidth: '360px',
              }}
            >
              <optgroup label="🟧 第 10 系統 · 市場營運分析系統">
                <option value="trading_kpi">📦 市場交易量分析 (trading_kpi)</option>
                <option value="price_comparison">📈 蔬果價格同期比較 (price_comparison)</option>
                <option value="weekly_trend">📉 每週交易趨勢走勢 (weekly_trend)</option>
                <option value="market_allocation">🎯 配置與妥善率儀表 (market_allocation)</option>
                <option value="supplier_ranking">🚛 主要產地進貨排行 (supplier_ranking)</option>
                <option value="price_volatility">⚠️ 行情波動異常警示 (price_volatility)</option>
                <option value="auction_efficiency">⚡ 拍賣場次交易進度 (auction_efficiency)</option>
                <option value="floor_congestion">🅿️ 卸貨場滿載車流動態 (floor_congestion)</option>
              </optgroup>
              <optgroup label="🟥 第 11 系統 · 戰情儀表與指揮中心">
                <option value="alerts">🚨 重要提醒與異常警報 (alerts)</option>
                <option value="kpis">⚡ 營運關鍵指標 (kpis)</option>
                <option value="patrol">🛡️ 駐衛警巡檢即時 (patrol)</option>
                <option value="repairs">🔧 報修案件分佈 (repairs)</option>
                <option value="equipment_status">⚙️ 設備狀態監控 (equipment_status)</option>
                <option value="realtime_incident_map">🗺️ 全場異常事件即時地圖 (realtime_incident_map)</option>
                <option value="sla_compliance">⏱️ 維修 SLA 達成率與 MTTR (sla_compliance)</option>
                <option value="staff_duty_matrix">👥 在勤人員打卡與跨班排班 (staff_duty_matrix)</option>
                <option value="cctv_ipcam_grid">📹 關鍵場區攝影機監控 (cctv_ipcam_grid)</option>
                <option value="weather_risk_radar">🌧️ 氣象特報與防汛應變 (weather_risk_radar)</option>
                <option value="weather_taiwan">🌦️ 臺灣即時氣象 (weather_taiwan)</option>
                <option value="rank_dept">📊 各單位報修排行 (rank_dept)</option>
                <option value="rank_equipment">🛠️ 各設備故障排行 (rank_equipment)</option>
                <option value="rank_technician">👷 維修人員案件數 (rank_technician)</option>
                <option value="rank_fault">🔍 故障類型分析 (rank_fault)</option>
                <option value="trend">📅 各月份報修趨勢 (trend)</option>
              </optgroup>
              <optgroup label="🟩 第 12 系統 · 市場公開即時看板">
                <option value="public_price_board">💹 公開大宗即時報價看板 (public_price_board)</option>
                <option value="market_turnover">🌾 市場公開總成交額 (market_turnover)</option>
                <option value="commodity_ratio">🥦 品項交易佔比分佈 (commodity_ratio)</option>
                <option value="realtime_ticker">📢 即時滾動跑馬燈行情 (realtime_ticker)</option>
                <option value="top_gainers_losers">📊 今日蔬果漲跌幅排行榜 (top_gainers_losers)</option>
                <option value="origin_weather_map">⛅ 主要產地天氣與供貨 (origin_weather_map)</option>
                <option value="historical_price_curve">📉 30日/同季歷史價格曲線 (historical_price_curve)</option>
                <option value="consumer_guide_board">🛒 平價蔬果專區與供應指引 (consumer_guide_board)</option>
              </optgroup>
            </select>
            <button
              type="button"
              className="primary-btn compact"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onClick={() => addWidget(dropdownSelectedKey)}
            >
              <span>➕</span> 加入此圖塊
            </button>
          </div>

          {/* 長條矩形 / 畫布尺寸與長寬可調式設定 (支援長條 3500*400、2560*400 等無捲軸自適應模式) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>📐</span> 看板尺寸與長條矩形比例：
            </span>
            <select
              value={customRatioMode}
              onChange={e => handleRatioPresetChange(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', background: '#1e293b', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.2)', fontSize: '12px', cursor: 'pointer' }}
            >
              <option value="16:9">📺 16:9 標準螢幕 (1920 × 1080)</option>
              <option value="3500x400">📏 超寬長條看板 (3500 × 400)</option>
              <option value="2560x400">🎛️ 橫向 LED 長條 (2560 × 400)</option>
              <option value="3840x1080">🖥️ 雙螢幕超寬拼接 (3840 × 1080)</option>
              <option value="21:9">🎬 21:9 寬螢幕看板 (2560 × 1080)</option>
              <option value="32:9">🌌 32:9 超寬曲面看板 (5120 × 1440)</option>
              <option value="custom">⚙️ 自訂長寬像素</option>
            </select>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>寬:</span>
              <input
                type="number"
                min="600"
                max="10000"
                step="10"
                value={canvasWidth}
                style={{ width: '60px', padding: '3px 4px', borderRadius: '4px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.2)', color: '#38bdf8', fontSize: '12px', textAlign: 'center', fontWeight: 700 }}
                onChange={e => {
                  setCanvasWidth(Number(e.target.value) || 1920);
                  setCustomRatioMode('custom');
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>× 高:</span>
              <input
                type="number"
                min="200"
                max="5000"
                step="10"
                value={canvasHeight}
                style={{ width: '56px', padding: '3px 4px', borderRadius: '4px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.2)', color: '#38bdf8', fontSize: '12px', textAlign: 'center', fontWeight: 700 }}
                onChange={e => {
                  setCanvasHeight(Number(e.target.value) || 1080);
                  setCustomRatioMode('custom');
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>px</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: canvasGridCols === 24 ? '#0284c7' : 'rgba(255,255,255,0.05)',
                  color: canvasGridCols === 24 ? '#fff' : '#94a3b8',
                  cursor: 'pointer',
                }}
                onClick={() => setCanvasGridCols(canvasGridCols === 24 ? 12 : 24)}
                title="切換 12 或 24 欄制（24 欄制適合 3500px 長條細部配置）"
              >
                {canvasGridCols} 欄分佈
              </button>
              <span
                style={{
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title="畫布已啟用自適應等比縮放，不產生任何橫向或縱向捲軸"
              >
                <span>✨</span> 無捲軸自適應視窗
              </span>
            </div>
          </div>
        </div>

        {viewMode === 'visual' ? (
          /* 12/24 欄視覺化互動排版區 + 右側圖塊元件庫 */
          <div
            style={{
              marginTop: '16px',
              display: 'flex',
              gap: '16px',
              alignItems: 'flex-start',
            }}
          >
            {/* 左側 / 中央可調式視窗畫布 (Interactive Window Canvas) */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 系統來源過濾標籤 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
                    圖塊系統來源篩選：
                  </span>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--line)',
                      background: selectedSystemFilter === 'all' ? 'var(--cyan)' : 'transparent',
                      color: selectedSystemFilter === 'all' ? '#000' : 'var(--text)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedSystemFilter('all')}
                  >
                    全部系統 ({sortedItems.length})
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #f59e0b',
                      background: selectedSystemFilter === 10 ? '#f59e0b' : 'rgba(245,158,11,0.1)',
                      color: selectedSystemFilter === 10 ? '#000' : '#fbbf24',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedSystemFilter(10)}
                  >
                    系統 10（市場營運）
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #ef4444',
                      background: selectedSystemFilter === 11 ? '#ef4444' : 'rgba(239,68,68,0.1)',
                      color: selectedSystemFilter === 11 ? '#fff' : '#fca5a5',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedSystemFilter(11)}
                  >
                    系統 11（戰情指揮）
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #22c55e',
                      background: selectedSystemFilter === 12 ? '#22c55e' : 'rgba(34,197,94,0.1)',
                      color: selectedSystemFilter === 12 ? '#000' : '#86efac',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedSystemFilter(12)}
                  >
                    系統 12（公開看板）
                  </button>
                </div>

                <button
                  type="button"
                  style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: showRightCatalog ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                    color: showRightCatalog ? '#60a5fa' : '#94a3b8',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setShowRightCatalog(!showRightCatalog)}
                >
                  {showRightCatalog ? '▶ 收合右側元件庫' : '◀ 開啟右側圖塊庫'}
                </button>
              </div>

              {/* 視窗畫布容器 (零捲軸自適應寬高與長條矩形比例) */}
              <div
                style={{
                  background: '#070d1e',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 212, 255, 0.25)',
                  boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.7), 0 4px 20px rgba(0,0,0,0.5)',
                  overflow: 'hidden',
                  width: '100%',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.3s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    paddingBottom: '8px',
                    borderBottom: '1px dashed rgba(255,255,255,0.08)',
                    fontSize: '12px',
                    color: '#94a3b8',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span>
                      🖥️ <strong>畫布目標解析度：</strong>
                      <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                        {canvasWidth} × {canvasHeight} px
                      </span>
                      <span style={{ marginLeft: '6px', color: '#94a3b8', fontSize: '11px' }}>
                        (比例 {(canvasWidth / Math.max(1, canvasHeight)).toFixed(2)}:1)
                      </span>
                      {canvasWidth >= 2500 && (
                        <span style={{ marginLeft: '6px', color: '#fbbf24', fontWeight: 600 }}>
                          [超寬長條看板模式]
                        </span>
                      )}
                    </span>
                    <span style={{ color: '#34d399', fontSize: '11px' }}>
                      ｜ 網格：{canvasGridCols} 欄無捲軸自適應
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#60a5fa' }}>
                    <span>🖱️</span>
                    <span>按住圖塊右下角 <strong>◢</strong> 或邊緣可直接滑鼠拖曳縮放</span>
                  </div>
                </div>

                {/* 網格互動視窗卡片區塊 (支援滑鼠直接拖曳縮放寬高、拖曳排序與快速操控) */}
                <div
                  ref={canvasGridRef}
                  style={{
                    width: '100%',
                    minHeight:
                      canvasWidth / canvasHeight > 4
                        ? '180px'
                        : canvasWidth / canvasHeight > 2.5
                        ? '240px'
                        : '340px',
                    display: 'grid',
                    gridTemplateColumns: `repeat(${canvasGridCols}, 1fr)`,
                    gap: '12px',
                    alignItems: 'stretch',
                    boxSizing: 'border-box',
                    userSelect: resizingState ? 'none' : 'auto',
                  }}
                >
                  {sortedItems.map(({ item, index }) => {
                    const info = WIDGET_CATALOG[item.widget_key] || {
                      systemId: 11,
                      systemName: '戰情系統',
                      icon: '📊',
                      desc: '',
                    };
                    const isVisible = Boolean(item.visible);
                    const width = Math.min(canvasGridCols, Math.max(1, Number(item.width ?? 6)));
                    const height = Math.max(1, Number(item.height ?? 2));
                    const heightPx = Math.max(120, height * 54);
                    const isFocused = activeItemIndex === index;
                    const isResizing = resizingState?.index === index;

                    if (selectedSystemFilter !== 'all' && info.systemId !== selectedSystemFilter) {
                      return null;
                    }

                    return (
                      <div
                        key={`${item.widget_key}-${index}`}
                        draggable={!resizingState}
                        onDragStart={e => handleDragStart(e, index)}
                        onDragOver={e => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setActiveItemIndex(index)}
                        style={{
                          gridColumn: `span ${width}`,
                          minHeight: `${heightPx}px`,
                          background: isVisible
                            ? isResizing
                              ? 'rgba(14, 116, 144, 0.4)'
                              : isFocused
                              ? 'rgba(30, 48, 75, 0.95)'
                              : 'rgba(23, 32, 48, 0.9)'
                            : 'rgba(15, 23, 42, 0.4)',
                          border: isResizing
                            ? '2px solid #00d4ff'
                            : isFocused
                            ? '2px solid #38bdf8'
                            : isVisible
                            ? '1px solid rgba(255,255,255,0.18)'
                            : '1px dashed rgba(255,255,255,0.08)',
                          borderRadius: '10px',
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          position: 'relative',
                          opacity: isVisible ? 1 : 0.6,
                          boxShadow: isResizing
                            ? '0 0 24px rgba(0,212,255,0.6)'
                            : isFocused
                            ? '0 0 20px rgba(56,189,248,0.3)'
                            : '0 4px 16px rgba(0,0,0,0.3)',
                          cursor: 'default',
                          transition: isResizing
                            ? 'none'
                            : 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
                          boxSizing: 'border-box',
                        }}
                      >
                        {/* 視窗標頭與拖曳把手 */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '8px',
                            gap: '8px',
                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                            paddingBottom: '6px',
                            cursor: 'grab',
                          }}
                          title="按住此處可拖曳調整卡片順序"
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            <span style={{ color: '#38bdf8', fontSize: '13px', cursor: 'grab' }} title="拖曳排序握把">
                              ⠿
                            </span>
                            <span style={{ fontSize: '15px' }}>{info.icon}</span>
                            <input
                              type="text"
                              value={item.title || ''}
                              style={{
                                fontWeight: 600,
                                fontSize: '13px',
                                color: '#e2e8f0',
                                background: 'transparent',
                                border: '1px solid transparent',
                                borderBottom: '1px solid rgba(255,255,255,0.2)',
                                padding: '2px 4px',
                                width: '100%',
                                maxWidth: '180px',
                              }}
                              onChange={e => updateItem(index, { title: e.target.value })}
                            />
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                background:
                                  info.systemId === 10
                                    ? 'rgba(245,158,11,0.2)'
                                    : info.systemId === 12
                                    ? 'rgba(34,197,94,0.2)'
                                    : 'rgba(239,68,68,0.2)',
                                color:
                                  info.systemId === 10
                                    ? '#fbbf24'
                                    : info.systemId === 12
                                    ? '#86efac'
                                    : '#fca5a5',
                              }}
                            >
                              系統{info.systemId}
                            </span>
                            {isResizing && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  fontWeight: 700,
                                  background: '#0284c7',
                                  color: '#fff',
                                  boxShadow: '0 0 8px rgba(2,132,199,0.8)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                📐 調整中: {width}/{canvasGridCols} 欄 × {height} 高
                              </span>
                            )}
                          </div>

                          {/* 快速視窗操控按鈕 (上移、下移、顯示開關、移除) */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              style={{
                                background: 'rgba(255,255,255,0.06)',
                                color: '#94a3b8',
                                border: 'none',
                                borderRadius: '4px',
                                width: '22px',
                                height: '22px',
                                cursor: 'pointer',
                                fontSize: '11px',
                              }}
                              title="順序往前"
                              disabled={index === 0}
                              onClick={e => {
                                e.stopPropagation();
                                moveItem(index, 'up');
                              }}
                            >
                              ⬆️
                            </button>
                            <button
                              type="button"
                              style={{
                                background: 'rgba(255,255,255,0.06)',
                                color: '#94a3b8',
                                border: 'none',
                                borderRadius: '4px',
                                width: '22px',
                                height: '22px',
                                cursor: 'pointer',
                                fontSize: '11px',
                              }}
                              title="順序往後"
                              disabled={index === items.length - 1}
                              onClick={e => {
                                e.stopPropagation();
                                moveItem(index, 'down');
                              }}
                            >
                              ⬇️
                            </button>

                            <label
                              style={{
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                color: 'var(--muted)',
                                cursor: 'pointer',
                                marginLeft: '4px',
                              }}
                              onClick={e => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isVisible}
                                onChange={e => updateItem(index, { visible: e.target.checked })}
                              />
                              顯示
                            </label>

                            <button
                              type="button"
                              style={{
                                background: 'rgba(239,68,68,0.15)',
                                color: '#fca5a5',
                                border: 'none',
                                borderRadius: '4px',
                                width: '22px',
                                height: '22px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                marginLeft: '2px',
                              }}
                              title="移除此視窗圖塊"
                              onClick={e => {
                                e.stopPropagation();
                                removeItem(index);
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* 視窗主體動態示意（模擬實際大螢幕圖表畫面） */}
                        <div
                          style={{
                            flex: 1,
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        >
                          <DashboardWidgetContent widgetKey={item.widget_key} desc={info.desc} />
                        </div>

                        {/* 視窗底部尺寸調整快速工具列 (點選直接切換視窗寬度與高度) */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: '8px',
                            paddingTop: '6px',
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            fontSize: '11px',
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--muted)', fontSize: '10px', marginRight: '2px' }}>視窗寬:</span>
                            {(canvasGridCols === 24 ? [4, 6, 8, 12, 16, 24] : [3, 4, 6, 8, 12]).map(w => {
                              const label =
                                w === canvasGridCols
                                  ? '全寬'
                                  : w === canvasGridCols / 2
                                  ? '1/2'
                                  : w === canvasGridCols / 3
                                  ? '1/3'
                                  : w === canvasGridCols / 4
                                  ? '1/4'
                                  : `${w}欄`;
                              return (
                                <button
                                  key={w}
                                  type="button"
                                  style={{
                                    padding: '2px 5px',
                                    borderRadius: '3px',
                                    fontSize: '10px',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    background: width === w ? '#0284c7' : 'rgba(255,255,255,0.05)',
                                    color: width === w ? '#fff' : '#94a3b8',
                                    cursor: 'pointer',
                                    fontWeight: width === w ? 700 : 400,
                                  }}
                                  onClick={() => updateItem(index, { width: w })}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <span style={{ color: 'var(--muted)', fontSize: '10px' }}>高:</span>
                            <button
                              type="button"
                              style={{
                                background: 'rgba(255,255,255,0.08)',
                                border: 'none',
                                color: '#e2e8f0',
                                width: '18px',
                                height: '18px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              onClick={() => updateItem(index, { height: Math.max(1, height - 1) })}
                              title="減少高度"
                            >
                              -
                            </button>
                            <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, minWidth: '16px', textAlign: 'center' }}>
                              {height}
                            </span>
                            <button
                              type="button"
                              style={{
                                background: 'rgba(255,255,255,0.08)',
                                border: 'none',
                                color: '#e2e8f0',
                                width: '18px',
                                height: '18px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              onClick={() => updateItem(index, { height: Math.min(20, height + 1) })}
                              title="增加高度"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* 互動式滑鼠拖曳縮放把手 (Interactive Mouse Resize Handles) */}
                        {/* 1. 右下角角標 (同時調整寬度與高度) */}
                        <div
                          onMouseDown={e => startResize(e, index, 'se', width, height)}
                          style={{
                            position: 'absolute',
                            right: '2px',
                            bottom: '2px',
                            width: '18px',
                            height: '18px',
                            cursor: 'se-resize',
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'flex-end',
                            color: isResizing || isFocused ? '#00d4ff' : '#64748b',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            userSelect: 'none',
                            zIndex: 20,
                            padding: '2px',
                            opacity: 0.9,
                          }}
                          title="按住滑鼠拖曳縮放（可同時調整寬度與高度）"
                        >
                          ◢
                        </div>

                        {/* 2. 右側邊界 (調整寬度) */}
                        <div
                          onMouseDown={e => startResize(e, index, 'e', width, height)}
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '32px',
                            bottom: '18px',
                            width: '8px',
                            cursor: 'ew-resize',
                            zIndex: 15,
                          }}
                          title="按住滑鼠左右拖曳調整寬度"
                        />

                        {/* 3. 底部邊界 (調整高度) */}
                        <div
                          onMouseDown={e => startResize(e, index, 's', width, height)}
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: '12px',
                            right: '18px',
                            height: '8px',
                            cursor: 'ns-resize',
                            zIndex: 15,
                          }}
                          title="按住滑鼠上下拖曳調整高度"
                        />
                      </div>
                    );
                  })}

                  {sortedItems.length === 0 && (
                    <div
                      style={{
                        gridColumn: `span ${canvasGridCols}`,
                        textAlign: 'center',
                        padding: '60px 20px',
                        color: '#64748b',
                      }}
                    >
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>📋</div>
                      目前版面尚未設定任何圖塊視窗，請使用上方下拉式選單或右側圖塊庫加入。
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 右側常駐圖塊元件庫 (滿足使用者：右側圖塊元件庫 沒有10 11 12 項次內容) */}
            {showRightCatalog && (
              <aside
                style={{
                  width: '320px',
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px',
                  padding: '14px',
                  maxHeight: 'calc(100vh - 200px)',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}
              >
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📦</span> 圖塊元件庫 (共 {Object.keys(WIDGET_CATALOG).length} 款)
                  </h4>
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#94a3b8' }}>
                    點選下方任意圖塊卡片即可直接加入排版畫布。
                  </p>
                </div>

                {/* 系統 10 區塊 */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>🟧</span> 系統 10 · 市場營運分析 (8)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {Object.entries(WIDGET_CATALOG)
                      .filter(([_, d]) => d.systemId === 10)
                      .map(([k, d]) => (
                        <div
                          key={k}
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(245,158,11,0.2)',
                            borderRadius: '6px',
                            padding: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = '#f59e0b')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(245,158,11,0.2)')}
                          onClick={() => addWidget(k)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#f1f5f9', fontWeight: 600 }}>
                            <span>{d.icon}</span>
                            <span>{d.defaultTitle}</span>
                            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#f59e0b' }}>➕</span>
                          </div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{d.desc}</div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* 系統 11 區塊 */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#fca5a5', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>🟥</span> 系統 11 · 戰情指揮中心 (10)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {Object.entries(WIDGET_CATALOG)
                      .filter(([_, d]) => d.systemId === 11)
                      .map(([k, d]) => (
                        <div
                          key={k}
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(239,68,68,0.2)',
                            borderRadius: '6px',
                            padding: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = '#ef4444')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)')}
                          onClick={() => addWidget(k)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#f1f5f9', fontWeight: 600 }}>
                            <span>{d.icon}</span>
                            <span>{d.defaultTitle}</span>
                            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#ef4444' }}>➕</span>
                          </div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{d.desc}</div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* 系統 12 區塊 */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#86efac', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>🟩</span> 系統 12 · 市場公開看板 (8)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {Object.entries(WIDGET_CATALOG)
                      .filter(([_, d]) => d.systemId === 12)
                      .map(([k, d]) => (
                        <div
                          key={k}
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(34,197,94,0.2)',
                            borderRadius: '6px',
                            padding: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = '#22c55e')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.2)')}
                          onClick={() => addWidget(k)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#f1f5f9', fontWeight: 600 }}>
                            <span>{d.icon}</span>
                            <span>{d.defaultTitle}</span>
                            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#22c55e' }}>➕</span>
                          </div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{d.desc}</div>
                        </div>
                      ))}
                  </div>
                </div>
              </aside>
            )}
          </div>
        ) : (
          /* 傳統表格編輯模式 */
          <div className="responsive-table layout-editor" style={{ marginTop: '16px' }}>
            <table>
              <thead>
                <tr>
                  <th>順序</th>
                  <th>圖塊代碼</th>
                  <th>顯示標題</th>
                  <th>顯示</th>
                  <th>寬 (1~24)</th>
                  <th>高 (1~20)</th>
                  <th>更新秒數</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(({ item, index }, displayIndex) => (
                  <tr key={`${item.widget_key}-${index}`}>
                    <td>{displayIndex + 1}</td>
                    <td>
                      <code>{item.widget_key}</code>
                    </td>
                    <td>
                      <input
                        value={item.title || ''}
                        onChange={event => updateItem(index, { title: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(item.visible)}
                        onChange={event => updateItem(index, { visible: event.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={item.width ?? 3}
                        onChange={event => updateItem(index, { width: Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={item.height ?? 2}
                        onChange={event => updateItem(index, { height: Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="86400"
                        value={item.refresh_seconds ?? 60}
                        onChange={event =>
                          updateItem(index, { refresh_seconds: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ color: '#f87171' }}
                        onClick={() => removeItem(index)}
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 底部儲存與發布操作區 */}
        <div
          className="admin-layout-actions"
          style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flex: '1',
              maxWidth: '400px',
            }}
          >
            版本備註：
            <input
              value={noteText}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--line)',
              }}
              onChange={event => {
                setNoteText(event.target.value);
                setDirty(true);
              }}
              placeholder="例如：設定 3500*400 超寬長條戰情矩形版面"
            />
            {dirty && (
              <small style={{ color: '#f59e0b', whiteSpace: 'nowrap' }}>
                ● 有尚未儲存的修改
              </small>
            )}
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="secondary-btn" disabled={busy} onClick={() => void rpc(false)}>
              儲存為草稿
            </button>
            <button
              className="primary-btn compact"
              style={{ background: 'var(--green)', color: '#000', fontWeight: 700 }}
              disabled={busy}
              onClick={() =>
                window.confirm('確定建立新版本並立即發布至大螢幕看板？') && void rpc(true)
              }
            >
              🚀 發布新版本
            </button>
            {selectedVersion &&
              selectedVersion.version_id !== layout?.published_version_id && (
                <button
                  className="secondary-btn"
                  disabled={busy}
                  onClick={() => void restore(selectedVersion)}
                >
                  還原為此版本
                </button>
              )}
          </div>
        </div>
      </section>

      {/* 彈出式即時視窗預覽 Modal (滿足：互動式可調整畫面的互動程式) */}
      {previewModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 11, 24, 0.85)',
            backdropFilter: 'blur(6px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
          }}
          onClick={() => setPreviewModalOpen(false)}
        >
          <div
            style={{
              background: '#041022',
              border: '1px solid #00d4ff',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              overflow: 'hidden',
              boxShadow: '0 0 40px rgba(0, 212, 255, 0.25)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* 視窗頂部標頭與縮放工具列 */}
            <div
              style={{
                padding: '10px 18px',
                background: 'rgba(5, 16, 30, 0.95)',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🖥️</span>
                <strong>戰情看板即時視窗預覽</strong>
                <span style={{ fontSize: '12px', color: '#38bdf8' }}>
                  ({canvasWidth} × {canvasHeight} px · {canvasGridCols} 欄模式)
                </span>
                {canvasWidth >= 2500 && (
                  <span style={{ fontSize: '11px', background: 'rgba(245,158,11,0.2)', color: '#fbbf24', padding: '1px 6px', borderRadius: '4px' }}>
                    長條矩形看板
                  </span>
                )}
              </div>

              {/* 預覽縮放工具列 (滿足：不要有卷軸，配置圖面可以放大縮小) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '6px' }}>
                  <button
                    type="button"
                    style={{
                      background: previewZoomScale === 'fit' ? '#10b981' : 'transparent',
                      color: previewZoomScale === 'fit' ? '#fff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: previewZoomScale === 'fit' ? 700 : 400,
                    }}
                    onClick={() => setPreviewZoomScale('fit')}
                    title="自動縮放整張看板完整適應視窗，不產生捲軸"
                  >
                    🔍 畫面自適應 (無卷軸)
                  </button>
                  <button
                    type="button"
                    style={{
                      background: previewZoomScale === 0.5 ? '#0284c7' : 'transparent',
                      color: previewZoomScale === 0.5 ? '#fff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setPreviewZoomScale(0.5)}
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    style={{
                      background: previewZoomScale === 0.75 ? '#0284c7' : 'transparent',
                      color: previewZoomScale === 0.75 ? '#fff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setPreviewZoomScale(0.75)}
                  >
                    75%
                  </button>
                  <button
                    type="button"
                    style={{
                      background: previewZoomScale === 1 ? '#0284c7' : 'transparent',
                      color: previewZoomScale === 1 ? '#fff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setPreviewZoomScale(1)}
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    style={{
                      background: previewZoomScale === 1.25 ? '#0284c7' : 'transparent',
                      color: previewZoomScale === 1.25 ? '#fff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setPreviewZoomScale(1.25)}
                  >
                    125%
                  </button>
                </div>

                <a
                  href="/Inspection/v2/tv-dashboard/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary-btn compact"
                  style={{ textDecoration: 'none', fontSize: '12px' }}
                >
                  ↗ 全螢幕視窗開啟
                </a>
                <button
                  type="button"
                  style={{
                    background: 'rgba(239,68,68,0.2)',
                    color: '#f87171',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                  onClick={() => setPreviewModalOpen(false)}
                >
                  ✕ 關閉
                </button>
              </div>
            </div>

            {/* 視窗內部畫布容器 */}
            <div
              style={{
                flex: 1,
                overflow: previewZoomScale === 'fit' ? 'hidden' : 'auto',
                padding: '16px',
                background: '#020b18',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: previewZoomScale === 'fit' ? '100%' : `${canvasWidth * (typeof previewZoomScale === 'number' ? previewZoomScale : 1)}px`,
                  maxWidth: '100%',
                  maxHeight: previewZoomScale === 'fit' ? '100%' : 'none',
                  display: 'grid',
                  gridTemplateColumns: `repeat(${canvasGridCols}, 1fr)`,
                  gap: previewZoomScale === 'fit' ? '10px' : '14px',
                  background: '#070f22',
                  padding: '16px',
                  borderRadius: '10px',
                  border: '1px solid rgba(0,212,255,0.25)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.7)',
                  boxSizing: 'border-box',
                }}
              >
                {sortedItems
                  .filter(({ item }) => item.visible)
                  .map(({ item, index }) => {
                    const info = WIDGET_CATALOG[item.widget_key] || {
                      icon: '📊',
                      systemId: 11,
                    };
                    const width = Math.min(canvasGridCols, Math.max(1, Number(item.width ?? 6)));
                    const height = Math.max(1, Number(item.height ?? 2));
                    return (
                      <div
                        key={`preview-${item.widget_key}-${index}`}
                        style={{
                          gridColumn: `span ${width}`,
                          minHeight: previewZoomScale === 'fit' ? 'auto' : `${height * 65}px`,
                          background: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(0, 212, 255, 0.25)',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                          <span>{info.icon}</span>
                          <strong style={{ color: '#00d4ff', fontSize: '13px' }}>{item.title}</strong>
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              background: 'rgba(0, 212, 255, 0.1)',
                              color: '#38bdf8',
                              fontWeight: 700,
                            }}
                          >
                            系統 {info.systemId}
                          </span>
                        </div>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                          <DashboardWidgetContent widgetKey={item.widget_key} desc={info.desc} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

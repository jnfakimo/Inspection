'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './equipment-operations-energy.module.css';

export type EquipmentOperationalState = 'healthy' | 'anomalous' | 'stopped' | 'maintenance' | 'offline' | 'unknown';
export type EquipmentFeedState = 'loading' | 'ready' | 'empty' | 'pending' | 'truncated' | 'error';
export type RelationState = 'available' | 'none' | 'pending' | 'error';
export type FilterOption = { value: string; label: string };

export type EquipmentAlarm = {
  eventId: string;
  title: string;
  severityLabel: string;
  occurredAt: string | null;
  receivedAt: string | null;
  repairRequestId?: string | null;
};

export type EquipmentWorkOrder = {
  requestId: string;
  requestNo: string;
  orderId: string | null;
  orderNo: string | null;
  statusLabel: string;
  updatedAt: string | null;
};
export type OpenWorkOrder = (workOrder: EquipmentWorkOrder) => void;

export type EquipmentInspectionCheck = {
  recordId: string;
  label: string;
  resultLabel: string;
  performedAt: string | null;
  sourceOrderId?: string | null;
};

export type EquipmentClosureEvidence = {
  evidenceId: string;
  label: string;
  recordedAt: string | null;
};

export type EquipmentOperationalAsset = {
  equipmentId: string;
  assetCode: string;
  name: string;
  siteId?: string | null;
  siteName?: string | null;
  floorId?: string | null;
  floorName?: string | null;
  systemId?: string | null;
  systemName?: string | null;
  location?: string | null;
  /** This is an adapter-supplied operational state; never derive it from equipment.status. */
  operationalState: EquipmentOperationalState;
  sourceName?: string | null;
  sourceObservedAt: string | null;
  receivedAt: string | null;
  trace: {
    alarms: { state: RelationState; items: readonly EquipmentAlarm[] };
    workOrders: { state: RelationState; items: readonly EquipmentWorkOrder[] };
    inspections: { state: RelationState; items: readonly EquipmentInspectionCheck[] };
    closureEvidence: { state: RelationState; items: readonly EquipmentClosureEvidence[] };
  };
};

export type EnergyMetricKey = 'dailyElectricity' | 'instantPower' | 'maximumDemand' | 'dailyWater';
export type EnergyReading = {
  state: 'available' | 'pending' | 'stale' | 'error' | 'empty';
  value: number | null;
  sourceName?: string | null;
  sourceObservedAt?: string | null;
  receivedAt?: string | null;
};

export type EquipmentOperationsEnergyProps = {
  equipmentFeed: EquipmentFeedState;
  equipment: readonly EquipmentOperationalAsset[];
  energy?: Partial<Record<EnergyMetricKey, EnergyReading>>;
  filterOptions?: {
    sites?: readonly FilterOption[];
    floors?: readonly FilterOption[];
    systems?: readonly FilterOption[];
  };
  mapHref?: string;
  errorMessage?: string;
  onOpenWorkOrder?: (workOrder: EquipmentWorkOrder) => void;
};

const ALL = '__all__';
export const EQUIPMENT_PAGE_SIZE = 10;

export type EquipmentPageFilters = {
  siteId?: string;
  floorId?: string;
  systemId?: string;
};

export function deriveEquipmentPage(
  equipment: readonly EquipmentOperationalAsset[],
  filters: EquipmentPageFilters,
  requestedPage: number,
  pageSize = EQUIPMENT_PAGE_SIZE,
) {
  const filteredAssets = equipment.filter(asset =>
    (!filters.siteId || asset.siteId === filters.siteId) &&
    (!filters.floorId || asset.floorId === filters.floorId) &&
    (!filters.systemId || asset.systemId === filters.systemId))
    .slice()
    .sort((left, right) =>
      left.assetCode.localeCompare(right.assetCode, 'zh-Hant', { numeric: true, sensitivity: 'base' }) ||
      left.equipmentId.localeCompare(right.equipmentId, 'zh-Hant', { numeric: true }));
  const safePageSize = Math.max(1, Math.trunc(pageSize) || EQUIPMENT_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / safePageSize));
  const page = Math.min(Math.max(Math.trunc(requestedPage) || 1, 1), pageCount);
  const start = (page - 1) * safePageSize;
  return {
    filteredAssets,
    pageAssets: filteredAssets.slice(start, start + safePageSize),
    page,
    pageCount,
    pageSize: safePageSize,
    totalCount: filteredAssets.length,
  };
}

const OPERATIONAL_STATES: ReadonlyArray<{
  key: EquipmentOperationalState;
  label: string;
  className: string;
}> = [
  { key: 'healthy', label: '正常', className: styles.statusHealthy },
  { key: 'anomalous', label: '異常', className: styles.statusAnomalous },
  { key: 'stopped', label: '停機', className: styles.statusStopped },
  { key: 'maintenance', label: '維護中', className: styles.statusMaintenance },
  { key: 'offline', label: '離線', className: styles.statusOffline },
  { key: 'unknown', label: '未知', className: styles.statusUnknown },
];

const ENERGY_METRICS: ReadonlyArray<{ key: EnergyMetricKey; label: string; unit: string; className: string }> = [
  { key: 'dailyElectricity', label: '今日用電量', unit: 'kWh', className: styles.energyElectricity },
  { key: 'instantPower', label: '即時功率', unit: 'kW', className: styles.energyPower },
  { key: 'maximumDemand', label: '最大需量', unit: 'kW', className: styles.energyDemand },
  { key: 'dailyWater', label: '今日用水量', unit: 'm³', className: styles.energyWater },
];

const FEED_LABEL: Record<EquipmentFeedState, string> = {
  loading: '載入中', ready: '資料已載入', empty: '目前沒有資料', pending: '待介接', truncated: '來源已達載入上限', error: '讀取失敗',
};
const RELATION_LABEL: Record<RelationState, string> = {
  available: '已取得資料', none: '無關聯紀錄', pending: '待介接', error: '讀取失敗',
};
const ENERGY_STATE_LABEL: Record<EnergyReading['state'], string> = {
  available: '已取得讀值', pending: '待介接', stale: '資料逾時', error: '讀取失敗', empty: '尚無讀值',
};

function timestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function uniqueOptions(
  assets: readonly EquipmentOperationalAsset[],
  provided: readonly FilterOption[] | undefined,
  valueKey: 'siteId' | 'floorId' | 'systemId',
  labelKey: 'siteName' | 'floorName' | 'systemName',
): FilterOption[] {
  const options = new Map<string, string>();
  for (const option of provided || []) options.set(option.value, option.label);
  for (const asset of assets) {
    const value = asset[valueKey];
    if (value) options.set(value, asset[labelKey] || value);
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
}

function relationValue(state: RelationState, count: number): string {
  if (state === 'available') return count ? `${count} 筆` : '已介接，未提供明細';
  return RELATION_LABEL[state];
}

function energyValue(reading: EnergyReading | undefined, unit: string): string {
  if (!reading || reading.state !== 'available' || reading.value == null || !Number.isFinite(reading.value)) return '—';
  return `${reading.value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })} ${unit}`;
}

/** Pass canonical IDs to the route adapter; do not search by device name or guess a URL here. */
export function openEquipmentWorkOrder(workOrder: EquipmentWorkOrder, onOpenWorkOrder?: OpenWorkOrder): boolean {
  if (!onOpenWorkOrder || !workOrder.orderId) return false;
  onOpenWorkOrder(workOrder);
  return true;
}

function RelationMessage({ state, count }: { state: RelationState; count: number }) {
  const message = state === 'available' && count > 0 ? '' : relationValue(state, count);
  return message ? <span className={styles.relationMessage}>{message}</span> : null;
}

export function EquipmentOperationsEnergy({
  equipmentFeed,
  equipment,
  energy = {},
  filterOptions,
  mapHref,
  errorMessage,
  onOpenWorkOrder,
}: EquipmentOperationsEnergyProps) {
  const [siteFilter, setSiteFilter] = useState(ALL);
  const [floorFilter, setFloorFilter] = useState(ALL);
  const [systemFilter, setSystemFilter] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sites = useMemo(() => uniqueOptions(equipment, filterOptions?.sites, 'siteId', 'siteName'), [equipment, filterOptions?.sites]);
  const floors = useMemo(() => uniqueOptions(equipment, filterOptions?.floors, 'floorId', 'floorName'), [equipment, filterOptions?.floors]);
  const systems = useMemo(() => uniqueOptions(equipment, filterOptions?.systems, 'systemId', 'systemName'), [equipment, filterOptions?.systems]);
  const equipmentPage = useMemo(() => deriveEquipmentPage(equipment, {
    siteId: siteFilter === ALL ? undefined : siteFilter,
    floorId: floorFilter === ALL ? undefined : floorFilter,
    systemId: systemFilter === ALL ? undefined : systemFilter,
  }, page), [equipment, siteFilter, floorFilter, systemFilter, page]);
  const filteredEquipment = equipmentPage.filteredAssets;
  const pageEquipment = equipmentPage.pageAssets;
  useEffect(() => {
    if (page !== equipmentPage.page) setPage(equipmentPage.page);
  }, [equipmentPage.page, page]);
  const selected = filteredEquipment.find(asset => asset.equipmentId === selectedId) || filteredEquipment[0] || null;
  const stateCounts = useMemo(() => {
    const counts: Record<EquipmentOperationalState, number> = {
      healthy: 0, anomalous: 0, stopped: 0, maintenance: 0, offline: 0, unknown: 0,
    };
    filteredEquipment.forEach(asset => { counts[asset.operationalState] += 1; });
    return counts;
  }, [filteredEquipment]);
  const countsAvailable = equipmentFeed === 'ready' || equipmentFeed === 'empty';
  const equipmentNotice = equipmentFeed === 'error'
    ? errorMessage || '設備資料載入失敗，請稍後重試。'
    : equipmentFeed === 'pending' ? '設備資料來源待介接。'
      : equipmentFeed === 'truncated' ? '資料來源已達載入上限；以下僅計算目前載入資料，實際筆數可能更多。'
        : equipmentFeed === 'loading' ? '設備資料載入中。' : '';

  return <section className={styles.root} aria-label="設備營運與能源">
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>設備營運中心</p>
        <h2>設備營運與能源</h2>
        <p className={styles.headerNote}>設備狀態、告警、工單、巡檢與結案佐證勾稽</p>
      </div>
      {mapHref ? <a className={styles.mapLink} href={mapHref}>開啟三維圖台</a> : null}
    </header>

    <section className={styles.filters} aria-label="設備篩選">
      <label>場域
        <select value={siteFilter} onChange={event => { setSiteFilter(event.target.value); setPage(1); }} disabled={!sites.length}>
          <option value={ALL}>全部場域</option>
          {sites.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>樓層
        <select value={floorFilter} onChange={event => { setFloorFilter(event.target.value); setPage(1); }} disabled={!floors.length}>
          <option value={ALL}>全部樓層</option>
          {floors.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>設備系統
        <select value={systemFilter} onChange={event => { setSystemFilter(event.target.value); setPage(1); }} disabled={!systems.length}>
          <option value={ALL}>全部系統</option>
          {systems.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <span className={styles.filterSummary}>{equipmentNotice || `顯示 ${filteredEquipment.length} / ${equipment.length} 項設備`}</span>
    </section>

    <section className={styles.statusGrid} aria-label="設備營運狀態統計">
      {OPERATIONAL_STATES.map(item => <article className={`${styles.statusCard} ${item.className}`} key={item.key}>
        <span>{item.label}</span>
        <strong>{countsAvailable ? stateCounts[item.key] : '—'}</strong>
        <small>{countsAvailable ? '項設備' : FEED_LABEL[equipmentFeed]}</small>
      </article>)}
    </section>

    <div className={styles.mainGrid}>
      <section className={styles.panel} aria-labelledby="equipment-issue-heading">
        <header className={styles.panelHeader}>
          <div><h3 id="equipment-issue-heading">設備狀態與待處理事項</h3><p>狀態及時間依資料來源回報，未提供時不推定為正常</p></div>
          <span className={styles.panelCount}>{equipmentFeed === 'truncated' ? `目前載入 ${filteredEquipment.length} 項（可能更多）` : countsAvailable ? `${filteredEquipment.length} 項` : FEED_LABEL[equipmentFeed]}</span>
        </header>
        <div className={styles.tableScroll}>
          <table className={styles.issueTable}>
            <thead><tr><th>設備編號／名稱</th><th>位置</th><th>營運狀態</th><th>來源資料時間</th><th>告警</th><th>工單</th></tr></thead>
            <tbody>
              {pageEquipment.map(asset => {
                const status = OPERATIONAL_STATES.find(item => item.key === asset.operationalState) || OPERATIONAL_STATES[5];
                const alarmState = asset.trace.alarms.state;
                const workOrderState = asset.trace.workOrders.state;
                const latestAlarm = asset.trace.alarms.items[0];
                const latestOrder = asset.trace.workOrders.items[0];
                return <tr key={asset.equipmentId} className={selected?.equipmentId === asset.equipmentId ? styles.selectedRow : undefined}>
                  <td><button type="button" className={styles.assetSelect} aria-pressed={selected?.equipmentId === asset.equipmentId}
                    onClick={() => setSelectedId(asset.equipmentId)}><strong>{asset.assetCode || '未編號'}</strong><span>{asset.name || '未命名設備'}</span></button></td>
                  <td>{[asset.floorName || asset.floorId, asset.location].filter(Boolean).join('・') || '—'}</td>
                  <td><span className={`${styles.stateBadge} ${status.className}`}><i aria-hidden="true" />{status.label}</span></td>
                  <td><span className={styles.timestamp}>{timestamp(asset.sourceObservedAt)}</span><small>{asset.sourceName || '來源未提供'}</small></td>
                  <td>{latestAlarm ? <span className={styles.issueValue} title={latestAlarm.title}>{latestAlarm.title}<small>{latestAlarm.severityLabel}・{timestamp(latestAlarm.occurredAt)}</small></span>
                    : <RelationMessage state={alarmState} count={asset.trace.alarms.items.length} />}</td>
                  <td>{latestOrder ? onOpenWorkOrder && latestOrder.orderId
                    ? <button type="button" className={styles.workOrderButton} onClick={() => openEquipmentWorkOrder(latestOrder, onOpenWorkOrder)}>{latestOrder.orderNo || latestOrder.requestNo}<small>{latestOrder.statusLabel}</small></button>
                    : <span className={styles.issueValue}>{latestOrder.orderNo || latestOrder.requestNo}<small>{latestOrder.statusLabel}・尚未設定工單導覽</small></span>
                    : <RelationMessage state={workOrderState} count={asset.trace.workOrders.items.length} />}</td>
                </tr>;
              })}
              {!filteredEquipment.length && <tr><td colSpan={6} className={styles.emptyRow}>{equipmentFeed === 'truncated'
                ? '目前已載入的資料沒有符合篩選條件的設備；來源仍可能有其他資料。'
                : equipmentNotice || (equipmentFeed === 'empty' || equipmentFeed === 'ready' ? '目前沒有符合篩選條件的設備。' : '設備清單待介接。')}</td></tr>}
            </tbody>
          </table>
        </div>
        <nav className={styles.pagination} aria-label="設備清單分頁">
          <button type="button" disabled={equipmentPage.page <= 1} onClick={() => setPage(equipmentPage.page - 1)}>上一頁</button>
          <span aria-live="polite">第 {equipmentPage.page} / {equipmentPage.pageCount} 頁 · 顯示 {filteredEquipment.length ? (equipmentPage.page - 1) * equipmentPage.pageSize + 1 : 0}–{Math.min(equipmentPage.page * equipmentPage.pageSize, filteredEquipment.length)} / {filteredEquipment.length} 筆{equipmentFeed === 'truncated' ? '（目前已載入，總數可能更多）' : ''}</span>
          <button type="button" disabled={equipmentPage.page >= equipmentPage.pageCount} onClick={() => setPage(equipmentPage.page + 1)}>下一頁</button>
        </nav>
        <p className={styles.timeNote}>來源資料時間為設備來源的觀測時間；接收時間只在下方追蹤明細提供，兩者分開顯示。</p>
      </section>

      <section className={`${styles.panel} ${styles.energyPanel}`} aria-labelledby="energy-heading">
        <header className={styles.panelHeader}>
          <div><h3 id="energy-heading">能源監測</h3><p>尚未接通的能源來源以待介接標示</p></div>
          <span className={styles.integrationBadge}>能源資料介接</span>
        </header>
        <div className={styles.energyGrid}>
          {ENERGY_METRICS.map(metric => {
            const reading = energy[metric.key];
            const state = !reading ? 'pending'
              : reading.state === 'available' && (reading.value == null || !Number.isFinite(reading.value)) ? 'empty'
                : reading.state;
            return <article className={`${styles.energyCard} ${metric.className}`} key={metric.key}>
              <span className={styles.energyLabel}>{metric.label}</span>
              <strong>{energyValue(reading, metric.unit)}</strong>
              <span className={styles.energyState}>{ENERGY_STATE_LABEL[state]}</span>
              <div className={styles.energyTimes}>
                <span>來源時間 <b>{timestamp(reading?.sourceObservedAt)}</b></span>
                <span>接收時間 <b>{timestamp(reading?.receivedAt)}</b></span>
              </div>
              <small className={styles.sourceName}>{reading?.sourceName || '資料來源待介接'}</small>
            </article>;
          })}
        </div>
      </section>
    </div>

    <section className={styles.panel} aria-labelledby="trace-heading">
      <header className={styles.panelHeader}>
        <div><h3 id="trace-heading">設備處理追蹤</h3><p>{selected ? `${selected.assetCode || '未編號'}｜${selected.name}` : '選取設備後查看告警到結案佐證的關聯'}</p></div>
        {selected?.sourceName ? <span className={styles.panelCount}>設備來源：{selected.sourceName}</span> : null}
      </header>
      {selected ? <>
        <p className={styles.traceTimes}><span>設備狀態來源時間 <b>{timestamp(selected.sourceObservedAt)}</b></span><span>系統接收時間 <b>{timestamp(selected.receivedAt)}</b></span></p>
        <ol className={styles.traceChain}>
          <li className={styles.traceStep}>
            <span className={styles.traceNumber}>1</span><div><strong>告警</strong><RelationMessage state={selected.trace.alarms.state} count={selected.trace.alarms.items.length} />
              {selected.trace.alarms.items.map(alarm => <p key={alarm.eventId}>{alarm.title}・{alarm.severityLabel}<small>發生 {timestamp(alarm.occurredAt)}／接收 {timestamp(alarm.receivedAt)}</small></p>)}
            </div>
          </li>
          <li className={styles.traceStep}>
            <span className={styles.traceNumber}>2</span><div><strong>報修／工單</strong><RelationMessage state={selected.trace.workOrders.state} count={selected.trace.workOrders.items.length} />
              {selected.trace.workOrders.items.map(order => <p key={`${order.requestId}:${order.orderId || 'request'}`}>
                {onOpenWorkOrder && order.orderId ? <button type="button" className={styles.workOrderButton} onClick={() => openEquipmentWorkOrder(order, onOpenWorkOrder)}>{order.orderNo || order.requestNo}</button> : <b>{order.orderNo || order.requestNo}</b>}
                <small>{order.statusLabel}・更新 {timestamp(order.updatedAt)}{!onOpenWorkOrder || !order.orderId ? '・工單導覽待設定' : ''}</small>
              </p>)}
            </div>
          </li>
          <li className={styles.traceStep}>
            <span className={styles.traceNumber}>3</span><div><strong>巡檢核對</strong><RelationMessage state={selected.trace.inspections.state} count={selected.trace.inspections.items.length} />
              {selected.trace.inspections.items.map(check => <p key={check.recordId}>{check.label}・{check.resultLabel}<small>紀錄時間 {timestamp(check.performedAt)}{check.sourceOrderId ? `・來源工單 ${check.sourceOrderId}` : ''}</small></p>)}
            </div>
          </li>
          <li className={styles.traceStep}>
            <span className={styles.traceNumber}>4</span><div><strong>結案佐證</strong><RelationMessage state={selected.trace.closureEvidence.state} count={selected.trace.closureEvidence.items.length} />
              {selected.trace.closureEvidence.items.map(evidence => <p key={evidence.evidenceId}>{evidence.label}<small>紀錄時間 {timestamp(evidence.recordedAt)}</small></p>)}
            </div>
          </li>
        </ol>
      </> : <p className={styles.emptyTrace}>目前沒有可檢視的設備追蹤資料。</p>}
    </section>
  </section>;
}

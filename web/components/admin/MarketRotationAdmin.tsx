'use client';

import { useEffect, useMemo, useState } from 'react';
import { invokeAppApi } from '@/lib/supabase';
import {
  DASHBOARD_CATEGORIES,
  DASHBOARD_MARKETS,
  dashboardRotationGroupKey,
  dashboardRotationItemsForGroup,
  normalizeDashboardMarketRotation,
  serializeDashboardMarketRotation,
  type DashboardCategory,
  type DashboardMarket,
  type DashboardMarketRotationConfig,
} from '@/lib/dashboard-market-rotation';
import './market-rotation-admin.css';

type Source = {
  source_id: string;
  source_code: string;
  source_name: string;
  config?: Record<string, unknown>;
};

type Catalog = { sources?: Source[] };
type DimensionCatalog = { options?: Record<string, Array<{ value: string; count: number }>> };

const objectOf = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const sourceConfig = (source: Source) => objectOf(source.config);

export function MarketRotationAdmin({ config, onChange }: {
  config: unknown;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const rotation = useMemo(() => normalizeDashboardMarketRotation(config), [config]);
  const [sources, setSources] = useState<Source[]>([]);
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true); setMessage('');
      try {
        const result = await invokeAppApi<Catalog>('market_catalog');
        if (!cancelled) setSources((result.sources || []).filter(source => source.source_code !== 'market_demo' && sourceConfig(source).is_demo !== true));
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '市場行情資料來源載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const defaultSource = sources.find(source => sourceConfig(source).is_default === true && sourceConfig(source).is_actual === true)
    || sources.find(source => sourceConfig(source).is_actual === true)
    || sources[0];
  const activeSourceId = sources.some(source => source.source_id === rotation.sourceId) ? rotation.sourceId : defaultSource?.source_id || '';

  useEffect(() => {
    if (!activeSourceId) { setOptions({}); return; }
    let cancelled = false;
    void (async () => {
      setLoading(true); setMessage('');
      try {
        const entries = await Promise.all(DASHBOARD_MARKETS.flatMap(market => DASHBOARD_CATEGORIES.map(async category => {
          const key = dashboardRotationGroupKey(market, category);
          try {
            const result = await invokeAppApi<DimensionCatalog>('market_dimension_catalog', {
              source_id: activeSourceId,
              filters: { market, category },
            });
            return { key, values: (result.options?.item || []).map(item => item.value).filter(Boolean), failed: false };
          } catch {
            return { key, values: [] as string[], failed: true };
          }
        })));
        if (!cancelled) {
          setOptions(Object.fromEntries(entries.map(entry => [entry.key, entry.values])));
          const failedCount = entries.filter(entry => entry.failed).length;
          if (failedCount) setMessage(`有 ${failedCount} 組品項選項暫時無法載入，其餘群組仍可設定`);
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '市場與蔬果品項選項載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSourceId]);

  const commit = (next: DashboardMarketRotationConfig) => {
    const sourceId = sources.some(source => source.source_id === next.sourceId) ? next.sourceId : activeSourceId || next.sourceId;
    onChange({ ...objectOf(config), market_rotation: serializeDashboardMarketRotation({ ...next, sourceId }) });
  };

  const addItem = (market: DashboardMarket, category: DashboardCategory) => {
    const key = dashboardRotationGroupKey(market, category);
    const typed = String(drafts[key] || '').trim();
    const exact = (options[key] || []).find(item => item === typed);
    if (!exact) { setMessage(`請從「${market}／${category}」的有效行情品項中選擇`); return; }
    const duplicate = rotation.items.find(item => item.market === market && item.category === category && item.item === exact);
    if (duplicate) {
      if (duplicate.enabled) { setMessage(`「${exact}」已在此輪播群組中`); return; }
      commit({ ...rotation, items: rotation.items.map(item => item === duplicate ? { ...item, enabled: true } : item) });
      setMessage(`已重新啟用「${exact}」；發布新版後生效`);
      return;
    }
    const current = dashboardRotationItemsForGroup(rotation, market, category);
    if (current.length >= rotation.cardsPerGroup) { setMessage(`目前每群最多固定 ${rotation.cardsPerGroup} 個輪播品項`); return; }
    const nextOrder = Math.max(0, ...rotation.items.map(item => item.sortOrder)) + 10;
    commit({ ...rotation, sourceId: activeSourceId, items: [...rotation.items, { market, category, item: exact, enabled: true, sortOrder: nextOrder }] });
    setDrafts(value => ({ ...value, [key]: '' }));
    setMessage(`已將「${exact}」加入${market}／${category}；發布新版後生效`);
  };

  const removeItem = (market: DashboardMarket, category: DashboardCategory, itemName: string) => {
    commit({ ...rotation, items: rotation.items.filter(item => !(item.market === market && item.category === category && item.item === itemName)) });
    setMessage(`已從輪播設定移除「${itemName}」；不會刪除交易行情資料`);
  };

  const clearGroup = (market: DashboardMarket, category: DashboardCategory) => {
    commit({ ...rotation, items: rotation.items.filter(item => item.market !== market || item.category !== category) });
    setMessage(`${market}／${category}已改回依成交量自動排行`);
  };

  return <section className="market-rotation-admin" aria-labelledby="market-rotation-title">
    <header>
      <div><span>中央戰情儀表板</span><h2 id="market-rotation-title">市場行情輪播品項</h2><p>固定輪播第一市場、第二市場的蔬菜與水果；指定品項會優先顯示，其餘名額由最新交易日成交量自動補足。</p></div>
      <a className="secondary-btn compact" href="/Inspection/v2/" target="_blank" rel="noreferrer">預覽戰情儀表板</a>
    </header>

    <div className="market-rotation-controls">
      <label>行情資料來源<select value={activeSourceId} disabled={loading || !sources.length} onChange={event => {
        if (rotation.items.length && !window.confirm('切換資料來源會清除目前固定的輪播品項，確定繼續？')) return;
        commit({ ...rotation, sourceId: event.target.value, items: [] });
      }}>{sources.map(source => <option key={source.source_id} value={source.source_id}>{source.source_name}</option>)}</select></label>
      <label>每個品項播放秒數<input type="number" min="2" max="30" step="0.5" value={rotation.autoStepSeconds} onChange={event => commit({ ...rotation, autoStepSeconds: Number(event.target.value) })} /></label>
      <label>每群輪播品項數<input type="number" min="4" max="24" step="1" value={rotation.cardsPerGroup} onChange={event => commit({ ...rotation, cardsPerGroup: Number(event.target.value) })} /></label>
      <div className="market-rotation-source-note"><b>真正新增交易品項</b><span>請到資料介接中心匯入含價格與成交量的行情。</span><a href="/Inspection/v2/systems/marketanalytics/sources/">前往資料介接中心</a></div>
    </div>

    <div className="market-rotation-groups">
      {DASHBOARD_MARKETS.flatMap(market => DASHBOARD_CATEGORIES.map(category => {
        const key = dashboardRotationGroupKey(market, category);
        const selected = dashboardRotationItemsForGroup(rotation, market, category);
        const listId = `market-rotation-${market === '第一市場' ? 'one' : 'two'}-${category === '蔬菜' ? 'vegetable' : 'fruit'}`;
        return <article className={`market-rotation-group ${category === '水果' ? 'fruit' : 'vegetable'}`} key={key}>
          <div className="market-rotation-group-title"><div><span>{market}</span><h3>{category}</h3></div><small>{selected.length ? `固定優先 ${selected.length} 項` : '依成交量自動排行'}</small></div>
          <div className="market-rotation-add-row"><label><span>搜尋並加入輪播品項</span><input list={listId} value={drafts[key] || ''} onChange={event => setDrafts(value => ({ ...value, [key]: event.target.value }))} placeholder={loading ? '品項載入中…' : `輸入${category}品名`} /></label><datalist id={listId}>{(options[key] || []).map(item => <option value={item} key={item} />)}</datalist><button type="button" className="secondary-btn compact" disabled={loading || !activeSourceId} onClick={() => addItem(market, category)}>加入品項</button></div>
          {selected.length ? <div className="market-rotation-chips">{selected.map((item, index) => <span key={item.item}><b>{index + 1}</b>{item.item}<button type="button" aria-label={`從${market}${category}輪播移除${item.item}`} onClick={() => removeItem(market, category, item.item)}>×</button></span>)}</div> : <p className="market-rotation-auto">未固定品項，系統會依成交量自動選取前 {rotation.cardsPerGroup} 項。</p>}
          {selected.length > 0 && <button type="button" className="market-rotation-reset" onClick={() => clearGroup(market, category)}>清除固定品項，改回自動排行</button>}
        </article>;
      }))}
    </div>
    <footer><span>此區修改會跟著戰情版面建立新版本；必須按下方「發布新版本」後，中央戰情儀表板才會套用。</span>{message && <p role="status">{message}</p>}</footer>
  </section>;
}

'use client';

import { getSupabase } from './supabase';

/** 樓層圖只在目前頁面工作期間使用，避免把永久 Storage URL 暴露給瀏覽器。 */
export const FLOORPLAN_SIGNED_URL_TTL = 300;

function cleanPath(path: unknown): string {
  const value = String(path || '').replace(/^\/+/, '');
  if (!value || value.split('/').some(part => part === '..')) return '';
  return value;
}

/** 以短效 signed URL 讀取 floorplans，回傳 path → URL 對照表。 */
export async function signFloorplanPaths(
  paths: readonly (string | null | undefined)[],
  client = getSupabase(),
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.map(cleanPath).filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await client.storage
    .from('floorplans')
    .createSignedUrls(unique, FLOORPLAN_SIGNED_URL_TTL);
  if (error) throw error;
  return new Map((data || [])
    .filter(row => row?.path && row?.signedUrl)
    .map(row => [String(row.path), String(row.signedUrl)]));
}

/** 一個樓層可用的圖檔連結：raw 是原色圖（需要客戶端重畫），light／tech 是已重畫好的成品。 */
export type FloorPlanUrls = { raw: string; light: string; tech: string };

/**
 * 一次簽好各主題與尺寸的樓層圖連結。
 *
 * 3D建模系統上傳時會產生 light/、tech/ 成品圖與 desktop/、mobile/ 兩種尺寸
 * （見 modeler-client.tsx 的 uploadDerivedPlans）。檢視器拿得到成品就直接開，
 * 省掉「下載原圖 → getImageData → 逐像素重畫 → toBlob」（實測桌機 250～450ms、
 * 手機 3～6 倍）；拿不到才退回原圖自己重畫，所以缺圖只會慢、不會壞。
 *
 * 兩種主題一次簽完，切換介面風格時不必重新簽章。
 */
export async function signFloorPlanVariants(
  paths: readonly (string | null | undefined)[],
  client = getSupabase(),
): Promise<Map<string, FloorPlanUrls>> {
  const unique = [...new Set(paths.map(cleanPath).filter(Boolean))];
  if (!unique.length) return new Map();
  // 觸控裝置與窄螢幕取 1024px 的 mobile 版，其餘取 2048px 的 desktop 版。
  // 判斷條件與 V1 的 b1plan.html 一致。
  const wantsSmall = typeof window !== 'undefined'
    && window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  const sizeDir = wantsSmall ? 'mobile/' : '';
  const wanted = unique.flatMap(path => [
    `light/${sizeDir}${path}`,
    `tech/${sizeDir}${path}`,
    wantsSmall ? `mobile/${path}` : `desktop/${path}`,
    path,
  ]);
  const signed = await signFloorplanPaths(wanted, client);
  return new Map(unique.map(path => [path, {
    raw: signed.get(wantsSmall ? `mobile/${path}` : `desktop/${path}`) || signed.get(path) || '',
    light: signed.get(`light/${sizeDir}${path}`) || '',
    tech: signed.get(`tech/${sizeDir}${path}`) || '',
  }]));
}

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

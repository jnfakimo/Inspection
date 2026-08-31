'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from './supabase';
import type { Profile } from '@/types/app';

/**
 * SYS-07 公務車派車的角色判斷，系統入口與五個模組共用同一份。
 *
 * 入口圖卡的顯示條件必須與模組內實際能做的事一致，否則一般使用人會看到
 * 點進去只能乾瞪眼的卡片：
 *   公務車輛（VehiclesModule）  以 canManageFleet 控制維護權
 *   駕駛人員／派車管理員（RosterModule）  只有 isAdmin 能調整名單
 * 規則放在這裡一份，不要在入口頁另外複製一套判斷。
 */
export function useFleetRole(profile: Profile) {
  const [isManager, setIsManager] = useState(false);
  const role = String(profile.rbac_role || ({ admin: 'sysadmin', supervisor: 'unit_supervisor' } as Record<string, string>)[profile.role] || profile.role || '');
  const isAdmin = role === 'sysadmin' || role === 'admin';
  const isUnitSupervisor = role === 'unit_supervisor';
  useEffect(() => {
    let active = true;
    getSupabase().from('vehicle_dispatch_managers').select('user_id,active').eq('user_id', profile.user_id).eq('active', true).maybeSingle()
      .then(({ data }) => { if (active) setIsManager(Boolean(data)); });
    return () => { active = false; };
  }, [profile.user_id]);
  return { isAdmin, isUnitSupervisor, isManager, canManageFleet: isAdmin || isManager };
}

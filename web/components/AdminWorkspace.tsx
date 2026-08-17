'use client';

import { AppShell } from '@/components/AppShell';
import { UsersAdmin } from '@/components/admin/UsersAdmin';
import { PermissionsAdminV2 } from '@/components/admin/PermissionsAdminV2';
import { LocationsAdmin } from '@/components/admin/LocationsAdmin';
import { AuditAdminV2 } from '@/components/admin/AuditAdminV2';
import { AlertsAdminV2 } from '@/components/admin/AlertsAdminV2';
import { NoticesAdmin } from '@/components/admin/NoticesAdmin';
import { LayoutsAdmin } from '@/components/admin/LayoutsAdmin';
import { CyclesAdmin } from '@/components/admin/CyclesAdmin';
import { CostsAdmin } from '@/components/admin/CostsAdmin';
import { LocationAnalysisAdmin } from '@/components/admin/LocationAnalysisAdmin';
import { HealthAdmin } from '@/components/admin/HealthAdmin';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

const MODULES: Record<string, React.ComponentType<{ profile: Profile; module: ModuleDefinition }>> = {
  users: UsersAdmin,
  permissions: PermissionsAdminV2,
  locations: LocationsAdmin,
  audit: AuditAdminV2,
  alerts: AlertsAdminV2,
  notices: NoticesAdmin,
  layouts: LayoutsAdmin,
  cycles: CyclesAdmin,
  costs: CostsAdmin,
  locanalysis: LocationAnalysisAdmin,
  health: HealthAdmin,
};

export function AdminWorkspace({ profile, module }: { profile: Profile; module: ModuleDefinition }) {
  const role = String(profile.rbac_role || profile.role || '');
  const isPersonalNotices = module.key === 'notices';
  if (!isPersonalNotices && role !== 'sysadmin' && role !== 'admin') return <AppShell profile={profile} title={module.title}><section className="panel admin-access-denied"><h2>無後台管理權限</h2><p>此功能僅供系統管理員使用；如需操作，請聯絡系統管理員調整角色權限。</p></section></AppShell>;
  const Module = MODULES[module.key];
  return Module ? <Module profile={profile} module={module}/> : <AppShell profile={profile} title={module.title}><section className="panel"><p className="empty">找不到此後台模組。</p></section></AppShell>;
}

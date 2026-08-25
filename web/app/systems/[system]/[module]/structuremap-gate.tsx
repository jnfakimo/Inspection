'use client';

// SYS-06 的入口：資料模組走 StructureMapWorkspace，2D／3D 檢視器另行承接。
// 獨立成一個小檔是為了讓 page.tsx（server component）只需 import 一個元件，
// 而 AuthGate 的 function children 留在 client 端。

import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';
import { StructureMapWorkspace } from './structuremap-workspace';
import { StructureMapViewers } from './structuremap-viewers';
import { Floor3DBoardModule } from './structuremap-floor3d';
import { SystemRelationsAccessProvider } from './system-relations';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';

const VIEWER_MODULES = new Set(['floor2d']);

export function StructureMapModules({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  if (VIEWER_MODULES.has(module.key)) return <StructureMapViewers system={system} module={module} />;
  // 3D模型圖是 V1 floor3d.html 的全螢幕移植，自帶 topbar，不套 AppShell。
  if (module.key === 'floor3d') return <AuthGate>{profile => <Floor3DBoardModule profile={profile} />}</AuthGate>;
  if (module.key === 'relations') return <AuthGate>{profile => {
    const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes(system.key);
    if (!allowed) return <AppShell profile={profile} title={module.title}>
      <div className="notice danger">目前角色沒有此系統權限，請由管理員開放。</div>
    </AppShell>;
    return <SystemRelationsAccessProvider allowedSystems={profile.allowed_systems}>
      <StructureMapWorkspace system={system} module={module} profile={profile} />
    </SystemRelationsAccessProvider>;
  }}</AuthGate>;
  return <AuthGate>{profile => <StructureMapWorkspace system={system} module={module} profile={profile} />}</AuthGate>;
}

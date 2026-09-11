'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import { hasModuleAccess } from '@/lib/modules';
import { AuthGate } from '@/components/AuthGate';

type WorkspaceProps = {
  system: SystemDefinition;
  module: ModuleDefinition;
};

const moduleLoading = () => (
  <main className="center-state" aria-live="polite">
    <div className="loader" aria-hidden="true" />
    <p>正在載入系統模組…</p>
  </main>
);

// Keep heavy workspaces out of the shared module route bundle. In particular,
// Three.js, OpenSeadragon and DXF tooling are only needed by structure-map pages.
const ModuleWorkspace = dynamic<WorkspaceProps>(
  () => import('./workspace').then((mod) => mod.ModuleWorkspace),
  { ssr: false, loading: moduleLoading },
);
const OperationsWorkspace = dynamic<WorkspaceProps>(
  () => import('./operations-workspace').then((mod) => mod.OperationsWorkspace),
  { ssr: false, loading: moduleLoading },
);
const VehicleWorkspace = dynamic<WorkspaceProps>(
  () => import('./vehicle-workspace').then((mod) => mod.VehicleWorkspace),
  { ssr: false, loading: moduleLoading },
);
const MeetingWorkspace = dynamic<WorkspaceProps>(
  () => import('./meeting-workspace').then((mod) => mod.MeetingWorkspace),
  { ssr: false, loading: moduleLoading },
);
const EquipmentWorkspace = dynamic<WorkspaceProps>(
  () => import('./equipment-workspace').then((mod) => mod.EquipmentWorkspace),
  { ssr: false, loading: moduleLoading },
);
const WorkorderExtras = dynamic<WorkspaceProps>(
  () => import('./workorder-extras').then((mod) => mod.WorkorderExtras),
  { ssr: false, loading: moduleLoading },
);
const StructureMapModules = dynamic<WorkspaceProps>(
  () => import('./structuremap-gate').then((mod) => mod.StructureMapModules),
  { ssr: false, loading: moduleLoading },
);
const OfficialDocsWorkspace = dynamic<WorkspaceProps>(
  () => import('./official-docs-workspace').then((mod) => mod.OfficialDocsWorkspace),
  { ssr: false, loading: moduleLoading },
);
const RepairMap3DModule = dynamic(
  () => import('./repair-map3d').then((mod) => mod.RepairMap3DModule),
  { ssr: false, loading: moduleLoading },
);
const MarketAnalyticsWorkspace = dynamic<WorkspaceProps>(
  () => import('./market-analytics-workspace').then((mod) => mod.MarketAnalyticsWorkspace),
  { ssr: false, loading: moduleLoading },
);
const MarketCommandCenterWorkspace = dynamic<WorkspaceProps>(
  () => import('./market-command-center').then((mod) => mod.MarketCommandCenterWorkspace),
  { ssr: false, loading: moduleLoading },
);
const MarketInteractiveDashboardWorkspace = dynamic<WorkspaceProps>(
  () => import('./market-interactive-dashboard').then((mod) => mod.MarketInteractiveDashboardWorkspace),
  { ssr: false, loading: moduleLoading },
);
const MarketBoardWorkspace = dynamic<WorkspaceProps>(
  () => import('./market-board-workspace').then((mod) => mod.MarketBoardWorkspace),
  { ssr: false, loading: moduleLoading },
);
const VehicleTrackingWorkspace = dynamic<WorkspaceProps>(
  () => import('./vehicle-tracking-workspace').then((mod) => mod.VehicleTrackingWorkspace),
  { ssr: false, loading: moduleLoading },
);
const AdminWorkspace = dynamic<{ profile: import('@/types/app').Profile; module: ModuleDefinition }>(
  () => import('@/components/AdminWorkspace').then((mod) => mod.AdminWorkspace),
  { ssr: false, loading: moduleLoading },
);

export function WorkspaceRouter({ system, module }: WorkspaceProps) {
  if (system.key === 'admin') {
    return <AuthGate>{profile => hasModuleAccess(profile, system.key, module.key)
      ? <AdminWorkspace profile={profile} module={module} />
      : <AppShell profile={profile} title={module.title}><section className="panel admin-access-denied"><h2>未開放此子系統</h2><p>目前帳號沒有使用「{module.title}」的權限，請洽系統管理員調整。</p></section></AppShell>}
    </AuthGate>;
  }
  const marketAnalyticsWorkspace = () => {
    if (module.key === 'command-center') {
      return <MarketCommandCenterWorkspace system={system} module={module} />;
    }
    if (module.key === 'interactive-dashboard') {
      return <MarketInteractiveDashboardWorkspace system={system} module={module} />;
    }
    return <MarketAnalyticsWorkspace system={system} module={module} />;
  };
  let workspace: ReactNode;
  if (system.key === 'handover' || system.key === 'guardpatrol') {
    workspace = <OperationsWorkspace system={system} module={module} />;
  } else if (system.key === 'vehicle') {
    workspace = <VehicleWorkspace system={system} module={module} />;
  } else if (system.key === 'meetingroom') {
    workspace = <MeetingWorkspace system={system} module={module} />;
  } else if (system.key === 'equipment') {
    workspace = <EquipmentWorkspace system={system} module={module} />;
  } else if (system.key === 'workorder' && (module.key === 'attachments' || module.key === 'analytics')) {
    workspace = <WorkorderExtras system={system} module={module} />;
  } else if (system.key === 'workorder' && module.key === 'repairmap3d') {
    workspace = <AuthGate>{profile => <RepairMap3DModule system={system} module={module} profile={profile} />}</AuthGate>;
  } else if (system.key === 'structuremap') {
    workspace = <StructureMapModules system={system} module={module} />;
  } else if (system.key === 'officialdocs') {
    workspace = <OfficialDocsWorkspace system={system} module={module} />;
  } else if (system.key === 'marketboard') {
    workspace = <MarketBoardWorkspace system={system} module={module} />;
  } else if (system.key === 'marketanalytics') {
    workspace = marketAnalyticsWorkspace();
  } else if (system.key === 'vehicletracking') {
    workspace = <VehicleTrackingWorkspace system={system} module={module} />;
  } else {
    workspace = <ModuleWorkspace system={system} module={module} />;
  }
  // 主管簽核（guard-approve）不是獨立頁面，簽核主管要能進駐衛警交接簿才簽得到。
  const moduleAllowed = (profile: Parameters<typeof hasModuleAccess>[0]) => hasModuleAccess(profile, system.key, module.key)
    || (system.key === 'handover' && module.key === 'guard' && hasModuleAccess(profile, 'handover', 'guard-approve'));
  return <AuthGate>{profile => moduleAllowed(profile)
    ? workspace
    : <AppShell profile={profile} title={module.title}><section className="panel admin-access-denied"><h2>未開放此子系統</h2><p>目前帳號沒有使用「{module.title}」的權限，請洽系統管理員調整。</p></section></AppShell>}
  </AuthGate>;
}

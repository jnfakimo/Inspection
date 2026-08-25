'use client';

import dynamic from 'next/dynamic';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';

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

export function WorkspaceRouter({ system, module }: WorkspaceProps) {
  if (system.key === 'handover' || system.key === 'guardpatrol') {
    return <OperationsWorkspace system={system} module={module} />;
  }
  if (system.key === 'vehicle') {
    return <VehicleWorkspace system={system} module={module} />;
  }
  if (system.key === 'meetingroom') {
    return <MeetingWorkspace system={system} module={module} />;
  }
  if (system.key === 'equipment') {
    return <EquipmentWorkspace system={system} module={module} />;
  }
  if (system.key === 'workorder' && (module.key === 'attachments' || module.key === 'analytics')) {
    return <WorkorderExtras system={system} module={module} />;
  }
  if (system.key === 'structuremap') {
    return <StructureMapModules system={system} module={module} />;
  }
  return <ModuleWorkspace system={system} module={module} />;
}

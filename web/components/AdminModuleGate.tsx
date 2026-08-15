'use client';

import { AuthGate } from '@/components/AuthGate';
import { AdminWorkspace } from '@/components/AdminWorkspace';
import type { ModuleDefinition } from '@/lib/modules';

export function AdminModuleGate({ module }: { module: ModuleDefinition }) {
  return <AuthGate>{profile => <AdminWorkspace profile={profile} module={module}/>}</AuthGate>;
}

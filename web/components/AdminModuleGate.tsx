'use client';

import { useEffect } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { AdminWorkspace } from '@/components/AdminWorkspace';
import { canOpenAdminModule } from '@/lib/login-destination';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

function AuthorizedAdminModule({ profile, module }: { profile: Profile; module: ModuleDefinition }) {
  const allowed = canOpenAdminModule(profile, module.key);
  useEffect(() => {
    if (!allowed) window.location.replace('/Inspection/v2/systems/');
  }, [allowed]);
  if (!allowed) return <main className="center-state"><div className="loader" /><p>正在返回可使用的系統…</p></main>;
  return <AdminWorkspace profile={profile} module={module}/>;
}

export function AdminModuleGate({ module }: { module: ModuleDefinition }) {
  return <AuthGate>{profile => <AuthorizedAdminModule profile={profile} module={module}/>}</AuthGate>;
}

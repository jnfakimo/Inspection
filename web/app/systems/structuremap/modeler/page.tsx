'use client';

import { AuthGate } from '@/components/AuthGate';
import { ModelerClient } from './modeler-client';

export default function Page() {
  return <AuthGate>{profile => <ModelerClient profile={profile} />}</AuthGate>;
}

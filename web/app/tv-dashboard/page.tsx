'use client';

import { AuthGate } from '@/components/AuthGate';
import { TvClient } from './tv-client';

export default function Page() {
  return (
    <AuthGate>
      {profile => <TvClient profile={profile} />}
    </AuthGate>
  );
}

'use client';

import { AuthGate } from '@/components/AuthGate';
import { DashboardClient } from './dashboard-client';

export default function Page() { return <AuthGate>{profile => <DashboardClient profile={profile} />}</AuthGate>; }

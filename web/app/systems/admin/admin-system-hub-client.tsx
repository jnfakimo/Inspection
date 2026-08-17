'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { findSystem } from '@/lib/modules';
import type { Profile } from '@/types/app';
import styles from './admin-system-hub.module.css';

const adminSystem = findSystem('admin');

const cardVisuals = [
  { icon: '/Inspection/assets/system-icons/account-icon.png', accent: '#00bde8' },
  { icon: '/Inspection/assets/system-icons/account-icon.png', accent: '#4f8cff' },
  { icon: '/Inspection/assets/system-icons/guardpatrol-list-icon.png', accent: '#00c985' },
  { icon: '/Inspection/assets/system-icons/audit-icon.png', accent: '#9b70e8' },
  { icon: '/Inspection/assets/system-icons/guardpatrol-icon.png', accent: '#ef5b87' },
  { icon: '/Inspection/assets/system-icons/guardpatrol-line-push-icon.png', accent: '#e5a100' },
  { icon: '/Inspection/assets/system-icons/admin-icon.png', accent: '#00bde8' },
] as const;

function AdminHub({ profile }: { profile: Profile }) {
  if (!adminSystem) return null;
  const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes('admin');

  return (
    <AppShell profile={profile} title={adminSystem.title}>
      {allowed ? (
        <>
          <section className="module-hero">
            <div>
              <span>第 1 系統</span>
              <h2>{adminSystem.title}</h2>
              <p>{adminSystem.description}</p>
            </div>
            <img src={adminSystem.icon} alt="" />
          </section>

          <section className={styles.grid} aria-label="後台管理子系統">
            <Link
              className={styles.card}
              href="/systems/admin/settings/"
              style={{ '--admin-card-accent': '#00bde8' } as CSSProperties}
            >
              <span className={styles.badge}>系統設定</span>
              <span className={styles.icon} aria-hidden="true">
                <img src="/Inspection/assets/system-icons/admin-icon.png" alt="" />
              </span>
              <h3>系統設定</h3>
              <p>系統識別、組織、班別、LINE 推播及整合設定。</p>
              <b>▶ 開啟設定中心</b>
            </Link>
            {adminSystem.modules.map((module, index) => {
              const visual = cardVisuals[index] ?? cardVisuals[0];
              const cardStyle = { '--admin-card-accent': visual.accent } as CSSProperties;

              return (
                <Link
                  key={module.key}
                  className={styles.card}
                  href={`/systems/admin/${module.key}/`}
                  style={cardStyle}
                >
                  <span className={styles.badge}>子系統 {String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.icon} aria-hidden="true">
                    <img src={visual.icon} alt="" />
                  </span>
                  <h3>{module.title}</h3>
                  <p>{module.description}</p>
                  <b>▶ 開啟子系統</b>
                </Link>
              );
            })}
          </section>
        </>
      ) : (
        <div className="notice danger">目前角色沒有此系統權限，請由管理員開放。</div>
      )}
    </AppShell>
  );
}

export function AdminSystemHubClient() {
  return <AuthGate>{profile => <AdminHub profile={profile} />}</AuthGate>;
}

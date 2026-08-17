import { notFound } from 'next/navigation';
import { AdminModuleGate } from '@/components/AdminModuleGate';
import { findModule } from '@/lib/modules';

const ADMIN_MODULES = ['users', 'permissions', 'locations', 'audit', 'alerts', 'notices', 'layouts', 'cycles', 'costs', 'locanalysis', 'health'];

export function generateStaticParams() {
  return ADMIN_MODULES.map(module => ({ module }));
}

export default async function AdminModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: moduleKey } = await params;
  const module = findModule('admin', moduleKey);
  if (!module) notFound();
  return <AdminModuleGate module={module}/>;
}

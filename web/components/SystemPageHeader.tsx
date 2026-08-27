import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';

export const SYSTEM_PAGE_HEADER_DESIGN = {
  topbarGapPx: 22,
  titleFontSizePx: 26,
  titleColor: 'var(--cyan)',
  logoSizePx: 42,
} as const;

export function SystemPageHeader({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <header className="system-page-heading" data-system-page-heading="standard" data-system-key={system.key} data-module-key={module.key}>
    <img src={system.icon} alt="" data-system-page-logo />
    <div>
      <h1>{system.title}</h1>
      <span>{system.code} · {module.title}</span>
      <p>{module.description}</p>
    </div>
  </header>;
}

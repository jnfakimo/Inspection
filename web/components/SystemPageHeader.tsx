import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';

export const SYSTEM_PAGE_HEADER_DESIGN = {
  topbarGapPx: 22,
  titleFontSizePx: 26,
  titleColor: 'var(--cyan)',
  logoSizePx: 42,
} as const;

export function SystemPageHeader({ system, module, title, metaTitle }: {
  system: SystemDefinition;
  module: ModuleDefinition;
  title?: string;
  metaTitle?: string;
}) {
  return <header className="system-page-heading" data-system-page-heading="standard" data-system-key={system.key} data-module-key={module.key}>
    <img src={system.icon} alt="" data-system-page-logo />
    <div>
      <h1>{title || system.title}</h1>
      <span>{system.code} · {metaTitle || module.title}</span>
      <p>{module.description}</p>
    </div>
  </header>;
}

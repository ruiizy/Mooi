import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}

export const EmptyState = ({ icon: Icon, title, description, children }: EmptyStateProps) => (
  <div className="relative flex animate-fade-up flex-col items-center justify-center overflow-hidden rounded-card border border-dashed border-line-strong bg-surface px-6 py-12 text-center sm:py-16">
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-dot-grid [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
    <span className="relative flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-raised">
      <Icon className="size-5" />
    </span>
    <h3 className="relative mt-5 text-base font-semibold tracking-[-0.015em] text-ink">{title}</h3>
    <p className="relative mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
    {children ? <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
  </div>
);

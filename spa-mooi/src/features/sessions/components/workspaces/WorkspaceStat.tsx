import type { LucideIcon } from 'lucide-react';

interface WorkspaceStatProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}

export const WorkspaceStat = ({ icon: Icon, label, value, hint }: WorkspaceStatProps) => (
  <div className="flex min-w-0 items-start gap-3 rounded-xl border border-line bg-surface p-4">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-surface-2 text-ink-muted">
      <Icon className="size-4" />
    </span>
    <div className="min-w-0">
      <p className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">{label}</p>
      <p className="mt-0.5 truncate text-xl font-extrabold tracking-[-0.03em] text-ink tabular-nums">{value}</p>
      {hint ? <p className="truncate text-[11px] text-ink-subtle">{hint}</p> : null}
    </div>
  </div>
);

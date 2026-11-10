import { KeyRound, Settings2 } from 'lucide-react';
import { inheritedEnvironment } from '@/features/platform/lib/inheritedEnvironment';
import type { PlatformEnvironmentVariable } from '@/features/platform/types/PlatformEnvironmentVariable';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { StatusDot } from '@/shared/components/StatusDot';

interface PlatformEnvironmentCardProps {
  variables: PlatformEnvironmentVariable[];
  emptyDescription: string;
  onEdit: () => void;
}

const shortName = (name: string) => name.replace(/^MOOI_[A-Z]+?_/, '');

/** Which variables the scripts read and whether each one has a value; values themselves never show. */
export const PlatformEnvironmentCard = ({ variables, emptyDescription, onEdit }: PlatformEnvironmentCardProps) => {
  const missing = variables.filter((variable) => variable.required && !variable.configured).length;

  return (
    <Card as="section" className="flex flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><KeyRound className="size-4 text-ink-subtle" />Environment</h2>
          <p className="mt-0.5 text-xs text-ink-muted">{missing > 0 ? `${missing} required value${missing === 1 ? '' : 's'} missing` : 'Encrypted in the platform'}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}><Settings2 className="size-4" />Manage</Button>
      </header>
      {variables.length === 0 ? <p className="px-5 py-6 text-sm text-ink-muted">{emptyDescription}</p>
        : <ul className="flex flex-wrap gap-2 p-5">
          {variables.map((variable) => <li key={variable.name}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pr-3 pl-2.5"
            title={`${variable.name} · ${variable.configured ? 'Set' : variable.required ? 'Missing' : 'Optional, not set'}${variable.inherited ? ' · inherited' : ''}`}>
            <StatusDot tone={variable.configured ? 'success' : variable.required ? 'danger' : 'neutral'} />
            <span className="truncate font-mono text-[11px] font-bold text-ink">{shortName(variable.name)}</span>
            {variable.inherited ? <span className="text-[10px] font-bold text-ink-subtle uppercase">{inheritedEnvironment(variable.name).tag}</span> : null}
          </li>)}
        </ul>}
    </Card>
  );
};

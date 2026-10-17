import { RefreshCw } from 'lucide-react';
import { EngineDefaultsPanel } from '@/features/agents/components/EngineDefaultsPanel';
import { useEngineDefaults } from '@/features/agents/hooks/useEngineDefaults';
import { Button } from '@/shared/components/Button';
import { Eyebrow } from '@/shared/components/Eyebrow';
import { cn } from '@/shared/utils/cn';

export const AdminModelDefaults = () => {
  const { defaults, catalogs, catalogErrors, loading, error, refreshing, refresh, save } = useEngineDefaults();
  return <section className="mt-10">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><Eyebrow>Agent configuration</Eyebrow>
        <h2 className="mt-1.5 text-2xl font-extrabold tracking-[-0.035em] text-ink">Engine defaults</h2>
        <p className="mt-1 text-sm text-ink-muted">Set the model and reasoning effort preselected when choosing a Claude or Codex account.</p>
      </div>
      <Button variant="secondary" size="sm" disabled={refreshing} onClick={refresh}>
        <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} /> Refresh catalogs
      </Button>
    </div>
    {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
    {loading && <p role="status" className="text-sm text-ink-muted">Loading engine defaults…</p>}
    <div className="grid gap-4 xl:grid-cols-2">
      {defaults.map((entry) => <EngineDefaultsPanel key={entry.provider} defaults={entry}
        catalog={catalogs[entry.provider]} catalogError={catalogErrors[entry.provider]} save={save} />)}
    </div>
  </section>;
};

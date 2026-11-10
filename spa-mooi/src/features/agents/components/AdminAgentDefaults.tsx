import { RefreshCw } from 'lucide-react';
import { AgentDefaultsRow } from '@/features/agents/components/AgentDefaultsRow';
import { useEngineDefaults } from '@/features/agents/hooks/useEngineDefaults';
import { Card } from '@/shared/components/Card';
import { cn } from '@/shared/utils/cn';

/** The platform's agent defaults: what every new session preselects, per provider. */
export const AdminAgentDefaults = () => {
  const { defaults, providers, loading, error, catalog, loadCatalog, refresh, refreshing, save } = useEngineDefaults();
  const adapterOf = (provider: string, configured: string | null) => {
    const adapters = providers[provider]?.adapters ?? [];
    return adapters.find((entry) => entry.id === configured)?.id ?? adapters[0]?.id ?? '';
  };

  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ink">Session defaults</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">Preselected for every user when a new session starts. Changes save instantly.</p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} title="Refresh model lists" aria-label="Refresh model lists"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-60">
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
        </button>
      </header>
      {error && <p role="alert" className="px-6 py-4 text-sm text-danger">{error}</p>}
      {loading && <p role="status" className="px-6 py-4 text-sm text-ink-muted">Loading…</p>}
      <ul className="divide-y divide-line">
        {defaults.map((entry) => (
          <AgentDefaultsRow
            key={entry.provider}
            defaults={entry}
            provider={providers[entry.provider]}
            catalog={catalog(entry.provider, adapterOf(entry.provider, entry.sessionAdapter))}
            loadCatalog={loadCatalog}
            save={save}
          />
        ))}
      </ul>
    </Card>
  );
};

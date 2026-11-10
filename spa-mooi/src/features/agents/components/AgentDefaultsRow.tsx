import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { CatalogState } from '@/features/agents/hooks/useEngineDefaults';
import { modelChoiceIssue } from '@/features/agents/lib/modelChoiceIssue';
import { providerDefaultModel } from '@/features/agents/lib/providerDefaultModel';
import type { AdminAgentProvider } from '@/features/agents/types/AdminAgentProvider';
import type { EngineDefaults } from '@/features/agents/types/EngineDefaults';
import { SegmentedControl } from '@/shared/components/SegmentedControl';

interface AgentDefaultsRowProps {
  defaults: EngineDefaults;
  provider?: AdminAgentProvider;
  catalog?: CatalogState;
  loadCatalog: (provider: string, adapter: string) => void;
  save: (value: EngineDefaults) => Promise<void>;
}

type SaveState = 'idle' | 'saving' | 'saved';

const fieldClass = 'h-9 w-full min-w-0 rounded-control border border-line bg-surface-2 px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-brand disabled:opacity-60';
const labelClass = 'flex min-w-0 flex-col gap-1.5 text-[11px] font-medium text-ink-subtle';

const providerLabel = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * One provider's defaults on one line: adapter, model and effort, each saved the moment it
 * changes. Without a catalog to choose from, model and effort are typed and saved on blur.
 */
export const AgentDefaultsRow = ({ defaults, provider, catalog: state, loadCatalog, save }: AgentDefaultsRowProps) => {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const adapters = provider?.adapters ?? [];
  const adapter = adapters.find((entry) => entry.id === defaults.sessionAdapter)?.id ?? adapters[0]?.id;
  const catalog = state?.catalog ?? null;
  const model = defaults.sessionModel ?? '';
  const effort = defaults.sessionEffort ?? '';
  const fallbackModel = catalog ? providerDefaultModel(catalog) : undefined;
  const selected = catalog ? (model ? catalog.models.find((entry) => entry.id === model) : fallbackModel) : undefined;
  const issue = modelChoiceIssue({ model, effort }, catalog);
  const label = provider?.label ?? providerLabel(defaults.provider);

  useEffect(() => {
    if (adapter) loadCatalog(defaults.provider, adapter);
  }, [loadCatalog, defaults.provider, adapter]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  const persist = (change: Partial<EngineDefaults>) => {
    const next = { ...defaults, ...change };
    if (next.sessionModel === defaults.sessionModel && next.sessionEffort === defaults.sessionEffort
      && next.sessionAdapter === defaults.sessionAdapter) return;
    setSaveState('saving');
    setError(null);
    save(next).then(() => setSaveState('saved')).catch((failure: Error) => {
      setSaveState('idle');
      setError(failure.message);
    });
  };

  const typed = (value: string) => value.trim() || null;

  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-5 sm:px-6">
      <div className="flex items-center gap-2 sm:pt-6">
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        <span aria-live="polite" className="text-ink-subtle">
          {saveState === 'saving' && <LoaderCircle aria-label="Saving" className="size-3.5 animate-spin" />}
          {saveState === 'saved' && <Check aria-label="Saved" className="size-3.5 text-success" />}
        </span>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,10rem)] sm:items-end">
          {adapters.length > 1 && adapter ? (
            <div className={labelClass}>
              <span id={`${defaults.provider}-adapter`}>Adapter</span>
              <SegmentedControl
                labelledBy={`${defaults.provider}-adapter`}
                items={adapters.map((entry) => ({ id: entry.id, label: entry.label }))}
                value={adapter}
                // The first adapter is the built-in default: choosing it stores no override.
                onChange={(id) => persist({ sessionAdapter: id === adapters[0].id ? null : id })}
                className="[&_button]:min-h-8"
              />
            </div>
          ) : adapters.length === 1 ? (
            <div className={labelClass}>
              <span>Adapter</span>
              <span className="flex h-9 items-center text-[13px] text-ink-muted">{adapters[0].label}</span>
            </div>
          ) : null}

          {catalog ? (
            <>
              <label className={labelClass}>
                Model
                <select className={fieldClass} value={model} disabled={saveState === 'saving'}
                  onChange={(event) => persist({ sessionModel: event.target.value || null, sessionEffort: null })}>
                  <option value="">Provider default{fallbackModel ? ` (${fallbackModel.label})` : ''}</option>
                  {catalog.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  {issue === 'model' && <option value={model}>{model} (unavailable)</option>}
                </select>
              </label>
              <label className={labelClass}>
                Effort
                <select className={fieldClass} value={effort}
                  disabled={saveState === 'saving' || (!selected?.efforts.length && !effort)}
                  onChange={(event) => persist({ sessionEffort: event.target.value || null })}>
                  <option value="">Auto{selected?.defaultEffort ? ` (${selected.defaultEffort})` : ''}</option>
                  {selected?.efforts.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                  {issue === 'effort' && <option value={effort}>{effort} (unavailable)</option>}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className={labelClass}>
                Model
                <input key={`model-${model}`} className={fieldClass} defaultValue={model} maxLength={120}
                  placeholder="Provider default" disabled={state?.loading}
                  onBlur={(event) => persist({ sessionModel: typed(event.target.value) })}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
              </label>
              <label className={labelClass}>
                Effort
                <input key={`effort-${effort}`} className={fieldClass} defaultValue={effort} maxLength={32}
                  placeholder="Auto" disabled={state?.loading}
                  onBlur={(event) => persist({ sessionEffort: typed(event.target.value) })}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
              </label>
            </>
          )}
        </div>

        {error ? <p role="alert" className="text-xs text-danger">{error}</p>
          : issue ? <p role="alert" className="text-xs text-warning">The saved {issue} is not offered by this adapter. Choose another one.</p>
            : !catalog && state && !state.loading && state.error ? <p className="text-xs text-ink-subtle">{state.error}</p>
              : null}
      </div>
    </li>
  );
};

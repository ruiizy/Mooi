import { useState } from 'react';
import { Bot } from 'lucide-react';
import { EffortPicker } from '@/features/agents/components/EffortPicker';
import { ModelOptionList } from '@/features/agents/components/ModelOptionList';
import { modelChoiceIssue } from '@/features/agents/lib/modelChoiceIssue';
import { providerDefaultModel } from '@/features/agents/lib/providerDefaultModel';
import type { EngineDefaults } from '@/features/agents/types/EngineDefaults';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';

interface Props {
  defaults: EngineDefaults;
  catalog?: SessionProvider;
  catalogError?: string;
  save: (defaults: EngineDefaults) => Promise<EngineDefaults>;
}

export const EngineDefaultsPanel = ({ defaults, catalog, catalogError, save }: Props) => {
  const [model, setModel] = useState(defaults.sessionModel ?? '');
  const [effort, setEffort] = useState(defaults.sessionEffort ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = model !== (defaults.sessionModel ?? '') || effort !== (defaults.sessionEffort ?? '');
  const selected = catalog && (model ? catalog.models.find((entry) => entry.id === model) : providerDefaultModel(catalog));
  const issue = modelChoiceIssue({ model, effort }, catalog ?? null);
  const label = defaults.provider === 'claude' ? 'Claude' : 'Codex';

  const persist = async () => {
    setSaving(true);
    setError(null);
    try {
      const value = await save({ provider: defaults.provider, sessionModel: model.trim() || null, sessionEffort: effort.trim() || null });
      setModel(value.sessionModel ?? '');
      setEffort(value.sessionEffort ?? '');
      setSaved(true);
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  };

  return <Card className="min-w-0 p-5 sm:p-6">
    <div className="mb-5 flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink"><Bot className="size-5" /></span>
      <div><h3 className="font-extrabold text-ink">{label}</h3>
        <p className="mt-1 text-xs text-ink-subtle">Applies to every {label} account and user.</p></div>
    </div>
    {catalog ? <div className="space-y-5">
      <ModelOptionList name={`${defaults.provider}-model`} label={`${label} default model`} catalog={catalog} value={model}
        disabled={saving} onChange={(value) => { setModel(value); setEffort(''); setSaved(false); }} />
      <EffortPicker name={`${defaults.provider}-effort`} efforts={selected?.efforts ?? []}
        modelDefault={selected?.defaultEffort ?? null} value={effort} disabled={saving}
        onChange={(value) => { setEffort(value); setSaved(false); }} />
      {issue && <p role="alert" className="text-xs text-warning">The configured {issue} is unavailable in this catalog. Choose a supported value.</p>}
    </div> : <div className="space-y-4">
      <p className="text-xs text-ink-muted">{catalogError || 'Loading model catalog…'} You can also enter defaults directly.</p>
      <label className="flex flex-col gap-2 text-xs font-semibold text-ink-muted">Model ID (empty for provider default)
        <input className="h-11 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink" value={model} maxLength={120}
          disabled={saving} onChange={(event) => { setModel(event.target.value); setEffort(''); setSaved(false); }} />
      </label>
      <label className="flex flex-col gap-2 text-xs font-semibold text-ink-muted">Reasoning effort (empty for automatic)
        <input className="h-11 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink" value={effort} maxLength={32}
          disabled={saving} onChange={(event) => { setEffort(event.target.value); setSaved(false); }} />
      </label>
    </div>}
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
      {saved && !dirty && <span role="status" className="text-xs text-ink-muted">Saved</span>}
      {dirty && <Button variant="ghost" size="sm" disabled={saving} onClick={() => {
        setModel(defaults.sessionModel ?? ''); setEffort(defaults.sessionEffort ?? ''); setError(null); setSaved(false);
      }}>Discard</Button>}
      <Button variant="brand" size="sm" disabled={!dirty || saving || Boolean(issue)} onClick={() => void persist()}>
        {saving ? 'Saving…' : 'Save defaults'}
      </Button>
    </div>
  </Card>;
};

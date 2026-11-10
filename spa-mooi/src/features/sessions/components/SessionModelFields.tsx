import type { SessionProvider } from '@/features/sessions/types/SessionProvider';

interface SessionModelFieldsProps {
  provider?: SessionProvider;
  model: string;
  effort: string;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
}

export const SessionModelFields = ({ provider, model, effort, onModelChange, onEffortChange }: SessionModelFieldsProps) => {
  if (!provider) return null;
  if (provider.unavailable) return <p role="alert" className="text-sm text-danger">{provider.unavailable}</p>;
  const efforts = provider.models.find((entry) => entry.id === model)?.efforts ?? [];
  const style = 'h-11 min-w-0 rounded-control border border-line bg-surface-2 px-3 text-sm text-ink outline-none focus:border-brand';
  return <div className="grid grid-cols-2 gap-3 sm:gap-4">
    <label className={`flex min-w-0 flex-col gap-2 ${efforts.length === 0 ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium text-ink-muted">Model</span>
      <select aria-label="Session model" className={style} value={model} onChange={(event) => onModelChange(event.target.value)}>
        <option value="" disabled>Select a model</option>
        {provider.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </label>
    {efforts.length > 0 && <label className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium text-ink-muted">Effort</span>
      <select aria-label="Reasoning effort" className={style} value={effort} onChange={(event) => onEffortChange(event.target.value)}>
        {efforts.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
      </select>
    </label>}
  </div>;
};

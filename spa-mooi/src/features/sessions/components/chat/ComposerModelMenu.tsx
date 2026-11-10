import { useCallback, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';
import { cn } from '@/shared/utils/cn';

interface ComposerModelMenuOption {
  value: string;
  label: string;
}

interface ComposerModelMenuProps {
  model: string;
  effort: string | null;
  modelOptions: ComposerModelMenuOption[];
  effortOptions: string[];
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
  disabled: boolean;
}

const fieldClass = 'w-full appearance-none truncate rounded-lg border border-line bg-surface-2 py-2.5 pr-9 pl-3 text-sm font-medium text-ink outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-60';

const Field = ({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: ComposerModelMenuOption[]; onChange: (value: string) => void; disabled: boolean;
}) => (
  <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink-subtle">
    {label}
    <span className="relative flex">
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={fieldClass}>
        {value && !options.some((option) => option.value === value) ? <option value={value}>{value}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-subtle" />
    </span>
  </label>
);

/**
 * Phones fold the model and effort pickers into one chip so the toolbar keeps a single tidy row.
 * The panel spans the toolbar (its nearest positioned ancestor), never the chip, so it is never clipped.
 */
export const ComposerModelMenu = ({ model, effort, modelOptions, effortOptions, onModelChange, onEffortChange, disabled }: ComposerModelMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const dismiss = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useOnClickOutside(containerRef, close, open);
  useOnEscape(dismiss, open);

  const modelLabel = modelOptions.find((option) => option.value === model)?.label ?? model;
  const summary = effort ? `${modelLabel} · ${effort}` : modelLabel;

  return (
    <div ref={containerRef} className="flex min-w-0">
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}
        aria-label={`Model and effort: ${summary}`} title="Model and effort" aria-haspopup="dialog" aria-expanded={open}
        className={cn('flex h-9 min-w-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          open ? 'border-ink bg-surface text-ink' : 'border-line bg-surface text-ink-muted hover:text-ink')}>
        <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{summary}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Model and effort"
          className="absolute inset-x-1.5 bottom-full z-50 mb-2 flex max-h-[min(20rem,50dvh)] flex-col gap-3 overflow-y-auto rounded-xl border border-line-strong bg-surface p-3 shadow-pop">
          <Field label="Model" value={model} options={modelOptions} onChange={onModelChange} disabled={disabled} />
          {effortOptions.length > 0 ? (
            <Field label="Effort" value={effort ?? ''} options={effortOptions.map((option) => ({ value: option, label: option }))}
              onChange={onEffortChange} disabled={disabled} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

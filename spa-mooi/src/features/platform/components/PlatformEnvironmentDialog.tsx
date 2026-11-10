import { useState } from 'react';
import { KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { inheritedEnvironment } from '@/features/platform/lib/inheritedEnvironment';
import type { PlatformEnvironmentVariable } from '@/features/platform/types/PlatformEnvironmentVariable';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { cn } from '@/shared/utils/cn';

const NAME = /^[A-Z0-9_]{1,100}$/;

interface PlatformEnvironmentDialogProps {
  /** The name prefix of the variables this configuration owns, e.g. `MOOI_PRODUCTION_`. */
  prefix: string;
  description: string;
  variables: PlatformEnvironmentVariable[];
  /** The stored variables are still loading. */
  loading?: boolean;
  loadError?: string | null;
  emptyDescription?: string;
  save: (values: Record<string, string | null>) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Values are write-only: a blank field keeps the stored value, so secrets never travel back to
 * the browser. Optional variables can be removed; required ones are read by the scripts. Inherited
 * variables only show whether they are set.
 */
export const PlatformEnvironmentDialog = ({
  prefix, description, variables, loading = false, loadError = null,
  emptyDescription = 'The scripts do not read any variable yet.', save, onClose, onSaved,
}: PlatformEnvironmentDialogProps) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<{ name: string; value: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = added.some((entry) => !NAME.test(entry.name));

  const submit = async () => {
    const update: Record<string, string | null> = {};
    Object.entries(values).forEach(([name, value]) => { if (value.length > 0) update[name] = value; });
    removed.forEach((name) => { update[name] = null; });
    added.forEach(({ name, value }) => { if (value.length > 0) update[`${prefix}${name}`] = value; });
    if (Object.keys(update).length === 0) { onClose(); return; }
    setBusy(true); setError(null);
    try { await save(update); onSaved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };

  const field = 'h-10 min-w-0 rounded-control border border-line bg-surface-2 px-3 font-mono text-xs text-ink outline-none focus:border-brand/50';

  return <Modal open size="lg" onClose={busy ? () => undefined : onClose} title="Environment variables"
    description={`${description} Leave a field blank to keep its current value.`}
    footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="brand" onClick={() => void submit()} disabled={busy || invalid || loading}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{busy ? 'Saving…' : 'Save variables'}
      </Button></>}>
    <ul className="flex flex-col gap-3">
      {variables.map((variable) => {
        const removing = removed.has(variable.name);
        return <li key={variable.name} className={cn('flex flex-col gap-1.5', removing && 'opacity-50')}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-xs font-bold text-ink">{variable.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] font-semibold">
              <span className={variable.configured ? 'text-success' : variable.required ? 'text-danger' : 'text-ink-subtle'}>
                {variable.configured ? 'Set' : variable.required ? 'Missing' : 'Not set'}</span>
              {!variable.required && !variable.inherited && variable.configured ? <button type="button" disabled={busy}
                onClick={() => setRemoved((current) => { const next = new Set(current); if (removing) next.delete(variable.name); else next.add(variable.name); return next; })}
                aria-label={removing ? `Keep ${variable.name}` : `Remove ${variable.name}`} title={removing ? 'Keep' : 'Remove'}
                className="grid size-7 place-items-center rounded-md text-ink-subtle hover:bg-danger-soft hover:text-danger">
                <Trash2 className="size-3.5" /></button> : null}
            </span>
          </div>
          {variable.inherited ? <p className="rounded-control bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
            Managed in {inheritedEnvironment(variable.name).owner}.</p>
            : <input type="password" autoComplete="new-password" spellCheck={false} disabled={busy || removing}
              value={values[variable.name] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [variable.name]: event.target.value }))}
              placeholder={variable.configured ? '•••••••• (unchanged)' : 'Value'} aria-label={`${variable.name} value`} className={field} />}
        </li>;
      })}
      {added.map((entry, index) => <li key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <span className={cn(field, 'flex items-center gap-0.5 pr-1')}>
          <span className="shrink-0 text-ink-subtle">{prefix}</span>
          <input value={entry.name} autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false} disabled={busy} aria-label="Variable name" placeholder="NAME"
            onChange={(event) => setAdded((current) => current.map((item, position) => position === index ? { ...item, name: event.target.value.toUpperCase() } : item))}
            className="h-full min-w-0 flex-1 bg-transparent outline-none" />
        </span>
        <input type="password" autoComplete="new-password" value={entry.value} disabled={busy} aria-label="Variable value" placeholder="Value"
          onChange={(event) => setAdded((current) => current.map((item, position) => position === index ? { ...item, value: event.target.value } : item))}
          className={field} />
        <button type="button" onClick={() => setAdded((current) => current.filter((_, position) => position !== index))} disabled={busy}
          aria-label="Discard variable" title="Discard" className="grid size-10 place-items-center rounded-control text-ink-subtle hover:bg-surface-2 hover:text-ink">
          <Trash2 className="size-4" /></button>
      </li>)}
    </ul>
    {loading ? <p className="flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle className="size-4 animate-spin" />Loading variables…</p>
      : variables.length === 0 && added.length === 0 ? <p className="text-sm text-ink-muted">{emptyDescription}</p> : null}
    {loadError ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{loadError}</p> : null}
    <button type="button" onClick={() => setAdded((current) => [...current, { name: '', value: '' }])} disabled={busy || loading}
      className="mt-4 inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-xs font-bold text-ink-muted transition hover:bg-surface-2 hover:text-ink">
      <Plus className="size-3.5" />Add variable</button>
    {error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p> : null}
  </Modal>;
};

import { formatTokenShare } from '@/features/traces/lib/formatTokenShare';
import { formatTokens } from '@/features/traces/lib/formatTokens';
import type { TraceModelStat } from '@/features/traces/types/TraceModelStat';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface TraceModelTableProps {
  models: readonly TraceModelStat[];
}

const PARTS = [
  { key: 'cacheRead', label: 'Cache read', dot: 'bg-info-dot' },
  { key: 'cacheWrite', label: 'Cache write', dot: 'bg-accent-dot' },
  { key: 'input', label: 'Input', dot: 'bg-brand' },
  { key: 'output', label: 'Output', dot: 'bg-success-dot' },
] as const;

const total = (model: TraceModelStat) => model.input + model.cacheRead + model.cacheWrite + model.output;
const exact = (value: number) => value.toLocaleString('en');

/**
 * Tokens per model (FR6): one row per model, largest first, with its share of every token of the trace
 * as a stacked bar (same parts and colours as the context chart) and the exact figures in titles.
 */
export const TraceModelTable = ({ models }: TraceModelTableProps) => {
  if (models.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-ink-muted">No model request yet.</p>;
  }
  const rows = [...models].sort((a, b) => total(b) - total(a));
  const grand = rows.reduce((sum, model) => sum + total(model), 0);

  return (
    <ul className="@container flex min-w-0 flex-col divide-y divide-line">
      {rows.map((model) => {
        const tokens = total(model);
        return (
          <li key={model.model} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink" title={model.model}>
                {model.model}
              </span>
              <span className="shrink-0 text-[12px] text-ink-muted tabular-nums" title={`${exact(model.calls)} requests`}>
                {formatCount(model.calls)} {model.calls === 1 ? 'call' : 'calls'}
              </span>
              <span className="shrink-0 font-mono text-[13px] font-semibold text-ink tabular-nums" title={`${exact(tokens)} tokens`}>
                {formatTokens(tokens)}
              </span>
              <span className="w-9 shrink-0 text-right text-[11px] text-ink-subtle tabular-nums">{formatTokenShare(tokens, grand)}</span>
            </div>
            <div
              role="img"
              aria-label={`${model.model}: ${PARTS.map((part) => `${part.label} ${exact(model[part.key])}`).join(', ')}`}
              className="flex h-1.5 overflow-hidden rounded-full bg-surface-3"
              style={{ width: `${grand > 0 ? Math.max((tokens / grand) * 100, 2) : 0}%` }}
            >
              {PARTS.map((part) =>
                model[part.key] > 0 ? (
                  <span key={part.key} className={cn('h-full', part.dot)} style={{ width: `${(model[part.key] / Math.max(tokens, 1)) * 100}%` }} />
                ) : null,
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-muted @lg:grid-cols-4">
              {PARTS.map((part) => (
                <div key={part.key} className="flex min-w-0 items-center gap-1.5" title={`${part.label}: ${exact(model[part.key])}`}>
                  <span aria-hidden className={cn('size-2 shrink-0 rounded-[2px]', part.dot)} />
                  <dt className="truncate">{part.label}</dt>
                  <dd className="ml-auto font-mono text-ink tabular-nums">{formatTokens(model[part.key])}</dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
};

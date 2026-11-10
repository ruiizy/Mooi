import { formatSpanDuration } from '@/features/traces/lib/formatSpanDuration';
import { formatTokens } from '@/features/traces/lib/formatTokens';
import type { TraceSummary } from '@/features/traces/types/TraceSummary';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface TraceSummaryStripProps {
  summary: TraceSummary;
  /** The agent still works: the duration runs up to `now`. */
  live: boolean;
  now: number;
}

interface Kpi {
  id: string;
  label: string;
  value: string;
  /** Exact figure or breakdown, shown on hover and read by screen readers. */
  detail: string;
  tone?: 'danger';
}

const exact = (value: number) => value.toLocaleString('en');

const kpis = (summary: TraceSummary, live: boolean, now: number): Kpi[] => {
  const { counts, tokens } = summary;
  const end = live ? Math.max(now, summary.endMs ?? now) : summary.endMs;
  const duration = summary.startMs !== null && end !== null ? end - summary.startMs : null;
  const count = (id: string, label: string, value: number, tone?: 'danger'): Kpi => ({
    id,
    label,
    value: formatCount(value),
    detail: `${label}: ${exact(value)}`,
    tone: tone && value > 0 ? tone : undefined,
  });

  return [
    {
      id: 'duration',
      label: 'Duration',
      value: duration === null ? '–' : formatSpanDuration(duration),
      detail: duration === null ? 'Duration: none yet' : `Duration: ${formatSpanDuration(duration)}`,
    },
    count('prompts', 'Prompts', counts.prompt),
    count('turns', 'Turns', counts.turn),
    count('tools', 'Tool calls', counts.tool),
    count('agents', 'Sub-agents', counts.agent),
    count('errors', 'Errors', summary.errors, 'danger'),
    {
      id: 'tokens',
      label: 'Tokens',
      value: formatTokens(tokens.total),
      detail: [
        `Tokens: ${exact(tokens.total)}`,
        `input ${exact(tokens.input)}`,
        `cache read ${exact(tokens.cacheRead)}`,
        `cache write ${exact(tokens.cacheWrite)}`,
        `output ${exact(tokens.output)}`,
        `reasoning ${exact(tokens.reasoning)}`,
      ].join(' · '),
    },
    {
      id: 'cache',
      label: 'Cache hit',
      value: summary.cacheHitRate === null ? '–' : `${Math.round(summary.cacheHitRate * 100)}%`,
      detail: summary.cacheHitRate === null ? 'Cache hit rate: no model request' : `Cache hit rate: ${(summary.cacheHitRate * 100).toFixed(1)}%`,
    },
    {
      id: 'context',
      label: 'Peak context',
      value: formatTokens(summary.peakContext),
      detail: summary.peakContext === null ? 'Peak context: no model request' : `Peak context: ${exact(summary.peakContext)} tokens`,
    },
  ];
};

/**
 * The trace's KPIs (FR2) as compact cards: one scrolling row on phones, wrapping into a grid from `md`.
 * Values use compact pills; the exact figure and the token breakdown sit in the title.
 */
export const TraceSummaryStrip = ({ summary, live, now }: TraceSummaryStripProps) => (
  <dl
    aria-label="Trace summary"
    className="scrollbar-none flex min-w-0 snap-x gap-2 overflow-x-auto px-3 py-2.5 sm:px-4 md:grid md:grid-cols-[repeat(auto-fit,minmax(104px,1fr))] md:overflow-visible"
  >
    {kpis(summary, live, now).map((kpi) => (
      <div
        key={kpi.id}
        title={kpi.detail}
        className={cn(
          'flex min-w-[92px] shrink-0 snap-start flex-col gap-0.5 rounded-control border px-3 py-2 md:min-w-0',
          kpi.tone === 'danger' ? 'border-danger/30 bg-danger-soft' : 'border-line bg-surface-2/60',
        )}
      >
        <dt className="truncate text-[11px] font-medium text-ink-subtle">{kpi.label}</dt>
        <dd
          aria-label={kpi.detail}
          className={cn('truncate font-mono text-[15px] font-semibold tabular-nums', kpi.tone === 'danger' ? 'text-danger' : 'text-ink')}
        >
          {kpi.value}
        </dd>
      </div>
    ))}
  </dl>
);

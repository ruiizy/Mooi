import { useMemo, useState } from 'react';
import { formatSpanDuration } from '@/features/traces/lib/formatSpanDuration';
import { traceKindStyle } from '@/features/traces/lib/traceKindStyle';
import type { TraceToolStat } from '@/features/traces/types/TraceToolStat';
import { SegmentedControl } from '@/shared/components/SegmentedControl';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface TraceToolRankingProps {
  tools: readonly TraceToolStat[];
}

type Rank = 'calls' | 'time';

const RANKS = [
  { id: 'calls', label: 'Calls' },
  { id: 'time', label: 'Time' },
];

/**
 * Tools, sub-agents and skills ranked by calls or by total time (FR6), each with a bar relative to the
 * leader, its kind icon and its error count. Names truncate; the full name and exact figures are titles.
 */
export const TraceToolRanking = ({ tools }: TraceToolRankingProps) => {
  const [rank, setRank] = useState<Rank>('calls');
  const rows = useMemo(
    () =>
      [...tools].sort((a, b) =>
        rank === 'calls' ? b.calls - a.calls || b.durationMs - a.durationMs : b.durationMs - a.durationMs || b.calls - a.calls,
      ),
    [tools, rank],
  );
  const value = (tool: TraceToolStat) => (rank === 'calls' ? tool.calls : tool.durationMs);
  const top = rows.length > 0 ? Math.max(value(rows[0]), 1) : 1;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SegmentedControl items={RANKS} value={rank} onChange={(id) => setRank(id as Rank)} className="self-start" />
      {rows.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-ink-muted">No tool call yet.</p>
      ) : (
        <ol className="flex min-w-0 flex-col gap-2.5">
          {rows.map((tool) => {
            const style = traceKindStyle(tool.kind);
            const Icon = style.icon;
            const detail = `${tool.name}: ${tool.calls.toLocaleString('en')} calls, ${formatSpanDuration(tool.durationMs)} total${
              tool.errors > 0 ? `, ${tool.errors.toLocaleString('en')} errors` : ''
            }`;
            return (
              <li key={`${tool.kind}:${tool.name}`} title={detail} aria-label={detail} className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2 text-[12px]">
                  <Icon aria-hidden className={cn('size-3.5 shrink-0', style.text)} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{tool.name}</span>
                  {tool.errors > 0 ? (
                    <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-px text-[11px] font-medium text-danger tabular-nums">
                      {formatCount(tool.errors)} err
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-ink tabular-nums">
                    {rank === 'calls' ? formatCount(tool.calls) : formatSpanDuration(tool.durationMs)}
                  </span>
                  <span className="hidden w-14 shrink-0 text-right font-mono text-[11px] text-ink-subtle tabular-nums sm:inline">
                    {rank === 'calls' ? formatSpanDuration(tool.durationMs) : `${formatCount(tool.calls)}×`}
                  </span>
                </div>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className={cn('block h-full rounded-full transition-[width] duration-300', style.bar)}
                    style={{ width: `${Math.max((value(tool) / top) * 100, 2)}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

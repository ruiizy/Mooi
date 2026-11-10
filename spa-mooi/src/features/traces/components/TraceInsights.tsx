import { useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, Cpu, Gauge, Wrench, type LucideIcon } from 'lucide-react';
import { TraceContextChart } from '@/features/traces/components/TraceContextChart';
import { TraceErrorList } from '@/features/traces/components/TraceErrorList';
import { TraceModelTable } from '@/features/traces/components/TraceModelTable';
import { TraceToolRanking } from '@/features/traces/components/TraceToolRanking';
import { traceContextBars } from '@/features/traces/lib/traceContextBars';
import type { AgentTrace } from '@/features/traces/types/AgentTrace';
import { SegmentedControl } from '@/shared/components/SegmentedControl';
import { cn } from '@/shared/utils/cn';

interface TraceInsightsProps {
  trace: AgentTrace;
  /** Switches to the Timeline and opens the span in the inspector. */
  onOpenSpan: (spanId: string) => void;
}

interface InsightCardProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

const InsightCard = ({ icon: Icon, title, hint, action, children, className }: InsightCardProps) => (
  <section aria-label={title} className={cn('flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-raised sm:p-4', className)}>
    <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
      <h3 className="min-w-0 truncate text-sm font-semibold text-ink">{title}</h3>
      {hint ? <span className="min-w-0 truncate text-[12px] text-ink-subtle">{hint}</span> : null}
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </header>
    {children}
  </section>
);

const SCOPES = [
  { id: 'main', label: 'Main' },
  { id: 'all', label: 'With sub-agents' },
];

/**
 * The Insights view of the Trace tab (FR6): context size per model request, tokens per model, tools
 * ranked by calls or time, and the failed steps. One column on phones, two from `xl`; every card links
 * back into the Timeline inspector.
 */
export const TraceInsights = ({ trace, onOpenSpan }: TraceInsightsProps) => {
  const [scope, setScope] = useState<'main' | 'all'>('main');
  const hasSubAgents = trace.summary.counts.agent > 0;
  const includeSubAgents = hasSubAgents && scope === 'all';
  const bars = useMemo(() => traceContextBars(trace.spans, includeSubAgents), [trace.spans, includeSubAgents]);
  const errors = useMemo(() => trace.spans.filter((span) => span.status === 'error' && span.kind !== 'turn'), [trace.spans]);
  const requests = bars.reduce((sum, bar) => sum + bar.calls, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
      <div className="grid min-w-0 animate-fade-up grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        <InsightCard
          icon={Gauge}
          title="Context per request"
          hint={requests > 0 ? `${requests.toLocaleString('en')} requests` : undefined}
          action={
            hasSubAgents ? (
              <SegmentedControl items={SCOPES} value={scope} onChange={(id) => setScope(id as 'main' | 'all')} className="flex-nowrap whitespace-nowrap" />
            ) : null
          }
          className="xl:col-span-2"
        >
          <TraceContextChart key={scope} bars={bars} onOpenSpan={onOpenSpan} />
        </InsightCard>

        <InsightCard icon={Cpu} title="Tokens per model" hint={hasSubAgents ? 'sub-agents included' : undefined}>
          <TraceModelTable models={trace.summary.models} />
        </InsightCard>

        <InsightCard icon={Wrench} title="Tools" hint={trace.summary.tools.length >= 40 ? 'top 40' : undefined}>
          <TraceToolRanking tools={trace.summary.tools} />
        </InsightCard>

        <InsightCard
          icon={CircleAlert}
          title="Errors"
          hint={errors.length > 0 ? errors.length.toLocaleString('en') : undefined}
          className="xl:col-span-2"
        >
          <TraceErrorList errors={errors} traceStartMs={trace.summary.startMs} onOpenSpan={onOpenSpan} />
        </InsightCard>
      </div>
    </div>
  );
};

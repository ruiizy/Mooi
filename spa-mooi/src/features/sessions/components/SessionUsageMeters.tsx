import { useAccountFiveHourLimit } from '@/features/sessions/hooks/useAccountFiveHourLimit';
import { usagePercent } from '@/features/sessions/lib/usagePercent';
import type { Session } from '@/features/sessions/types/Session';
import { cn } from '@/shared/utils/cn';

interface UsageMeterProps {
  label: string;
  name: string;
  percent: number | null;
  hint: string | null;
}

const fill = (percent: number) => (percent >= 90 ? 'bg-danger' : percent >= 75 ? 'bg-warning' : 'bg-brand');

const UsageMeter = ({ label, name, percent, hint }: UsageMeterProps) => {
  const shown = percent == null ? null : Math.round(percent);
  const description = `${name}: ${shown == null ? 'unavailable' : `${shown}% used`}${hint ? ` · ${hint}` : ''}`;
  return (
    <span role="img" aria-label={description} title={description} className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 leading-none">
        <span className="font-mono text-[10px] font-medium tracking-[0.1em] text-ink-subtle uppercase">{label}</span>
        <span className={cn('text-[11px] font-bold tabular-nums', shown == null ? 'text-ink-subtle' : 'text-ink')}>
          {shown == null ? '—' : `${shown}%`}
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-surface-3">
        {percent != null ? (
          <span className={cn('block h-full rounded-full transition-[width] duration-500', fill(percent))}
            style={{ width: `${Math.max(percent, 2)}%` }} />
        ) : null}
      </span>
    </span>
  );
};

interface SessionUsageMetersProps {
  session: Session;
  className?: string;
}

/**
 * The two numbers that decide whether a session can keep going: how full its conversation is and
 * how much of its account's 5 hour window is spent. Both follow the player's live channel.
 */
export const SessionUsageMeters = ({ session, className }: SessionUsageMetersProps) => {
  const context = session.usage?.context;
  const fiveHour = useAccountFiveHourLimit(session.connectionId);
  const tokens = context?.limitTokens != null
    ? `${(context.usedTokens ?? 0).toLocaleString()} / ${context.limitTokens.toLocaleString()} tokens` : null;
  const resets = fiveHour?.resetsAt ? `resets ${new Date(fiveHour.resetsAt * 1000).toLocaleString()}` : null;

  return (
    <span className={cn('grid grid-cols-2 gap-3', className)}>
      <UsageMeter label="Context" name="Context" percent={usagePercent(context)} hint={tokens} />
      <UsageMeter label="5h" name="5 hour limit" percent={usagePercent(fiveHour)} hint={resets} />
    </span>
  );
};

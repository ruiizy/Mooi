import { useEffect, useState } from 'react';

interface WorkingStatusProps {
  /** What the agent is doing right now, e.g. "Running tests". */
  label: string;
  detail?: string | null;
  /** When the turn started, for the elapsed counter; omitted, no counter is shown. */
  since?: string;
}

const formatElapsed = (seconds: number): string =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;

const useElapsedSeconds = (since: string | undefined): number | null => {
  const start = since ? new Date(since).getTime() : Number.NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(start)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [start]);

  return Number.isNaN(start) ? null : Math.max(0, Math.floor((now - start) / 1000));
};

/**
 * The one line that says the agent is busy and with what: a highlight sweeps across the current
 * action while it runs. Announced politely, so screen readers hear each new action once.
 */
export const WorkingStatus = ({ label, detail, since }: WorkingStatusProps) => {
  const elapsed = useElapsedSeconds(since);

  return (
    <span role="status" aria-live="polite" className="flex min-w-0 items-center gap-2 text-[13px]">
      <span aria-hidden="true" className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 animate-orb-ping rounded-full bg-brand/60" />
        <span className="relative size-2 rounded-full bg-brand-gradient" />
      </span>
      <span className="min-w-0 truncate">
        <span className="text-shimmer font-medium">{label}</span>
        {detail ? <span className="text-shimmer ml-1.5 font-mono text-[12px]">{detail}</span> : null}
      </span>
      {elapsed !== null ? <span className="shrink-0 font-mono text-[11px] text-ink-subtle tabular-nums">{formatElapsed(elapsed)}</span> : null}
    </span>
  );
};

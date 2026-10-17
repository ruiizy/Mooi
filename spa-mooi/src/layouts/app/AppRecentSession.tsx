import { Link, useLocation } from 'react-router-dom';
import { sessionChatLabel } from '@/features/sessions/lib/sessionChatLabel';
import { sessionChatPath } from '@/features/sessions/lib/sessionChatPath';
import { sessionKindIcon } from '@/features/sessions/lib/sessionKindIcon';
import { sessionStatusLabel, sessionStatusPulses, sessionStatusTone } from '@/features/sessions/lib/sessionStatusTone';
import type { Session } from '@/features/sessions/types/Session';
import { StatusDot } from '@/shared/components/StatusDot';
import { cn } from '@/shared/utils/cn';

interface AppRecentSessionProps {
  session: Session;
  onNavigate?: () => void;
}

/** One open conversation under its project: what it is, and what its agent is doing right now. */
export const AppRecentSession = ({ session, onNavigate }: AppRecentSessionProps) => {
  const { pathname, search } = useLocation();
  const to = sessionChatPath(session);
  const [path, query] = to.split('?');
  const active = pathname === path && (!query || search.includes(query));
  const Icon = sessionKindIcon(session.kind);
  const label = sessionChatLabel(session);
  const status = sessionStatusLabel(session.status);

  return (
    <li>
      <Link
        to={to}
        onClick={onNavigate}
        title={`${label} · ${status}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center gap-2.5 rounded-[10px] py-1.5 pr-3 pl-2.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          active ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        )}
      >
        <Icon className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-xs font-bold', session.kind === 'session' && 'font-mono')}>{label}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-ink-subtle">
            <StatusDot tone={sessionStatusTone(session.status)} pulse={sessionStatusPulses(session.status)} />
            <span className="truncate">{status}</span>
          </span>
        </span>
      </Link>
    </li>
  );
};

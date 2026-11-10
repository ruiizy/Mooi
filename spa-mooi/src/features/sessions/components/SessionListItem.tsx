import { Link } from 'react-router-dom';
import { ChevronRight, GitBranch } from 'lucide-react';
import { sessionPath } from '@/app/paths';
import { SessionStatusBadge } from '@/features/sessions/components/SessionStatusBadge';
import { SessionAccountIdentity } from '@/features/sessions/components/SessionAccountIdentity';
import { SessionUsageMeters } from '@/features/sessions/components/SessionUsageMeters';
import { WorkspacePathLabel } from '@/features/sessions/components/WorkspacePathLabel';
import type { Session } from '@/features/sessions/types/Session';
import type { BackLink } from '@/shared/types/BackLink';
import { backLinkState } from '@/shared/utils/backLinkState';
import { formatDate } from '@/shared/utils/formatDate';

interface SessionListItemProps {
  session: Session;
  /** Where the session's back button returns; its project by default. */
  backLink?: BackLink;
}

export const SessionListItem = ({ session, backLink }: SessionListItemProps) => (
  <li className="border-b border-line last:border-b-0">
    <Link
      to={sessionPath(session.projectId, session.id)}
      state={backLink ? backLinkState(backLink) : undefined}
      className="flex items-center gap-3 px-1 py-3.5 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:gap-4 sm:px-2.5"
    >
      <span className="w-[108px] shrink-0">
        <SessionStatusBadge status={session.status} deployment={session.deployment.state} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
          <GitBranch className="size-3.5 shrink-0 text-ink-subtle" />
          <span className="truncate font-mono">{session.branch}</span>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
          {session.detail ?? `Updated ${formatDate(session.updatedAt)}`}
        </p>
        <span className="mt-0.5 block sm:hidden"><SessionAccountIdentity session={session} compact /></span>
        <WorkspacePathLabel path={session.workspacePath} className="mt-1" />
        <SessionUsageMeters session={session} className="mt-2 max-w-60 sm:hidden" />
      </div>

      <SessionUsageMeters session={session} className="hidden w-36 shrink-0 sm:grid" />

      <span className="hidden min-w-0 max-w-32 shrink-0 sm:block"><SessionAccountIdentity session={session} /></span>

      <ChevronRight className="size-4 shrink-0 text-line-strong" />
    </Link>
  </li>
);

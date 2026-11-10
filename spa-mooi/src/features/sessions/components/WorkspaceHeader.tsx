import { Link } from 'react-router-dom';
import { ChevronLeft, GitBranch } from 'lucide-react';
import type { Project } from '@/features/projects/types/Project';
import type { Session } from '@/features/sessions/types/Session';
import { DeployButton } from '@/features/sessions/components/deploy/DeployButton';
import { MergeButton } from '@/features/sessions/components/merge/MergeButton';
import { SessionActionsMenu } from '@/features/sessions/components/SessionActionsMenu';
import { SessionAccountIdentity } from '@/features/sessions/components/SessionAccountIdentity';
import { WorkspaceCompactTitle } from '@/features/sessions/components/WorkspaceCompactTitle';
import { WorkspacePathLabel } from '@/features/sessions/components/WorkspacePathLabel';
import { useDeployControl } from '@/features/sessions/hooks/useDeployControl';
import { Tooltip } from '@/shared/components/Tooltip';
import type { BackLink } from '@/shared/types/BackLink';

interface WorkspaceHeaderProps {
  project: Project;
  session: Session;
  back: BackLink;
  deployEnabled: boolean;
  onClose: () => void;
  closeBusy: boolean;
}

/**
 * The branch is the session's name, so it gets every pixel the controls do not need: icon-only
 * merge on phones, the deploy button only while a deployment is active (its other actions join the
 * secondary ones, close included, in one menu), and a one-line title that reveals the details on tap.
 */
export const WorkspaceHeader = ({ project, session, back, deployEnabled, onClose, closeBusy }: WorkspaceHeaderProps) => {
  const deployControl = useDeployControl(session, closeBusy);
  const deploy = deployEnabled ? deployControl : null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 composing:max-lg:hidden border-b border-line bg-surface py-2 pr-2 pl-1.5 sm:gap-3 sm:px-5 sm:py-2.5">
      <Link
        to={back.to}
        aria-label={`Back to ${back.label}`}
        title={`Back to ${back.label}`}
        className="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ChevronLeft className="size-4.5" />
      </Link>

      <WorkspaceCompactTitle project={project} session={session} />

      <div className="min-w-0 flex-1 max-sm:hidden">
        <p className="truncate text-[11px] font-medium text-ink-subtle">{project.name}</p>
        <Tooltip content={session.branch} className="flex">
          <h1 className="flex min-w-0 items-center gap-1.5 text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
            <GitBranch className="size-4 shrink-0 text-ink-subtle" />
            <span className="line-clamp-1 font-mono break-all">{session.branch}</span>
          </h1>
        </Tooltip>
        <WorkspacePathLabel path={session.workspacePath} className="mt-0.5" focusable />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden max-w-36 border-r border-line pr-3 sm:block"><SessionAccountIdentity session={session} /></span>
        <MergeButton key={`merge-${session.id}`} session={session} disabled={closeBusy} />
        {deploy ? <DeployButton control={deploy} /> : null}
        <SessionActionsMenu session={session} deploy={deploy} onClose={onClose} closeBusy={closeBusy} />
      </div>
    </div>
  );
};

import type { ReactNode } from 'react';
import { Bot, FolderGit2, GitBranch, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Project } from '@/features/projects/types/Project';
import { SessionAccountIdentity } from '@/features/sessions/components/SessionAccountIdentity';
import type { Session } from '@/features/sessions/types/Session';
import { TapTooltip } from '@/shared/components/TapTooltip';

interface WorkspaceCompactTitleProps {
  project: Project;
  session: Session;
}

const Detail = ({ icon: Icon, children, mono = false }: { icon: LucideIcon; children: ReactNode; mono?: boolean }) => (
  <p className="flex min-w-0 items-start gap-2 py-1.5 text-[12px] leading-snug first:pt-0 last:pb-0">
    <Icon className="mt-[2px] size-3.5 shrink-0 text-ink-subtle" />
    <span className={mono ? 'min-w-0 font-mono break-all' : 'min-w-0 break-words'}>{children}</span>
  </p>
);

/**
 * The phone header title: the branch on one line, clipped at its start so its distinctive end stays
 * readable, over the agent's provider in small print. A tap reveals project, full branch, account
 * and clone path for a few seconds.
 */
export const WorkspaceCompactTitle = ({ project, session }: WorkspaceCompactTitleProps) => (
  <div className="min-w-0 flex-1 sm:hidden">
    <h1 className="sr-only">{session.branch}</h1>
    <TapTooltip label="Show session details" content={
      <div className="flex w-[min(22rem,calc(100vw-6rem))] flex-col divide-y divide-line">
        <Detail icon={Layers}><span className="font-bold">{project.name}</span></Detail>
        <Detail icon={GitBranch} mono>{session.branch}</Detail>
        <Detail icon={Bot}><SessionAccountIdentity session={session} compact /></Detail>
        <Detail icon={FolderGit2} mono>
          {session.workspacePath ?? <span className="font-sans text-ink-subtle italic">Clone not ready yet</span>}
        </Detail>
      </div>
    }>
      <span aria-hidden="true" className="flex min-w-0 items-center gap-1.5 text-[14px] leading-tight font-extrabold tracking-[-0.01em] text-ink">
        <GitBranch className="size-3.5 shrink-0 text-ink-subtle" />
        <span className="truncate-start min-w-0 font-mono"><span dir="ltr">{session.branch}</span></span>
      </span>
      <span aria-hidden="true" className="mt-0.5 block truncate pl-5 text-[10px] leading-tight font-semibold text-ink-subtle">
        {session.adapterLabel ?? session.providerLabel}
      </span>
    </TapTooltip>
  </div>
);

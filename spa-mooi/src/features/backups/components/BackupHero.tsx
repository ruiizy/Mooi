import { Link } from 'react-router-dom';
import { DatabaseBackup, ExternalLink, KeyRound, MessagesSquare, Rocket, Sparkles, Terminal } from 'lucide-react';
import { deploymentPath } from '@/app/paths';
import { BackupSteps } from '@/features/backups/components/BackupSteps';
import { BACKUP_STAGE_VIEWS } from '@/features/backups/lib/backupStageView';
import type { BackupStage } from '@/features/backups/types/BackupStage';
import type { Project } from '@/features/projects/types/Project';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Initials } from '@/shared/components/Initials';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import { toneStyles } from '@/shared/styles/toneStyles';
import { cn } from '@/shared/utils/cn';

interface BackupHeroProps {
  project: Project;
  stage: BackupStage;
  hasChat: boolean;
  missingVariables: number;
  deployedRelease: string | null;
  busy: boolean;
  onSetup: () => void;
  onBackup: () => void;
  onOpenChat: () => void;
  onOpenConsole: () => void;
  onFix: () => void;
  onEnvironment: () => void;
}

/**
 * The project's backup story in one card: where it stands and the single next step. Secondary
 * actions stay in the page header so this card never grows a toolbar.
 */
export const BackupHero = ({ project, stage, hasChat, missingVariables, deployedRelease, busy, onSetup, onBackup, onOpenChat,
  onOpenConsole, onFix, onEnvironment }: BackupHeroProps) => {
  const view = BACKUP_STAGE_VIEWS[stage];
  const Icon = view.icon;
  const operational = stage === 'ready' || stage === 'protected' || stage === 'failed';
  const blocked = missingVariables > 0 && operational;

  return (
    <Card className="relative overflow-hidden p-5 sm:p-7">
      <div aria-hidden className={cn('pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-60 blur-3xl', toneStyles(view.tone))} />

      <div className="relative flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <Initials value={project.name} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.035em] text-ink sm:text-[26px]">{project.name}</h1>
              {project.htmlUrl ? <a href={project.htmlUrl} target="_blank" rel="noreferrer"
                className="mt-0.5 inline-flex max-w-full items-center gap-1.5 font-mono text-[11px] text-ink-subtle transition hover:text-ink">
                <span className="truncate">{project.fullName}</span><ExternalLink className="size-3 shrink-0" /></a>
                : <p className="mt-0.5 truncate font-mono text-[11px] text-ink-subtle">{project.fullName}</p>}
            </div>
          </div>
          <Badge tone={view.tone} icon={view.icon} className={cn('shrink-0', stage === 'running' && '[&>svg]:animate-spin')}>{view.label}</Badge>
        </div>

        <div className="flex flex-col gap-5 border-t border-line pt-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className={cn('hidden size-12 shrink-0 items-center justify-center rounded-2xl sm:flex', toneStyles(view.tone))}>
              <Icon className={cn('size-6', stage === 'running' && 'animate-spin')} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink sm:text-xl">{view.title}</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-muted">
                {blocked ? `${missingVariables} required environment ${missingVariables === 1 ? 'variable is' : 'variables are'} missing. Set ${missingVariables === 1 ? 'it' : 'them'} before backing up.`
                  : operational && !deployedRelease ? 'Nothing runs in production right now. Deploy a release before creating backups.' : view.description}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {stage === 'undeployed' ? <Link to={deploymentPath(project.id)} className={buttonStyles('brand', 'lg')}><Rocket className="size-4.5" />Go to deployment</Link> : null}
            {stage === 'unconfigured' ? <Button variant="brand" size="lg" onClick={onSetup}><DatabaseBackup className="size-4.5" />Set up backups</Button> : null}
            {stage === 'preparing' ? <Button variant="brand" size="lg" onClick={onOpenChat}><MessagesSquare className="size-4.5" />Continue in chat</Button> : null}
            {stage === 'running' ? <Button variant="brand" size="lg" onClick={onOpenConsole}><Terminal className="size-4.5" />Watch the console</Button> : null}
            {stage === 'failed' ? <Button variant="secondary" size="lg" onClick={hasChat ? onOpenChat : onFix}><Sparkles className="size-4.5" />Fix with agent</Button> : null}
            {blocked ? <Button variant="brand" size="lg" onClick={onEnvironment}><KeyRound className="size-4.5" />Set variables</Button>
              : operational ? <Button variant="brand" size="lg" onClick={onBackup} disabled={busy || !deployedRelease}>
                <DatabaseBackup className="size-4.5" />{stage === 'failed' ? 'Back up again' : 'Create backup'}</Button> : null}
          </div>
        </div>

        {stage === 'unconfigured' || stage === 'preparing' ? <BackupSteps current={stage === 'unconfigured' ? 0 : 1} /> : null}
      </div>
    </Card>
  );
};

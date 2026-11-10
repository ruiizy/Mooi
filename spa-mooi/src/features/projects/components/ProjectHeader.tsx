import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, Globe, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { DevelopmentEnvironmentDialog } from '@/features/development/components/DevelopmentEnvironmentDialog';
import { EditProjectDialog } from '@/features/projects/components/EditProjectDialog';
import type { Project } from '@/features/projects/types/Project';
import { Badge } from '@/shared/components/Badge';
import { Card } from '@/shared/components/Card';
import { Eyebrow } from '@/shared/components/Eyebrow';
import { GithubMark } from '@/shared/components/icons/GithubMark';
import { Initials } from '@/shared/components/Initials';
import { iconAction } from '@/shared/styles/iconAction';
import { cn } from '@/shared/utils/cn';
import { formatDate } from '@/shared/utils/formatDate';

interface ProjectHeaderProps {
  project: Project;
  busy: boolean;
  onRemove: () => void;
}

/**
 * Actions live inside the overview card as icons, next to the repository mark, so the page keeps
 * a single header row on phones. The mark sits above the title, letting the name, visibility badge
 * and description use the card's full width instead of a column beside the icon.
 */
export const ProjectHeader = ({ project, busy, onRemove }: ProjectHeaderProps) => {
  const [editing, setEditing] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold">
        <Link
          to={ROUTES.projects}
          className="rounded text-ink-subtle transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Projects
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-line-strong" />
        <span className="min-w-0 truncate text-ink">{project.name}</span>
      </nav>

      <Card className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <Initials value={project.name} size="lg" />

          <div className="flex items-center gap-2">
            {project.htmlUrl ? (
              <a
                href={project.htmlUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open on GitHub"
                title="Open on GitHub"
                className={iconAction}
              >
                <GithubMark className="size-4" />
              </a>
            ) : null}

            <button
              type="button"
              onClick={() => setEnvironmentOpen(true)}
              aria-label="Development environment variables"
              title="Development environment variables"
              className={iconAction}
            >
              <KeyRound className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit project"
              title="Edit project"
              className={iconAction}
            >
              <Pencil className="size-4" />
            </button>

            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              aria-label="Delete GitHub repository"
              title="Delete GitHub repository"
              className={cn(iconAction, 'border-danger/35 text-danger hover:bg-danger-soft hover:text-danger')}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="min-w-0 text-[24px] leading-tight font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] text-ink sm:text-[26px]">
              {project.name}
            </h1>
            <Badge tone={project.isPrivate ? 'neutral' : 'info'}>
              {project.isPrivate ? 'Private' : 'Public'}
            </Badge>
            {project.webApplication ? (
              <Badge tone="brand" icon={Globe}>
                Web app
              </Badge>
            ) : null}
          </div>

          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            {project.description ?? 'No description on GitHub.'}
          </p>

          {project.htmlUrl ? (
            <a
              href={project.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1.5 font-mono text-[11px] [overflow-wrap:anywhere] text-ink-subtle transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {project.fullName}
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          ) : (
            <p className="mt-2 font-mono text-[11px] [overflow-wrap:anywhere] text-ink-subtle">{project.fullName}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4 sm:gap-y-4 sm:pt-5">
          <div className="min-w-0">
            <Eyebrow>Default branch</Eyebrow>
            <p className="mt-1 truncate font-mono text-[15px] font-extrabold text-ink">
              {project.defaultBranch ?? '—'}
            </p>
          </div>

          <div className="min-w-0">
            <Eyebrow>Language</Eyebrow>
            <p className="mt-1 flex items-center gap-2 truncate text-[15px] font-extrabold text-ink">
              {project.language ? <span className="size-1.5 shrink-0 rounded-full bg-info-dot" /> : null}
              {project.language ?? '—'}
            </p>
          </div>

          <div className="min-w-0">
            <Eyebrow>Stars</Eyebrow>
            <p className="mt-1 text-[15px] font-extrabold text-ink">{String(project.stars)}</p>
          </div>

          <div className="min-w-0">
            <Eyebrow>Added</Eyebrow>
            <p className="mt-1 text-[15px] font-extrabold text-ink">{formatDate(project.addedAt)}</p>
          </div>
        </div>
      </Card>

      {editing ? <EditProjectDialog project={project} onClose={() => setEditing(false)} /> : null}
      {environmentOpen ? <DevelopmentEnvironmentDialog projectId={project.id} onClose={() => setEnvironmentOpen(false)} /> : null}
    </div>
  );
};

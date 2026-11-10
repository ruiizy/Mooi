import { Link } from 'react-router-dom';
import { ArrowUpRight, GitBranch, Globe, Lock, Star } from 'lucide-react';
import { projectPath } from '@/app/paths';
import type { Project } from '@/features/projects/types/Project';
import { Badge } from '@/shared/components/Badge';
import { Initials } from '@/shared/components/Initials';
import { formatDate } from '@/shared/utils/formatDate';

interface ProjectCardProps {
  project: Project;
}

/** Hover lifts the card (transform only) and lights its edge; the arrow says the whole card is a link. */
export const ProjectCard = ({ project }: ProjectCardProps) => (
  <article className="group relative h-full min-w-0 animate-fade-up rounded-card border border-line bg-surface shadow-card transition-[transform,border-color,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised">
    <div aria-hidden className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    <Link
      to={projectPath(project.id)}
      className="flex h-full flex-col rounded-card p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <div className="flex items-start gap-3">
        <Initials value={project.name} size="md" />
        <span className="min-w-0 flex-1">
          <h3 className="truncate text-[15.5px] font-semibold tracking-[-0.02em] text-ink">
            {project.name}
          </h3>
          <p className="truncate font-mono text-[11px] text-ink-subtle">{project.fullName}</p>
        </span>
        <Badge tone={project.isPrivate ? 'neutral' : 'info'} icon={project.isPrivate ? Lock : undefined}>
          {project.isPrivate ? 'Private' : 'Public'}
        </Badge>
      </div>

      <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
        {project.description ?? 'No description on GitHub.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px] font-medium text-ink-muted">
        {project.language ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-info-dot ring-2 ring-info-dot/20" />
            {project.language}
          </span>
        ) : null}
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate font-mono font-normal">{project.defaultBranch ?? '—'}</span>
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <Star className="size-3" />
          {project.stars}
        </span>
        {project.webApplication ? (
          <span className="flex items-center gap-1.5 text-brand">
            <Globe className="size-3" />
            Web app
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3.5 text-[11.5px] text-ink-subtle">
        <span className="pt-0">Added {formatDate(project.addedAt)}</span>
        <ArrowUpRight className="size-3.5 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
      </div>
    </Link>
  </article>
);

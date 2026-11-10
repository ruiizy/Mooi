import { Check } from 'lucide-react';
import type { GithubRepository } from '@/features/github/types/GithubRepository';
import { Button } from '@/shared/components/Button';
import { Initials } from '@/shared/components/Initials';
import { cn } from '@/shared/utils/cn';
import { formatDate } from '@/shared/utils/formatDate';

interface RepositoryRowProps {
  repository: GithubRepository;
  added: boolean;
  onSelect: () => void;
}

export const RepositoryRow = ({ repository, added, onSelect }: RepositoryRowProps) => {
  const shortName = repository.name || repository.fullName.split('/')[1] || repository.fullName;
  const meta = [
    repository.description,
    repository.language,
    repository.pushedAt ? `updated ${formatDate(repository.pushedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-control px-2.5 py-2.5 transition',
        added ? 'bg-surface-2' : 'hover:bg-surface-2',
      )}
    >
      <Initials value={shortName} size="md" />

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{shortName}</span>
          <span className="shrink-0 text-[9px] font-extrabold tracking-[0.06em] text-ink-subtle uppercase">
            {repository.isPrivate ? 'Private' : 'Public'}
          </span>
        </p>
        {meta ? <p className="mt-0.5 truncate text-[11px] text-ink-subtle">{meta}</p> : null}
      </div>

      <span className="shrink-0">
        {added ? (
          <span className="inline-flex items-center gap-1.5 rounded-control bg-success-soft px-3 py-2 text-[13px] font-bold text-success">
            <Check className="size-3.5" />
            In your workspace
          </span>
        ) : (
          <Button variant="brand" size="sm" onClick={onSelect}>
            Add
          </Button>
        )}
      </span>
    </li>
  );
};

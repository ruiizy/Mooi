import { ArrowLeft } from 'lucide-react';
import type { GithubRepository } from '@/features/github/types/GithubRepository';
import { ProjectKindField } from '@/features/projects/components/ProjectKindField';
import { Initials } from '@/shared/components/Initials';

interface ProjectKindStepProps {
  repository: GithubRepository;
  webApplication: boolean | null;
  onChange: (webApplication: boolean) => void;
  onBack: () => void;
}

/**
 * The second step of adding a repository. Nothing is preselected on purpose: whether deploy and
 * preview make sense is the player's call, and a default would be answered without being read.
 */
export const ProjectKindStep = ({ repository, webApplication, onChange, onBack }: ProjectKindStepProps) => {
  const shortName = repository.name || repository.fullName.split('/')[1] || repository.fullName;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 py-2.5 pr-2.5 pl-3">
        <Initials value={shortName} size="md" className="bg-surface" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{shortName}</p>
          <p className="truncate font-mono text-[11px] text-ink-subtle">{repository.fullName}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-2 text-[12px] font-bold text-ink-muted transition hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <ArrowLeft className="size-3.5" />
          Change
        </button>
      </div>

      <ProjectKindField
        value={webApplication}
        onChange={onChange}
        hint="Deploy and live preview are only offered for web applications. You can change this later by editing the project."
      />
    </div>
  );
};

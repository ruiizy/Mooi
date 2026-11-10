import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, FolderGit2 } from 'lucide-react';
import type { Project } from '@/features/projects/types/Project';
import { Button } from '@/shared/components/Button';
import { SearchInput } from '@/shared/components/SearchInput';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import { formatCount } from '@/shared/utils/formatCount';

interface TodoProjectFilterProps {
  projects: Project[];
  selectedIds: Set<string>;
  onChange: (projectIds: string[] | null) => void;
}

export const TodoProjectFilter = ({ projects, selectedIds, onChange }: TodoProjectFilterProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const selectedCount = projects.filter((project) => selectedIds.has(project.id)).length;
  const term = query.trim().toLowerCase();
  const matches = projects.filter((project) => project.fullName.toLowerCase().includes(term));

  useOnClickOutside(root, () => setOpen(false), open);
  useOnEscape(() => {
    setOpen(false);
    trigger.current?.focus();
  }, open);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('input, button')?.focus();
    else setQuery('');
  }, [open]);

  const toggle = (projectId: string) => {
    const next = new Set(selectedIds);
    if (!next.delete(projectId)) next.add(projectId);
    onChange([...next]);
  };

  return (
    <div ref={root} className="relative min-w-0" onBlur={(event) => {
      // Clicking label text or the scrollbar can blur with no next focus target.
      // Let the native label toggle its checkbox; outside pointer clicks close separately.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)} className={buttonStyles('secondary', 'sm')}>
        <FolderGit2 className="size-4 shrink-0" />
        Projects
        <span className="font-mono text-xs text-ink-muted tabular-nums">{formatCount(selectedCount)}/{formatCount(projects.length)}</span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div ref={panel} id={panelId} role="group" aria-label="Projects to show"
          className="absolute top-full left-0 z-40 mt-2 flex max-h-[min(24rem,60dvh)] w-[min(21rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
            <p className="text-sm font-semibold text-ink">Projects to show</p>
            <SearchInput value={query} onChange={setQuery} placeholder="Find a project" />
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Select all</Button>
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>Clear selection</Button>
            </div>
          </div>
          <div className="min-h-0 max-h-[min(15rem,35dvh)] flex-1 overflow-y-auto overscroll-contain p-1">
            {matches.map((project) => (
              <label key={project.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2 focus-within:bg-surface-2">
                <input type="checkbox" checked={selectedIds.has(project.id)} onChange={() => toggle(project.id)}
                  className="size-4 shrink-0 accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{project.name}</span>
                  <span className="block truncate text-xs text-ink-subtle">{project.fullName}</span>
                </span>
              </label>
            ))}
            {matches.length === 0 ? <p className="px-3 py-4 text-sm text-ink-muted">No matching projects.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

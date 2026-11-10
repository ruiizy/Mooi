import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FolderPlus, Plus } from 'lucide-react';
import type { Project } from '@/features/projects/types/Project';
import { Initials } from '@/shared/components/Initials';
import { useAnchoredPlacement } from '@/shared/hooks/useAnchoredPlacement';

interface ProjectSelectProps {
  projects: Project[];
  value: string | null;
  onChange: (projectId: string) => void;
  /** Import an existing GitHub repository; omitted when GitHub is not linked. */
  onImport?: () => void;
  /** Create a new repository; omitted when GitHub is not linked. */
  onCreate?: () => void;
}

const ROW = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-surface-2 focus:bg-surface-2';

/**
 * Project picker for dialogs: the panel is portaled to the dialog so no scroll container clips it,
 * and it ends with the ways to add a project without leaving the flow.
 */
export const ProjectSelect = ({ projects, value, onChange, onImport, onCreate }: ProjectSelectProps) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const placement = useAnchoredPlacement(open, root, 320);
  const listId = useId();
  const selected = projects.find((project) => project.id === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const items = () => Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);

  const openAt = (edge: 'selected' | 'first' | 'last') => {
    setOpen(true);
    requestAnimationFrame(() => {
      const all = items();
      const target = edge === 'last' ? all.at(-1)
        : edge === 'selected' ? popup.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? all[0] : all[0];
      target?.focus();
    });
  };

  const closeAndFocus = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const choose = (action: () => void) => () => {
    closeAndFocus();
    action();
  };

  const navigate = (event: KeyboardEvent) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % all.length : event.key === 'ArrowUp' ? (index - 1 + all.length) % all.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : null;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (next !== null) {
      event.preventDefault();
      all[next]?.focus();
    }
  };

  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-label="Project" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      onClick={() => (open ? setOpen(false) : openAt('selected'))}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openAt(event.key === 'ArrowDown' ? 'first' : 'last');
        }
      }}
      className="flex w-full items-center gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5 text-left outline-none transition hover:border-line-strong focus-visible:border-brand">
      {selected ? <Initials value={selected.name} size="sm" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{selected ? selected.name : 'Select a project'}</span>
        <span className="block truncate text-xs text-ink-subtle">{selected ? selected.fullName : `${projects.length} in your workspace`}</span>
      </span>
      <ChevronDown className={`size-4 shrink-0 text-ink-muted transition ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && createPortal(<div ref={popup} onKeyDown={navigate}
      style={{ position: 'fixed', top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}
      className="z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
      <div id={listId} role="listbox" aria-label="Projects" className="min-h-0 overflow-y-auto overscroll-contain p-1">
        {projects.length === 0 ? <p className="px-3 py-2.5 text-sm text-ink-muted">No projects yet. Add one below.</p> : null}
        {projects.map((project) => <button key={project.id} type="button" role="option" aria-selected={project.id === value}
          onClick={choose(() => onChange(project.id))} className={ROW}>
          <Initials value={project.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{project.name}</span>
            <span className="block truncate text-xs text-ink-subtle">{project.fullName}</span>
          </span>
          {project.id === value && <Check className="size-4 shrink-0 text-brand" />}
        </button>)}
      </div>
      {onImport || onCreate ? <div className="shrink-0 border-t border-line p-1">
        {onImport ? <button type="button" onClick={choose(onImport)} className={`${ROW} text-sm font-bold text-ink`}>
          <Plus className="size-4 shrink-0 text-ink-muted" />Add repository</button> : null}
        {onCreate ? <button type="button" onClick={choose(onCreate)} className={`${ROW} text-sm font-bold text-ink`}>
          <FolderPlus className="size-4 shrink-0 text-ink-muted" />Create project</button> : null}
      </div> : null}
    </div>, root.current?.closest('dialog') ?? document.body)}
  </div>;
};

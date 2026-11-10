import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import type { ChangeKind } from '@/features/sessions/types/ChangeKind';
import type { FileTreeRow } from '@/features/sessions/types/FileTreeRow';
import { cn } from '@/shared/utils/cn';

interface FileTreeItemProps {
  row: FileTreeRow;
  selected: boolean;
  /** The file has unsaved edits. */
  unsaved: boolean;
  /** How the file differs from the branch base, when it does. */
  change?: ChangeKind;
  /** Folder of the file, shown after its name in search results where the tree gives no context. */
  detail?: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

const changeTone: Record<ChangeKind, string> = {
  added: 'text-success',
  modified: 'text-info',
  deleted: 'text-danger',
  renamed: 'text-warning',
};

const INDENT_PX = 14;

export const FileTreeItem = ({ row, selected, unsaved, change, detail, onSelect, onToggle }: FileTreeItemProps) => {
  const directory = row.kind === 'directory';
  const Icon = directory ? (row.expanded ? FolderOpen : Folder) : FileText;

  return (
    <li>
      <button
        type="button"
        onClick={() => (directory ? onToggle(row.path) : onSelect(row.path))}
        aria-expanded={directory ? row.expanded : undefined}
        aria-current={selected ? 'true' : undefined}
        title={row.path}
        style={{ paddingLeft: `${8 + row.depth * INDENT_PX}px` }}
        className={cn(
          'flex min-h-10 w-full items-center gap-1.5 rounded-chip pr-2 text-left transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand lg:min-h-7',
          selected ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 shrink-0 text-ink-subtle transition-transform', directory ? row.expanded && 'rotate-90' : 'invisible')}
        />
        <Icon aria-hidden className={cn('size-4 shrink-0', directory ? 'text-accent' : 'text-ink-subtle')} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {row.name}
          {detail ? <span className="ml-2 text-[10px] text-ink-subtle">{detail}</span> : null}
        </span>
        {unsaved ? <span role="img" aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
        {change ? <span role="img" aria-label={`File ${change}`} className={cn('size-1.5 shrink-0 rounded-full bg-current', changeTone[change])} /> : null}
      </button>
    </li>
  );
};

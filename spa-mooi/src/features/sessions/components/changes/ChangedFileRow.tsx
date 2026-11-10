import type { ChangeKind } from '@/features/sessions/types/ChangeKind';
import type { ChangedFile } from '@/features/sessions/types/ChangedFile';
import { FloatingTooltip } from '@/shared/components/FloatingTooltip';
import { cn } from '@/shared/utils/cn';

interface ChangedFileRowProps {
  file: ChangedFile;
  selected: boolean;
  onSelect: (path: string) => void;
}

const letters: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const letterStyles: Record<ChangeKind, string> = {
  added: 'bg-success-soft text-success',
  modified: 'bg-info-soft text-info',
  deleted: 'bg-danger-soft text-danger',
  renamed: 'bg-warning-soft text-warning',
};

export const ChangedFileRow = ({ file, selected, onSelect }: ChangedFileRowProps) => {
  const separator = file.path.lastIndexOf('/');
  const directory = separator === -1 ? '' : file.path.slice(0, separator);
  const filename = separator === -1 ? file.path : file.path.slice(separator + 1);

  return (
    <li>
      <FloatingTooltip content={file.path}>
      <button
        type="button"
        onClick={() => onSelect(file.path)}
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-chip px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
          selected ? 'bg-surface-3 text-ink' : 'hover:bg-surface-2',
        )}
      >
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold',
            letterStyles[file.change],
          )}
        >
          {letters[file.change]}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono">
          <span className="truncate text-xs font-medium text-ink">{filename}</span>
          {directory ? <span className="truncate text-[10px] text-ink-subtle">{directory}</span> : null}
        </span>

        <span className="shrink-0 font-mono text-[10px] font-medium text-success">+{file.added}</span>
        <span className="shrink-0 font-mono text-[10px] font-medium text-danger">−{file.removed}</span>
      </button>
      </FloatingTooltip>
    </li>
  );
};

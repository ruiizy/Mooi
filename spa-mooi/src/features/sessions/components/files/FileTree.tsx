import { useMemo } from 'react';
import { fileTreeRows } from '@/features/sessions/lib/fileTreeRows';
import { FileTreeItem } from '@/features/sessions/components/files/FileTreeItem';
import type { ChangeKind } from '@/features/sessions/types/ChangeKind';
import type { FileTreeRow } from '@/features/sessions/types/FileTreeRow';
import { useIncrementalCount } from '@/shared/hooks/useIncrementalCount';

interface FileTreeProps {
  paths: string[];
  /** Filters to the files whose path contains this text, listed flat. */
  query: string;
  open: ReadonlySet<string>;
  selectedPath: string | null;
  unsaved: ReadonlySet<string>;
  changes: ReadonlyMap<string, ChangeKind>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

const MATCH_STEP = 200;

const matchRow = (path: string): FileTreeRow => {
  const separator = path.lastIndexOf('/');
  return { kind: 'file', path, name: separator === -1 ? path : path.slice(separator + 1), depth: 0, expanded: false };
};

export const FileTree = ({ paths, query, open, selectedPath, unsaved, changes, onSelect, onToggle }: FileTreeProps) => {
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => needle
      ? paths.filter((path) => path.toLowerCase().includes(needle)).map(matchRow)
      : fileTreeRows(paths, (directory) => open.has(directory)),
    [needle, open, paths],
  );
  // Only what the reader has scrolled to is rendered, so a repository of any size opens instantly.
  const { count, more, sentinel } = useIncrementalCount(rows.length, MATCH_STEP);

  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-ink-muted">{needle ? 'No file matches this search.' : 'This workspace has no files yet.'}</p>;
  }

  return (
    <ul className="p-1.5">
      {rows.slice(0, count).map((row) => {
        const separator = row.path.lastIndexOf('/');
        return (
          <FileTreeItem
            key={`${row.kind}:${row.path}`}
            row={row}
            selected={row.path === selectedPath}
            unsaved={unsaved.has(row.path)}
            change={changes.get(row.path)}
            detail={needle && separator !== -1 ? row.path.slice(0, separator) : undefined}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        );
      })}
      {more ? <li ref={sentinel} aria-hidden="true" className="h-px" /> : null}
    </ul>
  );
};

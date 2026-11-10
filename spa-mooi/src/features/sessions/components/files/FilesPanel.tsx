import { useCallback, useMemo, useState } from 'react';
import { FileCode2, FolderTree, RotateCw } from 'lucide-react';
import { FileEditor } from '@/features/sessions/components/files/FileEditor';
import { FileTree } from '@/features/sessions/components/files/FileTree';
import { useSessionFiles } from '@/features/sessions/hooks/useSessionFiles';
import { ancestorDirectories } from '@/features/sessions/lib/fileTreeRows';
import type { ChangeKind } from '@/features/sessions/types/ChangeKind';
import { Button } from '@/shared/components/Button';
import { EmptyState } from '@/shared/components/EmptyState';
import { SearchInput } from '@/shared/components/SearchInput';
import { useSessionsStore } from '@/stores/sessionsStore';
import { cn } from '@/shared/utils/cn';

interface FilesPanelProps {
  sessionId: string;
  /** The tab is on screen; the panel stays mounted once visited so drafts survive tab switches. */
  active: boolean;
}

/**
 * Project view of the session's working tree: a folder tree beside a plain-text editor on desktop,
 * the same two screens one after the other on a phone. Saving writes into the session's workspace,
 * so edits flow into the Changes tab and the merge like the agent's own.
 */
export const FilesPanel = ({ sessionId, active }: FilesPanelProps) => {
  const { files, error, retry } = useSessionFiles(sessionId, active);
  const changed = useSessionsStore((state) => state.byId[sessionId]?.changes?.files);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});

  const changeKinds = useMemo(
    () => new Map<string, ChangeKind>((changed ?? []).map((file) => [file.path, file.change])),
    [changed],
  );
  const unsaved = useMemo(() => new Set(Object.keys(drafts)), [drafts]);

  const toggle = useCallback((directory: string) => setOpen((current) => {
    const next = new Set(current);
    if (!next.delete(directory)) next.add(directory);
    return next;
  }), []);

  const select = useCallback((path: string) => {
    setSelectedPath(path);
    setReading(true);
    setOpen((current) => new Set([...current, ...ancestorDirectories(path)]));
  }, []);

  const setDraft = useCallback((path: string, text: string | undefined) => setDrafts((current) => {
    if (text === undefined) {
      const { [path]: _discarded, ...rest } = current;
      return rest;
    }
    return { ...current, [path]: text };
  }), []);

  // A file deleted from the branch no longer has an editor to show.
  const present = selectedPath !== null && (files?.paths.includes(selectedPath) ?? true);
  const current = present ? selectedPath : null;

  if (error && !files) {
    return (
      <div className="flex h-full items-center justify-center bg-surface px-4">
        <div role="alert" className="flex flex-col items-center gap-3 text-center text-sm text-danger">
          <p>{error}</p>
          <Button variant="danger" size="sm" onClick={retry}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!files) {
    return <p className="bg-surface p-6 text-sm text-ink-muted">Loading files…</p>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-1 bg-surface lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className={cn('flex min-h-0 min-w-0 flex-col lg:border-r lg:border-line', reading && current && 'max-lg:hidden')}>
        <div className="shrink-0 border-b border-line p-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search files" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <FileTree
            paths={files.paths}
            query={query}
            open={open}
            selectedPath={current}
            unsaved={unsaved}
            changes={changeKinds}
            onSelect={select}
            onToggle={toggle}
          />
          {files.truncated ? <p className="px-3 pb-4 text-center text-xs text-ink-subtle">Showing the first {files.paths.length.toLocaleString('en')} files.</p> : null}
        </div>
      </div>

      <div className={cn('min-h-0 min-w-0', !(reading && current) && 'max-lg:hidden')}>
        {current ? (
          <FileEditor
            key={current}
            sessionId={sessionId}
            path={current}
            draft={drafts[current]}
            active={active}
            onDraft={setDraft}
            onBack={() => setReading(false)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4">
            <EmptyState
              icon={files.paths.length === 0 ? FolderTree : FileCode2}
              title={files.paths.length === 0 ? 'No files yet' : 'Pick a file'}
              description={files.paths.length === 0
                ? 'Once this workspace has files, you can browse and edit them here.'
                : 'Open a file from the tree to read it, edit it and save it into this session.'}
            />
          </div>
        )}
      </div>
    </div>
  );
};

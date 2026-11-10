import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileWarning, LoaderCircle, RotateCcw, RotateCw, Save } from 'lucide-react';
import { saveSessionFile } from '@/features/sessions/api/sessionsApi';
import { useOpenFile } from '@/features/sessions/hooks/useOpenFile';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/utils/cn';

interface FileEditorProps {
  sessionId: string;
  path: string;
  /** Unsaved text for this file, kept by the panel so switching files never loses it. */
  draft: string | undefined;
  active: boolean;
  onDraft: (path: string, text: string | undefined) => void;
  onBack: () => void;
}

/** Past this many lines the line-number gutter is dropped: the editor stays smooth on huge files. */
const GUTTER_MAX_LINES = 20_000;

const unreadable = {
  binary: 'Binary file — it has no plain-text view.',
  too_large: 'This file is too large to open here.',
} as const;

export const FileEditor = ({ sessionId, path, draft, active, onDraft, onBack }: FileEditorProps) => {
  const { file, latest, error, behind, adopt, reload } = useOpenFile(sessionId, path, active);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const text = file?.preview === 'text' ? file.content : '';
  const value = draft ?? text;
  const dirty = draft !== undefined && draft !== text;
  const lines = useMemo(() => (file?.preview === 'text' ? value.split('\n').length : 0), [file?.preview, value]);
  const numbers = useMemo(
    () => (lines > 0 && lines <= GUTTER_MAX_LINES ? Array.from({ length: lines }, (_, index) => index + 1).join('\n') : null),
    [lines],
  );

  // A newer revision from the branch (the agent edited the file) is taken over unless it would clobber edits.
  useEffect(() => {
    if (behind && !dirty) adopt();
  }, [adopt, behind, dirty]);

  const save = async () => {
    if (!file || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveSessionFile(sessionId, path, value, file.revision);
      adopt(saved);
      onDraft(path, undefined);
    } catch (failure) {
      setSaveError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setSaveError(null);
    onDraft(path, undefined);
  };

  const separator = path.lastIndexOf('/');
  const filename = separator === -1 ? path : path.slice(separator + 1);
  const directory = separator === -1 ? '' : path.slice(0, separator);
  const editable = file?.preview === 'text';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to files"
          className="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:hidden"
        >
          <ArrowLeft className="size-4.5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col font-mono" title={path}>
          <span className="flex items-center gap-1.5 truncate text-xs font-medium text-ink">
            {filename}
            {dirty ? <span role="img" aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
          </span>
          {directory ? <span className="truncate text-[10px] text-ink-subtle">{directory}</span> : null}
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || saving} ariaLabel="Discard unsaved changes">
              <RotateCcw className="size-3.5" />
              <span className="max-sm:hidden">Discard</span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save
            </Button>
          </div>
        ) : null}
      </div>

      {behind && dirty && latest ? (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <span className="min-w-0 flex-1">This file changed on the branch while you were editing.</span>
          <Button variant="secondary" size="sm" onClick={() => { discard(); adopt(); }}>Load latest</Button>
          <Button variant="secondary" size="sm" onClick={() => adopt()}>Keep mine</Button>
        </div>
      ) : null}
      {saveError ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1 break-words">{saveError}</span>
          <Button variant="danger" size="sm" onClick={() => { discard(); setSaveError(null); reload(); }}>Reload</Button>
        </div>
      ) : null}

      {error && !file ? (
        <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm text-danger">
          <p>{error}</p>
          <Button variant="danger" size="sm" onClick={reload}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      ) : !file ? (
        <p className="px-4 py-6 text-sm text-ink-muted">Opening file…</p>
      ) : file.preview !== 'text' ? (
        <p className="flex items-center gap-2 px-4 py-6 text-sm text-ink-muted">
          <FileWarning aria-hidden className="size-4 shrink-0" />
          {unreadable[file.preview]}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 font-mono text-base leading-5 sm:text-[13px]">
          {numbers ? (
            <div ref={gutter} aria-hidden className="scrollbar-none w-12 shrink-0 select-none overflow-hidden border-r border-line bg-surface-2 py-3 pr-2 text-right text-ink-subtle">
              <pre className="pb-8">{numbers}</pre>
            </div>
          ) : null}
          <textarea
            value={value}
            onChange={(event) => onDraft(path, event.target.value === text ? undefined : event.target.value)}
            onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void save();
              }
            }}
            aria-label={`Contents of ${path}`}
            wrap="off"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            className={cn('min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 text-ink [tab-size:2] focus:outline-none')}
          />
        </div>
      )}
    </div>
  );
};

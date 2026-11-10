import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Plus, Rocket, Tag } from 'lucide-react';
import { fetchProductionReleases } from '@/features/production/api/productionApi';
import { nextReleaseTag } from '@/features/production/lib/nextReleaseTag';
import { RELEASE_TAG_PATTERN } from '@/features/production/lib/releaseTagPattern';
import type { GithubRelease } from '@/features/production/types/GithubRelease';
import type { ReleaseChoice } from '@/features/production/types/ReleaseChoice';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { cn } from '@/shared/utils/cn';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';

interface ProductionReleaseDialogProps {
  projectId: string;
  defaultBranch: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSelect: (choice: ReleaseChoice) => void;
}

/** Production always deploys an immutable GitHub release: an existing one, or a new one from the default branch. */
export const ProductionReleaseDialog = ({ projectId, defaultBranch, busy, error, onClose, onSelect }: ProductionReleaseDialogProps) => {
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [selected, setSelected] = useState('');
  const [tag, setTag] = useState('');

  useEffect(() => {
    let active = true;
    fetchProductionReleases(projectId).then((items) => {
      if (!active) return;
      setReleases(items);
      setSelected(items[0]?.tag ?? '');
      setTag(nextReleaseTag(items[0]?.tag));
      if (items.length === 0) setMode('create');
    }).catch((failure: Error) => { if (active) setLoadError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const choice: ReleaseChoice = mode === 'existing' ? { tag: selected, create: false } : { tag: tag.trim(), create: true };
  const valid = choice.tag.length > 0 && (mode === 'existing' || RELEASE_TAG_PATTERN.test(choice.tag));
  const modes = [
    { id: 'existing' as const, icon: Tag, title: 'Existing release', hint: `${releases.length} published`, disabled: releases.length === 0 },
    { id: 'create' as const, icon: Plus, title: 'New release', hint: `From ${defaultBranch ?? 'the default branch'}`, disabled: false },
  ];

  return <Modal open onClose={busy ? () => undefined : onClose} title="Deploy a release"
    description="Production always runs an immutable GitHub release. Redeploy a published version or publish a new one."
    footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="brand" disabled={!valid || busy || loading} onClick={() => onSelect(choice)}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Rocket className="size-4" />}
        {busy ? 'Starting…' : mode === 'create' ? 'Publish' : 'Deploy'}
      </Button></>}>
    <div role="radiogroup" aria-label="Release source" className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1">
      {modes.map(({ id, icon: Icon, title, hint, disabled }) => <button key={id} type="button" role="radio" aria-checked={mode === id}
        disabled={disabled || busy} onClick={() => setMode(id)}
        className={cn('flex min-w-0 items-center gap-2.5 rounded-control px-3 py-2.5 text-left transition disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-brand',
          mode === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}>
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0"><span className="block truncate text-sm font-bold">{title}</span>
          <span className="block truncate text-[11px] text-ink-subtle">{hint}</span></span>
      </button>)}
    </div>

    {loading ? <p className="mt-5 flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle className="size-4 animate-spin" />Loading releases…</p>
      : mode === 'existing' ? <ul role="radiogroup" aria-label="Published releases" className="mt-5 flex max-h-[min(18rem,40dvh)] flex-col gap-1.5 overflow-y-auto overscroll-contain">
        {releases.map((release) => <li key={release.tag}>
          <button type="button" role="radio" aria-checked={selected === release.tag} disabled={busy} onClick={() => setSelected(release.tag)}
            className={cn('flex w-full items-center gap-3 rounded-control border px-3.5 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-brand',
              selected === release.tag ? 'border-ink bg-surface' : 'border-line hover:bg-surface-2')}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm font-bold text-ink">{release.tag}</span>
              <span className="block truncate text-xs text-ink-muted">{release.name !== release.tag ? `${release.name} · ` : ''}
                {release.publishedAt ? `Published ${formatRelativeTime(release.publishedAt)}` : 'Published'}</span>
            </span>
            {selected === release.tag ? <Check className="size-4 shrink-0 text-ink" /> : null}
          </button>
        </li>)}
      </ul> : <label className="mt-5 flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-muted">Version</span>
        <input autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} value={tag} onChange={(event) => setTag(event.target.value)} disabled={busy}
          placeholder="v1.0.0" aria-invalid={tag.length > 0 && !valid}
          className="h-11 rounded-control border border-line bg-surface-2 px-3 font-mono text-sm text-ink outline-none focus:border-brand/50" />
        <span className="text-xs text-ink-subtle">Published on GitHub from the latest {defaultBranch ?? 'default branch'} commit when the deployment starts.</span>
      </label>}
    {loadError || error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error ?? loadError}</p> : null}
  </Modal>;
};

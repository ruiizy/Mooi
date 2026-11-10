import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';

interface AddRecipeMarketplaceDialogProps {
  busy: boolean;
  actionError: string | null;
  onClose: () => void;
  onAdd: (url: string) => Promise<boolean>;
}

export const AddRecipeMarketplaceDialog = ({ busy, actionError, onClose, onAdd }: AddRecipeMarketplaceDialogProps) => {
  const [url, setUrl] = useState('');
  const submit = () => {
    if (!url.trim() || busy) return;
    void onAdd(url.trim()).then((added) => { if (added) onClose(); });
  };

  return (
    <Modal open onClose={onClose} title="Add recipe marketplace"
      description="Link a GitHub repository your account can read, public or private, with a recipes folder of Markdown recipes."
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="brand" type="submit" form="add-recipe-marketplace" disabled={busy || !url.trim()}>
          {busy ? 'Checking repository…' : 'Add marketplace'}
        </Button>
      </>}>
      <form id="add-recipe-marketplace" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-ink-muted">Repository URL <span className="text-danger">*</span></span>
          <span className="flex h-12 items-center gap-2 rounded-control border border-line bg-surface-2 px-3 focus-within:border-brand">
            <Link2 className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <input value={url} onChange={(event) => setUrl(event.target.value)} maxLength={512} required autoFocus
              inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://github.com/owner/agent-recipes"
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle" />
          </span>
        </label>
        <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-xs leading-relaxed text-ink-muted">
          <p className="font-semibold text-ink">Expected layout</p>
          <pre className="mt-2 font-mono text-[11px] text-ink-subtle">{'recipes/\n  google_sso_login.md\n  rate_limiting.md'}</pre>
          <p className="mt-2">Each recipe starts with a front matter holding its <code>name</code> and <code>description</code>.</p>
        </div>
        {actionError ? <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{actionError}</p> : null}
      </form>
    </Modal>
  );
};

import { useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, LoaderCircle, Sparkles } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';

interface DeploymentSetupDialogProps {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (instructions: string) => void;
}

const SUGGESTIONS = ['Add a Redis cache service', 'Seed the database with demo data', 'Serve the API under /api'];

/** Asks what should change in the session's deployment; Enter submits, Shift+Enter breaks lines. */
export const DeploymentSetupDialog = ({ busy, error, onClose, onSubmit }: DeploymentSetupDialogProps) => {
  const [instructions, setInstructions] = useState('');
  const valid = instructions.trim().length > 0;

  const submit = () => {
    if (valid && !busy) onSubmit(instructions.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return <Modal open size="lg" onClose={busy ? () => undefined : onClose} title="Change deployment setup"
    description="The chat is cleared and the agent updates the deployment files with your request, then tests them."
    footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="brand" onClick={submit} disabled={!valid || busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? 'Starting…' : 'Start update'}
      </Button>
    </>}>
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-muted">What should change?</span>
        <div className="rounded-xl border border-line bg-surface-2 transition focus-within:border-brand/50">
          <textarea autoFocus rows={5} value={instructions} disabled={busy} onChange={(event) => setInstructions(event.target.value)}
            onKeyDown={onKeyDown} maxLength={20000}
            placeholder="For example: add a worker service, expose the admin panel instead of the landing page, use Postgres 17…"
            className="block min-h-32 w-full resize-y bg-transparent p-3.5 text-sm leading-6 text-ink placeholder:text-ink-subtle focus:outline-none disabled:opacity-60" />
          <div className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2 text-[11px] text-ink-subtle">
            <span className="inline-flex items-center gap-1.5"><CornerDownLeft className="size-3.5" />Enter to start · Shift+Enter for a new line</span>
            <span className="tabular-nums">{instructions.length > 0 ? instructions.length : ''}</span>
          </div>
        </div>
        {instructions.length === 0 ? <div className="flex flex-wrap gap-2 pt-1">
          {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => setInstructions(suggestion)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
            {suggestion}
          </button>)}
        </div> : null}
      </label>
      {error ? <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p> : null}
    </div>
  </Modal>;
};

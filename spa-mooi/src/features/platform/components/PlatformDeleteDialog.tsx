import { useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';

interface PlatformDeleteDialogProps {
  title: string;
  description: string;
  /** What stays and what goes, one line each. */
  consequences: string[];
  action: string;
  remove: () => Promise<unknown>;
  onClose: () => void;
  onDeleted: () => void;
}

/** Confirms removing a stored platform configuration and its variables. */
export const PlatformDeleteDialog = ({ title, description, consequences, action, remove, onClose, onDeleted }: PlatformDeleteDialogProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true); setError(null);
    try { await remove(); onDeleted(); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  };

  return <Modal open onClose={busy ? () => undefined : onClose} title={title} description={description}
    footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{busy ? 'Deleting…' : action}
      </Button></>}>
    <ul className="flex flex-col gap-2 text-sm leading-relaxed text-ink-muted">
      {consequences.map((line) => <li key={line}>{line}</li>)}
    </ul>
    {error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p> : null}
  </Modal>;
};

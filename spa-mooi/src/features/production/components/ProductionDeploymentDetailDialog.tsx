import { useEffect, useState } from 'react';
import { LoaderCircle, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { fetchProductionDeploymentDetail } from '@/features/production/api/productionHistoryApi';
import { PRODUCTION_DOCUMENTS } from '@/features/production/lib/productionDocuments';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import type { ProductionDeploymentDetail } from '@/features/production/types/ProductionDeploymentDetail';
import type { ProductionFiles } from '@/features/production/types/ProductionFiles';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { cn } from '@/shared/utils/cn';
import { formatDate } from '@/shared/utils/formatDate';
import { formatDuration } from '@/shared/utils/formatDuration';
import { formatTime } from '@/shared/utils/formatTime';

interface ProductionDeploymentDetailDialogProps {
  deployment: ProductionDeployment;
  projectName: string;
  onClose: () => void;
  onRedeploy?: () => void;
  onFix?: () => void;
  onDelete?: () => Promise<void>;
}

/** One recorded attempt: its result, the exact files it ran and its redacted output. */
export const ProductionDeploymentDetailDialog = ({ deployment, projectName, onClose, onRedeploy, onFix, onDelete }: ProductionDeploymentDetailDialogProps) => {
  const [detail, setDetail] = useState<ProductionDeploymentDetail | null>(null);
  const [selected, setSelected] = useState<keyof ProductionFiles | 'output'>('output');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchProductionDeploymentDetail(deployment.projectId, deployment.operationId)
      .then((result) => { if (active) setDetail(result); })
      .catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [deployment.projectId, deployment.operationId]);

  const remove = async () => {
    if (!onDelete) return;
    setDeleting(true); setError(null);
    try { await onDelete(); }
    catch (failure) { setError((failure as Error).message); setDeleting(false); }
  };

  const files = detail?.files;
  const tabs = [{ id: 'output' as const, label: 'Output' },
    ...PRODUCTION_DOCUMENTS.filter(({ key }) => Boolean(files?.[key])).map(({ key, name }) => ({ id: key, label: name }))];
  const content = selected === 'output' ? (detail?.logs.join('\n') || 'No output was recorded.') : files?.[selected] ?? '';
  const finished = deployment.finishedAt;

  return <Modal open size="lg" onClose={deleting ? () => undefined : onClose} title={`${deployment.releaseTag} · ${projectName}`}
    description={`${formatDate(deployment.startedAt)} at ${formatTime(deployment.startedAt)}${finished ? ` · took ${formatDuration(deployment.startedAt, finished)}` : ''}`}
    footer={onDelete && deployment.state !== 'running' ? confirmDelete ? <>
      <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep it</Button>
      <Button variant="danger" onClick={() => void remove()} disabled={deleting}>
        {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Delete saved data</Button>
    </> : <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-danger sm:mr-auto">
      <Trash2 className="size-4" />Delete from history</Button> : undefined}>
    <div className="flex flex-wrap items-center gap-2">
      <DeploymentStateBadge state={deployment.state} />
      {detail?.message ? <p className="min-w-0 flex-1 text-sm text-ink-muted">{detail.message}</p> : null}
      <div className="flex gap-2">
        {onFix && deployment.state === 'failed' ? <Button variant="secondary" size="sm" onClick={onFix}><Sparkles className="size-4" />Fix with agent</Button> : null}
        {onRedeploy && deployment.state !== 'running' ? <Button variant="secondary" size="sm" onClick={onRedeploy}><RotateCcw className="size-4" />Redeploy</Button> : null}
      </div>
    </div>
    {confirmDelete ? <p className="mt-4 rounded-control bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
      Removes this entry, its files and its output from Mooi. The deployed service and the current configuration stay in place.</p> : null}

    {error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>
      : !detail ? <p className="mt-5 flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle className="size-4 animate-spin" />Loading deployment…</p>
        : <div className="mt-5">
          <div role="tablist" aria-label="Deployment content" className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={selected === tab.id} onClick={() => setSelected(tab.id)}
              className={cn('rounded-lg px-3 py-1.5 font-mono text-xs font-bold transition',
                selected === tab.id ? 'bg-contrast text-contrast-ink' : 'bg-surface-2 text-ink-muted hover:text-ink')}>{tab.label}</button>)}
          </div>
          <pre role="tabpanel" className={cn('mt-3 max-h-[45dvh] overflow-auto rounded-xl p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-all',
            selected === 'output' ? 'bg-neutral-950 text-neutral-100' : 'border border-line bg-surface-2 text-ink')}>{content}</pre>
          {!files ? <p className="mt-3 text-xs text-ink-subtle">This attempt predates saved file snapshots.</p> : null}
        </div>}
  </Modal>;
};

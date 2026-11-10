import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, FolderTree, GitCompareArrows, MessagesSquare, Monitor } from 'lucide-react';
import { PreviewPanel } from './preview/PreviewPanel';
import { Tabs } from '@/shared/components/Tabs';
import type { TabItem } from '@/shared/types/TabItem';
import { DeployLogsDrawer } from './deploy/DeployLogsDrawer';
import { deploymentConsoleHidden } from '@/features/sessions/lib/deploymentConsoleHidden';
import { useSessionsStore } from '@/stores/sessionsStore';
import { cn } from '@/shared/utils/cn';

const ChangesPanel = lazy(() => import('./changes/ChangesPanel').then((module) => ({ default: module.ChangesPanel })));
const FilesPanel = lazy(() => import('./files/FilesPanel').then((module) => ({ default: module.FilesPanel })));
const TracePanel = lazy(() => import('@/features/traces/components/TracePanel').then((module) => ({ default: module.TracePanel })));

interface SessionWorkspaceProps {
  sessionId: string;
  /** False for projects that are not web applications: no preview tab, no deployment logs. */
  deployEnabled: boolean;
  children: ReactNode;
}

export const SessionWorkspace = ({ sessionId, deployEnabled, children }: SessionWorkspaceProps) => {
  const pane = useSessionsStore((state) => state.byId[sessionId]?.pane ?? 'conversation');
  const setPane = useSessionsStore((state) => state.setPane);
  const logOpen = useSessionsStore((state) => state.byId[sessionId]?.deploymentLogOpen ?? false);
  const [visitedOperation, setVisitedOperation] = useState<string | null>(null);
  const [filesVisited, setFilesVisited] = useState(false);
  const [traceVisited, setTraceVisited] = useState(false);
  const changes = useSessionsStore((state) => state.byId[sessionId]?.changes);
  const session = useSessionsStore((state) => state.sessions.find((item) => item.id === sessionId));
  const deployment = session?.deployment;
  const setup = session?.deploymentSetup ?? null;
  const consoleHidden = session ? deploymentConsoleHidden(session) : false;
  const setupStart = useRef<string | null>(null);
  const openedOperation = useSessionsStore((state) => state.byId[sessionId]?.previewOpenedOperationId);
  const operationId = deployment?.operationId;
  const running = deployEnabled && deployment?.state === 'running';
  const hasPreview = deployEnabled && Boolean(operationId);

  useEffect(() => () => useSessionsStore.getState().setDeploymentLogOpen(sessionId, false), [sessionId]);

  useEffect(() => {
    if (running && operationId && openedOperation !== operationId) {
      useSessionsStore.getState().markPreviewOpened(sessionId, operationId);
      setVisitedOperation(operationId);
      setPane(sessionId, 'preview');
    }
  }, [running, operationId, openedOperation, sessionId, setPane]);

  // A setup brings the chat to the front; its test start shows the preview, the console stays one click away.
  useEffect(() => {
    if (setup !== 'preparing') {
      setupStart.current = null;
      return;
    }
    const store = useSessionsStore.getState();
    if (setupStart.current === null) {
      setupStart.current = '';
      setPane(sessionId, 'conversation');
      store.setDeploymentLogOpen(sessionId, false);
    }
    if (deployment?.state === 'starting' && operationId && setupStart.current !== operationId) {
      setupStart.current = operationId;
      setPane(sessionId, 'preview');
    }
  }, [setup, deployment?.state, operationId, sessionId, setPane]);

  const selectPane = (id: string) => {
    if (id !== 'conversation' && id !== 'changes' && id !== 'files' && id !== 'preview' && id !== 'trace') return;
    setPane(sessionId, id);
    if (id === 'files') setFilesVisited(true);
    if (id === 'trace') setTraceVisited(true);
    if (id === 'preview' && running && operationId) setVisitedOperation(operationId);
  };

  const items: TabItem[] = [
    { id: 'conversation', label: 'Conversation', icon: MessagesSquare },
    { id: 'changes', label: 'Changes', icon: GitCompareArrows, count: changes?.files.length ?? 0 },
    { id: 'files', label: 'Files', icon: FolderTree },
    ...(hasPreview ? [{ id: 'preview', label: 'Preview', icon: Monitor, dot: running }] : []),
    { id: 'trace', label: 'Trace', icon: Activity },
  ];
  const visiblePane = pane === 'preview' && !hasPreview ? 'conversation' : pane;
  const keepFiles = filesVisited || visiblePane === 'files';
  const keepTrace = traceVisited || visiblePane === 'trace';
  const keepPreview = visiblePane === 'preview' || (running && visitedOperation === operationId);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-2 composing:max-lg:hidden sm:px-4">
        <Tabs items={items} value={visiblePane} onChange={selectPane} ariaLabel="Session view" />
        {visiblePane === 'conversation' ? <span className="hidden items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] text-ink-subtle uppercase sm:flex"><span aria-hidden className="size-1.5 rounded-full bg-success-dot shadow-[0_0_6px_var(--success-dot)]" />Live</span> : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1">
        <section role="tabpanel" aria-label="Conversation" hidden={visiblePane !== 'conversation'}
          className={cn('min-h-0 min-w-0', visiblePane !== 'conversation' && 'hidden')}>{children}</section>
        {visiblePane === 'changes' ? <section role="tabpanel" id="session-changes" aria-label="Live code changes" className="min-h-0 min-w-0">
          <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading changes…</p>}><ChangesPanel sessionId={sessionId} /></Suspense>
        </section> : null}
        {keepFiles ? <section role="tabpanel" id="session-files" aria-label="Session files" hidden={visiblePane !== 'files'}
          className={cn('min-h-0 min-w-0', visiblePane !== 'files' && 'hidden')}>
          <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading files…</p>}><FilesPanel sessionId={sessionId} active={visiblePane === 'files'} /></Suspense>
        </section> : null}
        {keepTrace ? <section role="tabpanel" id="session-trace" aria-label="Agent trace" hidden={visiblePane !== 'trace'}
          className={cn('min-h-0 min-w-0', visiblePane !== 'trace' && 'hidden')}>
          <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading trace…</p>}><TracePanel sessionId={sessionId} active={visiblePane === 'trace'} /></Suspense>
        </section> : null}
        {keepPreview && deployment ? <section role="tabpanel" aria-label="Application preview" hidden={visiblePane !== 'preview'}
          className={cn('min-h-0 min-w-0', visiblePane !== 'preview' && 'hidden')}>
          <PreviewPanel deployment={deployment} visible={visiblePane === 'preview'} />
        </section> : null}
      </div>
      {deployEnabled && logOpen && !consoleHidden ? <DeployLogsDrawer sessionId={sessionId} /> : null}
    </div>
  );
};

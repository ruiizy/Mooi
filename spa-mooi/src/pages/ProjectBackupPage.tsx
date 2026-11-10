import { lazy, Suspense, useCallback, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Compass, FileCode2, GitCompareArrows, LayoutDashboard, MessagesSquare, Terminal, X } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { useAgentConnections } from '@/features/agents/hooks/useAgentConnections';
import {
  createBackup, deleteBackupConfiguration, deleteBackupData, fetchBackupFileDiff, forgetBackup, restoreBackup,
  saveBackupDraft, updateBackupEnvironment,
} from '@/features/backups/api/backupsApi';
import { BackupConsolePanel } from '@/features/backups/components/BackupConsolePanel';
import { BackupDeleteDialog } from '@/features/backups/components/BackupDeleteDialog';
import { BackupDetailDialog } from '@/features/backups/components/BackupDetailDialog';
import { BackupOverviewPanel } from '@/features/backups/components/BackupOverviewPanel';
import { BackupPageHeader } from '@/features/backups/components/BackupPageHeader';
import { BackupRestoreDialog } from '@/features/backups/components/BackupRestoreDialog';
import { useBackupOverview } from '@/features/backups/hooks/useBackupOverview';
import { useProjectBackups } from '@/features/backups/hooks/useProjectBackups';
import { BACKUP_AGENT_COPY, BACKUP_AGENT_SUGGESTIONS } from '@/features/backups/lib/backupAgentCopy';
import { backupAgentMessage } from '@/features/backups/lib/backupAgentMessage';
import { BACKUP_DOCUMENTS } from '@/features/backups/lib/backupDocuments';
import { BACKUP_FILES_SOURCE } from '@/features/backups/lib/backupFilesSource';
import { backupOperationLabel } from '@/features/backups/lib/backupOperationLabel';
import { backupStage } from '@/features/backups/lib/backupStage';
import type { Backup } from '@/features/backups/types/Backup';
import type { BackupAgentIntent } from '@/features/backups/types/BackupAgentIntent';
import type { BackupSnapshot } from '@/features/backups/types/BackupSnapshot';
import type { BackupTab } from '@/features/backups/types/BackupTab';
import { PlatformAgentDialog } from '@/features/platform/components/PlatformAgentDialog';
import { PlatformChatPanel } from '@/features/platform/components/PlatformChatPanel';
import { PlatformDeleteDialog } from '@/features/platform/components/PlatformDeleteDialog';
import { PlatformEnvironmentDialog } from '@/features/platform/components/PlatformEnvironmentDialog';
import { PlatformFilesPanel } from '@/features/platform/components/PlatformFilesPanel';
import { usePlatformChat } from '@/features/platform/hooks/usePlatformChat';
import { usePlatformFiles } from '@/features/platform/hooks/usePlatformFiles';
import { usePlatformOperation } from '@/features/platform/hooks/usePlatformOperation';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { findProject } from '@/features/projects/lib/findProject';
import { closeSession } from '@/features/sessions/api/sessionsApi';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import type { TabItem } from '@/shared/types/TabItem';
import { cn } from '@/shared/utils/cn';
import { useSessionsStore } from '@/stores/sessionsStore';

const ChangesPanel = lazy(() => import('@/features/sessions/components/changes/ChangesPanel').then((module) => ({ default: module.ChangesPanel })));
const TracePanel = lazy(() => import('@/features/traces/components/TracePanel').then((module) => ({ default: module.TracePanel })));

/**
 * One project's backups, shaped like its deployment view: an overview first, then tabs for the backup
 * chat, the live console, the platform-stored files and the chat's repository changes as they become
 * relevant. The active tab lives in `?tab=` so a reload lands back on the same view.
 */
export const ProjectBackupPage = () => {
  const { projectId } = useParams();
  const { projects, status } = useProjects();
  const project = findProject(projects, projectId);
  const { connections } = useAgentConnections();

  const stream = usePlatformOperation<BackupSnapshot>(project?.id, 'backup');
  const refreshKey = `${stream.configurationRevision}:${stream.snapshot?.operationId ?? ''}:${stream.snapshot?.state ?? ''}`;
  const { overview, error: overviewError, reload } = useBackupOverview(project?.id, refreshKey);
  const list = useProjectBackups(project?.id, refreshKey);
  const { chat, starting, error: chatError, start, clearError } = usePlatformChat(project?.id, 'backup');
  const files = usePlatformFiles(project?.id, stream.configurationRevision, BACKUP_FILES_SOURCE);
  const fetchDiff = useCallback((path: string) => fetchBackupFileDiff(project?.id ?? '', path), [project?.id]);
  const repositoryChanges = useSessionsStore((state) => (chat ? state.byId[chat.id]?.changes?.files.length ?? 0 : 0));
  const snapshot = stream.snapshot ?? overview?.snapshot ?? null;
  const stage = overview ? backupStage(overview, snapshot, list.backups[0], Boolean(chat)) : 'unconfigured';
  const missing = overview?.environment.filter((variable) => variable.required && !variable.configured).length ?? 0;
  const configured = Boolean(overview?.configured);
  const running = stage === 'running';

  const [searchParams, setSearchParams] = useSearchParams();
  const [agentIntent, setAgentIntent] = useState<BackupAgentIntent | null>(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detail, setDetail] = useState<Backup | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [removing, setRemoving] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The chat only lives while the scripts are being (re)written; once proven it may be closed.
  const chatTested = Boolean(chat && overview?.chatTested && overview.chatSessionId === chat.id);
  const chatClosable = chatTested && chat?.status === 'ready' && !chat.pending && !running;

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    ...(chat ? [{ id: 'chat', label: 'Chat', icon: MessagesSquare, dot: chat.status === 'working' || chat.status === 'waiting' || chat.status === 'provisioning',
      ...(chatClosable ? { onClose: () => void closeChat(), closeLabel: 'Close backup chat' } : {}) }] : []),
    ...(snapshot?.operationId ? [{ id: 'console', label: 'Console', icon: Terminal, dot: running }] : []),
    ...(configured || chat || files.documents?.draft ? [{ id: 'files', label: 'Platform files', icon: FileCode2, count: files.summary?.files.length || undefined }] : []),
    ...(chat ? [{ id: 'changes', label: 'Changes', icon: GitCompareArrows, count: repositoryChanges || undefined }] : []),
    ...(chat ? [{ id: 'trace', label: 'Trace', icon: Activity }] : []),
  ];
  const requested = searchParams.get('tab');
  const tab = (tabs.some((item) => item.id === requested) ? requested : 'overview') as BackupTab;
  const openTab = (next: string) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true });

  const closeChat = async () => {
    if (!chat) return;
    setActionError(null);
    try {
      await closeSession(chat.id);
      useSessionsStore.getState().removeSession(chat.id);
      if (tab === 'chat') openTab('overview');
      reload();
      files.reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  if (!project) {
    if (status === 'loading' || status === 'idle') {
      return <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10"><Card className="h-56 animate-pulse-soft" /></div>;
    }
    return <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <EmptyState icon={Compass} title="Project not found" description="This project is not part of your workspace.">
        <Link to={ROUTES.backups} className={buttonStyles('secondary', 'md')}>Back to backups</Link>
      </EmptyState>
    </div>;
  }

  /** Starts one operation and follows it in the console; errors stay on the overview. */
  const operate = async (operation: () => Promise<BackupSnapshot>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      stream.adoptSnapshot(await operation());
      setDetail(null);
      list.reload();
      openTab('console');
      return true;
    } catch (failure) {
      setActionError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requestBackup = () => {
    if (missing > 0) setEnvironmentOpen(true);
    else void operate(() => createBackup(project.id));
  };
  const verify = (backup: Backup) => void operate(() => restoreBackup(project.id, backup.id, 'verification'));
  const openAgent = (intent: BackupAgentIntent) => {
    clearError();
    setAgentIntent(intent);
  };
  const fixFailure = () => (chat ? openTab('chat') : openAgent('fix'));
  const failed = snapshot?.state === 'failed' ? backupOperationLabel(snapshot.action, snapshot.target).toLowerCase() : null;
  const actionable = (backup: Backup) => Boolean(overview?.active) && !running && !busy && backup.state === 'succeeded';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BackupPageHeader project={project} stage={stage} active={Boolean(overview?.active)} configured={configured}
        deployedRelease={overview?.deployedRelease ?? null} tabs={tabs} tab={tab} onTabChange={openTab} onBackup={requestBackup}
        onReconfigure={() => openAgent('update')} onEnvironment={() => setEnvironmentOpen(true)} onDelete={() => setDeleteOpen(true)} />

      <div className="relative min-h-0 flex-1 bg-canvas">
        {tab === 'overview' ? <BackupOverviewPanel project={project} overview={overview} error={overviewError ?? actionError} onRetry={reload}
          stage={stage} hasChat={Boolean(chat)} missingVariables={missing} list={list} busy={busy}
          onSetup={() => openAgent('setup')} onBackup={requestBackup} onOpenChat={() => openTab('chat')} onOpenConsole={() => openTab('console')}
          onFix={fixFailure} onEnvironment={() => setEnvironmentOpen(true)} onOpenBackup={setDetail} onVerify={verify}
          onRestore={setRestoring} onDelete={setRemoving} /> : null}

        {chat ? <div className={cn('h-full', tab !== 'chat' && 'hidden')}>
          <PlatformChatPanel key={chat.id} sessionId={chat.id} loadingLabel="Opening the backup chat…"
            completion={chatClosable ? { done: true, title: 'Backed up and verified.', description: 'Close this chat to accept its platform files.',
              action: <Button variant="brand" size="sm" onClick={() => void closeChat()}><X className="size-4" />Close chat</Button> } : null} />
        </div> : null}

        {tab === 'console' ? <BackupConsolePanel snapshot={snapshot} logs={stream.logs} hasChat={Boolean(chat)}
          canBackup={Boolean(overview?.active) && !running} onOpenChat={() => openTab('chat')} onFix={() => openAgent('fix')}
          onBackup={requestBackup} /> : null}

        {tab === 'files' ? <PlatformFilesPanel fields={BACKUP_DOCUMENTS} documents={files.documents} summary={files.summary}
          loadError={files.error} locked={running} fetchDiff={fetchDiff}
          saveDraft={(draft) => saveBackupDraft(project.id, draft)} onSaved={files.reload}
          emptyDescription="The agent saves BACKUP.md, backup.sh, restore.sh and delete.sh here one by one while it prepares the backups. They live in Mooi, never in the repository." /> : null}

        {tab === 'changes' && chat ? <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading changes…</p>}>
          <ChangesPanel sessionId={chat.id} showMerge={false}
            emptyDescription={`Backups rarely need repository changes. When they do, the agent asks before committing them to ${project.defaultBranch}.`} />
        </Suspense> : null}

        {tab === 'trace' && chat ? <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading trace…</p>}>
          <TracePanel key={chat.id} sessionId={chat.id} active />
        </Suspense> : null}
      </div>

      {agentIntent ? <PlatformAgentDialog key={agentIntent} copy={BACKUP_AGENT_COPY[agentIntent]} projectName={project.name}
        connections={connections} busy={starting} error={chatError} optionalPrompt={agentIntent === 'fix'}
        suggestions={agentIntent === 'setup' ? BACKUP_AGENT_SUGGESTIONS : []}
        replaceNotice={chat ? 'This starts a new backup chat and closes the current one. The saved configuration is kept.' : null}
        buildMessage={(prompt) => backupAgentMessage(agentIntent, prompt, failed)}
        onClose={() => setAgentIntent(null)} onSubmit={(request) => void start(request).then((session) => {
          if (!session) return;
          setAgentIntent(null);
          files.reload();
          openTab('chat');
        })} /> : null}
      {environmentOpen && overview ? <PlatformEnvironmentDialog prefix="MOOI_BACKUP_" variables={overview.environment}
        description="Stored encrypted in the platform and passed to backup.sh, restore.sh and delete.sh together with the production and development values."
        save={(values) => updateBackupEnvironment(project.id, values)}
        onClose={() => setEnvironmentOpen(false)} onSaved={() => { setEnvironmentOpen(false); reload(); }} /> : null}
      {deleteOpen ? <PlatformDeleteDialog title="Delete backup configuration" action="Delete configuration"
        description={`Removes BACKUP.md, backup.sh, restore.sh, delete.sh and every stored backup variable of ${project.name}.`}
        consequences={['Stored backups and their records stay; without delete.sh they can only be forgotten.',
          'Production and its deployment configuration are not touched.', 'The backup chat is closed; setting up again starts from scratch.']}
        remove={() => deleteBackupConfiguration(project.id)} onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          if (chat) useSessionsStore.getState().removeSession(chat.id);
          openTab('overview');
          reload();
        }} /> : null}
      {detail ? <BackupDetailDialog key={detail.id} backup={detail} projectName={project.name} onClose={() => setDetail(null)}
        onVerify={actionable(detail) ? () => verify(detail) : undefined}
        onRestore={actionable(detail) && detail.releaseTag === overview?.deployedRelease ? () => { setRestoring(detail); setDetail(null); } : undefined}
        onDelete={detail.state !== 'running' ? () => { setRemoving(detail); setDetail(null); } : undefined} /> : null}
      {restoring ? <BackupRestoreDialog key={restoring.id} backup={restoring} projectName={project.name} busy={busy} error={actionError}
        onClose={() => { setRestoring(null); setActionError(null); }}
        onConfirm={() => void operate(() => restoreBackup(project.id, restoring.id, 'production')).then((ok) => { if (ok) setRestoring(null); })} /> : null}
      {removing ? <BackupDeleteDialog key={removing.id} backup={removing} canRunScript={Boolean(overview?.active) && !running && !busy}
        onClose={() => setRemoving(null)}
        onDelete={async () => {
          stream.adoptSnapshot(await deleteBackupData(project.id, removing.id));
          setRemoving(null);
          openTab('console');
        }}
        onForget={async () => {
          await forgetBackup(project.id, removing.id);
          setRemoving(null);
          list.reload();
        }} /> : null}
    </div>
  );
};

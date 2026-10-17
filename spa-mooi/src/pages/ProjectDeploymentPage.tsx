import { lazy, Suspense, useCallback, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Compass, FileCode2, GitCompareArrows, LayoutDashboard, MessagesSquare, Rocket, Terminal, X } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { useAgentConnections } from '@/features/agents/hooks/useAgentConnections';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { findProject } from '@/features/projects/lib/findProject';
import { PlatformAgentDialog } from '@/features/platform/components/PlatformAgentDialog';
import { PlatformChatPanel } from '@/features/platform/components/PlatformChatPanel';
import { PlatformDeleteDialog } from '@/features/platform/components/PlatformDeleteDialog';
import { PlatformEnvironmentDialog } from '@/features/platform/components/PlatformEnvironmentDialog';
import { PlatformFilesPanel } from '@/features/platform/components/PlatformFilesPanel';
import { usePlatformChat } from '@/features/platform/hooks/usePlatformChat';
import { usePlatformFiles } from '@/features/platform/hooks/usePlatformFiles';
import { usePlatformStream } from '@/features/platform/hooks/usePlatformStream';
import {
  deleteProductionConfiguration, deleteProductionDeployment, fetchProductionFileDiff, productionPath, saveProductionDraft,
  startProductionDeployment, updateProductionEnvironment,
} from '@/features/production/api/productionApi';
import { ProductionConsolePanel } from '@/features/production/components/ProductionConsolePanel';
import { ProductionDeploymentDetailDialog } from '@/features/production/components/ProductionDeploymentDetailDialog';
import { ProductionOverviewPanel } from '@/features/production/components/ProductionOverviewPanel';
import { ProductionPageHeader } from '@/features/production/components/ProductionPageHeader';
import { ProductionReleaseDialog } from '@/features/production/components/ProductionReleaseDialog';
import { useProductionHealth } from '@/features/production/hooks/useProductionHealth';
import { useProductionOverview } from '@/features/production/hooks/useProductionOverview';
import { useProjectProductionHistory } from '@/features/production/hooks/useProjectProductionHistory';
import { PRODUCTION_AGENT_COPY, PRODUCTION_AGENT_SUGGESTIONS } from '@/features/production/lib/productionAgentCopy';
import { productionAgentMessage } from '@/features/production/lib/productionAgentMessage';
import { PRODUCTION_DOCUMENTS } from '@/features/production/lib/productionDocuments';
import { PRODUCTION_FILES_SOURCE } from '@/features/production/lib/productionFilesSource';
import { productionStage } from '@/features/production/lib/productionStage';
import type { ProductionAgentIntent } from '@/features/production/types/ProductionAgentIntent';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import type { ProductionSnapshot } from '@/features/production/types/ProductionSnapshot';
import type { ProductionTab } from '@/features/production/types/ProductionTab';
import type { ReleaseChoice } from '@/features/production/types/ReleaseChoice';
import { closeSession } from '@/features/sessions/api/sessionsApi';
import { useSessionsSync } from '@/features/sessions/hooks/useSessionsSync';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import type { TabItem } from '@/shared/types/TabItem';
import { cn } from '@/shared/utils/cn';
import { useSessionsStore } from '@/stores/sessionsStore';

const ChangesPanel = lazy(() => import('@/features/sessions/components/changes/ChangesPanel').then((module) => ({ default: module.ChangesPanel })));

/**
 * One project's production: an overview first, then — like a session — tabs for the deployment
 * chat, the live console, the platform-stored files and the chat's repository changes as they become
 * relevant. Both file tabs count their pending changes live. The active tab lives in `?tab=` so a
 * reload lands back on the same view.
 */
export const ProjectDeploymentPage = () => {
  const { projectId } = useParams();
  const { projects, status } = useProjects();
  const project = findProject(projects, projectId);
  const { connections } = useAgentConnections();
  useSessionsSync(project?.id, Boolean(project));

  const stream = usePlatformStream<ProductionSnapshot>(project ? `${productionPath(project.id)}/events` : undefined, 'production');
  const refreshKey = `${stream.configurationRevision}:${stream.snapshot?.operationId ?? ''}:${stream.snapshot?.state ?? ''}`;
  const { overview, error: overviewError, reload } = useProductionOverview(project?.id, refreshKey);
  const history = useProjectProductionHistory(project?.id, refreshKey);
  const { chat, starting, error: chatError, start, clearError } = usePlatformChat(project?.id, 'production');
  const files = usePlatformFiles(project?.id, stream.configurationRevision, PRODUCTION_FILES_SOURCE);
  const fetchDiff = useCallback((path: string) => fetchProductionFileDiff(project?.id ?? '', path), [project?.id]);
  const repositoryChanges = useSessionsStore((state) => (chat ? state.byId[chat.id]?.changes?.files.length ?? 0 : 0));
  const snapshot = stream.snapshot ?? overview?.snapshot ?? null;
  const latest = history.deployments[0];
  const stage = overview ? productionStage(overview, snapshot, latest, Boolean(chat)) : 'unconfigured';
  const missing = overview?.environment.filter((variable) => variable.required && !variable.configured).length ?? 0;
  const configured = Boolean(overview?.configured);
  const health = useProductionHealth(project?.id, configured && stage !== 'deploying'
    && Boolean(overview?.deployed || latest?.state === 'succeeded'));

  const [searchParams, setSearchParams] = useSearchParams();
  const [agentIntent, setAgentIntent] = useState<ProductionAgentIntent | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detail, setDetail] = useState<ProductionDeployment | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The chat only lives while the script is being (re)written; once tested for real it may be closed.
  const chatTested = Boolean(chat && overview?.chatTested && overview.chatSessionId === chat.id);
  const chatClosable = chatTested && chat?.status === 'ready' && !chat.pending && stage !== 'deploying';

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    ...(chat ? [{ id: 'chat', label: 'Chat', icon: MessagesSquare, dot: chat.status === 'working' || chat.status === 'waiting' || chat.status === 'provisioning',
      ...(chatClosable ? { onClose: () => void closeChat(), closeLabel: 'Close deployment chat' } : {}) }] : []),
    ...(snapshot?.operationId ? [{ id: 'console', label: 'Console', icon: Terminal, dot: snapshot.state === 'running' }] : []),
    ...(configured || chat || files.documents?.draft ? [{ id: 'files', label: 'Platform files', icon: FileCode2, count: files.summary?.files.length || undefined }] : []),
    ...(chat ? [{ id: 'changes', label: 'Changes', icon: GitCompareArrows, count: repositoryChanges || undefined }] : []),
  ];
  const requested = searchParams.get('tab');
  const tab = (tabs.some((item) => item.id === requested) ? requested : 'overview') as ProductionTab;
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
        <Link to={ROUTES.deployments} className={buttonStyles('secondary', 'md')}>Back to deployments</Link>
      </EmptyState>
    </div>;
  }

  const requestDeploy = () => {
    setActionError(null);
    if (missing > 0) setEnvironmentOpen(true);
    else setReleaseOpen(true);
  };

  const deploy = async (choice: ReleaseChoice) => {
    setDeploying(true);
    setActionError(null);
    try {
      stream.adoptSnapshot(await startProductionDeployment(project.id, choice));
      setReleaseOpen(false);
      setDetail(null);
      history.reload();
      openTab('console');
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setDeploying(false);
    }
  };

  const openAgent = (intent: ProductionAgentIntent) => {
    clearError();
    setAgentIntent(intent);
  };

  const fixFailure = () => (chat ? openTab('chat') : openAgent('fix'));
  const failedRelease = snapshot?.state === 'failed' ? snapshot.releaseTag : latest?.state === 'failed' ? latest.releaseTag : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProductionPageHeader project={project} stage={stage} configured={configured} healthState={health.state}
        tabs={tabs} tab={tab} onTabChange={openTab} onDeploy={requestDeploy} onReconfigure={() => openAgent('update')}
        onEnvironment={() => setEnvironmentOpen(true)} onCheckStatus={health.check} onDelete={() => setDeleteOpen(true)} />

      <div className="relative min-h-0 flex-1 bg-canvas">
        {tab === 'overview' ? <ProductionOverviewPanel project={project} overview={overview} error={overviewError ?? actionError}
          onRetry={reload} stage={stage} hasChat={Boolean(chat)} missingVariables={missing} releaseTag={latest?.releaseTag ?? null}
          latest={latest} health={health} history={history} deploying={deploying}
          onSetup={() => openAgent('setup')} onDeploy={requestDeploy} onOpenChat={() => openTab('chat')}
          onOpenConsole={() => openTab('console')} onFix={fixFailure} onEnvironment={() => setEnvironmentOpen(true)}
          onOpenDeployment={setDetail} onRedeploy={(deployment) => void deploy({ tag: deployment.releaseTag, create: false })} /> : null}

        {chat ? <div className={cn('h-full', tab !== 'chat' && 'hidden')}>
          <PlatformChatPanel key={chat.id} sessionId={chat.id} loadingLabel="Opening the deployment chat…"
            completion={chatClosable ? { done: true, title: 'Tested and deployed.', description: 'Close this chat to accept its platform files.',
              action: <Button variant="brand" size="sm" onClick={() => void closeChat()}><X className="size-4" />Close chat</Button> }
              : configured && missing === 0 && stage !== 'deploying' ? { done: false, title: 'The configuration is ready.', description: 'Deploy whenever you want.',
                action: <Button variant="brand" size="sm" onClick={requestDeploy}><Rocket className="size-4" />Deploy</Button> } : null} />
        </div> : null}

        {tab === 'console' ? <ProductionConsolePanel snapshot={snapshot} logs={stream.logs} hasChat={Boolean(chat)}
          onOpenChat={() => openTab('chat')} onFix={() => openAgent('fix')} onDeploy={requestDeploy} /> : null}

        {tab === 'files' ? <PlatformFilesPanel fields={PRODUCTION_DOCUMENTS} documents={files.documents} summary={files.summary}
          loadError={files.error} locked={stage === 'deploying'} fetchDiff={fetchDiff}
          saveDraft={(draft) => saveProductionDraft(project.id, draft)} onSaved={files.reload}
          emptyDescription="The agent saves DEPLOYMENT.md, deploy.sh and status.sh here one by one while it prepares the deployment. They live in Mooi, never in the repository." /> : null}

        {tab === 'changes' && chat ? <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading changes…</p>}>
          <ChangesPanel sessionId={chat.id} showMerge={false}
            emptyDescription={`Production Compose and other repository changes appear here. The agent asks before committing them to ${project.defaultBranch}.`} />
        </Suspense> : null}
      </div>

      {agentIntent ? <PlatformAgentDialog key={agentIntent} copy={PRODUCTION_AGENT_COPY[agentIntent]} projectName={project.name}
        connections={connections} busy={starting} error={chatError} optionalPrompt={agentIntent === 'fix'}
        suggestions={agentIntent === 'setup' ? PRODUCTION_AGENT_SUGGESTIONS : []}
        replaceNotice={chat ? 'This starts a new deployment chat and closes the current one. The saved configuration is kept.' : null}
        buildMessage={(prompt) => productionAgentMessage(agentIntent, prompt, failedRelease)}
        onClose={() => setAgentIntent(null)} onSubmit={(request) => void start(request).then((session) => {
          if (!session) return;
          setAgentIntent(null);
          files.reload();
          openTab('chat');
        })} /> : null}
      {releaseOpen ? <ProductionReleaseDialog projectId={project.id} defaultBranch={project.defaultBranch} busy={deploying}
        error={actionError} onClose={() => { setReleaseOpen(false); setActionError(null); }} onSelect={(choice) => void deploy(choice)} /> : null}
      {environmentOpen && overview ? <PlatformEnvironmentDialog prefix="MOOI_PRODUCTION_" variables={overview.environment}
        description="Stored encrypted in the platform and passed to deploy.sh and status.sh together with the development values."
        save={(values) => updateProductionEnvironment(project.id, values)}
        onClose={() => setEnvironmentOpen(false)} onSaved={() => { setEnvironmentOpen(false); reload(); }} /> : null}
      {deleteOpen ? <PlatformDeleteDialog title="Delete deployment configuration" action="Delete configuration"
        description={`Removes DEPLOYMENT.md, deploy.sh, status.sh and every stored environment variable of ${project.name}.`}
        consequences={['The service already running in production is not stopped.', 'The deployment history and its saved output stay available.',
          'The deployment chat is closed; setting up again starts from scratch.']}
        remove={() => deleteProductionConfiguration(project.id)} onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          if (chat) useSessionsStore.getState().removeSession(chat.id);
          openTab('overview');
          reload();
        }} /> : null}
      {detail ? <ProductionDeploymentDetailDialog key={detail.operationId} deployment={detail} projectName={project.name}
        onClose={() => setDetail(null)}
        onRedeploy={configured && stage !== 'deploying' ? () => void deploy({ tag: detail.releaseTag, create: false }) : undefined}
        onFix={() => { setDetail(null); fixFailure(); }}
        onDelete={async () => {
          await deleteProductionDeployment(project.id, detail.operationId);
          history.remove(detail.operationId);
          setDetail(null);
        }} /> : null}
    </div>
  );
};

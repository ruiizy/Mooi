import { useEffect, useState } from 'react';
import type { SessionConfiguration } from '@/features/sessions/types/SessionConfiguration';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { ChatComposer } from '@/features/sessions/components/chat/ChatComposer';
import { ChatMessageList } from '@/features/sessions/components/chat/ChatMessageList';
import { AsideStack } from '@/features/sessions/components/chat/AsideStack';
import { SubagentTrack } from '@/features/sessions/components/chat/SubagentTrack';
import { useAsides } from '@/features/sessions/hooks/useAsides';
import { RecipesButton } from '@/features/recipes/components/RecipesButton';
import type { SessionStreamState } from '@/features/sessions/lib/openSessionStream';
import type { PreparedImage } from '@/features/sessions/types/PreparedImage';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';

interface ChatPanelProps {
  session: Session;
  entries: TranscriptEntry[];
  pending: SessionPendingRequest[];
  streamState: SessionStreamState;
  busy: boolean;
  modelOptions: SessionProvider['models'];
  modelLoading: boolean;
  modelError: string | null;
  actionError: string | null;
  onSend: (text: string, images?: PreparedImage[]) => Promise<boolean>;
  onInterrupt: () => Promise<boolean>;
  onRecover: () => Promise<boolean>;
  onCompact: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
  onConfigurationChange: (configuration: SessionConfiguration) => void;
  onAllowPermission: (requestId: string, updatedInput?: Record<string, unknown>) => void;
  onDenyPermission: (requestId: string, message?: string) => void;
  onAnswerQuestion: (requestId: string, answers: Record<string, string | string[]>) => void;
}

/**
 * The chat side of the workspace: the transcript, whatever the agent is blocked on, and the
 * composer. Everything it renders comes from the session's own capabilities and status, so a
 * provider that declares the bare minimum still gets a coherent screen.
 */
export const ChatPanel = ({
  session,
  entries,
  pending,
  streamState,
  busy,
  modelOptions,
  modelLoading,
  modelError,
  actionError,
  onSend,
  onInterrupt,
  onRecover,
  onCompact,
  onClear,
  onConfigurationChange,
  onAllowPermission,
  onDenyPermission,
  onAnswerQuestion,
}: ChatPanelProps) => {
  const [sending, setSending] = useState(false);
  const asides = useAsides(session.id);
  const working = session.status === 'working' || session.status === 'waiting';
  const deploying = session.deployment.state === 'starting';
  const canSend = session.status === 'ready' && !busy && !sending && !deploying;

  useEffect(() => {
    if (working) setSending(false);
  }, [working]);

  const send = async (text: string, images: PreparedImage[] = []) => {
    setSending(true);
    const sent = await onSend(text, images);
    if (!sent) setSending(false);
    return sent;
  };

  return (
  <div className="flex h-full min-h-0 flex-col">
    {streamState === 'reconnecting' ? (
      <p className="flex shrink-0 items-center gap-2 border-b border-line bg-warning-soft px-4 py-2 text-xs text-warning">
        <LoaderCircle className="size-3.5 animate-spin" />
        Reconnecting to the session stream…
      </p>
    ) : null}

    {session.detail && session.status !== 'failed' && session.status !== 'closed' ? <p role="status" className="max-h-[20%] shrink-0 overflow-y-auto px-4 py-2 text-sm text-ink-muted [overflow-wrap:anywhere]">{session.detail}</p> : null}
    <ChatMessageList
      key={`transcript-${session.id}`}
      sessionId={session.id}
      entries={entries}
      pending={pending}
      providerLabel={session.providerLabel}
      capabilities={session.capabilities}
      working={working || sending}
      loading={streamState === 'reconnecting' && entries.length === 0}
      busy={busy}
      editableToolInput={session.capabilities.editableToolInput}
      onAllowPermission={onAllowPermission}
      onDenyPermission={onDenyPermission}
      onAnswerQuestion={onAnswerQuestion}
    />

    {actionError ? (
      <p role="alert" className="flex max-h-[25%] shrink-0 items-start gap-2 overflow-y-auto border-t border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger [overflow-wrap:anywhere] lg:px-6">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        {actionError}
      </p>
    ) : null}

    <AsideStack asides={asides.asides} onDismiss={asides.dismiss} />

    <SubagentTrack sessionId={session.id} entries={entries} showThinking={session.capabilities.thinking} />

    <ChatComposer
      key={`composer-${session.id}`}
      usage={session.usage}
      status={session.status}
      deploying={deploying}
      busy={busy}
      model={session.model}
      effort={session.effort ?? null}
      modelOptions={modelOptions}
      modelLoading={modelLoading}
      modelError={modelError}
      canInterrupt={session.capabilities.interrupt}
      hasConversation={entries.some((entry) => entry.kind === 'user')}
      acceptsImages={Boolean(session.capabilities.images)}
      onSend={send}
      onInterrupt={onInterrupt}
      recoverable={Boolean(session.recoverable)}
      onRecover={onRecover}
      onCompact={onCompact}
      onClear={onClear}
      canAskAside={Boolean(session.capabilities.asides)}
      askingAside={asides.answering}
      onAside={(question) => void asides.ask(question)}
      onConfigurationChange={onConfigurationChange}
      actions={session.kind === 'session' ? <RecipesButton disabled={!canSend} onApply={(text) => send(text)} /> : null}
    />
  </div>
  );
};

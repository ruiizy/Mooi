import { LoaderCircle } from 'lucide-react';
import type { PlatformCompletion } from '@/features/platform/types/PlatformCompletion';
import { ChatCompletionBar } from '@/features/sessions/components/chat/ChatCompletionBar';
import { ChatPanel } from '@/features/sessions/components/chat/ChatPanel';
import { useSession } from '@/features/sessions/hooks/useSession';
import { useSessionStream } from '@/features/sessions/hooks/useSessionStream';
import { useSessionsStore } from '@/stores/sessionsStore';

interface PlatformChatPanelProps {
  sessionId: string;
  /** Shown above the conversation while the agent is idle: its job is done, or what comes next. */
  completion: PlatformCompletion | null;
  loadingLabel: string;
}

/** A platform chat: the regular session chat plus a completion strip once the agent has nothing left to do. */
export const PlatformChatPanel = ({ sessionId, completion, loadingLabel }: PlatformChatPanelProps) => {
  const chat = useSession(sessionId);
  useSessionStream(sessionId);
  const transcript = useSessionsStore((state) => state.byId[sessionId]);
  const session = chat.session;

  if (!session) {
    return <p className="flex h-full items-center justify-center gap-2 text-sm text-ink-muted">
      <LoaderCircle className="size-4 animate-spin" />{loadingLabel}</p>;
  }

  const idle = session.status === 'ready' && !session.pending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {completion && idle ? <ChatCompletionBar done={completion.done} title={completion.title} description={completion.description}>
        {completion.action}
      </ChatCompletionBar> : null}
      <div className="min-h-0 flex-1">
        <ChatPanel
          session={session}
          entries={transcript?.entries ?? []}
          pending={transcript?.pending ?? []}
          streamState={transcript?.streamState ?? 'closed'}
          busy={chat.busy}
          modelOptions={chat.modelOptions}
          modelLoading={chat.modelLoading}
          modelError={chat.modelError}
          actionError={chat.actionError}
          onSend={chat.send}
          onQueue={chat.queue}
          onUnqueue={chat.unqueue}
          onInterrupt={chat.interrupt}
          onRecover={chat.recover}
          onCompact={chat.compact}
          onClear={chat.clearConversation}
          onConfigurationChange={(configuration) => void chat.updateConfiguration(configuration)}
          onAllowPermission={(requestId, updatedInput) => void chat.allowPermission(requestId, updatedInput)}
          onDenyPermission={(requestId, message) => void chat.denyPermission(requestId, message)}
          onAnswerQuestion={(requestId, answers) => void chat.answer(requestId, answers)}
        />
      </div>
    </div>
  );
};

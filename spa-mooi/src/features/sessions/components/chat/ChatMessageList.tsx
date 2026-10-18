import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, LoaderCircle, MessagesSquare } from 'lucide-react';
import { ChatMessageItem } from './ChatMessageItem';
import { PendingRequestCard } from './PendingRequestCard';
import { collectSubagents } from '@/features/sessions/lib/collectSubagents';
import { isProviderPlaceholder } from '@/features/sessions/lib/isProviderPlaceholder';
import type { AgentCapabilities } from '@/features/sessions/types/AgentCapabilities';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';

interface ChatMessageListProps {
  sessionId: string;
  entries: TranscriptEntry[];
  pending: SessionPendingRequest[];
  providerLabel: string;
  capabilities: AgentCapabilities;
  working: boolean;
  loading?: boolean;
  busy: boolean;
  editableToolInput: boolean;
  onAllowPermission: (requestId: string, updatedInput?: Record<string, unknown>) => void;
  onDenyPermission: (requestId: string, message?: string) => void;
  onAnswerQuestion: (requestId: string, answers: Record<string, string | string[]>) => void;
}

export const ChatMessageList = ({
  sessionId,
  entries,
  pending,
  providerLabel,
  capabilities,
  working,
  loading = false,
  busy,
  editableToolInput,
  onAllowPermission,
  onDenyPermission,
  onAnswerQuestion,
}: ChatMessageListProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLUListElement>(null);
  const pinned = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const visibleEntries = entries.filter((entry) => entry.kind !== 'assistant' ||
    (entry.streaming && working) || entry.result || entry.blocks.some((block) =>
      block.kind === 'step' || block.kind === 'subagent' || ((block.kind !== 'thinking' || capabilities.thinking) && block.text.trim() && !isProviderPlaceholder(block.text))));
  const hasStreamingAssistant = visibleEntries.some((entry) => entry.kind === 'assistant' && entry.streaming);
  const owners = useMemo(() => new Map(collectSubagents(entries).map(({ subagent }) => [subagent.toolUseId, subagent])), [entries]);

  useEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [entries, pending, working]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const list = listRef.current;
      if (list && pinned.current) list.scrollTop = list.scrollHeight;
    });
    if (listRef.current) observer.observe(listRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const latest = () => {
    pinned.current = true;
    setShowLatest(false);
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={listRef} aria-label="Conversation history" tabIndex={0}
        onScroll={() => {
          const list = listRef.current;
          if (!list) return;
          pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
          setShowLatest(!pinned.current);
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 sm:py-8">
        <ul ref={contentRef} className="mx-auto w-full max-w-3xl space-y-7 sm:space-y-9">
          {visibleEntries.length === 0 && pending.length === 0 ? <li className="flex min-h-48 flex-col items-center justify-center py-8 text-center sm:py-14">
            <span className="flex size-14 items-center justify-center rounded-[14px] bg-surface-2 text-ink-muted">
              {loading || working ? <LoaderCircle className="size-6 animate-spin" /> : <MessagesSquare className="size-6" />}
            </span>
            <h2 className="mt-5 text-xl font-extrabold tracking-[-0.03em] text-ink">{loading ? 'Loading conversation…' : working ? 'Processing your message…' : 'What shall we build?'}</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{loading ? 'Restoring the messages in this session.' : 'Describe an idea, ask about your code, or work through a change together.'}</p>
          </li> : <>
            {visibleEntries.map((entry) => <ChatMessageItem key={entry.id} sessionId={sessionId} entry={entry} providerLabel={providerLabel} capabilities={capabilities} working={working} />)}
            {working && !hasStreamingAssistant && pending.length === 0 ? (
              <li role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-ink-muted">
                <LoaderCircle className="size-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
                <span>Processing your message…</span>
              </li>
            ) : null}
            {pending.map((request) => (
              <li key={`pending-${request.requestId}`} aria-label={request.kind === 'question' ? 'Pending question' : 'Pending permission'}>
                <PendingRequestCard request={request} showOwner queued={pending.length > 1} busy={busy} editable={editableToolInput}
                  owner={request.parentToolUseId ? owners.get(request.parentToolUseId) ?? null : null}
                  onAllowPermission={onAllowPermission} onDenyPermission={onDenyPermission} onAnswerQuestion={onAnswerQuestion} />
              </li>
            ))}
          </>}
        </ul>
      </div>
      {showLatest ? <button type="button" onClick={latest} className="absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink shadow-lg"><ArrowDown className="size-4" />Latest messages</button> : null}
    </div>
  );
};

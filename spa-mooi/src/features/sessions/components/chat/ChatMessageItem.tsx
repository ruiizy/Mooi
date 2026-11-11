import { memo } from 'react';
import { CircleAlert } from 'lucide-react';
import { MessageImageGrid } from './MessageImageGrid';
import { NoticeItem } from './NoticeItem';
import { TurnBlocks } from './TurnBlocks';
import { TurnFooter } from '@/features/sessions/components/chat/TurnFooter';
import type { AgentCapabilities } from '@/features/sessions/types/AgentCapabilities';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import { AgentProviderIcon } from '@/features/agents/components/AgentProviderIcon';
import { formatTime } from '@/shared/utils/formatTime';

interface ChatMessageItemProps {
  sessionId: string;
  entry: TranscriptEntry;
  provider: string;
  providerLabel: string;
  capabilities: AgentCapabilities;
  /** The agent is working on this turn right now (not finished, not waiting on the user). */
  live: boolean;
}

/**
 * One transcript row. An `assistant` entry is a whole turn: what the agent tells the user renders as
 * text, and everything it does in between folds into activity blocks, in the order it happened (see
 * `TurnBlocks`); a delegation to another agent is a card nesting that agent's own work. While the
 * turn is live, the open block — or a fresh one once the agent has spoken — names what it is doing. Optional blocks are gated on the session's capabilities, never
 * on its provider id: a provider without `thinking` never shows one.
 */
export const ChatMessageItem = memo(function ChatMessageItem({ sessionId, entry, provider, providerLabel, capabilities, live }:ChatMessageItemProps) {
  if (entry.kind === 'error') {
    return (
      <li className="flex animate-fade-up items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm leading-relaxed text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words">{entry.text}</span>
      </li>
    );
  }

  if (entry.kind === 'notice') {
    return <NoticeItem entry={entry} />;
  }

  if (entry.kind === 'user') {
    return (
      <li className="flex animate-fade-up flex-col items-end gap-1.5">
        {entry.images.length > 0 ? <MessageImageGrid sessionId={sessionId} images={entry.images} /> : null}
        {entry.text ? (
          <p className="max-w-[95%] break-words rounded-[18px] rounded-br-[6px] border border-brand/15 bg-brand-soft px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-ink sm:max-w-[85%] sm:px-5 sm:py-3.5">
            {entry.text}
          </p>
        ) : null}
        <span className="font-mono text-[10.5px] text-ink-subtle">{formatTime(entry.at)}</span>
      </li>
    );
  }

  return (
    <li className="flex animate-fade-up gap-2 sm:gap-4">
      <span aria-hidden className="hidden size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface shadow-card sm:flex">
        <AgentProviderIcon provider={provider} className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{providerLabel}</span>
          <span className="font-mono text-[10.5px] text-ink-subtle">{formatTime(entry.at)}</span>
        </p>

        <div className="mt-1.5 flex flex-col gap-3">
          <TurnBlocks sessionId={sessionId} blocks={entry.blocks} showThinking={capabilities.thinking} live={live} since={entry.at} />
        </div>

        {entry.result ? <TurnFooter result={entry.result} showCost={capabilities.cost} /> : null}
      </div>
    </li>
  );
});

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { SubagentTrackList } from './SubagentTrackList';
import { SubagentTrackPill } from './SubagentTrackPill';
import { useSubagentParam } from '@/features/sessions/hooks/useSubagentParam';
import { collectSubagents } from '@/features/sessions/lib/collectSubagents';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import { Modal } from '@/shared/components/Modal';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';

interface SubagentTrackProps {
  entries: TranscriptEntry[];
  pending: SessionPendingRequest[];
}

/**
 * A lane above the composer for the session's delegations: a pill counting them by state, and
 * behind it every subagent — a popover anchored to the pill on wide screens, a bottom sheet on
 * phones. Picking one opens its panel and folds the list away. Absent until the agent delegates.
 */
export const SubagentTrack = ({ entries, pending }: SubagentTrackProps) => {
  const items = useMemo(() => collectSubagents(entries), [entries]);
  const subagents = useMemo(() => items.map(({ subagent }) => subagent), [items]);
  const [open, setOpen] = useState(false);
  const { agentId, open: openAgent } = useSubagentParam();
  // Agents holding an unanswered request, in the order they asked; the one already open is not a shortcut.
  const askers = useMemo(() => [...new Set(pending.flatMap((request) => request.parentToolUseId ?? []))]
    .flatMap((toolUseId) => subagents.find((subagent) => subagent.toolUseId === toolUseId) ?? []), [pending, subagents]);
  const waiting = askers.find((subagent) => subagent.toolUseId !== agentId) ?? null;
  const wide = useMediaQuery('(min-width: 640px)');
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(close, [agentId, close]);
  useOnClickOutside(containerRef, close, open && wide);
  useOnEscape(() => {
    close();
    pillRef.current?.focus();
  }, open && wide);

  if (items.length === 0) return null;

  const list = <SubagentTrackList items={items} />;

  return (
    <section aria-label="Subagents" className="mx-auto w-full max-w-[60rem] shrink-0 px-2.5 pt-2 sm:px-8">
      <div ref={containerRef} className="relative flex max-w-full flex-wrap items-center gap-2">
        <SubagentTrackPill ref={pillRef} subagents={subagents} open={open} panelId={panelId} onToggle={() => setOpen((current) => !current)} />

        {waiting ? (
          <button
            type="button"
            onClick={() => openAgent(waiting.toolUseId)}
            className="flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-warning-soft px-3 text-xs font-bold text-warning transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <CircleHelp className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">Answer {waiting.agentType ?? 'subagent'}</span>
            {askers.length > 1 ? <span className="shrink-0">+{askers.length - 1}</span> : null}
          </button>
        ) : null}

        {open && wide ? (
          <div
            id={panelId}
            role="dialog"
            aria-label="Subagents"
            className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(32rem,50dvh)] w-[min(32rem,calc(100vw-4rem))] origin-bottom-left overflow-y-auto overscroll-contain animate-menu-in rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]"
          >
            {list}
          </div>
        ) : null}
      </div>

      {!wide ? (
        <Modal open={open} onClose={close} title="Subagents"
          description={`${items.length} ${items.length === 1 ? 'agent' : 'agents'} delegated in this session.`}>
          <div id={panelId} className="-mx-5 -mt-5 sm:-mx-7 sm:-mt-6">{list}</div>
        </Modal>
      ) : null}
    </section>
  );
};

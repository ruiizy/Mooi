import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { SubagentTrackList } from './SubagentTrackList';
import { SubagentTrackPill } from './SubagentTrackPill';
import { collectSubagents } from '@/features/sessions/lib/collectSubagents';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import { Modal } from '@/shared/components/Modal';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';

interface SubagentTrackProps {
  sessionId: string;
  entries: TranscriptEntry[];
  showThinking: boolean;
}

/**
 * A lane above the composer for the session's delegations: a pill counting them by state, and
 * behind it every subagent — a popover anchored to the pill on wide screens, a bottom sheet on
 * phones. Absent until the agent delegates for the first time.
 */
export const SubagentTrack = ({ sessionId, entries, showThinking }: SubagentTrackProps) => {
  const items = useMemo(() => collectSubagents(entries), [entries]);
  const subagents = useMemo(() => items.map(({ subagent }) => subagent), [items]);
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 640px)');
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useOnClickOutside(containerRef, close, open && wide);
  useOnEscape(() => {
    close();
    pillRef.current?.focus();
  }, open && wide);

  if (items.length === 0) return null;

  const list = <SubagentTrackList sessionId={sessionId} items={items} showThinking={showThinking} />;

  return (
    <section aria-label="Subagents" className="mx-auto w-full max-w-[60rem] shrink-0 px-2.5 pt-2 sm:px-8">
      <div ref={containerRef} className="relative inline-flex max-w-full">
        <SubagentTrackPill ref={pillRef} subagents={subagents} open={open} panelId={panelId} onToggle={() => setOpen((current) => !current)} />

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

import { useState } from 'react';
import { SubagentRow } from './SubagentRow';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import type { CollectedSubagent } from '@/features/sessions/types/CollectedSubagent';
import { cn } from '@/shared/utils/cn';

interface SubagentTrackListProps {
  items: CollectedSubagent[];
}

/**
 * Every delegation of the session, nested ones indented under their delegator. Finished agents
 * can be hidden so a long-running session keeps what still matters on top.
 */
export const SubagentTrackList = ({ items }: SubagentTrackListProps) => {
  const [hideFinished, setHideFinished] = useState(false);
  const finished = items.filter(({ subagent }) => isTerminalSubagentStatus(subagent.status)).length;
  const visible = hideFinished ? items.filter(({ subagent }) => !isTerminalSubagentStatus(subagent.status)) : items;

  return (
    <div className="flex flex-col">
      {finished > 0 ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-[11px] text-ink-subtle">
          <span>{finished} finished</span>
          <button
            type="button"
            aria-pressed={hideFinished}
            onClick={() => setHideFinished((current) => !current)}
            className={cn('min-h-8 rounded-full px-2.5 font-bold transition focus-visible:outline-2 focus-visible:outline-brand',
              hideFinished ? 'bg-surface-2 text-ink' : 'hover:bg-surface-2 hover:text-ink')}
          >
            {hideFinished ? 'Show finished' : 'Hide finished'}
          </button>
        </div>
      ) : null}

      {visible.length ? (
        <ul className="divide-y divide-line">
          {visible.map(({ subagent, depth }) => <SubagentRow key={subagent.toolUseId} subagent={subagent} depth={depth} />)}
        </ul>
      ) : <p className="px-3 py-4 text-center text-xs text-ink-subtle">Every subagent has finished.</p>}
    </div>
  );
};

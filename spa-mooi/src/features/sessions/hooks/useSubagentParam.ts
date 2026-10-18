import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const PARAM = 'agent';

interface SubagentParam {
  /** The delegating call of the subagent open in the panel, if any. */
  agentId: string | null;
  open: (toolUseId: string) => void;
  close: () => void;
}

/**
 * The open subagent lives in `?agent=` so it can be linked and survives a reload. Opening pushes a
 * history entry, so Back closes the panel; closing replaces it, so it never stacks entries. Other
 * params (a platform page's `?tab=`) are kept.
 */
export const useSubagentParam = (): SubagentParam => {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentId = searchParams.get(PARAM);

  const open = useCallback((toolUseId: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set(PARAM, toolUseId);
    return next;
  }), [setSearchParams]);

  const close = useCallback(() => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete(PARAM);
    return next;
  }, { replace: true }), [setSearchParams]);

  return { agentId, open, close };
};

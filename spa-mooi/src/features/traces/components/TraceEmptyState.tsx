import { Activity, CircleAlert, LoaderCircle, RotateCw, SearchX } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { EmptyState } from '@/shared/components/EmptyState';

export type TraceEmptyKind = 'loading' | 'empty' | 'error' | 'noMatch';

interface TraceEmptyStateProps {
  kind: TraceEmptyKind;
  /** The error message (kind `error`). */
  message?: string | null;
  /** Retry (kind `error`) or clear the filters (kind `noMatch`). */
  onAction?: () => void;
}

const COPY: Record<TraceEmptyKind, { icon: typeof Activity; title: string; description: string }> = {
  loading: { icon: LoaderCircle, title: 'Loading trace…', description: "Reading the agent's session log." },
  empty: {
    icon: Activity,
    title: 'No steps yet',
    description: "Send a message: every prompt, turn (model call), tool call and sub-agent of the agent shows up here as it runs.",
  },
  error: { icon: CircleAlert, title: 'Could not load the trace', description: 'The session log could not be read.' },
  noMatch: { icon: SearchX, title: 'No matching steps', description: 'Nothing in this trace matches the filters.' },
};

/** The trace's loading, empty, error and no-match states, centred in the panel body. */
export const TraceEmptyState = ({ kind, message, onAction }: TraceEmptyStateProps) => {
  const copy = COPY[kind];
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-6">
      <EmptyState icon={copy.icon} title={copy.title} description={kind === 'error' && message ? message : copy.description}>
        {onAction && kind === 'error' ? (
          <Button variant="secondary" size="sm" onClick={onAction}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        ) : null}
        {onAction && kind === 'noMatch' ? (
          <Button variant="secondary" size="sm" onClick={onAction}>
            Clear filters
          </Button>
        ) : null}
      </EmptyState>
    </div>
  );
};

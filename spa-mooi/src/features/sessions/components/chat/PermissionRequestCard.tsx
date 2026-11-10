import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import { Button } from '@/shared/components/Button';

type PermissionPending = Extract<SessionPendingRequest, { kind: 'permission' }>;

interface PermissionRequestCardProps {
  request: PermissionPending;
  editable: boolean;
  busy: boolean;
  onAllow: (requestId: string, updatedInput?: Record<string, unknown>) => void;
  onDeny: (requestId: string, message?: string) => void;
}

/**
 * The agent is blocked on a tool-use approval. The input is only editable when the session's
 * provider declares `editableToolInput` — a provider without it ignores the field,
 * so sending an edit it never asked for would silently do nothing.
 */
export const PermissionRequestCard = ({ request, editable, busy, onAllow, onDeny }: PermissionRequestCardProps) => {
  const inputText = JSON.stringify(request.input, null, 2);
  const [draft, setDraft] = useState(inputText);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setDraft(inputText);
    setReason('');
  }, [request.requestId, inputText]);

  let parsedInput: Record<string, unknown> | null = null;
  let parseError: string | null = null;

  if (editable) {
    try {
      const value = JSON.parse(draft) as unknown;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsedInput = value as Record<string, unknown>;
      } else {
        parseError = 'Must be a JSON object.';
      }
    } catch {
      parseError = 'Invalid JSON.';
    }
  }

  return (
    <div className="rounded-card border border-warning/30 bg-warning-soft/60 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{request.title}</p>
          <p className="text-xs text-ink-subtle">
            wants to run <span className="font-mono">{request.toolName}</span>
          </p>
        </div>
      </div>

      {editable ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          rows={Math.min(10, draft.split('\n').length + 1)}
          aria-label="Tool input"
          className="mt-3 max-h-64 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink focus:border-brand/50 focus:outline-none"
        />
      ) : (
        <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
          {inputText}
        </pre>
      )}

      {parseError ? <p className="mt-1.5 text-xs text-danger">{parseError}</p> : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for denying (optional)"
          autoComplete="off"
          aria-label="Reason for denying"
          className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-brand/50 focus:outline-none sm:flex-1"
        />

        <div className="flex shrink-0 gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => onDeny(request.requestId, reason.trim().length > 0 ? reason.trim() : undefined)}
          >
            Deny
          </Button>
          <Button
            variant="brand"
            size="sm"
            disabled={busy || (editable && parseError !== null)}
            onClick={() => onAllow(request.requestId, editable ? (parsedInput ?? undefined) : undefined)}
          >
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
};

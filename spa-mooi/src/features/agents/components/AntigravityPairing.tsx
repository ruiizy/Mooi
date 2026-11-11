import { useEffect, useRef, useState } from 'react';
import { ExternalLink, KeyRound, LoaderCircle } from 'lucide-react';
import {
  AntigravityAuthorizationError, cancelAntigravityAuthorization, completeAntigravityAuthorization,
  startAntigravityAuthorization,
} from '@/features/agents/api/antigravityApi';
import type { AgentProviderCopy } from '@/features/agents/lib/agentProviderCopy';
import type { AntigravityAuthorization } from '@/features/agents/types/AntigravityAuthorization';
import { Button } from '@/shared/components/Button';
import { useAgentsStore } from '@/stores/agentsStore';

interface AntigravityPairingProps {
  name: string;
  copy: AgentProviderCopy['signIn'];
  onConnected: () => void;
}

/**
 * The Antigravity sign-in: the sessions API runs `agy`'s own Google sign-in, the player opens Google's
 * page in a new tab, signs in and pastes the code it shows. The attempt is cancelled when this view
 * closes before the account is linked, so no temporary sign-in outlives it.
 */
export const AntigravityPairing = ({ name, copy, onConnected }: AntigravityPairingProps) => {
  const [attempt, setAttempt] = useState<AntigravityAuthorization | null>(null);
  const [run, setRun] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    // Deferred so a development double mount never starts (and replaces) two attempts.
    const timer = setTimeout(() => void startAntigravityAuthorization(name.trim()).then((value) => {
      if (disposed) { void cancelAntigravityAuthorization(value.attemptId).catch(() => {}); return; }
      current.current = value.attemptId;
      setAttempt(value);
    }).catch((cause: Error) => { if (!disposed) setError(cause.message); }), 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (current.current) void cancelAntigravityAuthorization(current.current).catch(() => {});
      current.current = null;
    };
  }, [name, run]);

  const restart = () => {
    setAttempt(null);
    setError(null);
    setCode('');
    setBusy(false);
    setRun((value) => value + 1);
  };

  const connect = () => {
    if (!attempt || !code.trim() || busy) return;
    setBusy(true);
    setError(null);
    completeAntigravityAuthorization(attempt.attemptId, code.trim())
      .then((connection) => {
        current.current = null; // the server closed the attempt with the link
        useAgentsStore.getState().upsertConnection(connection);
        onConnected();
      })
      .catch((cause: unknown) => {
        setBusy(false);
        const status = cause instanceof AntigravityAuthorizationError ? cause.status : 0;
        // 400 and 409 leave the attempt usable; every other failure closed it on the server.
        if (status !== 400 && status !== 409) current.current = null;
        setError(cause instanceof Error ? cause.message : 'Could not link Antigravity. Try again.');
      });
  };

  if (!attempt) {
    return error ? <div className="flex flex-col gap-3">
      <p role="alert" className="text-sm text-danger">{error}</p>
      <Button variant="secondary" size="sm" onClick={restart}>Try again</Button>
    </div> : <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <LoaderCircle className="size-4 animate-spin" /> Preparing secure sign-in…
    </p>;
  }

  return <div className="flex flex-col gap-4">
    <p className="text-sm text-ink-muted">{copy.instructions}</p>
    <a href={attempt.authorizationUrl} target="_blank" rel="noopener noreferrer"
      className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white">
      {copy.action} <ExternalLink className="size-4" />
    </a>
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink-muted">Authorization code</span>
      <span className="flex h-12 items-center gap-2 rounded-control border border-line bg-surface-2 px-3 focus-within:border-brand">
        <KeyRound className="size-4 shrink-0 text-ink-subtle" />
        <input value={code} onChange={(event) => setCode(event.target.value)} disabled={busy}
          onKeyDown={(event) => { if (event.key === 'Enter') connect(); }}
          placeholder="Paste the code" autoComplete="off" spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
      </span>
    </label>
    <Button variant="brand" onClick={connect} disabled={busy || !code.trim()}>
      {busy ? 'Connecting…' : 'Connect account'}
    </Button>
    {error && <div className="flex flex-col gap-2">
      <p role="alert" className="text-sm text-danger">{error}</p>
      {!busy && <button type="button" onClick={restart}
        className="self-start text-xs font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">
        Start the sign-in again
      </button>}
    </div>}
    <p className="text-xs text-ink-subtle">{copy.codeHint}</p>
  </div>;
};

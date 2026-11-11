import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, LoaderCircle } from 'lucide-react';
import { completeAgentAuthorization, startAgentAuthorization } from '@/features/agents/api/agentsApi';
import type { AgentProviderCopy } from '@/features/agents/lib/agentProviderCopy';
import type { AgentAuthorizationResponse } from '@/features/agents/types/AgentAuthorizationResponse';
import { Button } from '@/shared/components/Button';
import { useAgentsStore } from '@/stores/agentsStore';

interface AuthorizationCodePairingProps {
  provider: string;
  name: string;
  copy: AgentProviderCopy['signIn'];
  onConnected: () => void;
}

/**
 * A provider sign-in that ends on the provider's own page showing a code to paste back here: the
 * Claude Code sign-in (Anthropic's page), since that client only redirects there. The code is redeemed by the API with the state it signed, so this
 * component never handles a token.
 */
export const AuthorizationCodePairing = ({ provider, name, copy, onConnected }: AuthorizationCodePairingProps) => {
  const [attempt, setAttempt] = useState<AgentAuthorizationResponse | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    startAgentAuthorization(provider)
      .then((value) => { if (!disposed) setAttempt(value); })
      .catch((cause: Error) => { if (!disposed) setError(cause.message); });
    return () => { disposed = true; };
  }, [provider]);

  const connect = () => {
    if (!attempt || !code.trim()) return;
    setBusy(true);
    setError(null);
    completeAgentAuthorization(provider, code.trim(), attempt.state, name)
      .then((connection) => {
        useAgentsStore.getState().upsertConnection(connection);
        onConnected();
      })
      .catch((cause: Error) => {
        setBusy(false);
        setError(cause.message);
      });
  };

  if (!attempt) {
    return error ? <p role="alert" className="text-sm text-danger">{error}</p>
      : <p role="status" className="flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle className="size-4 animate-spin" /> Preparing secure sign-in…</p>;
  }

  return <div className="flex flex-col gap-4">
    <p className="text-sm text-ink-muted">{copy.instructions}</p>
    <a href={attempt.authorizeUrl} target="_blank" rel="noopener noreferrer"
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
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <p className="text-xs text-ink-subtle">{copy.codeHint}</p>
  </div>;
};

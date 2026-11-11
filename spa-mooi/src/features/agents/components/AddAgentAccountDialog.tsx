import { useState } from 'react';
import { Check, KeyRound, LogIn } from 'lucide-react';
import { AuthorizationCodePairing } from '@/features/agents/components/AuthorizationCodePairing';
import { CodexPairing } from '@/features/agents/components/CodexPairing';
import { agentProviderCopy } from '@/features/agents/lib/agentProviderCopy';
import type { AgentProvider } from '@/features/agents/types/AgentProvider';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { cn } from '@/shared/utils/cn';

interface AddAgentAccountDialogProps {
  providers: AgentProvider[];
  busy: boolean;
  actionError: string | null;
  onClose: () => void;
  onConnected: () => void;
  onConnectToken: (provider: string, token: string, name: string) => Promise<boolean>;
}

type Method = 'sign-in' | 'paste';

/**
 * How a provider may be linked, as the API reports it. A pasted setup token is only the fallback for a
 * provider whose sign-in is off (it is deprecated); an API key is a way in of its own, offered next to
 * the sign-in.
 */
const methodsOf = (provider: AgentProvider | undefined): Method[] => {
  if (!provider) return [];
  const signIn = provider.modes.includes('oauth') && provider.oauthEnabled;
  if (provider.modes.includes('api_key')) return signIn ? ['sign-in', 'paste'] : ['paste'];
  if (signIn) return ['sign-in'];
  return provider.modes.includes('setup_token') ? ['paste'] : [];
};

const optionClass = (selected: boolean) => cn(
  'flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60',
  selected ? 'border-brand bg-brand/10 text-ink' : 'border-line bg-surface-2 text-ink-muted hover:border-line-strong',
);

export const AddAgentAccountDialog = ({ providers, busy, actionError, onClose, onConnected,
  onConnectToken }: AddAgentAccountDialogProps) => {
  const [title, setTitle] = useState('');
  const [providerId, setProviderId] = useState('');
  const [choice, setChoice] = useState<Method | null>(null);
  const [token, setToken] = useState('');
  const [pairing, setPairing] = useState(false);
  const provider = providers.find((entry) => entry.id === providerId);
  const copy = provider ? agentProviderCopy(provider.id, provider.label) : null;
  const validTitle = title.trim().length > 0;
  const isCodex = provider?.modes.includes('device_oauth');
  const methods = methodsOf(provider);
  const method = choice && methods.includes(choice) ? choice : methods[0];
  const signsIn = isCodex || method === 'sign-in';

  const connect = () => {
    if (!provider || !validTitle) return;
    if (signsIn) {
      setPairing(true);
    } else if (token.trim()) {
      void onConnectToken(provider.id, token.trim(), title.trim()).then((success) => {
        if (success) onClose();
      });
    }
  };

  return <Modal open onClose={onClose} title="Add agent account"
    description="Give this account a name, choose its provider, then connect it."
    footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      {!pairing && <Button variant="brand" onClick={connect}
        disabled={busy || !validTitle || !provider || (!signsIn && !token.trim())}>
        {busy ? 'Connecting…' : signsIn ? 'Continue to sign-in' : 'Connect account'}
      </Button>}
    </>}>
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-ink-muted">Account title <span className="text-danger">*</span></span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100}
          disabled={pairing} required autoFocus placeholder="e.g. Claude Ana or Gemini Joserra"
          className="h-12 rounded-control border border-line bg-surface-2 px-3 text-sm text-ink outline-none transition focus:border-brand disabled:opacity-60" />
      </label>
      <div>
        <span className="text-xs font-semibold text-ink-muted">Provider <span className="text-danger">*</span></span>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {providers.map((entry) => <button key={entry.id} type="button" disabled={pairing}
            onClick={() => { setProviderId(entry.id); setChoice(null); setToken(''); }}
            aria-pressed={entry.id === providerId} className={optionClass(entry.id === providerId)}>
            {entry.label}{entry.id === providerId && <Check className="size-4 text-brand" />}
          </button>)}
        </div>
      </div>
      {provider && copy && methods.length > 1 && <div>
        <span className="text-xs font-semibold text-ink-muted">Connect with</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {methods.map((entry) => <button key={entry} type="button" disabled={pairing}
            onClick={() => { setChoice(entry); setToken(''); }}
            aria-pressed={entry === method} className={optionClass(entry === method)}>
            <span className="flex items-center gap-2">
              {entry === 'sign-in' ? <LogIn className="size-4" /> : <KeyRound className="size-4" />}
              {entry === 'sign-in' ? `${provider.label} sign-in` : copy.pasted.label}
            </span>
            {entry === method && <Check className="size-4 text-brand" />}
          </button>)}
        </div>
      </div>}
      {provider && copy && !signsIn && <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-ink-muted">{copy.pasted.label}</span>
        <span className="flex h-12 items-center gap-2 rounded-control border border-line bg-surface-2 px-3 focus-within:border-brand">
          <KeyRound className="size-4 shrink-0 text-ink-subtle" />
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)}
            placeholder={copy.pasted.placeholder} autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
        </span>
        <span className="text-xs text-ink-subtle">
          {copy.pasted.hint}{copy.pasted.command && <> <code>{copy.pasted.command}</code></>}{copy.pasted.hintEnd}
        </span>
      </label>}
      {pairing && isCodex && <CodexPairing name={title.trim()} onConnected={() => { onConnected(); onClose(); }} />}
      {pairing && provider && copy && !isCodex && <AuthorizationCodePairing provider={provider.id} name={title.trim()}
        copy={copy.signIn} onConnected={() => { onConnected(); onClose(); }} />}
      {actionError && <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{actionError}</p>}
    </div>
  </Modal>;
};

import { useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, LoaderCircle, Sparkles } from 'lucide-react';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import type { PlatformAgentCopy } from '@/features/platform/types/PlatformAgentCopy';
import type { PlatformChatRequest } from '@/features/platform/types/PlatformChatRequest';
import { useDictation } from '@/features/dictation/hooks/useDictation';
import { DictationButton } from '@/features/dictation/components/DictationButton';
import { AgentModelFields } from '@/features/sessions/components/AgentModelFields';
import { useAgentModelChoice } from '@/features/sessions/hooks/useAgentModelChoice';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';

interface PlatformAgentDialogProps {
  copy: PlatformAgentCopy;
  projectName: string;
  connections: AgentConnection[];
  busy: boolean;
  error: string | null;
  /** The request may be left empty (e.g. fixing a failure the agent reads by itself). */
  optionalPrompt: boolean;
  suggestions?: string[];
  /** Shown when a live chat of this kind exists and will be replaced. */
  replaceNotice?: string | null;
  buildMessage: (prompt: string) => string;
  onClose: () => void;
  onSubmit: (request: PlatformChatRequest) => void;
}

/** Chooses the agent and the request that opens a platform chat; Enter submits, Shift+Enter breaks lines. */
export const PlatformAgentDialog = ({ copy, projectName, connections, busy, error, optionalPrompt, suggestions = [],
  replaceNotice, buildMessage, onClose, onSubmit }: PlatformAgentDialogProps) => {
  const choice = useAgentModelChoice(true, connections);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(promptRef);
  const [prompt, setPrompt] = useState('');
  const valid = choice.ready && (optionalPrompt || prompt.trim().length > 0);

  const submit = () => {
    if (!valid || busy) return;
    dictation.finish();
    onSubmit({ provider: choice.provider, connectionId: choice.connectionId, model: choice.model,
      effort: choice.effort || null, message: buildMessage(prompt) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return <Modal open size="lg" onClose={busy ? () => undefined : onClose} title={copy.title}
    description={`${projectName} · ${copy.description}`}
    footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="brand" onClick={submit} disabled={!valid || busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? 'Starting…' : copy.action}
      </Button>
    </>}>
    <div className="flex flex-col gap-5 sm:gap-6">
      <AgentModelFields choice={choice} onLeave={onClose} />

      {/* On phones the request comes first: it is what the dialog is for, the agent defaults rarely change. */}
      {connections.length > 0 ? <label className="flex flex-col gap-2 max-sm:order-first">
        <span className="text-xs font-medium text-ink-muted">{copy.label}</span>
        <div className="rounded-[12px] border border-line bg-surface-2 transition focus-within:border-brand/50">
          <textarea ref={promptRef} autoFocus rows={5} value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onKeyDown} placeholder={copy.placeholder} maxLength={20000}
            className="block min-h-28 w-full resize-y bg-transparent p-3.5 text-sm leading-6 sm:min-h-32 text-ink placeholder:text-ink-subtle focus:outline-none disabled:opacity-60" />
          <div className="flex items-center justify-between gap-3 border-t border-line py-1.5 pr-1.5 pl-3.5 text-[11px] text-ink-subtle">
            <span className="inline-flex items-center gap-1.5 pointer-coarse:invisible"><CornerDownLeft className="size-3.5" />Enter to start · Shift+Enter for a new line</span>
            <span className="inline-flex items-center gap-2">
              <span className="tabular-nums">{prompt.length > 0 ? prompt.length : ''}</span>
              <DictationButton field={promptRef} dictation={dictation} disabled={busy} className="size-8" />
            </span>
          </div>
        </div>
        {suggestions.length > 0 && prompt.length === 0 ? <div className="flex flex-wrap gap-2 pt-1">
          {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setPrompt(suggestion)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
            {suggestion}
          </button>)}
        </div> : null}
      </label> : null}

      {replaceNotice ? <p className="rounded-[10px] bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">{replaceNotice}</p> : null}
      {error ? <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p> : null}
    </div>
  </Modal>;
};

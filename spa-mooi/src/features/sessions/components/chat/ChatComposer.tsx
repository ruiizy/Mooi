import { ChatUsageIndicators } from './ChatUsageIndicators';
import type { SessionUsage } from '@/features/sessions/types/SessionUsage';
import type { SessionConfiguration } from '@/features/sessions/types/SessionConfiguration';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';
import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowUp, ImagePlus, MessageCircleQuestion, RotateCw, Square } from 'lucide-react';
import type { SessionStatus } from '@/features/sessions/types/SessionStatus';
import { useDictation } from '@/features/dictation/hooks/useDictation';
import { DictationButton } from '@/features/dictation/components/DictationButton';
import { useImageDraft } from '@/features/sessions/hooks/useImageDraft';
import { imageFilesFrom } from '@/features/sessions/lib/imageFilesFrom';
import type { PreparedImage } from '@/features/sessions/types/PreparedImage';
import { AttachImageButton } from './AttachImageButton';
import { ComposerImageStrip } from './ComposerImageStrip';
import { ComposerModelMenu } from './ComposerModelMenu';
import { ComposerSelect } from './ComposerSelect';
import { SlashCommandMenu } from './SlashCommandMenu';
import { matchSlashCommands } from '@/features/sessions/lib/matchSlashCommands';
import { parseSlashCommand } from '@/features/sessions/lib/parseSlashCommand';
import { slashCommandOptionId } from '@/features/sessions/lib/slashCommandOptionId';
import { slashCommands } from '@/features/sessions/lib/slashCommands';
import type { ParsedSlashCommand } from '@/features/sessions/types/ParsedSlashCommand';
import type { SlashCommand } from '@/features/sessions/types/SlashCommand';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/utils/cn';

interface ChatComposerProps {
  status: SessionStatus;
  usage?: SessionUsage;
  busy: boolean;
  deploying?: boolean;
  model: string;
  effort: string | null;
  modelOptions: SessionProvider['models'];
  modelLoading: boolean;
  modelError: string | null;
  canInterrupt: boolean;
  hasConversation: boolean;
  /** The provider takes images; each model may still decline them. */
  acceptsImages?: boolean;
  onSend: (text: string, images: PreparedImage[]) => Promise<boolean>;
  onInterrupt: () => Promise<boolean>;
  /** The session failed with its agent and workspace intact: offer to reconnect it. */
  recoverable?: boolean;
  onRecover: () => Promise<boolean>;
  onCompact: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
  /** The agent answers `/btw` side questions, even while a turn runs. */
  canAskAside?: boolean;
  /** A side question is still being answered. */
  askingAside?: boolean;
  onAside: (question: string) => void;
  onConfigurationChange: (configuration: SessionConfiguration) => void;
  /** Extra toolbar actions next to the context indicator, e.g. applying a recipe. */
  actions?: ReactNode;
}

/** The draft stays mounted while a turn runs so an interruption never loses user input. */
const hints: Partial<Record<SessionStatus, string>> = {
  provisioning: 'Preparing the workspace…',
  failed: 'This session failed and no longer takes messages.',
  closed: 'This session is closed.',
  compacting: 'Compacting context… Your draft is saved.',
};
const recoverableHint = 'The agent lost its connection. Your draft, workspace and changes are kept.';

export const ChatComposer = ({
  status,
  usage,
  busy,
  deploying = false,
  model,
  effort,
  modelOptions,
  modelLoading,
  modelError,
  canInterrupt,
  hasConversation,
  acceptsImages = false,
  onSend,
  onInterrupt,
  recoverable = false,
  onRecover,
  onCompact,
  onClear,
  canAskAside = false,
  askingAside = false,
  onAside,
  onConfigurationChange,
  actions,
}: ChatComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(textareaRef);
  const menuId = useId();
  const [value, setValue] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  // The draft the command menu was dismissed on; typing anything else reopens it.
  const [menuDismissedOn, setMenuDismissedOn] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const draft = useImageDraft();

  const effortOptions = modelOptions.find((option) => option.id === model)?.efforts ?? [];
  const configurationDisabled = deploying || busy || status === 'closed' || status === 'failed' || status === 'compacting' || modelLoading || Boolean(modelError);

  const changeModel = (nextModel: string) => {
    const option = modelOptions.find((entry) => entry.id === nextModel);
    const supported = option?.efforts ?? [];
    onConfigurationChange({ model: nextModel, effort: effort && supported.includes(effort)
      ? effort : option?.defaultEffort ?? supported[0] ?? null });
  };

  const reconnectable = status === 'failed' && recoverable;
  const hint = (reconnectable ? recoverableHint : hints[status]) ?? (deploying ? 'Deployment in progress. Your draft is saved; chat resumes when it finishes.' : null);
  const blocked = hint !== null;
  const { finish } = dictation;
  useEffect(() => {
    if (blocked) finish();
  }, [blocked, finish]);
  const activeTurn = status === 'working' || status === 'waiting';
  const imagesReason = modelOptions.find((option) => option.id === model)?.images === false
    ? 'The selected model does not accept images' : null;
  const canAttach = acceptsImages && !blocked && !draft.full;
  const readyImages = draft.images.filter((image) => image.status === 'ready');
  const hasImages = draft.images.length > 0;
  const sendable = (value.trim().length > 0 || readyImages.length > 0) && !draft.preparing && !(hasImages && imagesReason);
  const commands = slashCommands.filter((command) => command.name !== 'btw' || canAskAside);
  const suggestions = blocked ? [] : matchSlashCommands(value, commands);
  const menuOpen = suggestions.length > 0 && menuDismissedOn !== value;
  const activeIndex = Math.min(menuIndex, suggestions.length - 1);
  const command = parseSlashCommand(value);
  const aside = command?.name === 'btw' && canAskAside ? command : null;
  const asideReady = Boolean(aside?.argument) && !askingAside && !blocked;
  const imageStatus = draft.notice ?? (hasImages && imagesReason ? `${imagesReason}. Pick another model or remove them.` : null);

  const attach = (files: File[]) => {
    if (acceptsImages && !blocked) draft.add(files);
  };

  const onDragOver = (event: DragEvent) => {
    if (!acceptsImages || blocked || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const resize = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      // Collapsing to `auto` to measure resets the scroll: keep the reader (or a dictation) where it was.
      const { scrollTop } = textarea;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
      textarea.scrollTop = scrollTop;
    }
  };

  useLayoutEffect(() => {
    resize();
  }, [status, value]);

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const runCommand = async ({ name, argument }: ParsedSlashCommand) => {
    if (name === 'btw') {
      if (!asideReady) return;
      dictation.finish();
      setValue('');
      resetHeight();
      onAside(argument);
      return;
    }
    if (blocked || activeTurn || busy || status !== 'ready' || !hasConversation) return;
    dictation.finish();
    if (await (name === 'compact' ? onCompact() : onClear())) setValue('');
  };

  const pick = (picked: SlashCommand) => {
    setMenuIndex(0);
    if (picked.takesArgument) {
      setValue(`/${picked.name} `);
      textareaRef.current?.focus();
    } else {
      void runCommand({ name: picked.name, argument: '' });
    }
  };

  const submit = async () => {
    if (command && (command.name !== 'btw' || aside)) {
      await runCommand(command);
      return;
    }

    const text = value.trim();

    if (!sendable || blocked || activeTurn || busy || status !== 'ready') {
      return;
    }

    dictation.finish();
    const sent = readyImages;
    if (!await onSend(text, sent.flatMap((image) => image.prepared ? [image.prepared] : []))) return;
    setValue((current) => current.trim() === text ? '' : current);
    draft.discard(sent.map((image) => image.key));
    resetHeight();
  };

  return (
    <div className="mx-auto w-full max-w-[60rem] shrink-0 bg-surface px-2.5 pt-2 pb-[max(0.625rem,var(--safe-bottom))] sm:px-8 sm:pt-3 sm:pb-6">
      <div
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!dragging) return;
          event.preventDefault();
          setDragging(false);
          attach(imageFilesFrom(event.dataTransfer));
        }}
        className={cn('relative rounded-2xl border bg-surface-2 transition focus-within:border-ink',
          dragging ? 'border-brand' : 'border-line')}
      >
        {dragging ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-brand bg-brand-soft/90 text-sm font-semibold text-brand-strong">
            <ImagePlus className="size-5" />
            Drop images to attach
          </div>
        ) : null}
        {menuOpen ? (
          <SlashCommandMenu id={menuId} commands={suggestions} activeIndex={activeIndex} onPick={pick} onHover={setMenuIndex} />
        ) : null}
        {hasImages ? <ComposerImageStrip images={draft.images} onRemove={draft.remove} /> : null}
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          disabled={blocked}
          onChange={(event) => {
            setValue(event.target.value);
            setMenuIndex(0);
          }}
          onPaste={(event) => {
            const files = acceptsImages ? imageFilesFrom(event.clipboardData) : [];
            if (files.length === 0) return;
            // A screenshot carries no text: keep the native paste only when there is text to insert.
            if (!event.clipboardData.types.includes('text/plain')) event.preventDefault();
            attach(files);
          }}
          onKeyDown={(event) => {
            if (menuOpen && !event.nativeEvent.isComposing) {
              const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
              if (step) {
                event.preventDefault();
                setMenuIndex((activeIndex + step + suggestions.length) % suggestions.length);
                return;
              }
              if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault();
                pick(suggestions[activeIndex]);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setMenuDismissedOn(value);
                return;
              }
            }
            if (
              event.key === 'Enter'
              && !event.nativeEvent.isComposing
              && event.nativeEvent.keyCode !== 229
              && !event.shiftKey
              && !event.metaKey
              && !event.ctrlKey
              && !event.altKey
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={hint ? undefined : 'Describe the next change, or type / for commands'}
          aria-label="Message the agent"
          aria-autocomplete="list"
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={menuOpen ? slashCommandOptionId(menuId, activeIndex) : undefined}
          enterKeyHint="send"
          data-compose
          className="max-h-[min(12rem,25dvh)] w-full resize-none bg-transparent px-4 pt-3 text-base leading-relaxed keyboard:max-h-32 sm:px-5 sm:pt-4 text-ink placeholder:text-ink-subtle focus:outline-none disabled:cursor-not-allowed"
        />
        {hint ? <p role="status" className="px-4 pb-2 text-xs text-ink-muted sm:px-5">{hint}</p> : null}
        {imageStatus ? <p role="status" className="px-4 pb-2 text-xs text-warning sm:px-5">{imageStatus}</p> : null}

        {aside && !blocked ? (
          <p role="status" className="flex items-center gap-1.5 px-4 pb-2 text-xs font-medium text-brand-strong sm:px-5">
            <MessageCircleQuestion className="size-3.5 shrink-0" aria-hidden="true" />
            {askingAside ? 'Wait for the current side question to be answered.' : 'Side question: answered apart, without interrupting the agent or entering the chat.'}
          </p>
        ) : activeTurn ? (
          <p className="px-4 pb-2 text-xs text-ink-muted sm:px-5">
            Model and effort changes apply to your next message.{canAskAside ? <> Type <kbd className="font-mono font-semibold text-ink">/btw</kbd> to ask a side question meanwhile.</> : null}
          </p>
        ) : null}

        {/* One row at every width: phones fold the pickers into a chip, wider screens scroll them sideways. */}
        <div className="relative flex items-center gap-1 px-1.5 pb-1.5 sm:gap-2 sm:px-2 sm:pb-2">
          <ChatUsageIndicators usage={usage} loading={status === 'provisioning' || status === 'compacting'}
            actionsDisabled={busy || deploying || status !== 'ready' || !hasConversation}
            onCompact={onCompact} onClear={onClear} />
          {actions}
          {modelOptions.length > 0 ? (
            <div className="flex min-w-0 flex-1 sm:hidden">
              <ComposerModelMenu model={model} effort={effort} effortOptions={effortOptions}
                modelOptions={modelOptions.map((option) => ({ value: option.id, label: option.label }))}
                onModelChange={changeModel} onEffortChange={(value) => onConfigurationChange({ model, effort: value || null })}
                disabled={configurationDisabled} />
            </div>
          ) : null}
          <div className={cn('min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex sm:gap-2 [&::-webkit-scrollbar]:hidden',
            modelOptions.length > 0 ? 'hidden' : 'flex')}>
          {modelOptions.length > 0 ? (
            <>
              <ComposerSelect value={model} options={modelOptions.map((option) => ({ value: option.id, label: option.label }))}
                onChange={changeModel} disabled={configurationDisabled} ariaLabel="Agent model"
                describedBy={modelError ? 'model-error' : undefined} />
              {modelError ? <span id="model-error" className="sr-only">{modelError}</span> : null}
            </>
          ) : modelLoading ? (
            <span className="text-xs text-ink-subtle" role="status">Loading models…</span>
          ) : modelError ? (
            <span className="max-w-[16rem] truncate text-xs text-danger" role="alert" title={modelError}>{modelError}</span>
          ) : null}

          {effortOptions.length > 0 ? (
            <ComposerSelect value={effort ?? ''} options={effortOptions.map((option) => ({ value: option, label: option }))}
              onChange={(value) => onConfigurationChange({ model, effort: value || null })}
              disabled={configurationDisabled} ariaLabel="Agent effort" caption="Effort" />
          ) : null}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            {!activeTurn && !blocked ? <span className="mr-1 hidden text-xs text-ink-subtle lg:flex">Enter to send · Shift+Enter for a new line</span> : null}

            {acceptsImages && !blocked ? (
              <AttachImageButton onPick={attach} disabled={!canAttach} reason={imagesReason} className="max-sm:size-10" />
            ) : null}

            {!blocked ? <DictationButton field={textareaRef} dictation={dictation} className="max-sm:size-10" /> : null}

            {activeTurn && aside ? (
              <Button variant="brand" onClick={() => void submit()} disabled={!asideReady} ariaLabel="Ask side question"
                className="size-10 shrink-0 p-0 sm:size-11">
                <MessageCircleQuestion className="size-4" />
              </Button>
            ) : null}

            {activeTurn ? (
              <Button
                variant="danger"
                onClick={() => void onInterrupt()}
                disabled={busy || !canInterrupt}
                ariaLabel="Stop turn"
                className="size-10 shrink-0 p-0 sm:size-11"
              >
                <Square className="size-4" />
              </Button>
            ) : reconnectable ? (
              <Button variant="brand" onClick={() => void onRecover()} disabled={busy} ariaLabel="Reconnect the agent"
                className="h-10 shrink-0 gap-1.5 px-3 sm:h-11 sm:px-4">
                <RotateCw className={cn('size-4', busy && 'animate-spin')} />
                Reconnect
              </Button>
            ) : !blocked ? (
              <Button
                variant="brand"
                onClick={submit}
                disabled={aside ? !asideReady : busy || !sendable}
                ariaLabel={aside ? 'Ask side question' : 'Send message'}
                className="size-10 shrink-0 p-0 sm:size-11"
              >
                {aside ? <MessageCircleQuestion className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

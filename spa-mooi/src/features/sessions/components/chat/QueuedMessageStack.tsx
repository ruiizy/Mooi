import { ImageIcon, ListOrdered, Pencil, X } from 'lucide-react';
import type { QueuedMessage } from '@/features/sessions/types/QueuedMessage';

interface QueuedMessageStackProps {
  messages: QueuedMessage[];
  disabled: boolean;
  /** Takes a text-only message back into the composer, out of the queue. */
  onEdit: (message: QueuedMessage) => void;
  onRemove: (messageId: string) => void;
}

/**
 * Messages waiting for the agent, in the order they go out: each turn's end sends the next one.
 * The queue lives on the server, so every device shows the same one, live.
 */
export const QueuedMessageStack = ({ messages, disabled, onEdit, onRemove }: QueuedMessageStackProps) => {
  if (messages.length === 0) return null;

  return (
    <section aria-label="Queued messages" aria-live="polite" className="mb-2 rounded-2xl border border-line bg-surface-2/70">
      <p className="flex items-center gap-1.5 px-3 pt-2 text-[0.68rem] font-semibold tracking-wide text-ink-muted uppercase sm:px-3.5">
        <ListOrdered className="size-3.5" aria-hidden="true" />
        Queued · {messages.length}
        <span className="truncate font-normal tracking-normal normal-case text-ink-subtle">— sent in order as the agent finishes</span>
      </p>
      <ol className="flex max-h-[min(12rem,24dvh)] flex-col overflow-y-auto overscroll-contain px-1.5 pt-1 pb-1.5">
        {messages.map((message, index) => (
          <li key={message.id} className="flex animate-fade-up items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-surface sm:px-2">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[10px] font-semibold text-ink-muted">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm text-ink" title={message.text}>
              {message.text || <span className="text-ink-subtle">Images only</span>}
            </p>
            {message.images.length > 0 ? (
              <span className="flex shrink-0 items-center gap-1 text-xs text-ink-subtle" title={`${message.images.length} image${message.images.length === 1 ? '' : 's'}`}>
                <ImageIcon className="size-3.5" aria-hidden="true" />
                {message.images.length}
                <span className="sr-only">{message.images.length === 1 ? 'image' : 'images'}</span>
              </span>
            ) : (
              <button type="button" onClick={() => onEdit(message)} disabled={disabled}
                aria-label={`Edit queued message ${index + 1}`} title="Edit"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-subtle transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={() => onRemove(message.id)} disabled={disabled}
              aria-label={`Remove queued message ${index + 1}`} title="Remove"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-subtle transition hover:bg-surface-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">
              <X className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
};

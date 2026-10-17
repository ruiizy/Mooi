import { lazy, Suspense } from 'react';
import { CircleAlert, MessageCircleQuestion, X } from 'lucide-react';
import type { Aside } from '@/features/sessions/types/Aside';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface AsideCardProps {
  aside: Aside;
  onDismiss: (id: number) => void;
}

/** One side question and its streamed answer, set apart from the conversation it never enters. */
export const AsideCard = ({ aside, onDismiss }: AsideCardProps) => (
  <li className="animate-[rise_0.32s_cubic-bezier(0.16,1,0.3,1)_both] rounded-2xl border border-brand/25 bg-brand-soft/50 motion-reduce:animate-none">
    <div className="flex items-start gap-2.5 px-3 pt-2.5 sm:px-3.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-strong">
        <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.68rem] font-semibold tracking-wide text-brand-strong uppercase">Side question · not added to the chat</p>
        <p className="mt-0.5 line-clamp-2 text-sm font-medium break-words text-ink" title={aside.question}>{aside.question}</p>
      </div>
      <button type="button" onClick={() => onDismiss(aside.id)}
        aria-label={aside.status === 'answering' ? 'Cancel side question' : 'Dismiss side question'}
        title={aside.status === 'answering' ? 'Cancel' : 'Dismiss'}
        className="-mt-0.5 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-subtle transition hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
    <div className="px-3 pt-1.5 pb-3 text-sm leading-relaxed break-words text-ink sm:pr-3.5 sm:pl-[3.1rem]">
      {aside.answer ? (
        <Suspense fallback={<p className="whitespace-pre-wrap">{aside.answer}</p>}>
          <MarkdownContent text={aside.answer} />
        </Suspense>
      ) : aside.status === 'answering' ? (
        <span role="status" className="flex items-center gap-2 text-xs text-ink-subtle">
          <span className="flex items-center gap-1">
            {[0, 200, 400].map((delay) => (
              <span key={delay} className="size-1.5 animate-pulse-soft rounded-full bg-brand" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </span>
          Thinking…
        </span>
      ) : null}
      {aside.status === 'failed' ? (
        <p role="alert" className="mt-1 flex items-start gap-1.5 text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {aside.error}
        </p>
      ) : null}
    </div>
  </li>
);

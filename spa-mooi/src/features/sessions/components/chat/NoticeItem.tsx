import { CircleCheck, LoaderCircle, RotateCcw } from 'lucide-react';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import { formatTime } from '@/shared/utils/formatTime';
import { cn } from '@/shared/utils/cn';

type NoticeEntry = Extract<TranscriptEntry, { kind: 'notice' }>;

/** A system milestone or operation state in the transcript, not a chat message. */
export const NoticeItem = ({ entry }: { entry: NoticeEntry }) => {
  const Icon = entry.tone === 'success' ? CircleCheck : entry.tone === 'progress' ? LoaderCircle : RotateCcw;
  return (
    <li className={cn('flex animate-fade-up items-start gap-3 rounded-xl border px-3.5 py-3 text-sm leading-relaxed',
      entry.tone === 'success' ? 'border-success/25 bg-success-soft' : 'border-line bg-surface')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', entry.tone === 'success' ? 'text-success' : 'text-ink-muted', entry.tone === 'progress' && 'animate-spin')} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="font-semibold break-words text-ink">{entry.title}</span>
          <span className="font-mono text-[10.5px] text-ink-subtle">{formatTime(entry.at)}</span>
        </p>
        {entry.text ? <p className="mt-0.5 break-words text-ink-muted">{entry.text}</p> : null}
      </div>
    </li>
  );
};

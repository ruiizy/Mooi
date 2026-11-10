import { memo, useState } from 'react';
import { ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { MessageImageGrid } from './MessageImageGrid';
import { describeStep } from '@/features/sessions/lib/describeStep';
import type { TranscriptStep } from '@/features/sessions/types/TranscriptStep';
import { cn } from '@/shared/utils/cn';

interface ActivityStepRowProps {
  sessionId: string;
  step: TranscriptStep;
}

/** Codex items carry their own bookkeeping next to the input; none of it helps the reader. */
const NOISE_KEYS = new Set(['id', 'type', 'status', 'aggregatedOutput', 'exitCode', 'durationMs', 'commandActions', 'processId']);

const diffLines = (step: TranscriptStep): string[] | null => {
  const { input } = step;
  if (typeof input.diff === 'string' && input.diff.trim()) return input.diff.split('\n');
  const pairs = Array.isArray(input.edits) ? input.edits as Record<string, unknown>[] : [input];
  if (pairs.some((pair) => typeof pair.old_string === 'string' || typeof pair.new_string === 'string')) {
    return pairs.flatMap((pair, index) => [
      ...(index > 0 ? ['@@'] : []),
      ...String(pair.old_string ?? '').split('\n').filter(Boolean).map((line) => `-${line}`),
      ...String(pair.new_string ?? '').split('\n').filter(Boolean).map((line) => `+${line}`),
    ]);
  }
  if (step.name === 'Write' && typeof input.content === 'string') return input.content.split('\n').map((line) => `+${line}`);
  return null;
};

const DiffView = ({ lines }: { lines: string[] }) => (
  <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface font-mono text-[11.5px] leading-relaxed">
    {lines.map((line, index) => (
      <span key={index} className={cn('block px-3 whitespace-pre-wrap break-words',
        line.startsWith('+') && !line.startsWith('+++') ? 'bg-success-soft text-success'
          : line.startsWith('-') && !line.startsWith('---') ? 'bg-danger-soft text-danger'
            : line.startsWith('@@') ? 'text-info' : 'text-ink-subtle')}>
        {line || ' '}
      </span>
    ))}
  </pre>
);

const Output = ({ text, failed }: { text: string; failed: boolean }) => (
  <pre className={cn('max-h-64 overflow-auto rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words',
    failed ? 'text-danger' : 'text-ink-muted')}>
    {text}
  </pre>
);

/**
 * One action inside an activity block: a semantic line ("Searched for useState in src") that opens
 * onto what actually ran — the command and its output, the diff, or the raw input. The result
 * summary is bounded server-side, so it is safe to render in full once asked for.
 */
export const ActivityStepRow = memo(function ActivityStepRow({ sessionId, step }: ActivityStepRowProps) {
  const [open, setOpen] = useState(false);
  const description = describeStep(step);
  const Icon = description.icon;
  const summary = step.summary?.trim() ?? '';
  const failed = step.status === 'failed';
  const diff = description.kind === 'edit' ? diffLines(step) : null;
  const input = Object.fromEntries(Object.entries(step.input).filter(([key]) => !NOISE_KEYS.has(key)));
  const showInput = !description.command && !diff && Object.keys(input).length > 0;
  const expandable = Boolean(description.command || diff || showInput || summary);

  return (
    <li className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className="group/row flex w-full min-w-0 items-center gap-2 rounded-md py-1 pr-1.5 text-left text-[13px] transition enabled:hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-default"
      >
        <span className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface">
          {step.status === 'running' ? <LoaderCircle className="size-3.5 animate-spin text-brand" />
            : failed ? <CircleAlert className="size-3.5 text-danger" />
              : <Icon className="size-3.5 text-ink-subtle" />}
        </span>
        <span className="min-w-0 flex-1 truncate" title={description.command ?? description.detail ?? undefined}>
          <span className={cn('font-medium', failed ? 'text-danger' : step.status === 'running' ? 'text-ink' : 'text-ink-muted')}>{description.verb}</span>
          {description.steps.length ? (
            <span className="ml-1.5 text-ink-subtle">{description.steps.map((part) => part.done).join(' · ')}</span>
          ) : description.detail ? <span className="ml-1.5 font-mono text-[12px] text-ink-subtle">{description.detail}</span> : null}
          {description.failureTag ? <span className="ml-1.5 text-[12px] font-medium text-danger">failed</span> : null}
        </span>
        {expandable ? (
          <ChevronRight className={cn('size-3.5 shrink-0 text-ink-subtle opacity-0 transition group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
            open && 'rotate-90 opacity-100')} />
        ) : null}
      </button>

      {expandable && open ? (
        <div className="mt-1 mb-2 ml-7 flex animate-fade-in flex-col gap-1.5">
          {description.steps.length ? (
            <ol className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]">
              {description.steps.map((part, index) => (
                <li key={index} className="flex min-w-0 gap-2">
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] leading-5 text-ink-subtle tabular-nums">{index + 1}</span>
                  <span className="min-w-0 truncate leading-5">
                    <span className="font-medium text-ink-muted">{part.done}</span>
                    {part.detail ? <span className="ml-1.5 font-mono text-[11.5px] text-ink-subtle">{part.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {description.command ? (
            <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-ink">
              <span className="text-ink-subtle select-none">$ </span>{description.command}
            </pre>
          ) : null}
          {diff ? <DiffView lines={diff} /> : null}
          {showInput ? <Output text={JSON.stringify(input, null, 2)} failed={false} /> : null}
          {summary && !(diff && !failed) ? <Output text={summary} failed={failed} /> : null}
        </div>
      ) : null}

      {/* Returned images are output, not log: they show whenever the block is open. */}
      {step.images.length > 0 ? (
        <div className="mt-1 mb-2 ml-7">
          <MessageImageGrid sessionId={sessionId} images={step.images} align="start" />
        </div>
      ) : null}
    </li>
  );
});

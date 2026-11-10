import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/utils/cn';

type QuestionPending = Extract<SessionPendingRequest, { kind: 'question' }>;

interface QuestionCardProps {
  request: QuestionPending;
  busy: boolean;
  onAnswer: (requestId: string, answers: Record<string, string | string[]>) => void;
}

const OTHER = '__other__';

/**
 * The agent asked one or more structured questions (`AskUserQuestion`). Every question needs an
 * answer — a declared option or free text through "Other" — before the single "Send answers"
 * action builds the `{[question]: label | labels}` payload the SDK expects.
 */
export const QuestionCard = ({ request, busy, onAnswer }: QuestionCardProps) => {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelected({});
    setOtherText({});
  }, [request.requestId]);

  const toggleOption = (question: string, label: string, multiSelect: boolean) => {
    setSelected((current) => {
      const picked = current[question] ?? [];

      if (multiSelect) {
        const next = picked.includes(label) ? picked.filter((item) => item !== label) : [...picked, label];
        return { ...current, [question]: next };
      }

      return { ...current, [question]: picked.includes(label) ? [] : [label] };
    });
  };

  const isAnswered = (question: string): boolean => {
    const picked = selected[question] ?? [];

    if (picked.includes(OTHER)) {
      return (otherText[question] ?? '').trim().length > 0;
    }

    return picked.length > 0;
  };

  const canSubmit = request.questions.every((entry) => isAnswered(entry.question));

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }

    const answers: Record<string, string | string[]> = {};

    for (const entry of request.questions) {
      const picked = selected[entry.question] ?? [];
      const values = picked.map((label) => (label === OTHER ? otherText[entry.question].trim() : label));
      answers[entry.question] = entry.multiSelect ? values : values[0];
    }

    onAnswer(request.requestId, answers);
  };

  return (
    <div className="rounded-card border border-info/30 bg-info-soft/60 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-info" />
        <p className="text-sm font-medium text-ink">The agent needs more information</p>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {request.questions.map((entry) => {
          const picked = selected[entry.question] ?? [];

          return (
            <div key={entry.question}>
              <p className="text-xs font-medium text-ink-muted">{entry.header}</p>
              <p className="mt-0.5 text-sm text-ink">{entry.question}</p>

              <div className="mt-2 flex flex-col gap-1.5">
                {entry.options.map((option) => {
                  const active = picked.includes(option.label);

                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleOption(entry.question, option.label, entry.multiSelect)}
                      className={cn(
                        'min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition',
                        active
                          ? 'border-ink bg-surface-2 text-ink'
                          : 'border-line bg-surface text-ink-muted hover:text-ink',
                      )}
                    >
                      <span className="font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-xs text-ink-subtle">{option.description}</span>
                      ) : null}
                    </button>
                  );
                })}

                <button
                  type="button"
                  aria-pressed={picked.includes(OTHER)}
                  onClick={() => toggleOption(entry.question, OTHER, entry.multiSelect)}
                  className={cn(
                    'min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition',
                    picked.includes(OTHER)
                      ? 'border-ink bg-surface-2 text-ink'
                      : 'border-line bg-surface text-ink-muted hover:text-ink',
                  )}
                >
                  <span className="font-medium">Other</span>
                </button>

                {picked.includes(OTHER) ? (
                  <input
                    value={otherText[entry.question] ?? ''}
                    onChange={(event) =>
                      setOtherText((current) => ({ ...current, [entry.question]: event.target.value }))
                    }
                    placeholder="Type your answer…"
                    autoComplete="off"
                    aria-label={`Answer for ${entry.question}`}
                    className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand/50 focus:outline-none"
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="brand" size="sm" disabled={busy || !canSubmit} onClick={handleSubmit}>
          Send answers
        </Button>
      </div>
    </div>
  );
};

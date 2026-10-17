import { useEffect, type RefObject } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { DictationBars } from '@/features/dictation/components/DictationBars';
import type { DictationController } from '@/features/dictation/types/DictationController';
import { useDictationHotkey } from '@/features/dictation/hooks/useDictationHotkey';
import { useDictationPointer } from '@/features/dictation/hooks/useDictationPointer';
import { DICTATION_STATE_LABELS } from '@/features/dictation/lib/dictationCopy';
import type { DictationField } from '@/features/dictation/types/DictationField';
import { cn } from '@/shared/utils/cn';

interface DictationButtonProps {
  /** The field the transcript is written into, at its cursor. */
  field: RefObject<DictationField | null>;
  dictation: DictationController;
  disabled?: boolean;
  className?: string;
}

const tones = {
  idle: 'text-ink-muted hover:bg-surface-3 hover:text-ink',
  connecting: 'text-ink-muted',
  recording: 'bg-danger-soft text-danger',
  stopping: 'bg-danger-soft text-danger',
} as const;

/**
 * Push-to-talk microphone that lives inside a composer: tap to toggle, hold to talk, or
 * Ctrl+Shift+. while the field has focus. The words appear directly in the field as they are
 * recognized; there is no separate preview.
 */
export const DictationButton = ({ field, dictation, disabled = false, className }: DictationButtonProps) => {
  const handlers = useDictationPointer(dictation);
  useDictationHotkey(field, dictation);
  const { state, error, isActive, finish } = dictation;
  const label = error ?? DICTATION_STATE_LABELS[state];

  useEffect(() => {
    if (disabled && isActive()) finish();
  }, [finish, disabled, isActive]);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        {...handlers}
        disabled={disabled || state === 'stopping'}
        aria-label={label}
        title={label}
        aria-pressed={state === 'recording'}
        className={cn(
          'relative inline-flex size-11 shrink-0 touch-none items-center justify-center rounded-[10px] transition duration-200 select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
          error && state === 'idle' ? 'text-danger hover:bg-danger-soft' : tones[state],
          className,
        )}
      >
        {state === 'recording' ? (
          <span aria-hidden="true" className="absolute inset-0 rounded-[inherit] ring-1 ring-danger/40 motion-safe:animate-pulse-soft" />
        ) : null}
        {state === 'connecting' || state === 'stopping' ? (
          <Loader2 aria-hidden="true" className="size-4.5 animate-spin" />
        ) : state === 'recording' ? (
          <DictationBars />
        ) : error ? (
          <MicOff aria-hidden="true" className="size-4.5" />
        ) : (
          <Mic aria-hidden="true" className="size-4.5" />
        )}
      </button>
      {/* Touch screens have no hover title: the reason the microphone stopped is shown, not hidden. */}
      <span role="status" className={cn(
        'pointer-events-none absolute right-0 bottom-full z-30 mb-2 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-xl bg-contrast px-3 py-2 text-xs leading-snug font-medium text-contrast-ink shadow-lg',
        error ? 'animate-menu-in' : 'sr-only',
      )}>{error ?? ''}</span>
    </span>
  );
};

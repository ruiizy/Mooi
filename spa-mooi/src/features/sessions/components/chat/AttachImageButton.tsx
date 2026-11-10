import { useRef } from 'react';
import { ImagePlus } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface AttachImageButtonProps {
  onPick: (files: File[]) => void;
  disabled?: boolean;
  /** Why attaching is unavailable, e.g. the selected model takes text only. */
  reason?: string | null;
  className?: string;
}

/**
 * Opens the system image picker: the photo library on iOS and Android (`image/*` without `capture`
 * also offers the camera and Files), a file dialog on desktop. Several images can be picked at once.
 */
export const AttachImageButton = ({ onPick, disabled = false, reason = null, className }: AttachImageButtonProps) => {
  const input = useRef<HTMLInputElement>(null);
  const label = reason ?? 'Attach images';

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || Boolean(reason)}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition duration-200 select-none hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
          className,
        )}
      >
        <ImagePlus aria-hidden="true" className="size-4.5" />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          onPick(Array.from(event.target.files ?? []));
          // The same image can be picked again after it was removed.
          event.target.value = '';
        }}
      />
    </>
  );
};

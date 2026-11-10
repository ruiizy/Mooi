import { useLayoutEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/utils/cn';

interface TodoTextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'onSubmit'> {
  value: string;
  onSubmit: () => void;
}

/**
 * An item's text, however long: it wraps and grows instead of scrolling sideways. An item is still
 * one line in the file, so Enter submits and pasted line breaks collapse when the text is normalized.
 */
export const TodoTextArea = ({ value, onSubmit, onKeyDown, className, ...props }: TodoTextAreaProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onKeyDown={handleKey}
      className={cn('resize-none overflow-y-auto [overflow-wrap:anywhere]', className)}
      {...props}
    />
  );
};

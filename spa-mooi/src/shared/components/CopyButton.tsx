import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

export const CopyButton = ({ value, label, className }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-chip transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        copied ? 'text-success' : 'text-ink-subtle hover:bg-surface-3 hover:text-ink',
        className,
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
};

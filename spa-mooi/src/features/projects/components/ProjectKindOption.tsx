import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface ProjectKindOptionProps {
  name: string;
  icon: LucideIcon;
  title: string;
  description: string;
  features: string[];
  checked: boolean;
  onSelect: () => void;
}

/**
 * A radio card: a real `<input type="radio">` under the styling, so arrow keys, focus and screen
 * readers behave exactly like a native radio group.
 */
export const ProjectKindOption = ({
  name,
  icon: Icon,
  title,
  description,
  features,
  checked,
  onSelect,
}: ProjectKindOptionProps) => (
  <label
    className={cn(
      'relative flex cursor-pointer flex-col gap-3 rounded-card border p-4 transition duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
      checked ? 'border-brand bg-brand-soft/60 ring-1 ring-brand' : 'border-line hover:border-line-strong hover:bg-surface-2',
    )}
  >
    <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />

    <span className="flex items-start justify-between gap-3">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-control transition',
          checked ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-muted',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border transition',
          checked ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong',
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    </span>

    <span className="min-w-0">
      <span className="block text-[15px] font-extrabold tracking-[-0.01em] text-ink">{title}</span>
      <span className="mt-1 block text-[12px] leading-relaxed text-ink-muted">{description}</span>
    </span>

    <span className="mt-auto flex flex-wrap gap-1.5">
      {features.map((feature) => (
        <span
          key={feature}
          className={cn(
            'rounded-full px-2 py-0.5 text-[10.5px] font-bold',
            checked ? 'bg-surface text-brand-strong' : 'bg-surface-2 text-ink-subtle',
          )}
        >
          {feature}
        </span>
      ))}
    </span>
  </label>
);

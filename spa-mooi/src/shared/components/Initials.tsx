import { cn } from '@/shared/utils/cn';

interface InitialsProps {
  value: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'size-6 rounded-[6px] text-[9.5px]',
  md: 'size-9 rounded-control text-[11px]',
  lg: 'size-12 rounded-xl text-sm',
};

/** A stable hue per name, so the same repository always wears the same color across the product. */
const hueOf = (value: string): number => {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
};

/** The first two letters of the name over a tinted tile, which is how Mooi labels a repository at a glance. */
export const Initials = ({ value, size = 'md', className }: InitialsProps) => {
  const hue = hueOf(value.toLowerCase());

  return (
    <span
      aria-hidden
      style={{
        backgroundImage: `linear-gradient(140deg, oklch(0.68 0.15 ${hue}), oklch(0.52 0.17 ${(hue + 40) % 360}))`,
      }}
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold tracking-[0.02em] text-white uppercase inset-shadow-[0_1px_0_rgb(255_255_255/0.25)] [text-shadow:0_1px_1px_rgb(0_0_0/0.18)]',
        sizes[size],
        className,
      )}
    >
      {value.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '··'}
    </span>
  );
};

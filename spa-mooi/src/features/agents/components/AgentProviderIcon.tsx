import { Bot } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface AgentProviderIconProps {
  /** The provider id the API reports: `claude`, `codex` or `antigravity`. */
  provider: string;
  className?: string;
}

/** Twelve rays of alternating length around a centre: the Claude spark. */
const CLAUDE_RAYS = Array.from({ length: 12 }, (_, index) => index);

/**
 * The mark of the company behind each provider, drawn inline: lucide v1 ships no brand icons, and a
 * generic bot would not tell a Claude conversation from a Codex or Antigravity one. Antigravity runs
 * Google's models, so it wears the Gemini sparkle. Unknown providers get a neutral bot.
 */
export const AgentProviderIcon = ({ provider, className }: AgentProviderIconProps) => {
  if (provider === 'claude') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4 shrink-0', className)}>
        <g fill="#d97757">
          {CLAUDE_RAYS.map((index) => (
            <rect
              key={index}
              x="11.1"
              y={index % 2 === 0 ? 1 : 3.5}
              width="1.8"
              height={index % 2 === 0 ? 8.6 : 6.1}
              rx="0.9"
              transform={`rotate(${index * 30} 12 12)`}
            />
          ))}
        </g>
      </svg>
    );
  }

  if (provider === 'antigravity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4 shrink-0', className)}>
        <path
          fill="#3186ff"
          d="M12 0C12 6.6 17.4 12 24 12C17.4 12 12 17.4 12 24C12 17.4 6.6 12 0 12C6.6 12 12 6.6 12 0Z"
        />
      </svg>
    );
  }

  if (provider === 'codex') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" className={cn('size-4 shrink-0 text-ink', className)}>
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <rect key={angle} x="7.6" y="2" width="8.8" height="12.4" rx="4.4" transform={`rotate(${angle} 12 12)`} />
        ))}
      </svg>
    );
  }

  return <Bot aria-hidden className={cn('size-4 shrink-0 text-ink-subtle', className)} />;
};

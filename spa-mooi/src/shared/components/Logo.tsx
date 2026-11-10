import { env } from '@/config/env';
import { LogoMark } from '@/shared/components/LogoMark';

interface LogoProps {
  compact?: boolean;
}

export const Logo = ({ compact = false }: LogoProps) => (
  <span className="flex items-center gap-2.5">
    <LogoMark className="size-7 drop-shadow-[0_2px_6px_rgb(39_110_241/0.25)]" />
    {compact ? null : (
      <span className="text-[17px] font-semibold tracking-[-0.035em] text-current">{env.appName}</span>
    )}
  </span>
);

import { subagentStatusLabel, subagentStatusPulses, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';
import { StatusDot } from '@/shared/components/StatusDot';
import { toneStyles } from '@/shared/styles/toneStyles';
import { cn } from '@/shared/utils/cn';

export const SubagentStatusPill = ({ status }: { status: SubagentStatus }) => {
  const tone = subagentStatusTone(status);

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-extrabold', toneStyles(tone))}>
      <StatusDot tone={tone} pulse={subagentStatusPulses(status)} />
      {subagentStatusLabel(status)}
    </span>
  );
};

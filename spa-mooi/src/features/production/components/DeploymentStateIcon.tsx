import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import type { ProductionDeploymentState } from '@/features/production/types/ProductionDeploymentState';
import { cn } from '@/shared/utils/cn';

const VIEWS = {
  running: { icon: LoaderCircle, className: 'bg-info-soft text-info', spin: true },
  succeeded: { icon: CircleCheck, className: 'bg-success-soft text-success', spin: false },
  failed: { icon: CircleAlert, className: 'bg-danger-soft text-danger', spin: false },
} as const;

export const DeploymentStateIcon = ({ state, className }: { state: ProductionDeploymentState; className?: string }) => {
  const { icon: Icon, className: tone, spin } = VIEWS[state];
  return <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-control', tone, className)}>
    <Icon className={cn('size-4', spin && 'animate-spin')} />
  </span>;
};

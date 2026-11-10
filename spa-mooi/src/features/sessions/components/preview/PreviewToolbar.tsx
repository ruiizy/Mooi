import { Monitor, RotateCw, Smartphone } from 'lucide-react';
import type { PreviewDevice } from '@/features/sessions/types/PreviewDevice';
import { IconButton } from '@/shared/components/IconButton';
import { cn } from '@/shared/utils/cn';
import type { ReactNode } from 'react';

interface PreviewToolbarProps {
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  onReload: () => void;
  children?: ReactNode;
}

export const PreviewToolbar = ({ device, onDeviceChange, onReload, children }: PreviewToolbarProps) => (
  <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-line bg-surface px-2 py-1">
    <div className="flex items-center" role="group" aria-label="Preview viewport">
      {([{ id: 'desktop', label: 'Desktop (1920 × 1080)', icon: Monitor }, { id: 'mobile', label: 'Mobile (390 px wide)', icon: Smartphone }] as const).map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-label={label} title={label} aria-pressed={device === id}
          onClick={() => onDeviceChange(id)}
          className={cn('inline-flex size-11 items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-brand', device === id ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:bg-surface-2')}>
          <Icon className="size-4.5" />
        </button>
      ))}
      <span className="hidden px-2 text-xs tabular-nums text-ink-subtle lg:block">{device === 'mobile' ? '390 px' : '1920 × 1080'}</span>
    </div>
    <div className="flex items-center">
      <IconButton icon={RotateCw} label="Reload preview" onClick={onReload} />
      {children}
    </div>
  </div>
);

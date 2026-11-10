import { Hand, ZoomIn, ZoomOut } from 'lucide-react';
import { PREVIEW_ZOOM_STEP } from '@/features/sessions/lib/previewViewports';
import type { PreviewZoom } from '@/features/sessions/types/PreviewZoom';
import { IconButton } from '@/shared/components/IconButton';

interface PreviewZoomControlsProps {
  zoom: PreviewZoom;
  navigating: boolean;
  onNavigatingChange: (navigating: boolean) => void;
}

/** Desktop preview zoom: step buttons (pinch replaces them on phones), fit, and the move/zoom mode. */
export const PreviewZoomControls = ({ zoom, navigating, onNavigatingChange }: PreviewZoomControlsProps) => (
  <div className="flex items-center" role="group" aria-label="Preview zoom">
    <IconButton icon={ZoomOut} label="Zoom out" onClick={() => zoom.zoomBy(1 / PREVIEW_ZOOM_STEP)} className="max-sm:hidden" />
    <button type="button" onClick={zoom.fit} aria-label="Fit to panel" title="Fit to panel"
      className="inline-flex h-11 min-w-12 items-center justify-center rounded-control px-1.5 text-xs font-medium tabular-nums text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      {Math.round(zoom.scale * 100)}%
    </button>
    <IconButton icon={ZoomIn} label="Zoom in" onClick={() => zoom.zoomBy(PREVIEW_ZOOM_STEP)} className="max-sm:hidden" />
    <IconButton icon={Hand} label={navigating ? 'Interact with the app' : 'Move and zoom the view'} active={navigating}
      onClick={() => onNavigatingChange(!navigating)} />
  </div>
);

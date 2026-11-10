import { PreviewDiagnostics } from './PreviewDiagnostics';
import { usePreviewFullscreen } from '@/features/sessions/hooks/usePreviewFullscreen';
import { IconButton } from '@/shared/components/IconButton';
import { cn } from '@/shared/utils/cn';
import { useState } from 'react';
import { PreviewToolbar } from './PreviewToolbar';
import type { PreviewDevice } from '@/features/sessions/types/PreviewDevice';
import { Maximize, Minimize, LoaderCircle, Monitor } from 'lucide-react';
import { PreviewFrame } from './PreviewFrame';
import { PreviewViewport } from './PreviewViewport';
import { PreviewZoomControls } from './PreviewZoomControls';
import { usePreviewZoom } from '@/features/sessions/hooks/usePreviewZoom';
import { COMPACT_LAYOUT_QUERY } from '@/features/sessions/lib/previewViewports';
import { previewUrl } from '@/features/sessions/lib/previewUrl';
import type { DeploymentSnapshot } from '@/features/sessions/types/DeploymentSnapshot';

export const PreviewPanel = ({ deployment, visible }: { deployment: DeploymentSnapshot; visible: boolean }) => {
  // Phones start where their own users are; desktops on the real 1920×1080 layout.
  const [device, setDevice] = useState<PreviewDevice>(() => (window.matchMedia(COMPACT_LAYOUT_QUERY).matches ? 'mobile' : 'desktop'));
  // A scaled desktop is hard to tap on touch screens: there, gestures move and zoom it by default.
  const [navigating, setNavigating] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const zoom = usePreviewZoom();
  const [reload, setReload] = useState(0);
  const url = deployment.state === 'running' ? previewUrl(deployment.previewUrl) : null;
  const { panelRef, expanded, fullscreen, toggle } = usePreviewFullscreen(Boolean(url) && visible);
  if (url) {
    return <div ref={panelRef} className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-surface-2", expanded && "fixed inset-x-0 top-(--app-offset) z-50 h-app")}>
      <PreviewToolbar device={device} onDeviceChange={setDevice} onReload={() => setReload((value) => value + 1)}>
        {device === 'desktop' && <PreviewZoomControls zoom={zoom} navigating={navigating} onNavigatingChange={setNavigating} />}
        <IconButton icon={fullscreen ? Minimize : Maximize} label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggle()} />
      </PreviewToolbar>
      <PreviewViewport device={device} zoom={zoom} navigating={navigating}>
        <PreviewFrame key={`${deployment.operationId}:${url}:${reload}`} url={url} />
      </PreviewViewport>
      <PreviewDiagnostics url={url} />
    </div>;
  }

  const pending = deployment.state === 'starting' || deployment.state === 'stopping';
  const message = deployment.state === 'starting' ? 'Preparing your application. Preview opens when it is ready.'
    : deployment.state === 'stopping' ? 'Stopping the application…'
    : deployment.state === 'failed' ? deployment.result?.reason?.message ?? 'Deployment failed.'
    : deployment.state === 'running' ? 'Preview requires a valid HTTP or HTTPS address on a different origin from Mooi.'
    : 'The application is stopped. Deploy again to open its preview.';

  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center" role="status">
    {pending ? <LoaderCircle className="size-6 animate-spin text-ink-muted" /> : <Monitor className="size-6 text-ink-muted" />}
    <p className="max-w-lg text-sm text-ink-muted [overflow-wrap:anywhere]">{message}</p>
  </div>;
};

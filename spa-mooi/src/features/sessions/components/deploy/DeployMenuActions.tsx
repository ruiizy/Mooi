import { Rocket, Settings2, SquareTerminal } from 'lucide-react';
import type { DeployControl } from '@/features/sessions/types/DeployControl';
import { MenuAction } from '@/shared/components/MenuAction';

interface DeployMenuActionsProps {
  control: DeployControl;
  dismiss: () => void;
}

/**
 * The deploy group as menu items, for phones only: the header keeps the deploy button just while a
 * deployment is active, so starting one, its setup and its logs live in the session actions menu.
 */
export const DeployMenuActions = ({ control, dismiss }: DeployMenuActionsProps) => {
  const act = (action: () => void) => () => {
    dismiss();
    action();
  };

  return (
    <div className="sm:hidden">
      <p className="px-3 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.06em] text-ink-subtle uppercase">Preview</p>
      {control.failure ? (
        <p role="status" className="mx-1 mb-1 line-clamp-3 rounded-chip bg-danger-soft px-2.5 py-1.5 text-[11.5px] leading-snug text-danger">
          {control.failure}
        </p>
      ) : null}
      {control.active ? null : (
        <MenuAction icon={Rocket} label={control.label === 'Retry' ? 'Retry deployment' : 'Deploy preview'} disabled={control.blocked} onClick={act(control.run)} />
      )}
      {control.withSetup ? (
        <MenuAction icon={Settings2} label="Change deployment setup" disabled={control.setupBlocked} onClick={act(control.openSetup)} />
      ) : null}
      {control.withLogs ? (
        <MenuAction icon={SquareTerminal} label={control.logOpen ? 'Hide deployment logs' : 'Show deployment logs'}
          onClick={act(control.toggleLogs)} />
      ) : null}
      <div className="my-1 h-px bg-line" />
    </div>
  );
};

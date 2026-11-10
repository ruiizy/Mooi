import { useState } from 'react';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';

/**
 * The session, and the two ways out of it.
 *
 * "Every device" asks twice on purpose: it cannot be undone, and the two controls sit close enough
 * that a slip would otherwise sign the player out of machines they are not even holding.
 */
export const AccountSessionCard = () => {
  const { busy, signOutHere, signOutFromEveryDevice } = useSignOut();
  const [confirm, setConfirm] = useState(false);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold tracking-[-0.015em] text-ink">Your session</h2>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
        It stays alive between visits and renews itself while you use the platform. It also has an
        absolute age limit: past it you sign in again, however recently you were here.
      </p>

      <Button variant="secondary" size="md" onClick={signOutHere} disabled={busy} className="mt-4 w-full">
        <LogOut className="size-4" />
        Log out on this device
      </Button>

      <Button
        variant="danger"
        size="md"
        onClick={() => (confirm ? signOutFromEveryDevice() : setConfirm(true))}
        disabled={busy}
        className="mt-2 w-full"
      >
        <MonitorSmartphone className="size-4" />
        {confirm ? 'Confirm — every device' : 'Log out on every device'}
      </Button>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Logging out everywhere cannot be undone, which is why it asks first.
      </p>
    </Card>
  );
};

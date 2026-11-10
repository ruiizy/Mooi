import { ExternalLink, FolderGit2, RefreshCw, Unlink } from 'lucide-react';
import { GithubConnectButton } from '@/features/github/components/GithubConnectButton';
import { useGithubConnection } from '@/features/github/hooks/useGithubConnection';
import type { GithubConnection } from '@/features/github/types/GithubConnection';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { GithubMark } from '@/shared/components/icons/GithubMark';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import { formatDate } from '@/shared/utils/formatDate';

const Skeleton = () => (
  <div className="mt-5 flex animate-pulse-soft items-center gap-4">
    <span className="size-9 shrink-0 rounded-full bg-surface-2" />
    <span className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="h-3.5 w-32 rounded-full bg-surface-2" />
      <span className="h-3 w-48 rounded-full bg-surface-2" />
    </span>
  </div>
);

const Connected = ({
  connection,
  busy,
  onManageAccess,
  onDisconnect,
}: {
  connection: GithubConnection;
  busy: boolean;
  onManageAccess: () => void;
  onDisconnect: () => void;
}) => (
  <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
    <Avatar src={connection.avatarUrl} name={connection.login} size="md" />

    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate text-sm font-medium text-ink">{connection.login}</span>
        <Badge tone="success">Connected</Badge>
      </div>
      <p className="mt-1 truncate text-xs text-ink-subtle">
        {connection.name ? `${connection.name} · ` : ''}
        Linked {formatDate(connection.connectedAt)}
      </p>
      {/* Being linked and being able to read a repository are two different grants on GitHub, and
          a player who cannot find a private repository has no way to know that from the badge. */}
      <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
        Private repositories appear once Mooi is granted access to them on GitHub.
      </p>
    </div>

    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {connection.profileUrl ? (
        <a
          href={connection.profileUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonStyles('ghost', 'sm')}
        >
          <ExternalLink className="size-4" />
          Profile
        </a>
      ) : null}

      <Button variant="secondary" size="sm" onClick={onManageAccess} disabled={busy}>
        <FolderGit2 className="size-4" />
        Repository access
      </Button>

      <Button variant="danger" size="sm" onClick={onDisconnect} disabled={busy}>
        <Unlink className="size-4" />
        Disconnect
      </Button>
    </div>
  </div>
);

const Disconnected = ({ busy, onConnect }: { busy: boolean; onConnect: () => void }) => (
  <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
      <GithubMark className="size-5" />
    </span>

    <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-muted">
      Link GitHub so Mooi can reach the repositories you work on, straight from a session.
    </p>

    <span className="shrink-0">
      <GithubConnectButton onConnect={onConnect} busy={busy} />
    </span>
  </div>
);

/**
 * The live GitHub integration on the account screen. Every state it can be in is rendered here —
 * loading, linked, not linked, broken — because the player must never be left guessing whether an
 * account they authorized is actually connected.
 */
export const GithubConnectionCard = () => {
  const { connection, status, error, connect, manageAccess, disconnect, reload } =
    useGithubConnection();
  const busy = status === 'loading' || status === 'connecting';

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-sm font-semibold tracking-[-0.015em] text-ink">GitHub</h2>

      {status === 'error' ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">
            {error}
          </p>
          <span className="shrink-0">
            <Button variant="secondary" size="sm" onClick={reload}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </span>
        </div>
      ) : null}

      {status !== 'error' && status !== 'ready' && !connection ? <Skeleton /> : null}

      {status !== 'error' && connection ? (
        <Connected
          connection={connection}
          busy={busy}
          onManageAccess={manageAccess}
          onDisconnect={disconnect}
        />
      ) : null}

      {status === 'ready' && !connection ? (
        <Disconnected busy={busy} onConnect={connect} />
      ) : null}
    </Card>
  );
};

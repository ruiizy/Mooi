import { GithubConnectButton } from '@/features/github/components/GithubConnectButton';
import { useGithubConnection } from '@/features/github/hooks/useGithubConnection';
import { Card } from '@/shared/components/Card';
import { GithubMark } from '@/shared/components/icons/GithubMark';

interface GithubGateCardProps {
  title: string;
  description: string;
}

/**
 * What a screen shows instead of its own content while GitHub is not linked.
 *
 * It replaces the screen rather than sitting beside it: offering filters, search or an empty grid
 * next to this card would suggest there is something to do first, when connecting is the only move
 * available.
 */
export const GithubGateCard = ({ title, description }: GithubGateCardProps) => {
  const { status, error, connect } = useGithubConnection();

  return (
    <Card className="relative overflow-hidden p-8 text-center sm:p-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full bg-brand/15 blur-[110px]"
      />

      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-ink">
          <GithubMark className="size-6" />
        </span>

        <h2 className="mt-6 text-lg font-extrabold tracking-[-0.02em] text-balance text-ink sm:text-xl">
          {title}
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{description}</p>

        <div className="mt-7">
          <GithubConnectButton onConnect={connect} busy={status === 'connecting'} />
        </div>
        {status === 'error' && error ? (
          <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
};

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { completeGithubAuthorization } from '@/features/github/api/githubApi';
import { Card } from '@/shared/components/Card';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import { useGithubStore } from '@/stores/githubStore';

/**
 * Where GitHub sends the player back.
 *
 * It is an authenticated route on purpose: landing inside the application means the browser still
 * holds a Mooi access token, so the authorization code is redeemed as a known player and the link
 * is bound to them. An unauthenticated hit never reaches this page — the route guard sends it to
 * the login screen first.
 *
 * A success lands on the projects screen rather than back on the account screen: linking GitHub is what
 * the whole workspace was waiting for, so the player is returned to the place where it now works.
 */
export const GithubCallbackPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [failure, setFailure] = useState<string | null>(null);
  const redeemed = useRef(false);

  useEffect(() => {
    // The code is single-use and StrictMode mounts every effect twice, so the second run would
    // redeem a code the first run already spent and report a failure for a flow that worked.
    if (redeemed.current) {
      return;
    }
    redeemed.current = true;

    const denied = searchParams.get('error');
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (denied) {
      setFailure(
        denied === 'access_denied'
          ? 'You declined the authorization on GitHub.'
          : 'GitHub refused the authorization.',
      );
      return;
    }

    if (!code || !state) {
      setFailure('GitHub did not return a valid authorization.');
      return;
    }

    useGithubStore.getState().setStatus('connecting');
    completeGithubAuthorization(code, state)
      .then((connection) => {
        useGithubStore.getState().setConnection(connection);
        navigate(ROUTES.projects, { replace: true });
      })
      .catch(() => {
        setFailure('We could not link your GitHub account. Please try again.');
      });
  }, [navigate, searchParams]);

  if (failure) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-16 lg:px-6">
        <Card className="mx-auto w-full max-w-md p-8 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-card bg-danger-soft text-danger">
            <TriangleAlert className="size-5" />
          </span>

          <h1 className="mt-6 text-lg font-extrabold tracking-[-0.03em] text-ink">
            GitHub was not connected
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{failure}</p>

          <Link to={ROUTES.account} className={buttonStyles('primary', 'md', 'mt-7 w-full')}>
            Back to account
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-24 text-center lg:px-6">
      <LoaderCircle className="size-6 animate-spin text-brand" />
      <p className="mt-4 text-sm text-ink-muted">Linking your GitHub account…</p>
    </div>
  );
};

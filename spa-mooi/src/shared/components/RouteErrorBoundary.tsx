import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { Button } from '@/shared/components/Button';
import { buttonStyles } from '@/shared/styles/buttonStyles';

const describe = (error: unknown): string => {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error) return error.message;
  return 'Unknown error';
};

const reload = () => window.location.reload();

/** Root route error boundary: replaces React Router's default error screen with a recoverable one. */
export const RouteErrorBoundary = () => {
  const error = useRouteError();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-24 text-center lg:px-6">
      <span className="flex size-14 items-center justify-center rounded-card bg-surface-2 text-danger">
        <TriangleAlert className="size-6" />
      </span>

      <h1 className="mt-8 text-2xl font-extrabold tracking-[-0.03em] text-balance text-ink sm:text-3xl">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-ink-muted">
        This screen hit an unexpected error. Reload to try again, or head back to your projects.
      </p>
      <p className="mt-4 max-w-md font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">{describe(error)}</p>

      <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
        <Button variant="brand" className="w-full sm:w-auto" onClick={reload}>
          Reload
        </Button>
        <Link to={ROUTES.projects} className={buttonStyles('secondary', 'md', 'w-full sm:w-auto')}>
          Go to projects
        </Link>
      </div>
    </div>
  );
};

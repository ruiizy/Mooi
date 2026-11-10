import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { buttonStyles } from '@/shared/styles/buttonStyles';

export const NotFoundPage = () => (
  <div className="mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-24 text-center lg:px-6">
    <span className="flex size-14 items-center justify-center rounded-card bg-surface-2 text-ink-muted">
      <Compass className="size-6" />
    </span>

    <p className="mt-8 text-6xl font-extrabold tracking-[-0.05em] text-ink sm:text-7xl">
      404
    </p>

    <h1 className="mt-4 text-2xl font-extrabold tracking-[-0.03em] text-balance text-ink sm:text-3xl">
      This page does not exist
    </h1>
    <p className="mt-3 max-w-md text-base leading-relaxed text-ink-muted">
      The route you followed is not part of the workspace. Head back and pick a project.
    </p>

    <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
      <Link to={ROUTES.projects} className={buttonStyles('brand', 'md', 'w-full sm:w-auto')}>
        Go to projects
      </Link>
    </div>
  </div>
);

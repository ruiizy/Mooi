import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { AppLayout } from '@/layouts/app/AppLayout';
import { GuestRoute } from '@/shared/router/GuestRoute';
import { ProtectedRoute } from '@/shared/router/ProtectedRoute';
import { RoleRoute } from '@/shared/router/RoleRoute';
import { AccountPage } from '@/pages/AccountPage';
import { AdminPage } from '@/pages/AdminPage';
import { GithubCallbackPage } from '@/pages/GithubCallbackPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProjectPage } from '@/pages/ProjectPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { SessionPage } from '@/pages/SessionPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { TodosPage } from '@/pages/TodosPage';
import { DeploymentsPage } from '@/pages/DeploymentsPage';
import { ProjectDeploymentPage } from '@/pages/ProjectDeploymentPage';
import { BackupsPage } from '@/pages/BackupsPage';
import type { RouteHandle } from '@/shared/types/RouteHandle';

const immersive: RouteHandle = { immersive: true };
import { ProjectBackupPage } from '@/pages/ProjectBackupPage';

/**
 * Every screen lives behind a session. The application is a workspace, not a site: there is nothing
 * to show a visitor who is not signed in, so the guest tree holds the login screen alone and even
 * the not-found route sits inside the protected tree — an unknown path reached signed out lands on
 * the login screen rather than on a dead end.
 */
export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [{ path: ROUTES.login, element: <LoginPage /> }],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.root, element: <Navigate to={ROUTES.projects} replace /> },
          { path: ROUTES.projects, element: <ProjectsPage /> },
          { path: ROUTES.project, element: <ProjectPage /> },
          { path: ROUTES.session, element: <SessionPage />, handle: immersive },
          { path: ROUTES.sessions, element: <SessionsPage /> },
          { path: ROUTES.todos, element: <TodosPage /> },
          { path: ROUTES.deployments, element: <DeploymentsPage /> },
          { path: ROUTES.deployment, element: <ProjectDeploymentPage />, handle: immersive },
          { path: ROUTES.backups, element: <BackupsPage /> },
          { path: ROUTES.backup, element: <ProjectBackupPage />, handle: immersive },
          { path: ROUTES.account, element: <AccountPage /> },
          { path: ROUTES.githubCallback, element: <GithubCallbackPage /> },
          {
            element: <RoleRoute role="admin" />,
            children: [{ path: ROUTES.admin, element: <AdminPage /> }],
          },
          { path: ROUTES.notFound, element: <NotFoundPage /> },
        ],
      },
    ],
  },
], { basename: import.meta.env.BASE_URL });

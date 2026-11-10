/**
 * `root` only redirects: the signed-in player lands on their projects, which is the workspace
 * itself. The application has no public page to send a visitor to.
 */
export const ROUTES = {
  root: '/',
  login: '/login',
  projects: '/projects',
  project: '/projects/:projectId',
  session: '/projects/:projectId/sessions/:sessionId',
  sessions: '/sessions',
  todos: '/todos',
  deployments: '/deployments',
  deployment: '/deployments/:projectId',
  backups: '/backups',
  backup: '/backups/:projectId',
  account: '/account',
  githubCallback: '/account/github/callback',
  admin: '/admin',
  notFound: '*',
} as const;

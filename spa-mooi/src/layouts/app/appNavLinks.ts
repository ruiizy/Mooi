import { DatabaseBackup, FolderGit2, ListTodo, MessagesSquare, Rocket, ShieldCheck, UserRound } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import type { AppNavLink } from '@/shared/types/AppNavLink';

export const appNavLinks: AppNavLink[] = [
  { id: 'projects', label: 'Projects', to: ROUTES.projects, icon: FolderGit2 },
  { id: 'sessions', label: 'Sessions', to: ROUTES.sessions, icon: MessagesSquare },
  { id: 'todos', label: 'To-dos', to: ROUTES.todos, icon: ListTodo },
  { id: 'deployments', label: 'Deployments', to: ROUTES.deployments, icon: Rocket },
  { id: 'backups', label: 'Backups', to: ROUTES.backups, icon: DatabaseBackup },
  { id: 'account', label: 'Account', to: ROUTES.account, icon: UserRound },
  { id: 'admin', label: 'Admin', to: ROUTES.admin, icon: ShieldCheck, adminOnly: true },
];

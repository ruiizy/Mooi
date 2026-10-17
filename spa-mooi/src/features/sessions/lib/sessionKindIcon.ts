import { DatabaseBackup, GitBranch, Rocket, type LucideIcon } from 'lucide-react';
import type { SessionKind } from '@/features/sessions/types/SessionKind';

const icons: Record<SessionKind, LucideIcon> = {
  session: GitBranch,
  production: Rocket,
  backup: DatabaseBackup,
};

export const sessionKindIcon = (kind: SessionKind): LucideIcon => icons[kind];

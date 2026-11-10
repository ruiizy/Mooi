import type { AuthSession } from '@/features/auth/types/AuthSession';

/** What tabs tell each other so only one of them has to renew the access token. */
export type AuthBroadcast = { type: 'token'; session: AuthSession } | { type: 'signed-out' };

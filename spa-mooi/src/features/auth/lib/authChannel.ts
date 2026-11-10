import { env } from '@/config/env';
import type { AuthBroadcast } from '@/features/auth/types/AuthBroadcast';

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${env.storagePrefix}:auth`);

/** Tells the other tabs of this browser; a tab never hears its own messages. */
export const postAuth = (message: AuthBroadcast): void => {
  channel?.postMessage(message);
};

export const onAuth = (listener: (message: AuthBroadcast) => void): (() => void) => {
  if (!channel) {
    return () => {};
  }

  const handler = (event: MessageEvent<AuthBroadcast>) => listener(event.data);

  channel.addEventListener('message', handler);

  return () => channel.removeEventListener('message', handler);
};

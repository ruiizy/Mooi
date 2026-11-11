import { sessionsFetch } from '@/features/sessions/lib/sessionsFetch';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import type { AntigravityAuthorization } from '@/features/agents/types/AntigravityAuthorization';

const path = '/agents/antigravity/authorization';

/** A failed sign-in call; `status` tells the dialog whether the attempt is still usable. */
export class AntigravityAuthorizationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const FRIENDLY: Record<number, string> = {
  404: 'This sign-in expired. Start it again.',
  409: 'This code is already being checked. Wait a moment.',
  410: 'This sign-in ended. Start it again.',
  429: 'Too many sign-in attempts. Wait a moment and try again.',
  502: 'The Antigravity sign-in could not be completed. Try again.',
  504: 'Antigravity took too long to answer. Try again.',
};

const failure = async (response: Response, fallback: string) => {
  const message = await apiErrorMessage(response, FRIENDLY[response.status] ?? fallback);
  // 400 keeps the server's wording (it says whether the paste or the code was wrong); others get calm copy.
  return new AntigravityAuthorizationError(response.status,
    response.status === 400 || !FRIENDLY[response.status] ? message : FRIENDLY[response.status]);
};

export const startAntigravityAuthorization = async (name: string): Promise<AntigravityAuthorization> => {
  const response = await sessionsFetch(`${path}?name=${encodeURIComponent(name)}`, { method: 'POST' });
  if (!response.ok) throw await failure(response, 'Could not start the Antigravity sign-in.');
  return response.json();
};

export const completeAntigravityAuthorization = async (attemptId: string, code: string): Promise<AgentConnection> => {
  const response = await sessionsFetch(`${path}/${encodeURIComponent(attemptId)}/code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  if (!response.ok) throw await failure(response, 'Could not link Antigravity.');
  return response.json();
};

export const cancelAntigravityAuthorization = async (attemptId: string): Promise<void> => {
  await sessionsFetch(`${path}/${encodeURIComponent(attemptId)}`, { method: 'DELETE' });
};

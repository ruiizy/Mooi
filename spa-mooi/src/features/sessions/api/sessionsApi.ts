import type { DeploymentSnapshot } from '@/features/sessions/types/DeploymentSnapshot';
import type { SessionConfiguration } from '@/features/sessions/types/SessionConfiguration';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';
import { sessionsFetch } from '@/features/sessions/lib/sessionsFetch';
import { readNdjson } from '@/features/sessions/lib/readNdjson';
import type { AsideFrame } from '@/features/sessions/types/AsideFrame';
import type { ChangesSummary } from '@/features/sessions/types/ChangesSummary';
import type { CreateSessionRequest } from '@/features/sessions/types/CreateSessionRequest';
import type { FileDiffPayload } from '@/features/sessions/types/FileDiffPayload';
import type { ImageUpload } from '@/features/sessions/types/ImageUpload';
import type { MergeResult } from '@/features/sessions/types/MergeResult';
import type { SendMessageResponse } from '@/features/sessions/types/SendMessageResponse';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionsResponse } from '@/features/sessions/types/SessionsResponse';
import type { WorkspaceOverview } from '@/features/sessions/types/WorkspaceOverview';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';

const sessionsPath = (projectId?: string) =>
  projectId ? `/sessions?projectId=${encodeURIComponent(projectId)}` : '/sessions';
const workspacesPath = (projectId: string) => `/sessions/workspaces?projectId=${encodeURIComponent(projectId)}`;
const sessionPath = (sessionId: string) => `/sessions/${sessionId}`;
const messagesPath = (sessionId: string) => `/sessions/${sessionId}/messages`;
const imagePath = (sessionId: string, imageId: string) => `/sessions/${sessionId}/images/${imageId}`;
const configurationPath = (sessionId: string) => `/sessions/${sessionId}/configuration`;
const interruptPath = (sessionId: string) => `/sessions/${sessionId}/interrupt`;
const recoverPath = (sessionId: string) => `/sessions/${sessionId}/recover`;
const compactPath = (sessionId: string) => `/sessions/${sessionId}/compact`;
const clearPath = (sessionId: string) => `/sessions/${sessionId}/clear`;
const asidesPath = (sessionId: string) => `/sessions/${sessionId}/asides`;
const permissionPath = (sessionId: string, requestId: string) =>
  `/sessions/${sessionId}/permissions/${requestId}`;
const questionPath = (sessionId: string, requestId: string) => `/sessions/${sessionId}/questions/${requestId}`;
const changesPath = (sessionId: string) => `/sessions/${sessionId}/changes`;
const fileDiffPath = (sessionId: string, path: string) =>
  `/sessions/${sessionId}/changes/file?path=${encodeURIComponent(path)}`;

const jsonHeaders = { 'Content-Type': 'application/json' };

export const fetchSessions = async (projectId?: string): Promise<Session[]> => {
  const response = await sessionsFetch(sessionsPath(projectId));

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load the sessions.'));
  }

  const body = (await response.json()) as SessionsResponse;

  return body.sessions;
};

export const fetchSession = async (sessionId: string): Promise<Session> => {
  const response = await sessionsFetch(sessionPath(sessionId));

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load this session.'));
  }

  return (await response.json()) as Session;
};

export const createSession = async (request: CreateSessionRequest): Promise<Session> => {
  const response = await sessionsFetch('/sessions', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not create the session.'));
  }

  return (await response.json()) as Session;
};

export const closeSession = async (sessionId: string): Promise<void> => {
  const response = await sessionsFetch(sessionPath(sessionId), { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not close this session.'));
  }
};

export const sendSessionMessage = async (sessionId: string, text: string, images: ImageUpload[] = []): Promise<SendMessageResponse> => {
  const response = await sessionsFetch(messagesPath(sessionId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(images.length ? { text, images } : { text }),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not send this message.'));
  }

  return (await response.json()) as SendMessageResponse;
};

export const fetchSessionImage = async (sessionId: string, imageId: string): Promise<Blob> => {
  const response = await sessionsFetch(imagePath(sessionId, imageId));
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not load this image.'));
  return response.blob();
};

export const updateSessionConfiguration = async (sessionId: string, configuration: SessionConfiguration): Promise<Session> => {
  const response = await sessionsFetch(configurationPath(sessionId), {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(configuration),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not change the session configuration.'));
  }

  return (await response.json()) as Session;
};

export const interruptSession = async (sessionId: string): Promise<void> => {
  const response = await sessionsFetch(interruptPath(sessionId), { method: 'POST' });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not interrupt the agent.'));
  }
};

export const recoverSession = async (sessionId: string): Promise<void> => {
  const response = await sessionsFetch(recoverPath(sessionId), { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not reconnect the agent.'));
};

export const compactSession = async (sessionId: string): Promise<void> => {
  const response = await sessionsFetch(compactPath(sessionId), { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not compact the conversation.'));
};

/** Streams a side question's answer through `onText`; it never enters the conversation. */
export const askAside = async (
  sessionId: string,
  question: string,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<void> => {
  const response = await sessionsFetch(asidesPath(sessionId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ question }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(await apiErrorMessage(response, 'Could not ask the side question.'));

  for await (const frame of readNdjson<AsideFrame>(response.body)) {
    if (frame.type === 'delta') onText(frame.text);
    else if (frame.type === 'error') throw new Error(frame.message);
    else return;
  }
  throw new Error('The side question was interrupted. Try again.');
};

export const clearSessionConversation = async (sessionId: string): Promise<void> => {
  const response = await sessionsFetch(clearPath(sessionId), { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not clear the conversation.'));
};

export const answerPermission = async (
  sessionId: string,
  requestId: string,
  decision: 'allow' | 'deny',
  message?: string,
  updatedInput?: Record<string, unknown>,
): Promise<void> => {
  const response = await sessionsFetch(permissionPath(sessionId, requestId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ decision, message, updatedInput }),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not send this decision.'));
  }
};

export const answerQuestion = async (
  sessionId: string,
  requestId: string,
  answers: Record<string, string | string[]>,
  response_?: string,
): Promise<void> => {
  const response = await sessionsFetch(questionPath(sessionId, requestId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ answers, response: response_ }),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not send these answers.'));
  }
};

export const fetchChanges = async (sessionId: string): Promise<ChangesSummary> => {
  const response = await sessionsFetch(changesPath(sessionId));

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load the changes.'));
  }

  return (await response.json()) as ChangesSummary;
};

export const fetchFileDiff = async (sessionId: string, path: string): Promise<FileDiffPayload> => {
  const response = await sessionsFetch(fileDiffPath(sessionId, path));

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load the diff for this file.'));
  }

  return (await response.json()) as FileDiffPayload;
};

export const fetchSessionProvider = async (provider: string, connectionId: string, refresh = false): Promise<SessionProvider> => {
  const response = await sessionsFetch(`/sessions/providers/${encodeURIComponent(provider)}?connectionId=${encodeURIComponent(connectionId)}${refresh ? '&refresh=true' : ''}`);
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not load session models.'));
  return (await response.json()) as SessionProvider;
};

export const startDeployment = async (sessionId: string): Promise<DeploymentSnapshot> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/deployment/start`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not start the deployment.'));
  return (await response.json()) as DeploymentSnapshot;
};

export const changeDeploymentSetup = async (sessionId: string, instructions: string): Promise<DeploymentSnapshot> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/deployment/setup`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ instructions }),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not change the deployment setup.'));
  return (await response.json()) as DeploymentSnapshot;
};

export const stopDeployment = async (sessionId: string): Promise<DeploymentSnapshot> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/deployment/stop`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not stop the deployment.'));
  return (await response.json()) as DeploymentSnapshot;
};

export const sendSessionActivity = async (sessionId: string, signal?: AbortSignal): Promise<void> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/activity`, { method: 'POST', signal });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not renew session activity.'));
};

export const fetchWorkspaces = async (projectId: string): Promise<WorkspaceOverview> => {
  const response = await sessionsFetch(workspacesPath(projectId));
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not load the workspaces.'));
  return (await response.json()) as WorkspaceOverview;
};

export const checkMerge = async (sessionId: string): Promise<MergeResult> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/merge/check`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not check the merge.'));
  return (await response.json()) as MergeResult;
};

export const mergeSession = async (sessionId: string, message: string): Promise<MergeResult> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/merge`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not merge this session.'));
  return (await response.json()) as MergeResult;
};

export const resolveMergeConflicts = async (sessionId: string): Promise<SendMessageResponse> => {
  const response = await sessionsFetch(`${sessionPath(sessionId)}/merge/resolve`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not start resolving the conflicts.'));
  return (await response.json()) as SendMessageResponse;
};

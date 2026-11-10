export const projectPath = (projectId: string): string => `/projects/${projectId}`;

export const sessionPath = (projectId: string, sessionId: string): string =>
  `/projects/${projectId}/sessions/${sessionId}`;

export const deploymentPath = (projectId: string): string => `/deployments/${projectId}`;

export const backupPath = (projectId: string): string => `/backups/${projectId}`;

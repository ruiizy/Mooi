export interface AppEnv {
  appName: string;
  appTagline: string;
  appDescription: string;
  appVersion: string;
  githubUrl: string;
  docsUrl: string;
  contactEmail: string;
  apiBaseUrl: string;
  sessionsBaseUrl: string;
  streamStaleMs: number;
  speechBaseUrl: string;
  googleClientId: string;
  googleAuthMock: boolean;
  storagePrefix: string;
}

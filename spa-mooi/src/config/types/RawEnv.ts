export interface RawEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_TAGLINE: string;
  readonly VITE_APP_DESCRIPTION: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_GITHUB_URL: string;
  readonly VITE_DOCS_URL: string;
  readonly VITE_CONTACT_EMAIL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_SESSIONS_BASE_URL: string;
  readonly VITE_SPEECH_BASE_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_AUTH_GOOGLE_MOCK?: string;
  readonly VITE_STORAGE_PREFIX: string;
}

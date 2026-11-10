import { FlaskConical, LoaderCircle } from 'lucide-react';
import { buttonStyles } from '@/shared/styles/buttonStyles';

/** Any non-empty credential: a mocked mic-mooi ignores it and signs in its fixed development player. */
const MOCK_CREDENTIAL = 'mock-google-credential';

interface MockSignInButtonProps {
  onCredential: (idToken: string) => void;
  busy?: boolean;
}

/**
 * Development stand-in for Google sign-in (`VITE_AUTH_GOOGLE_MOCK`), used by Mooi session previews:
 * same login flow and endpoint, without loading Google Identity Services.
 */
export const MockSignInButton = ({ onCredential, busy = false }: MockSignInButtonProps) => (
  <button
    type="button"
    className={buttonStyles('brand', 'lg', 'w-full')}
    disabled={busy}
    onClick={() => onCredential(MOCK_CREDENTIAL)}
    title="Development sign-in: Google is mocked"
  >
    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
    {busy ? 'Signing in…' : 'Continue as developer'}
  </button>
);

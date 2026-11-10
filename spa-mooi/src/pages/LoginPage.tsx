import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CircleCheck } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { env } from '@/config/env';
import { PipelineShowcase } from '@/features/brand/components/PipelineShowcase';
import { AuthRequestError, loginWithGoogle } from '@/features/auth/api/authApi';
import { GoogleSignInButton } from '@/features/auth/components/GoogleSignInButton';
import { MockSignInButton } from '@/features/auth/components/MockSignInButton';
import { setAccessSession } from '@/features/auth/lib/accessTokenProvider';
import { toAuthSession } from '@/features/auth/lib/toAuthSession';
import { ThemeToggle } from '@/shared/components/ThemeToggle';
import { Logo } from '@/shared/components/Logo';
import { LogoMark } from '@/shared/components/LogoMark';
import { useAuthStore } from '@/stores/authStore';

const SUSPENDED_MESSAGE = 'This account is suspended. Contact an administrator.';

const highlights = [
  'Import the repositories you already own',
  'Agent sessions with full project context',
  'Review every change, right beside the conversation',
];

/**
 * The first screen of the application, and the only one a signed-out player can reach.
 *
 * The workspace runs on the player's own repositories, so the copy stays on what a Google account
 * gets them and what happens next; there is nothing else to decide on this screen.
 */
export const LoginPage = () => {
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);
  const suspended = useAuthStore((state) => state.suspended);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = error ?? (suspended ? SUSPENDED_MESSAGE : null);

  const handleCredential = useCallback(
    (idToken: string) => {
      setBusy(true);
      setError(null);

      loginWithGoogle(idToken)
        .then((response) => {
          setAccessSession(toAuthSession(response));
          signIn(response.player);
          navigate(ROUTES.projects, { replace: true });
        })
        .catch((failure: unknown) => {
          setBusy(false);
          setError(failure instanceof AuthRequestError && failure.status === 403
            ? SUSPENDED_MESSAGE
            : 'Sign in failed. Please try again.');
        });
    },
    [navigate, signIn],
  );

  return (
    <div className="min-h-full bg-canvas text-ink lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Always a night panel, whatever the theme: the brand story reads best on dark. Its children
          speak `contrast-ink`, so the panel pins that token to the light ink. */}
      <aside className="relative isolate hidden overflow-hidden bg-[#060609] p-12 text-[#f4f4f5] [--contrast:#17171d] [--contrast-ink:#f4f4f5] lg:flex lg:flex-col xl:p-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 [background:radial-gradient(42rem_26rem_at_0%_0%,rgb(47_107_255/0.28),transparent_65%),radial-gradient(36rem_24rem_at_100%_100%,rgb(124_92_255/0.22),transparent_65%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background-image:linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />

        <div className="relative z-10 flex items-center justify-between">
          <Logo />
          <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10.5px] tracking-[0.08em] text-white/70 uppercase">
            <span className="size-1.5 rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981]" />
            AI-native dev platform
          </span>
        </div>

        <PipelineShowcase className="my-8 flex-1" />

        <div className="relative z-10">
          <h2 className="max-w-lg text-4xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance xl:text-[52px]">
            Less friction.{' '}
            <span className="bg-gradient-to-r from-[#8fb0ff] to-[#b9a4ff] bg-clip-text text-transparent">More creating.</span>
          </h2>

          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/65">From the first prompt to production. A calmer place to build software with your agents.</p>
          <ul className="mt-6 hidden flex-col gap-3 [@media(min-height:960px)]:flex">
            {highlights.map((highlight) => (
              <li key={highlight} className="flex items-start gap-3 text-sm text-white/75">
                <CircleCheck className="mt-0.5 size-4.5 shrink-0 text-[#8fb0ff]" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 mt-8 font-mono text-[11px] text-white/45">
          © {new Date().getFullYear()} {env.appName}
        </p>
      </aside>

      <main className="relative isolate flex min-h-[var(--app-height,100dvh)] flex-col justify-center overflow-hidden px-5 py-12 sm:px-8 lg:min-h-0">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-dot-grid [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)] lg:[mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--glow-a),transparent_70%)] lg:hidden" />
        <div className="absolute top-[calc(1rem+var(--safe-top))] right-4 sm:right-5"><ThemeToggle /></div>
        <div className="mx-auto w-full max-w-sm animate-fade-up">
          <LogoMark live className="size-11 drop-shadow-[0_6px_18px_rgb(39_110_241/0.35)] lg:hidden" />

          <h1 className="mt-8 text-[40px] leading-[1.05] font-semibold tracking-[-0.05em] text-ink lg:mt-0">Welcome to Mooi<span className="text-brand-gradient">.</span></h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            Continue with Google to open your workspace. Your first sign-in creates your account.
          </p>

          <div className="mt-8 rounded-panel border border-line bg-surface p-5 shadow-raised">
            <p className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">Your next idea starts here <ArrowUpRight className="size-4 text-brand" /></p>
            {env.googleAuthMock ? (
              <MockSignInButton onCredential={handleCredential} busy={busy} />
            ) : (
              <GoogleSignInButton onCredential={handleCredential} busy={busy} />
            )}
          </div>

          {message ? (
            <p role="alert" className="mt-4 animate-fade-up rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">
              {message}
            </p>
          ) : null}

          <p className="mt-8 text-xs leading-relaxed text-ink-subtle">
            Mooi works on your own repositories. Nothing is imported until you connect GitHub, and
            you can unlink it at any time from the account screen.
          </p>
        </div>
      </main>
    </div>
  );
};

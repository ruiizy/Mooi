/** How the account dialog talks about one provider's sign-in and pasted credential. */
export interface AgentProviderCopy {
  /** The sign-in where the provider's page shows a code to paste back. */
  signIn: { action: string; instructions: string; codeHint: string };
  /** A credential pasted by hand: a setup token or an API key. `hintEnd` carries its own leading space. */
  pasted: { label: string; placeholder: string; hint: string; command?: string; hintEnd?: string };
}

const COPY: Record<string, AgentProviderCopy> = {
  claude: {
    signIn: {
      action: 'Continue with Claude',
      instructions: 'Sign in with your Claude account and authorize Claude Code. Then copy the code Anthropic shows and paste it here.',
      codeHint: 'The code works once and expires after a few minutes.',
    },
    pasted: { label: 'Claude setup token', placeholder: 'sk-ant-oat01-…', hint: 'Create it with', command: 'claude setup-token', hintEnd: ' on your machine.' },
  },
  gemini: {
    signIn: {
      action: 'Continue with Google',
      instructions: 'Sign in with your Google account and allow Gemini CLI. Then copy the authorization code Google shows and paste it here.',
      codeHint: 'The code works once and expires after a few minutes. Your Gemini Code Assist plan and its limits apply.',
    },
    pasted: { label: 'Gemini API key', placeholder: 'AIza…', hint: 'Create one in Google AI Studio, under', command: 'aistudio.google.com/apikey', hintEnd: '. Usage is billed to its project.' },
  },
};

const fallback = (label: string): AgentProviderCopy => ({
  signIn: {
    action: `Continue with ${label}`,
    instructions: `Sign in with your ${label} account. Then copy the code the provider shows and paste it here.`,
    codeHint: 'The code works once and expires after a few minutes.',
  },
  pasted: { label: `${label} token`, placeholder: 'Paste the token', hint: 'Paste the credential the provider gave you.' },
});

export const agentProviderCopy = (provider: string, label: string): AgentProviderCopy => COPY[provider] ?? fallback(label);

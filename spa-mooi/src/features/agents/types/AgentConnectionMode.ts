/** How the credential behind a connection was obtained: full OAuth2, a pasted setup token, a Codex device
 * sign-in, or a pasted provider API key (Gemini). */
export type AgentConnectionMode = 'oauth' | 'setup_token' | 'device_oauth' | 'api_key';

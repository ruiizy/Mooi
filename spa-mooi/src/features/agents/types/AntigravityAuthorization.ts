/** One Antigravity sign-in attempt: agy's Google page, where the player signs in and copies the code. */
export interface AntigravityAuthorization {
  attemptId: string;
  authorizationUrl: string;
  /** Seconds the attempt waits for the code. */
  expiresIn: number;
}

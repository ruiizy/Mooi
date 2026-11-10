/** The short-lived access token. Memory only: the refresh token lives in an HttpOnly cookie. */
export interface AuthSession {
  accessToken: string;
  /** Absolute deadline in epoch milliseconds, derived from the relative `expiresIn`. */
  expiresAt: number;
}

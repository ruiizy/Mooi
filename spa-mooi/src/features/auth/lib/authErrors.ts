/** The sign-in is over (expired, revoked, replayed): with a suspension, the only failure that signs the player out. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Not authenticated');
  }
}

/** The account is banned: signs out, and the login page says why. */
export class AccountSuspendedError extends SessionExpiredError {}

/** Renewal reached no verdict (offline, 5xx, timeout): the sign-in is kept and retried. */
export class AuthUnavailableError extends Error {
  constructor() {
    super('Authentication is temporarily unavailable');
  }
}

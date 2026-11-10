/**
 * Transition only: a refresh token found in the old persisted state (before it moved to an HttpOnly
 * cookie), kept in memory until the first renewal trades it for the cookie. Removed together with the
 * server's `AUTH_LEGACY_BODY_TOKEN_ENABLED`.
 */
let legacyRefreshToken: string | null = null;

export const stashLegacyRefreshToken = (token: string | null | undefined): void => {
  legacyRefreshToken = token ?? null;
};

export const takeLegacyRefreshToken = (): string | null => {
  const token = legacyRefreshToken;

  legacyRefreshToken = null;

  return token;
};

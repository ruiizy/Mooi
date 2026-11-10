/** One live sign-in (a device) of a user. */
export interface AdminSignIn {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}

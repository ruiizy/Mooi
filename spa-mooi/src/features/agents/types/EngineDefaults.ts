/** A provider's platform-wide session defaults; `null` leaves the choice to the provider. */
export interface EngineDefaults {
  provider: string;
  sessionModel: string | null;
  sessionEffort: string | null;
  /** The adapter new sessions use unless they pick one; `null` is the provider's first adapter. */
  sessionAdapter: string | null;
}

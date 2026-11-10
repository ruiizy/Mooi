/** Where the player authorizes, and the signed state to send back with the code the provider shows. */
export interface AgentAuthorizationResponse {
  authorizeUrl: string;
  state: string;
}

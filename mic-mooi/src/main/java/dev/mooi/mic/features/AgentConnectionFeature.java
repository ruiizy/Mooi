package dev.mooi.mic.features;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.mooi.mic.shared.Agents;
import dev.mooi.mic.shared.Auth;
import dev.mooi.mic.shared.Crypto;
import dev.mooi.mic.shared.Db;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.Setter;

/**
 * Feature: agent-provider credentials linked to a player.
 *
 * <p>A connection hands an agent-provider credential (a Claude personal access token today) to
 * {@code mic-sessions} on request; the browser never holds it. Both ways a player can obtain that
 * credential — OAuth2 or pasting a token minted by {@code claude setup-token}, see {@link Agents}
 * for why both yield the same kind of token — are recorded in the same table, distinguished only by
 * {@link Agents.Mode}.
 *
 * <p>Self-contained by architecture: API, application logic, persistence and contracts live in this
 * single file and may only import transversal aspects from {@code shared}.
 */
@RestController
@RequiredArgsConstructor
public class AgentConnectionFeature {

    private final AgentConnectionService agentConnectionService;

    @GetMapping("/me/agents/providers")
    @Auth.Authenticated
    public AgentProvidersResponse providers() {
        return agentConnectionService.providers();
    }

    /** Minting a state has an effect and must never be replayed from a cache, hence POST. */
    @PostMapping("/me/agents/{provider}/authorization")
    @Auth.Authenticated
    public AuthorizationPayload startAuthorization(@PathVariable String provider, Auth.Principal principal) {
        return agentConnectionService.startAuthorization(principal.player().id(), provider);
    }

    /** The code is redeemed for the caller on this request, never for whoever the state claims. */
    @PostMapping("/me/agents/{provider}/connection")
    @Auth.Authenticated
    public AgentConnectionPayload connectOauth(@PathVariable String provider,
            @Valid @RequestBody OauthConnectRequest request, Auth.Principal principal) {
        return agentConnectionService.connectOauth(principal.player().id(), provider, request.code(), request.state(), request.name());
    }

    /** Always recorded as {@code setup_token}: this door never produces an OAuth-mode row. */
    @PutMapping("/me/agents/{provider}/connection")
    @Auth.Authenticated
    public AgentConnectionPayload connectToken(@PathVariable String provider,
            @Valid @RequestBody TokenConnectRequest request, Auth.Principal principal) {
        return agentConnectionService.connectToken(principal.player().id(), provider, request.token(), request.name());
    }

    @GetMapping("/me/agents/connections")
    @Auth.Authenticated
    public AgentConnectionsResponse connections(Auth.Principal principal) {
        return new AgentConnectionsResponse(agentConnectionService.list(principal.player().id()));
    }

    /** Always 204, linked or not: disconnecting is stated as an outcome, not as a transaction. */
    @DeleteMapping("/me/agents/connections/{connectionId}")
    @Auth.Authenticated
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disconnect(@PathVariable UUID connectionId, Auth.Principal principal) {
        agentConnectionService.disconnect(principal.player().id(), connectionId);
    }

    @PutMapping("/me/agents/connections/{connectionId}/name")
    @Auth.Authenticated
    public AgentConnectionPayload rename(@PathVariable UUID connectionId,
            @Valid @RequestBody RenameRequest request, Auth.Principal principal) {
        return agentConnectionService.rename(principal.player().id(), connectionId, request.name());
    }

    @GetMapping("/admin/agents/defaults")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public List<EngineDefaultsPayload> engineDefaults() {
        return agentConnectionService.engineDefaults();
    }

    @PutMapping("/me/agents/default-account")
    @Auth.Authenticated
    public AgentConnectionsResponse setDefaultAccount(@RequestBody DefaultAccountRequest request, Auth.Principal principal) {
        return new AgentConnectionsResponse(agentConnectionService.setDefaultAccount(principal.player().id(), request.connectionId()));
    }

    @PutMapping("/admin/agents/{provider}/defaults")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public EngineDefaultsPayload setDefaultModels(@PathVariable String provider,
            @Valid @RequestBody DefaultModelsRequest request) {
        return agentConnectionService.setDefaultModels(provider, request);
    }

    /** A browser holding a valid access token is not enough here: only another internal service may call this. */
    @GetMapping("/me/agents/connections/{connectionId}/credential")
    @Auth.Authenticated
    @Auth.ServiceCall
    public CredentialPayload credential(@PathVariable UUID connectionId, Auth.Principal principal) {
        return agentConnectionService.credential(principal.player().id(), connectionId);
    }

    @PostMapping("/me/agents/codex/device-connection")
    @Auth.Authenticated
    @Auth.ServiceCall
    public AgentConnectionPayload connectDevice(@Valid @RequestBody DeviceConnectRequest request,
                                                Auth.Principal principal) {
        return agentConnectionService.connectDevice(principal.player().id(), request);
    }

    @PutMapping("/me/agents/{provider}/credential")
    @Auth.Authenticated
    @Auth.ServiceCall
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void refreshCredential(@PathVariable String provider,
                                  @Valid @RequestBody RefreshCredentialRequest request, Auth.Principal principal) {
        agentConnectionService.refreshCredential(principal.player().id(), provider, request);
    }

    // --- application ---

    /**
     * Everything a connection does: linking a provider by either mode, listing what is linked, and
     * dropping a link.
     *
     * <p>Token material is sealed the moment it arrives and opened only for the single call that
     * needs it, so no caller is ever handed a usable agent-provider credential from here. A failed
     * renewal (added in the OAuth flow) never destroys data: a stale link the player can repair with
     * one click is strictly better than a row deleted because the provider answered badly.
     */
    @Service
    @RequiredArgsConstructor
    public static class AgentConnectionService {

        private final AgentConnectionRepository agentConnectionRepository;
        private final EngineDefaultsRepository engineDefaultsRepository;
        private final AccountPreferenceRepository accountPreferenceRepository;
        private final Agents.Settings settings;
        private final Agents.StateCodec stateCodec;
        private final Agents.OAuthClient oauthClient;
        private final Crypto.SecretBox secretBox;
        private final Clock clock;

        /** Both modes are always offered: whether OAuth is actually usable is a separate flag. */
        private static final List<String> MODES = List.of(Agents.Mode.OAUTH.wire(), Agents.Mode.SETUP_TOKEN.wire());

        /** One grant, whichever mode produced it. Fields absent for a mode are simply {@code null}. */
        private record Grant(String accessToken, OffsetDateTime accessTokenExpiresAt, String refreshToken,
                             String scope, String accountLabel) {
        }

        public AgentProvidersResponse providers() {
            return new AgentProvidersResponse(settings.all().stream()
                    .map(provider -> new ProviderPayload(provider.id(), provider.label(), provider.id().equals("codex")
                            ? List.of(Agents.Mode.DEVICE_OAUTH.wire()) : MODES,
                            provider.oauthEnabled() && provider.clientId() != null))
                    .toList());
        }

        public List<AgentConnectionPayload> list(UUID playerId) {
            UUID defaultId = defaultAccountId(playerId);
            return agentConnectionRepository.findByPlayerIdOrderByConnectedAtDesc(playerId).stream()
                    .map(connection -> toPayload(connection, defaultId))
                    .toList();
        }

        /**
         * The URL is assembled here rather than in the SPA so the client id and the registered
         * redirect URI stay configuration of the API, and so the PKCE {@code state} is signed by the
         * very party that will later verify it.
         */
        public AuthorizationPayload startAuthorization(UUID playerId, String provider) {
            Agents.Provider agentProvider = settings.find(provider).orElseThrow(Agents.AgentsException::unknownProvider);
            if (!agentProvider.oauthEnabled() || agentProvider.clientId() == null) {
                throw Agents.AgentsException.oauthNotConfigured();
            }
            Agents.StateCodec.Issued issued = stateCodec.issue(playerId, agentProvider.id());
            return new AuthorizationPayload(oauthClient.authorizeUrl(agentProvider, issued.state(), issued.codeChallenge()));
        }

        /**
         * Closes the loop opened by {@link #startAuthorization(UUID, String)}.
         *
         * <p>The state is checked against the caller and the provider, not merely against our own
         * signature: a perfectly valid state minted for somebody else, or for a different provider,
         * is exactly the attack this parameter exists to stop, and only this request knows both.
         */
        @Transactional
        public AgentConnectionPayload connectOauth(UUID playerId, String provider, String code, String state, String name) {
            Agents.Provider agentProvider = settings.find(provider).orElseThrow(Agents.AgentsException::unknownProvider);
            Agents.StateCodec.StateClaims claims = stateCodec.verify(state);
            if (!claims.playerId().equals(playerId) || !claims.provider().equals(provider)) {
                throw Agents.AgentsException.invalidState();
            }
            Agents.OAuthClient.Tokens grant = oauthClient.exchangeCode(agentProvider, code, claims.codeVerifier());
            AgentConnection saved = create(playerId, agentProvider, Agents.Mode.OAUTH, toGrant(grant), name);
            Agents.LOG.info("Player {} linked agent provider {} ({})", playerId, agentProvider.id(),
                    Agents.Mode.OAUTH.wire());
            return toPayload(saved);
        }

        /**
         * Hands out a usable credential to another internal service. For {@code setup_token} the
         * stored token is handed out as is — it never expires and has no refresh token. For
         * {@code oauth} it is renewed first when it is within {@link Agents.Settings#getTokenRefreshSkew()}
         * of expiring, so a caller is never handed a credential that dies mid-flight.
         */
        @Transactional
        public CredentialPayload credential(UUID playerId, UUID connectionId) {
            AgentConnection connection = agentConnectionRepository.findByPlayerIdAndId(playerId, connectionId)
                    .orElseThrow(Agents.AgentsException::reauthorize);
            Agents.Provider agentProvider = settings.find(connection.getProvider()).orElseThrow(Agents.AgentsException::unknownProvider);
            if (Agents.Mode.fromWire(connection.getMode()) == Agents.Mode.OAUTH) {
                connection = ensureFreshToken(connection, agentProvider);
            }
            EngineDefaults defaults = engineDefaultsRepository.findById(agentProvider.id()).orElseThrow();
            return new CredentialPayload(agentProvider.id(), connection.getMode(),
                    secretBox.decrypt(connection.getAccessToken()), connection.getAccessTokenExpiresAt(),
                    connection.getCredentialId(), defaults.getSessionModel(), defaults.getSessionEffort());
        }

        /**
         * Records a token pasted from {@code claude setup-token}. Not validated beyond "not blank":
         * token formats are the provider's to change, and a wrong credential already fails loudly,
         * and safely, the first time a session tries to use it.
         */
        @Transactional
        public AgentConnectionPayload connectToken(UUID playerId, String provider, String token, String name) {
            Agents.Provider agentProvider = settings.find(provider).orElseThrow(Agents.AgentsException::unknownProvider);
            if (provider.equals("codex") || token == null || token.isBlank()) {
                throw Agents.AgentsException.invalidToken();
            }
            AgentConnection saved = create(playerId, agentProvider, Agents.Mode.SETUP_TOKEN,
                    new Grant(token.strip(), null, null, null, null), name);
            Agents.LOG.info("Player {} linked agent provider {} ({})", playerId, agentProvider.id(),
                    Agents.Mode.SETUP_TOKEN.wire());
            return toPayload(saved);
        }

        @Transactional
        public AgentConnectionPayload connectDevice(UUID playerId, DeviceConnectRequest request) {
            Agents.Provider provider = settings.find("codex").orElseThrow(Agents.AgentsException::unknownProvider);
            if (request.token().length() > 65536 || request.accountLabel() != null && request.accountLabel().length() > 255) {
                throw Agents.AgentsException.invalidToken();
            }
            return toPayload(create(playerId, provider, Agents.Mode.DEVICE_OAUTH,
                    new Grant(request.token(), null, null, null, request.accountLabel()), request.name()));
        }

        @Transactional
        public void refreshCredential(UUID playerId, String provider, RefreshCredentialRequest request) {
            if (!provider.equals("codex") || request.token().length() > 65536) {
                throw Agents.AgentsException.reauthorize();
            }
            if (agentConnectionRepository.refreshCodex(playerId, request.connectionId(),
                    secretBox.encrypt(request.token())) != 1) {
                throw Agents.AgentsException.reauthorize();
            }
        }

        /** Idempotent: disconnecting an account that was never linked is not an error. */
        @Transactional
        public void disconnect(UUID playerId, UUID connectionId) {
            agentConnectionRepository.findByPlayerIdAndId(playerId, connectionId).ifPresent(connection -> {
                agentConnectionRepository.delete(connection);
                Agents.LOG.info("Player {} unlinked agent connection {}", playerId, connectionId);
            });
        }

        @Transactional
        public AgentConnectionPayload rename(UUID playerId, UUID connectionId, String name) {
            AgentConnection connection = agentConnectionRepository.findByPlayerIdAndId(playerId, connectionId)
                    .orElseThrow(Agents.AgentsException::reauthorize);
            connection.setName(cleanName(name));
            return toPayload(agentConnectionRepository.save(connection));
        }

        public List<EngineDefaultsPayload> engineDefaults() {
            return engineDefaultsRepository.findAll().stream().map(this::toDefaultsPayload).toList();
        }

        @Transactional
        public EngineDefaultsPayload setDefaultModels(String provider, DefaultModelsRequest request) {
            settings.find(provider).orElseThrow(Agents.AgentsException::unknownProvider);
            EngineDefaults defaults = engineDefaultsRepository.findById(provider).orElseThrow();
            defaults.setSessionModel(cleanModel(request.sessionModel()));
            defaults.setSessionEffort(cleanEffort(request.sessionEffort()));
            return toDefaultsPayload(engineDefaultsRepository.save(defaults));
        }

        @Transactional
        public List<AgentConnectionPayload> setDefaultAccount(UUID playerId, UUID connectionId) {
            if (connectionId == null) {
                accountPreferenceRepository.deleteById(playerId);
            } else {
                agentConnectionRepository.findByPlayerIdAndId(playerId, connectionId)
                        .orElseThrow(Agents.AgentsException::reauthorize);
                accountPreferenceRepository.selectAccount(playerId, connectionId);
            }
            return list(playerId);
        }

        private UUID defaultAccountId(UUID playerId) {
            return accountPreferenceRepository.findById(playerId).map(AccountPreference::getConnectionId).orElse(null);
        }

        private EngineDefaultsPayload toDefaultsPayload(EngineDefaults defaults) {
            return new EngineDefaultsPayload(defaults.getProvider(), defaults.getSessionModel(), defaults.getSessionEffort());
        }

        private String cleanEffort(String value) {
            if (value == null || value.isBlank()) return null;
            String cleaned = value.strip();
            if (cleaned.length() > 32) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid effort");
            return cleaned;
        }

        private String cleanModel(String value) {
            if (value == null || value.isBlank()) return null;
            String cleaned = value.strip();
            if (cleaned.length() > 120 || cleaned.equalsIgnoreCase("default"))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid model");
            return cleaned;
        }

        /** Creates a separate account link for every completed authorization. */
        private AgentConnection create(UUID playerId, Agents.Provider provider, Agents.Mode mode, Grant grant, String name) {
            AgentConnection connection = new AgentConnection();
            connection.setPlayerId(playerId);
            connection.setProvider(provider.id());
            connection.setConnectedAt(OffsetDateTime.now(clock));
            connection.setCredentialId(UUID.randomUUID());
            connection.setName(cleanName(name));
            connection.setMode(mode.wire());
            connection.setAccountLabel(grant.accountLabel());
            connection.setAccessToken(secretBox.encrypt(grant.accessToken()));
            connection.setAccessTokenExpiresAt(grant.accessTokenExpiresAt());
            connection.setRefreshToken(secretBox.encrypt(grant.refreshToken()));
            connection.setScope(grant.scope());
            connection.setStale(false);
            return agentConnectionRepository.save(connection);
        }

        private String cleanName(String name) {
            if (name == null || name.isBlank()) return null;
            String cleaned = name.strip();
            if (cleaned.length() > 100) throw Agents.AgentsException.invalidToken();
            return cleaned;
        }

        /**
         * Renews an OAuth credential shortly before it expires, so nothing downstream is handed a
         * token that dies mid-flight.
         *
         * <p>A refusal marks the row {@code stale} and throws {@link Agents.AgentsException#reauthorize()}
         * rather than destroying it: the link is still a fact, and the player only needs to
         * re-authorize to repair it.
         */
        private AgentConnection ensureFreshToken(AgentConnection connection, Agents.Provider provider) {
            OffsetDateTime expiresAt = connection.getAccessTokenExpiresAt();
            OffsetDateTime now = OffsetDateTime.now(clock);
            if (expiresAt == null || expiresAt.isAfter(now.plus(settings.getTokenRefreshSkew()))) {
                return connection;
            }
            String refreshToken = secretBox.decrypt(connection.getRefreshToken());
            if (refreshToken == null) {
                Agents.LOG.warn("Agent connection of player {} for provider {} has no refresh token to renew with",
                        connection.getPlayerId(), provider.id());
                markStale(connection);
                throw Agents.AgentsException.reauthorize();
            }
            try {
                Agents.OAuthClient.Tokens renewed = oauthClient.refresh(provider, refreshToken);
                // Some providers omit fields on renewal rather than rotating them: keep what was there.
                Grant grant = new Grant(renewed.accessToken(), renewed.accessTokenExpiresAt(),
                        renewed.refreshToken() != null ? renewed.refreshToken() : refreshToken,
                        renewed.scope() != null ? renewed.scope() : connection.getScope(),
                        renewed.accountLabel() != null ? renewed.accountLabel() : connection.getAccountLabel());
                connection.setAccessToken(secretBox.encrypt(grant.accessToken()));
                connection.setAccessTokenExpiresAt(grant.accessTokenExpiresAt());
                connection.setRefreshToken(secretBox.encrypt(grant.refreshToken()));
                connection.setScope(grant.scope());
                connection.setAccountLabel(grant.accountLabel());
                connection.setStale(false);
                return agentConnectionRepository.save(connection);
            } catch (Agents.AgentsException exception) {
                Agents.LOG.warn("Unable to renew the agent credential of player {} for provider {}: {}",
                        connection.getPlayerId(), provider.id(), exception.getReason());
                markStale(connection);
                throw Agents.AgentsException.reauthorize();
            }
        }

        private void markStale(AgentConnection connection) {
            connection.setStale(true);
            agentConnectionRepository.save(connection);
        }

        private static Grant toGrant(Agents.OAuthClient.Tokens tokens) {
            return new Grant(tokens.accessToken(), tokens.accessTokenExpiresAt(), tokens.refreshToken(),
                    tokens.scope(), tokens.accountLabel());
        }

        private AgentConnectionPayload toPayload(AgentConnection connection) {
            return toPayload(connection, defaultAccountId(connection.getPlayerId()));
        }

        private AgentConnectionPayload toPayload(AgentConnection connection, UUID defaultId) {
            String label = settings.find(connection.getProvider())
                    .map(Agents.Provider::label)
                    .orElse(connection.getProvider());
            return new AgentConnectionPayload(connection.getId(), connection.getProvider(), label, connection.getName(), connection.getMode(),
                    connection.getAccountLabel(), connection.getScope(), connection.getConnectedAt(),
                    connection.getAccessTokenExpiresAt(), connection.isStale(), connection.getId().equals(defaultId));
        }
    }

    // --- persistence ---

    /**
     * One agent-provider credential linked to one player. A player may link several accounts for
     * the same provider.
     */
    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "AgentConnection")
    @Table(name = "agent_connections")
    public static class AgentConnection extends Db.Auditable {

        @Id
        @GeneratedValue
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, updatable = false)
        private UUID playerId;

        @Column(name = "provider", nullable = false, length = 32, updatable = false)
        private String provider;

        @Column(name = "mode", nullable = false, length = 16)
        private String mode;

        @Column(name = "account_label", length = 255)
        private String accountLabel;

        @Column(name = "name", length = 100)
        private String name;

        /**
         * AES-256-GCM ciphertext produced by {@code Crypto.SecretBox}, never a usable credential.
         * The plaintext exists only inside the request that needs it.
         */
        @Column(name = "credential_id", nullable = false)
        private UUID credentialId;

        @Column(name = "access_token", nullable = false, columnDefinition = "text")
        private String accessToken;

        /** NULL for a {@code setup_token} credential: it does not expire. */
        @Column(name = "access_token_expires_at")
        private OffsetDateTime accessTokenExpiresAt;

        /** Ciphertext, as above. NULL for a {@code setup_token} credential: there is nothing to renew with. */
        @Column(name = "refresh_token", length = 2048)
        private String refreshToken;

        @Column(name = "scope", length = 512)
        private String scope;

        /** True once an OAuth credential expired and renewal failed. Cleared by any fresh grant. */
        @Column(name = "stale", nullable = false)
        private boolean stale;

        /** When the player first linked this provider; survives a relink or a token renewal. */
        @Column(name = "connected_at", nullable = false)
        private OffsetDateTime connectedAt;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "EngineDefaults")
    @Table(name = "agent_engine_defaults")
    public static class EngineDefaults {
        @Id
        @Column(length = 32)
        private String provider;
        @Column(name = "session_model", length = 120)
        private String sessionModel;
        @Column(name = "session_effort", length = 32)
        private String sessionEffort;
    }

    public interface EngineDefaultsRepository extends JpaRepository<EngineDefaults, String> { }

    @Getter
    @NoArgsConstructor
    @Entity(name = "AccountPreference")
    @Table(name = "agent_account_preferences")
    public static class AccountPreference {
        @Id
        @Column(name = "player_id")
        private UUID playerId;
        @Column(name = "connection_id")
        private UUID connectionId;
    }

    public interface AccountPreferenceRepository extends JpaRepository<AccountPreference, UUID> {
        @Modifying
        @Query(value = "insert into agent_account_preferences (player_id, connection_id) values (:playerId, :connectionId) "
                + "on conflict (player_id) do update set connection_id = excluded.connection_id", nativeQuery = true)
        void selectAccount(UUID playerId, UUID connectionId);
    }

    public interface AgentConnectionRepository extends JpaRepository<AgentConnection, UUID> {

        List<AgentConnection> findByPlayerIdOrderByConnectedAtDesc(UUID playerId);

        Optional<AgentConnection> findByPlayerIdAndId(UUID playerId, UUID id);

        // The identity check and update must be atomic with a concurrent disconnect/relink.
        @Modifying
        @Query("update AgentConnection c set c.accessToken = :token "
                + "where c.playerId = :playerId and c.provider = 'codex' "
                + "and c.mode = 'device_oauth' and c.credentialId = :connectionId")
        int refreshCodex(UUID playerId, UUID connectionId, String token);
    }

    // --- contracts ---

    /**
     * What the SPA is told about a connection. No token material of any kind: the client never needs
     * an agent-provider credential, so it is never given one. {@code stale} is {@code true} when an
     * OAuth credential expired and renewal failed — the player repairs it with one click, the row is
     * not deleted.
     */
    public record AgentConnectionPayload(UUID id, String provider, String label, String name, String mode, String accountLabel,
                                         String scope, OffsetDateTime connectedAt, OffsetDateTime expiresAt,
                                         boolean stale, boolean defaultAccount) {
    }

    /** Where the browser sends the player to authorize. Nothing else is needed to complete the callback. */
    public record AuthorizationPayload(String authorizeUrl) {
    }

    /**
     * A usable credential, handed only to another internal service. The single place, across every
     * payload in this feature, where a raw token is ever serialized.
     */
    public record CredentialPayload(String provider, String mode, String token, OffsetDateTime expiresAt, UUID connectionId,
                                    String sessionModel, String sessionEffort) {
    }

    /** One provider this application knows how to link, and whether OAuth is actually usable for it. */
    public record ProviderPayload(String id, String label, List<String> modes, boolean oauthEnabled) {
    }

    public record AgentProvidersResponse(List<ProviderPayload> providers) {
    }

    public record AgentConnectionsResponse(List<AgentConnectionPayload> connections) {
    }

    public record OauthConnectRequest(@NotBlank String code, @NotBlank String state, @NotBlank String name) {
    }

    public record DeviceConnectRequest(@NotBlank String token, String accountLabel, @NotBlank String name) { }

    public record RefreshCredentialRequest(@NotBlank String token,
            @jakarta.validation.constraints.NotNull UUID connectionId) { }

    public record TokenConnectRequest(@NotBlank String token, @NotBlank String name) {
    }

    public record RenameRequest(@NotBlank String name) {
    }

    public record DefaultAccountRequest(UUID connectionId) { }

    public record EngineDefaultsPayload(String provider, String sessionModel, String sessionEffort) { }

    public record DefaultModelsRequest(String sessionModel, String sessionEffort) {
    }
}

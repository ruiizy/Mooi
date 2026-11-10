package dev.mooi.mic.features;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.mooi.mic.shared.Auth;
import dev.mooi.mic.shared.Crypto;
import dev.mooi.mic.shared.Db;
import dev.mooi.mic.shared.Github;
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
 * Feature: the GitHub account linked to a player.
 *
 * <p>A connection is a link, never an identity: signing up and signing in stay Google-only, and
 * nothing here can create a player or open a session. What this feature owns is the grant a player
 * gave us on their GitHub account, kept alive on their behalf.
 *
 * <p>Every endpoint is authenticated, the OAuth2 callback included. That is the whole reason GitHub
 * redirects to the SPA rather than here: the browser lands on a screen that already holds a Mooi
 * access token and posts the authorization code with it, so the grant is bound to a known player and
 * no session material ever travels through a URL or a cross-site redirect.
 *
 * <p>Self-contained by architecture: API, application logic, persistence and contracts live in this
 * single file and may only import transversal aspects from {@code shared}.
 */
@RestController
@RequiredArgsConstructor
public class GithubConnectionFeature {

    private final GithubConnectionService githubConnectionService;

    /** Minting a state has an effect and must never be replayed from a cache, hence POST. */
    @PostMapping("/me/github/authorization")
    @Auth.Authenticated
    public AuthorizationPayload startAuthorization(Auth.Principal principal) {
        return githubConnectionService.startAuthorization(principal.player().id());
    }

    /** The code is redeemed for the caller on this request, never for whoever the state claims. */
    @PostMapping("/me/github/connection")
    @Auth.Authenticated
    public ConnectionResponse connect(@Valid @RequestBody ConnectionRequest request, Auth.Principal principal) {
        return new ConnectionResponse(
                githubConnectionService.connect(principal.player().id(), request.code(), request.state()));
    }

    /** Answers with a null connection rather than a 404: "not linked" is a state, not a mistake. */
    @GetMapping("/me/github/connection")
    @Auth.Authenticated
    public ConnectionResponse currentConnection(Auth.Principal principal) {
        return new ConnectionResponse(
                githubConnectionService.currentConnection(principal.player().id()).orElse(null));
    }

    /**
     * The repositories behind the link, read live rather than stored: what a grant can reach changes
     * on GitHub's side, and a cached list would offer the player repositories they no longer have.
     */
    @GetMapping("/me/github/repositories")
    @Auth.Authenticated
    public RepositoriesResponse repositories(Auth.Principal principal) {
        Github.RepositoryAccess access = githubConnectionService.repositories(principal.player().id());
        return new RepositoriesResponse(access.repositories(), access.installations());
    }

    /** Always 204, linked or not: disconnecting is stated as an outcome, not as a transaction. */
    @DeleteMapping("/me/github/connection")
    @Auth.Authenticated
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disconnect(Auth.Principal principal) {
        githubConnectionService.disconnect(principal.player().id());
    }

    /**
     * A usable clone token, handed only to another internal service so it can fetch the player's
     * repositories onto its own filesystem. A browser holding a valid access token is not enough.
     */
    @GetMapping("/me/github/token")
    @Auth.Authenticated
    @Auth.ServiceCall
    public GithubTokenPayload token(Auth.Principal principal) {
        return githubConnectionService.token(principal.player().id());
    }

    // --- application ---

    /**
     * Everything the connection does: opening the authorization, closing it, reporting it and
     * dropping it.
     *
     * <p>Two rules shape the whole class. Token material is sealed the moment it arrives and opened
     * only for the single call that needs it, so no caller is ever handed a usable GitHub
     * credential. And a failed renewal never destroys data: a stale link the player can repair with
     * one click is strictly better than a row deleted because GitHub answered badly.
     */
    @Service
    @RequiredArgsConstructor
    public static class GithubConnectionService {

        private final GithubConnectionRepository githubConnectionRepository;
        private final Github.OAuthClient oauthClient;
        private final Github.StateCodec stateCodec;
        private final Github.Settings settings;
        private final Crypto.SecretBox secretBox;
        private final Clock clock;

        /**
         * The URL is assembled here rather than in the SPA so the client id and the registered
         * redirect URI stay configuration of the API, and so the {@code state} is signed by the very
         * party that will later verify it.
         */
        public AuthorizationPayload startAuthorization(UUID playerId) {
            oauthClient.ensureCredentialsAccepted();
            String state = stateCodec.issue(playerId);
            return new AuthorizationPayload(oauthClient.authorizeUrl(state), oauthClient.installUrl(state));
        }

        /**
         * Closes the loop opened by {@link #startAuthorization(UUID)}.
         *
         * <p>The state is checked against the caller, not merely against our own signature: a
         * perfectly valid state minted for somebody else is exactly the attack this parameter exists
         * to stop, and only the authenticated player on this request can tell the two apart.
         */
        @Transactional
        public GithubConnectionPayload connect(UUID playerId, String code, String state) {
            if (!stateCodec.verify(state).equals(playerId)) {
                throw Github.GithubException.invalidState();
            }
            Github.Tokens grant = oauthClient.exchangeCode(code);
            Github.Viewer viewer = oauthClient.fetchViewer(grant.accessToken());

            githubConnectionRepository.findByGithubUserId(viewer.id())
                    .filter(claimed -> !claimed.getPlayerId().equals(playerId))
                    .ifPresent(claimed -> {
                        throw Github.GithubException.alreadyLinked();
                    });

            OffsetDateTime now = OffsetDateTime.now(clock);
            // Relinking reuses the row, and with it the original connectedAt: the player is renewing
            // a link they already made, not making a new one.
            GithubConnection connection = githubConnectionRepository.findByPlayerId(playerId)
                    .orElseGet(() -> {
                        GithubConnection created = new GithubConnection();
                        created.setPlayerId(playerId);
                        created.setConnectedAt(now);
                        return created;
                    });
            connection.setGithubUserId(viewer.id());
            connection.setLogin(viewer.login());
            connection.setName(viewer.name());
            connection.setAvatarUrl(viewer.avatarUrl());
            connection.setProfileUrl(viewer.profileUrl());
            connection.setScope(grant.scope());
            applyGrant(connection, grant);

            GithubConnection saved = githubConnectionRepository.save(connection);
            Github.LOG.info("Player {} linked GitHub account {}", playerId, viewer.login());
            return toPayload(saved);
        }

        /**
         * Reading the status is also what keeps the link alive: a player who opens the account
         * screen every few hours never authorizes again, and no scheduled job is needed to hold the
         * grant open.
         */
        @Transactional
        public Optional<GithubConnectionPayload> currentConnection(UUID playerId) {
            return githubConnectionRepository.findByPlayerId(playerId)
                    .map(this::ensureFreshToken)
                    .map(GithubConnectionService::toPayload);
        }

        /**
         * Lists what the linked account can reach, renewing the token first for the same reason
         * every other read does: a call that dies mid-flight on an expired credential would look to
         * the player like GitHub losing their repositories.
         */
        @Transactional
        public Github.RepositoryAccess repositories(UUID playerId) {
            GithubConnection connection = githubConnectionRepository.findByPlayerId(playerId)
                    .map(this::ensureFreshToken)
                    .orElseThrow(Github.GithubException::reauthorize);
            return oauthClient.listRepositories(secretBox.decrypt(connection.getAccessToken()));
        }

        /**
         * Drops the grant on both sides, ours last. GitHub is told first, best effort only: the
         * player asked to disconnect, so a GitHub outage must never be able to keep the link. Silent
         * when nothing is linked, which is what makes a repeated call harmless.
         */
        @Transactional
        public void disconnect(UUID playerId) {
            githubConnectionRepository.findByPlayerId(playerId).ifPresent(connection -> {
                oauthClient.revoke(secretBox.decrypt(connection.getAccessToken()));
                githubConnectionRepository.deleteByPlayerId(playerId);
                Github.LOG.info("Player {} unlinked GitHub account {}", playerId, connection.getLogin());
            });
        }

        /**
         * Renewing the token here is what makes this endpoint safe to call on every session start:
         * the caller is never handed a credential that dies mid-clone.
         */
        @Transactional
        public GithubTokenPayload token(UUID playerId) {
            GithubConnection connection = githubConnectionRepository.findByPlayerId(playerId)
                    .map(this::ensureFreshToken)
                    .orElseThrow(Github.GithubException::reauthorize);
            return new GithubTokenPayload(secretBox.decrypt(connection.getAccessToken()),
                    connection.getAccessTokenExpiresAt());
        }

        /**
         * Renews the access token shortly before it expires, so nothing downstream is handed a
         * credential that dies mid-flight.
         *
         * <p>A refusal returns the row untouched instead of raising: the connection is still a fact,
         * and the player only needs to link again.
         */
        private GithubConnection ensureFreshToken(GithubConnection connection) {
            OffsetDateTime expiresAt = connection.getAccessTokenExpiresAt();
            OffsetDateTime now = OffsetDateTime.now(clock);
            if (expiresAt == null || expiresAt.isAfter(now.plus(settings.getTokenRefreshSkew()))) {
                return connection;
            }
            String refreshToken = secretBox.decrypt(connection.getRefreshToken());
            if (refreshToken == null) {
                Github.LOG.warn("GitHub connection of player {} has no refresh token to renew with",
                        connection.getPlayerId());
                return connection;
            }
            try {
                applyGrant(connection, oauthClient.refresh(refreshToken));
                connection.setLastRefreshedAt(now);
                return githubConnectionRepository.save(connection);
            } catch (Github.GithubException exception) {
                Github.LOG.warn("Unable to renew the GitHub token of player {}: {}",
                        connection.getPlayerId(), exception.getReason());
                return connection;
            }
        }

        /**
         * Writes a whole grant, never half of one: GitHub rotates the refresh token together with
         * the access token, so keeping the previous one would leave the row holding a credential
         * GitHub has already retired.
         */
        private void applyGrant(GithubConnection connection, Github.Tokens grant) {
            connection.setAccessToken(secretBox.encrypt(grant.accessToken()));
            connection.setAccessTokenExpiresAt(grant.accessTokenExpiresAt());
            connection.setRefreshToken(secretBox.encrypt(grant.refreshToken()));
            connection.setRefreshTokenExpiresAt(grant.refreshTokenExpiresAt());
        }

        private static GithubConnectionPayload toPayload(GithubConnection connection) {
            return new GithubConnectionPayload(connection.getGithubUserId(), connection.getLogin(),
                    connection.getName(), connection.getAvatarUrl(), connection.getProfileUrl(),
                    connection.getConnectedAt(), connection.getAccessTokenExpiresAt(),
                    connection.getRefreshTokenExpiresAt());
        }
    }

    // --- persistence ---

    /**
     * One GitHub account linked to one player.
     *
     * <p>Two unique constraints carry the two halves of that sentence: a player links at most one
     * GitHub account, and a GitHub account is claimed by at most one player. The second one is what
     * stops two people quietly sharing a single GitHub identity inside the application.
     */
    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "GithubConnection")
    @Table(name = "github_connections")
    public static class GithubConnection extends Db.Auditable {

        @Id
        @GeneratedValue
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, unique = true, updatable = false)
        private UUID playerId;

        /** GitHub's numeric id, not the login: a login can be renamed, this cannot. */
        @Column(name = "github_user_id", nullable = false, unique = true)
        private long githubUserId;

        @Column(name = "login", nullable = false, length = 128)
        private String login;

        @Column(name = "name", length = 255)
        private String name;

        @Column(name = "avatar_url", length = 512)
        private String avatarUrl;

        @Column(name = "profile_url", length = 512)
        private String profileUrl;

        @Column(name = "scope", length = 512)
        private String scope;

        /**
         * AES-256-GCM ciphertext produced by {@code Crypto.SecretBox}, never a usable credential.
         * The plaintext exists only inside the request that needs it.
         */
        @Column(name = "access_token", nullable = false, length = 1024)
        private String accessToken;

        /** NULL means the token does not expire: a GitHub App with token expiration turned off. */
        @Column(name = "access_token_expires_at")
        private OffsetDateTime accessTokenExpiresAt;

        /** Ciphertext, as above. NULL when GitHub issued no refresh token with the grant. */
        @Column(name = "refresh_token", length = 1024)
        private String refreshToken;

        @Column(name = "refresh_token_expires_at")
        private OffsetDateTime refreshTokenExpiresAt;

        /** When the player first linked the account; survives a relink of the same account. */
        @Column(name = "connected_at", nullable = false)
        private OffsetDateTime connectedAt;

        @Column(name = "last_refreshed_at")
        private OffsetDateTime lastRefreshedAt;
    }

    public interface GithubConnectionRepository extends JpaRepository<GithubConnection, UUID> {

        Optional<GithubConnection> findByPlayerId(UUID playerId);

        /** Answers whether the GitHub account is already claimed, before anything is written. */
        Optional<GithubConnection> findByGithubUserId(long githubUserId);

        void deleteByPlayerId(UUID playerId);
    }

    // --- contracts ---

    /**
     * The two doors of the integration. {@code authorizeUrl} identifies the player and lets them
     * choose which GitHub account to use; {@code installUrl} is where they choose which repositories
     * Mooi may read. Both carry the same freshly signed state, so either one closes the loop on the
     * same callback.
     */
    public record AuthorizationPayload(String authorizeUrl, String installUrl) {
    }

    public record ConnectionRequest(@NotBlank String code, @NotBlank String state) {
    }

    /**
     * What the SPA is told about a connection. No token material of any kind: the client never needs
     * a GitHub credential, so it is never given one.
     */
    public record GithubConnectionPayload(long githubUserId, String login, String name, String avatarUrl,
                                          String profileUrl, OffsetDateTime connectedAt,
                                          OffsetDateTime accessTokenExpiresAt,
                                          OffsetDateTime refreshTokenExpiresAt) {
    }

    /** Nullable payload: "not linked" is an answer, not an error. */
    public record ConnectionResponse(GithubConnectionPayload connection) {
    }

    /**
     * Repository metadata only, straight from GitHub: nothing here is persisted by this feature.
     * {@code installations} travels with it because it is what separates "you have no other
     * repository" from "Mooi was never granted access to one".
     */
    public record RepositoriesResponse(List<Github.Repository> repositories, int installations) {
    }

    /** A usable GitHub clone token. The only payload in this feature that ever serializes one. */
    public record GithubTokenPayload(String token, OffsetDateTime expiresAt) {
    }
}

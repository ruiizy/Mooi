package dev.mooi.mic.features;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
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
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.annotation.JsonInclude;

import dev.mooi.mic.shared.Auth;
import dev.mooi.mic.shared.Auth.GoogleIdentityProvider.GoogleIdentity;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Converter;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.Setter;

/**
 * Feature: authentication sessions.
 *
 * <p>Sign up and login share one endpoint because the client cannot know which one it is asking
 * for: only {@code google_id} tells them apart, and only the server has seen it before. Everything
 * downstream of that — session opening, refresh token rotation, replay detection and revocation —
 * lives here too.
 *
 * <p>A sign-in stays alive while it is used: the refresh token travels in an {@code HttpOnly}
 * cookie, is single-use and is re-issued on every renewal with a fresh 30-day deadline, so only 30
 * days without use (or an explicit revocation, or a detected replay) ends it. A response lost on
 * the way is recovered instead of being mistaken for a replay.
 *
 * <p>Self-contained by architecture: API, application logic, persistence and contracts live in this
 * single file and may only import transversal aspects from {@code shared}. This feature also adapts
 * the {@link Auth.SessionGuard} port, which is how the auth aspect reaches these tables without
 * importing a feature.
 */
@RestController
@RequiredArgsConstructor
public class AuthFeature {

    private final AuthService authService;
    private final Auth.RefreshCookies refreshCookies;
    private final Auth.Settings settings;

    @PostMapping("/auth/google")
    public SessionPayload loginOrSignup(@Valid @RequestBody GoogleLoginRequest request,
                                        HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        refreshCookies.requireTrustedOrigin(httpRequest);
        IssuedSession issued = authService.loginOrSignupWithGoogle(request.idToken(), Auth.readUserAgent(httpRequest),
                Auth.readIpAddress(httpRequest));
        return respond(issued, httpRequest, httpResponse);
    }

    /**
     * Renews the sign-in. The token comes from the cookie; the body is read only for clients that
     * predate the cookie (the migration of a stored token, and old bundles still open).
     */
    @PostMapping("/auth/refresh")
    public SessionPayload refresh(@RequestBody(required = false) LegacyRefreshRequest body,
                                  HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        refreshCookies.requireTrustedOrigin(httpRequest);
        String presented = presentedToken(body, httpRequest)
                .orElseThrow(() -> new Auth.AuthenticationException("Invalid refresh token"));
        return respond(authService.refreshSession(presented), httpRequest, httpResponse);
    }

    /**
     * Always answers 204, even for a token nobody knows: logout must succeed for a client holding a
     * retired token, and a different answer would be an oracle for guessing tokens.
     */
    @PostMapping("/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestBody(required = false) LegacyRefreshRequest body,
                       HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        refreshCookies.requireTrustedOrigin(httpRequest);
        presentedToken(body, httpRequest).ifPresent(authService::revokeSession);
        refreshCookies.clear(httpResponse);
    }

    @PostMapping("/auth/logout-all")
    @Auth.Authenticated
    public RevokedSessionsPayload logoutEverywhere(Auth.Principal principal, HttpServletRequest httpRequest,
                                                   HttpServletResponse httpResponse) {
        refreshCookies.requireTrustedOrigin(httpRequest);
        refreshCookies.clear(httpResponse);
        return new RevokedSessionsPayload(authService.revokePlayerSessions(principal.player().id()));
    }

    /** Doubles as the session check: reaching the handler at all means the session is still alive. */
    @GetMapping("/me")
    @Auth.Authenticated
    public CurrentPlayerPayload me(Auth.Principal principal) {
        return new CurrentPlayerPayload(AuthService.toPayload(principal.player()));
    }

    /**
     * Service-only: a fresh access token for a sign-in that is still live, so an agent or a run acting
     * for the player keeps working after the token of the request that started it expired.
     */
    @PostMapping("/internal/auth/sessions/{sessionId}/access-token")
    @Auth.ServiceOnly
    public AccessTokenPayload renewAccessToken(@PathVariable UUID sessionId,
                                               @Valid @RequestBody AccessTokenRequest request) {
        return authService.renewAccessToken(sessionId, request.playerId());
    }

    @GetMapping("/admin/ping")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public StatusPayload adminPing() {
        return new StatusPayload("ok");
    }

    /** Kick: ends every sign-in of the player at once; they may sign in again. */
    @PostMapping("/admin/players/{playerId}/sign-out")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public RevokedSessionsPayload signOutPlayer(@PathVariable UUID playerId, Auth.Principal principal) {
        return new RevokedSessionsPayload(authService.signOutPlayer(principal.player().id(), playerId));
    }

    /** Ban: ends every sign-in and refuses every future one until lifted. Idempotent. */
    @PutMapping("/admin/players/{playerId}/ban")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public BanPayload banPlayer(@PathVariable UUID playerId, Auth.Principal principal) {
        return authService.banPlayer(principal.player().id(), playerId);
    }

    @DeleteMapping("/admin/players/{playerId}/ban")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public BanPayload unbanPlayer(@PathVariable UUID playerId, Auth.Principal principal) {
        return authService.unbanPlayer(principal.player().id(), playerId);
    }

    /** Cookie first, legacy body second (only while the transition flag is on). */
    private Optional<String> presentedToken(LegacyRefreshRequest body, HttpServletRequest request) {
        Optional<String> fromCookie = refreshCookies.read(request);
        if (fromCookie.isPresent()) {
            return fromCookie;
        }
        if (settings.isLegacyBodyTokenEnabled() && body != null && body.refreshToken() != null
                && !body.refreshToken().isBlank()) {
            return Optional.of(body.refreshToken());
        }
        return Optional.empty();
    }

    /**
     * Sets the cookie when a refresh token was issued and keeps every cookie-carrying answer out of
     * caches. The body repeats the token only for clients that predate the cookie.
     */
    private SessionPayload respond(IssuedSession issued, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue());
        if (issued.refreshSecret() != null) {
            refreshCookies.write(response, issued.refreshSecret());
        }
        boolean legacyClient = settings.isLegacyBodyTokenEnabled() && !refreshCookies.cookieTransport(request);
        return new SessionPayload(issued.accessToken(), issued.expiresIn(),
                legacyClient ? issued.refreshSecret() : null, issued.player());
    }

    // --- application ---

    @Service
    @RequiredArgsConstructor
    public static class AuthService implements Auth.SessionGuard {

        private static final String INVALID_REFRESH_TOKEN = "Invalid refresh token";
        private static final String SESSION_NOT_ACTIVE = "Session is no longer active";
        private static final String ACCOUNT_SUSPENDED = "This account is suspended";

        private final PlayerRepository playerRepository;
        private final AuthSessionRepository authSessionRepository;
        private final RefreshTokenRepository refreshTokenRepository;
        private final Auth.Settings settings;
        private final Auth.Tokens tokens;
        private final Auth.GoogleIdentityProvider googleIdentityProvider;
        private final Clock clock;

        /**
         * The {@link Auth.SessionGuard} adaptation: two indexed primary key lookups, and the subject
         * binding check that makes a token minted for another player forgery rather than a mismatch.
         */
        @Override
        @Transactional(readOnly = true)
        public Optional<Auth.AuthenticatedPlayer> resolve(UUID sessionId, UUID playerId) {
            Optional<AuthSession> session = authSessionRepository.findByIdAndRevokedAtIsNull(sessionId);
            if (session.isEmpty()) {
                return Optional.empty();
            }
            if (!session.get().getPlayerId().equals(playerId)) {
                Auth.LOG.warn("Access token subject {} does not match session {}", playerId, sessionId);
                return Optional.empty();
            }
            return playerRepository.findById(playerId).filter(AuthService::allowed).map(AuthService::toAuthenticatedPlayer);
        }

        /**
         * One entry point for both flows. The response is identical either way — the SPA cannot tell
         * them apart and does not need to; the branch only decides what is written and what is logged.
         */
        @Transactional
        public IssuedSession loginOrSignupWithGoogle(String idToken, String userAgent, String ipAddress) {
            GoogleIdentity identity = googleIdentityProvider.verify(idToken);
            OffsetDateTime now = OffsetDateTime.now(clock);

            Optional<Player> existing = playerRepository.findByGoogleId(identity.googleId());
            if (existing.isPresent() && !allowed(existing.get())) {
                Auth.LOG.info("Banned player {} was refused sign in", existing.get().getId());
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, ACCOUNT_SUSPENDED);
            }
            boolean isNewPlayer = existing.isEmpty();
            Player player = existing
                    .map(found -> refreshProfile(found, identity))
                    .orElseGet(() -> createPlayer(identity, now));

            // A new session row every time, never a reused one: that is what makes each device
            // separately revocable, and what stops signing in on a new machine from silently
            // extending an old login.
            AuthSession session = new AuthSession();
            session.setPlayerId(player.getId());
            session.setCreatedAt(now);
            session.setLastUsedAt(now);
            session.setUserAgent(userAgent);
            session.setIpAddress(ipAddress);
            AuthSession openedSession = authSessionRepository.save(session);

            IssuedSession payload = issueSessionTokens(player, openedSession.getId(), null, now);
            Auth.LOG.info(isNewPlayer ? "Player signed up {}" : "Player signed in {}", player.getId());
            return payload;
        }

        /**
         * Rotation, replay detection and recovery.
         *
         * <p>Every renewal spends the presented token and issues its successor, with a fresh
         * deadline: a player who keeps using the application never signs in again. A spent token
         * presented again is judged by what happened since:
         * <ul>
         *   <li>inside the grace window two tabs simply raced: an access token is returned and no
         *       refresh token, because the browser already holds the winner's;</li>
         *   <li>after it, if the successor is still unspent the response carrying it was lost on the
         *       way: the chain is resumed from the successor;</li>
         *   <li>otherwise a copy of a retired token is the only explanation left and the whole session
         *       goes.</li>
         * </ul>
         *
         * <p>The revocations commit even though the call ends in a 401, hence {@code noRollbackFor}.
         */
        @Transactional(noRollbackFor = ResponseStatusException.class)
        public IssuedSession refreshSession(String presentedToken) {
            OffsetDateTime now = OffsetDateTime.now(clock);
            RefreshToken row = refreshTokenRepository.findByTokenHash(tokens.hashRefreshToken(presentedToken))
                    .orElseThrow(() -> new Auth.AuthenticationException(INVALID_REFRESH_TOKEN));
            AuthSession session = liveSession(row.getSessionId(), now);
            Player player = playerRepository.findById(session.getPlayerId())
                    .orElseThrow(() -> new Auth.AuthenticationException(SESSION_NOT_ACTIVE));
            if (!allowed(player)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, ACCOUNT_SUSPENDED);
            }

            if (row.getUsedAt() == null) {
                if (row.getExpiresAt().isBefore(now)) {
                    throw new Auth.AuthenticationException(INVALID_REFRESH_TOKEN);
                }
                // The claim is one conditional statement, so Postgres serialises concurrent attempts
                // and exactly one of them wins; the loser carries on as a replay of a just-spent token.
                if (refreshTokenRepository.spend(row.getId(), now) == 1) {
                    authSessionRepository.touch(session.getId(), now);
                    return issueSessionTokens(player, session.getId(), row, now);
                }
                row = refreshTokenRepository.findById(row.getId())
                        .orElseThrow(() -> new Auth.AuthenticationException(INVALID_REFRESH_TOKEN));
            }

            if (!now.isAfter(row.getUsedAt().plus(settings.getReplayGrace()))) {
                return accessOnly(player, session.getId());
            }
            Optional<RefreshToken> successor = Optional.ofNullable(row.getReplacedById())
                    .flatMap(refreshTokenRepository::findById)
                    .filter(next -> next.getUsedAt() == null && next.getExpiresAt().isAfter(now));
            if (successor.isPresent() && refreshTokenRepository.spend(successor.get().getId(), now) == 1) {
                authSessionRepository.touch(session.getId(), now);
                Auth.LOG.info("Refresh response lost for session {}; recovered", session.getId());
                return issueSessionTokens(player, session.getId(), successor.get(), now);
            }
            authSessionRepository.revoke(session.getId(), now);
            Auth.LOG.warn("Refresh token replayed {} after it was spent; session {} revoked",
                    settings.getReplayGrace(), session.getId());
            throw new Auth.AuthenticationException(INVALID_REFRESH_TOKEN);
        }

        /**
         * The session behind a refresh token, if the sign-in is still alive. A sign-in unused for the
         * refresh token's lifetime (or past the optional ceiling) is closed here rather than merely
         * refused, so every token still outstanding under it dies with it.
         */
        private AuthSession liveSession(UUID sessionId, OffsetDateTime now) {
            AuthSession session = authSessionRepository.findByIdAndRevokedAtIsNull(sessionId)
                    .orElseThrow(() -> new Auth.AuthenticationException(SESSION_NOT_ACTIVE));
            if (expired(session, now)) {
                authSessionRepository.revoke(session.getId(), now);
                Auth.LOG.info("Session {} expired after {} without use or reached its ceiling", session.getId(),
                        settings.getRefreshTokenTtl());
                throw new Auth.AuthenticationException(SESSION_NOT_ACTIVE);
            }
            return session;
        }

        private boolean expired(AuthSession session, OffsetDateTime now) {
            return session.getLastUsedAt().plus(settings.getRefreshTokenTtl()).isBefore(now)
                    || settings.getSessionMaxLifetime()
                            .map(ceiling -> session.getCreatedAt().plus(ceiling).isBefore(now)).orElse(false);
        }

        /** A grace-window renewal: a fresh access token, and no refresh token to hand out. */
        private IssuedSession accessOnly(Player player, UUID sessionId) {
            return new IssuedSession(tokens.signAccessToken(player.getId(), player.getRole(), sessionId),
                    tokens.accessTokenExpiresInSeconds(), null, toPayload(player));
        }

        /**
         * Mints an access token under a live session without touching its refresh tokens. Revocation,
         * the subject binding, the idle deadline and the optional ceiling apply exactly as they do to a
         * refresh, so a player who signs out stops every agent acting for them at its next renewal. It is
         * not player activity, so it never extends the sign-in.
         */
        @Transactional(readOnly = true)
        public AccessTokenPayload renewAccessToken(UUID sessionId, UUID playerId) {
            OffsetDateTime now = OffsetDateTime.now(clock);
            AuthSession session = authSessionRepository.findByIdAndRevokedAtIsNull(sessionId)
                    .filter(found -> found.getPlayerId().equals(playerId))
                    .filter(found -> !expired(found, now))
                    .orElseThrow(() -> new Auth.AuthenticationException(SESSION_NOT_ACTIVE));
            Player player = playerRepository.findById(session.getPlayerId()).filter(AuthService::allowed)
                    .orElseThrow(() -> new Auth.AuthenticationException(SESSION_NOT_ACTIVE));
            return new AccessTokenPayload(tokens.signAccessToken(player.getId(), player.getRole(), sessionId),
                    tokens.accessTokenExpiresInSeconds());
        }

        /**
         * Revokes <em>the session</em> behind a refresh token, not the token: that voids every access
         * token ever minted under it. Silent when the token is unknown.
         */
        @Transactional
        public void revokeSession(String presentedToken) {
            refreshTokenRepository.findByTokenHash(tokens.hashRefreshToken(presentedToken))
                    .ifPresent(row -> {
                        if (authSessionRepository.revoke(row.getSessionId(), OffsetDateTime.now(clock)) > 0) {
                            Auth.LOG.info("Session {} revoked by logout", row.getSessionId());
                        }
                    });
        }

        /**
         * Revokes every session of a player, the caller's included — sparing it would leave alive the
         * session an attacker most likely holds.
         */
        @Transactional
        public int revokePlayerSessions(UUID playerId) {
            int revoked = authSessionRepository.revokeAllForPlayer(playerId, OffsetDateTime.now(clock));
            Auth.LOG.info("Revoked {} sessions of player {}", revoked, playerId);
            return revoked;
        }

        /** An administrator ends every sign-in of another player; the player may sign in again. */
        @Transactional
        public int signOutPlayer(UUID adminId, UUID playerId) {
            requirePlayer(playerId);
            int revoked = authSessionRepository.revokeAllForPlayer(playerId, OffsetDateTime.now(clock));
            Auth.LOG.info("Admin {} revoked {} sessions of player {}", adminId, revoked, playerId);
            return revoked;
        }

        /**
         * Suspends a player: every sign-in ends now and none is accepted until the ban is lifted. The
         * guard, refresh and token renewal all read the ban, so agents acting for the player stop at
         * their next renewal too. An administrator never bans themselves out of the console.
         */
        @Transactional
        public BanPayload banPlayer(UUID adminId, UUID playerId) {
            if (adminId.equals(playerId)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "You cannot ban your own account");
            }
            Player player = requirePlayer(playerId);
            OffsetDateTime now = OffsetDateTime.now(clock);
            if (player.getBannedAt() == null) {
                player.setBannedAt(now);
                playerRepository.save(player);
            }
            int revoked = authSessionRepository.revokeAllForPlayer(playerId, now);
            Auth.LOG.info("Admin {} banned player {} ({} sessions revoked)", adminId, playerId, revoked);
            return new BanPayload(playerId, player.getBannedAt());
        }

        @Transactional
        public BanPayload unbanPlayer(UUID adminId, UUID playerId) {
            Player player = requirePlayer(playerId);
            if (player.getBannedAt() != null) {
                player.setBannedAt(null);
                playerRepository.save(player);
                Auth.LOG.info("Admin {} lifted the ban of player {}", adminId, playerId);
            }
            return new BanPayload(playerId, null);
        }

        private Player requirePlayer(UUID playerId) {
            return playerRepository.findById(playerId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Player not found"));
        }

        private static boolean allowed(Player player) {
            return player.getBannedAt() == null;
        }

        /**
         * Keeps the rotation ledger bounded, and closes the sign-ins nobody used for the refresh
         * token's lifetime so the admin console only lists live ones.
         *
         * <p>A sliding token leaves a spent row behind on every renewal — tens of thousands a year
         * for a single daily-active session. Only <em>expired</em> rows are deleted: a spent but
         * still unexpired one is exactly what replay detection reads, and removing it early would
         * turn a stolen token back into an unrecognised one.
         */
        @Transactional
        @Scheduled(cron = "${app.auth.refresh-token-purge-cron}")
        public void purgeExpiredAuthState() {
            OffsetDateTime now = OffsetDateTime.now(clock);
            int idle = authSessionRepository.revokeIdle(now.minus(settings.getRefreshTokenTtl()), now);
            int purged = refreshTokenRepository.purgeExpired(now);
            if (idle > 0 || purged > 0) {
                Auth.LOG.info("Revoked {} idle sessions, purged {} expired refresh tokens", idle, purged);
            }
        }

        /**
         * Issues the token pair, shared by login and refresh. Rotation is unconditional: a refresh
         * token is minted here and nowhere else, and the client never keeps the one it presented.
         * The spent {@code parent} is linked to its successor, which is what lets a lost response be
         * recovered.
         */
        private IssuedSession issueSessionTokens(Player player, UUID sessionId, RefreshToken parent,
                                                 OffsetDateTime now) {
            String refreshSecret = tokens.generateRefreshToken();
            RefreshToken refreshToken = new RefreshToken();
            refreshToken.setSessionId(sessionId);
            refreshToken.setTokenHash(tokens.hashRefreshToken(refreshSecret));
            refreshToken.setCreatedAt(now);
            refreshToken.setExpiresAt(now.plus(settings.getRefreshTokenTtl()));
            RefreshToken saved = refreshTokenRepository.save(refreshToken);
            if (parent != null) {
                refreshTokenRepository.linkSuccessor(parent.getId(), saved.getId());
            }

            String accessToken = tokens.signAccessToken(player.getId(), player.getRole(), sessionId);
            // expiresIn is relative seconds, so a client with a skewed clock still renews in time.
            return new IssuedSession(accessToken, tokens.accessTokenExpiresInSeconds(), refreshSecret,
                    toPayload(player));
        }

        /** The role is decided here and only here: adding an address to ADMIN_EMAILS never promotes. */
        private Player createPlayer(GoogleIdentity identity, OffsetDateTime now) {
            Player player = new Player();
            player.setGoogleId(identity.googleId());
            player.setEmail(identity.email());
            player.setUsername(identity.username());
            player.setAvatarUrl(identity.avatarUrl());
            player.setRole(settings.resolvePlayerRole(identity.email()));
            player.setCreatedAt(now);
            return playerRepository.save(player);
        }

        /** Google owns the profile, we own the role: the UPDATE is skipped when nothing changed. */
        private Player refreshProfile(Player player, GoogleIdentity identity) {
            boolean unchanged = Objects.equals(player.getUsername(), identity.username())
                    && Objects.equals(player.getEmail(), identity.email())
                    && Objects.equals(player.getAvatarUrl(), identity.avatarUrl());
            if (unchanged) {
                return player;
            }
            player.setUsername(identity.username());
            player.setEmail(identity.email());
            player.setAvatarUrl(identity.avatarUrl());
            return playerRepository.save(player);
        }

        private static Auth.AuthenticatedPlayer toAuthenticatedPlayer(Player player) {
            return new Auth.AuthenticatedPlayer(player.getId(), player.getUsername(), player.getEmail(),
                    player.getAvatarUrl(), player.getRole(), player.getCreatedAt());
        }

        static PlayerPayload toPayload(Player player) {
            return new PlayerPayload(player.getId(), player.getUsername(), player.getEmail(),
                    player.getAvatarUrl(), player.getRole().wire(), player.getCreatedAt());
        }

        static PlayerPayload toPayload(Auth.AuthenticatedPlayer player) {
            return new PlayerPayload(player.id(), player.username(), player.email(), player.avatarUrl(),
                    player.role().wire(), player.createdAt());
        }
    }

    // --- persistence ---

    /** Keeps the closed set of roles on the wire exactly as the API and the SPA read it. */
    @Converter
    public static class RoleConverter implements AttributeConverter<Auth.Role, String> {

        @Override
        public String convertToDatabaseColumn(Auth.Role role) {
            return role == null ? null : role.wire();
        }

        @Override
        public Auth.Role convertToEntityAttribute(String value) {
            return value == null ? null : Auth.Role.fromWire(value);
        }
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "Player")
    @Table(name = "players")
    public static class Player {

        @Id
        @GeneratedValue
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        /** The only stable link to Google. Decides sign up vs. login, and never leaves the server. */
        @Column(name = "google_id", nullable = false, unique = true, updatable = false, length = 255)
        private String googleId;

        @Column(name = "email", nullable = false, unique = true, length = 255)
        private String email;

        @Column(name = "username", nullable = false, length = 64)
        private String username;

        @Column(name = "avatar_url", length = 512)
        private String avatarUrl;

        @Convert(converter = RoleConverter.class)
        @Column(name = "role", nullable = false, length = 16)
        private Auth.Role role;

        @Column(name = "created_at", nullable = false, updatable = false)
        private OffsetDateTime createdAt;

        /** NULL means allowed. Set by an administrator: no sign-in is accepted while it is set. */
        @Column(name = "banned_at")
        private OffsetDateTime bannedAt;
    }

    /** One sign-in — the unit revocation acts on. */
    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "AuthSession")
    @Table(name = "auth_sessions")
    public static class AuthSession {

        @Id
        @GeneratedValue
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, updatable = false)
        private UUID playerId;

        @Column(name = "created_at", nullable = false, updatable = false)
        private OffsetDateTime createdAt;

        @Column(name = "last_used_at", nullable = false)
        private OffsetDateTime lastUsedAt;

        /** NULL means alive: the single fact every auth check reads. */
        @Column(name = "revoked_at")
        private OffsetDateTime revokedAt;

        @Column(name = "user_agent", length = 512)
        private String userAgent;

        @Column(name = "ip_address", length = 64)
        private String ipAddress;
    }

    /** Single-use renewal ticket. The secret itself exists only on the client. */
    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "RefreshToken")
    @Table(name = "refresh_tokens")
    public static class RefreshToken {

        @Id
        @GeneratedValue
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "session_id", nullable = false, updatable = false)
        private UUID sessionId;

        @Column(name = "token_hash", nullable = false, unique = true, updatable = false, length = 64)
        private String tokenHash;

        @Column(name = "expires_at", nullable = false, updatable = false)
        private OffsetDateTime expiresAt;

        @Column(name = "created_at", nullable = false, updatable = false)
        private OffsetDateTime createdAt;

        /** NULL means unspent. Set once, atomically — the rotation and replay signal. */
        @Column(name = "used_at")
        private OffsetDateTime usedAt;

        /** The token this one was rotated into; NULL until rotated. Lets a lost response be recovered. */
        @Column(name = "replaced_by_id")
        private UUID replacedById;
    }

    public interface PlayerRepository extends JpaRepository<Player, UUID> {

        Optional<Player> findByGoogleId(String googleId);
    }

    public interface AuthSessionRepository extends JpaRepository<AuthSession, UUID> {

        Optional<AuthSession> findByIdAndRevokedAtIsNull(UUID id);

        /** Guarded so a repeated logout keeps the original timestamp. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("update AuthSession s set s.revokedAt = :now where s.id = :id and s.revokedAt is null")
        int revoke(@Param("id") UUID id, @Param("now") OffsetDateTime now);

        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("update AuthSession s set s.revokedAt = :now where s.playerId = :playerId and s.revokedAt is null")
        int revokeAllForPlayer(@Param("playerId") UUID playerId, @Param("now") OffsetDateTime now);

        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("update AuthSession s set s.lastUsedAt = :now where s.id = :id")
        int touch(@Param("id") UUID id, @Param("now") OffsetDateTime now);

        /** Closes the live sign-ins not used since {@code cutoff}. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("update AuthSession s set s.revokedAt = :now where s.revokedAt is null and s.lastUsedAt < :cutoff")
        int revokeIdle(@Param("cutoff") OffsetDateTime cutoff, @Param("now") OffsetDateTime now);
    }

    public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

        Optional<RefreshToken> findByTokenHash(String tokenHash);

        /**
         * The single conditional statement rotation depends on: Postgres serialises concurrent
         * attempts on the row, so exactly one of them still sees {@code used_at IS NULL}.
         */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("update RefreshToken t set t.usedAt = :now where t.id = :id and t.usedAt is null")
        int spend(@Param("id") UUID id, @Param("now") OffsetDateTime now);

        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("update RefreshToken t set t.replacedById = :successor where t.id = :id")
        int linkSuccessor(@Param("id") UUID id, @Param("successor") UUID successor);

        /** Expiry is the only condition: spent rows stay until then, because replay detection reads them. */
        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query("delete from RefreshToken t where t.expiresAt < :now")
        int purgeExpired(@Param("now") OffsetDateTime now);
    }

    // --- contracts ---

    public record GoogleLoginRequest(@NotBlank String idToken) {
    }

    /** Transition only: pre-cookie clients send the refresh token in the body. */
    public record LegacyRefreshRequest(String refreshToken) {
    }

    /** Internal result of login and refresh; {@code refreshSecret} is null when none was issued. */
    record IssuedSession(String accessToken, long expiresIn, String refreshSecret, PlayerPayload player) {
    }

    /** {@code googleId} is deliberately absent: it never leaves the server. */
    public record PlayerPayload(UUID id, String username, String email, String avatarUrl, String role,
                                OffsetDateTime createdAt) {
    }

    public record AccessTokenRequest(@NotNull UUID playerId) {
    }

    public record AccessTokenPayload(String accessToken, long expiresIn) {
    }

    /** {@code refreshToken} is present only for clients that predate the cookie transport. */
    public record SessionPayload(String accessToken, long expiresIn,
                                 @JsonInclude(JsonInclude.Include.NON_NULL) String refreshToken,
                                 PlayerPayload player) {
    }

    public record CurrentPlayerPayload(PlayerPayload player) {
    }

    public record RevokedSessionsPayload(int revokedSessions) {
    }

    public record StatusPayload(String status) {
    }

    public record BanPayload(UUID playerId, OffsetDateTime bannedAt) {
    }
}

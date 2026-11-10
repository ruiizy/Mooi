package dev.mooi.mic.shared;

import java.lang.annotation.Annotation;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.BadJOSEException;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Transversal aspect: authentication and authorization.
 *
 * <p>Google issues an OIDC ID token in the browser, this aspect verifies it, and the feature that
 * owns the identity tables opens a session from it. Clients then hold a short-lived access token
 * (a stateless HS256 JWT) and a single-use refresh token. The access token carries {@code sid}, the
 * id of the session it was minted under, which is what makes it revocable: every guarded call
 * re-checks that the session is still alive, so a revocation takes effect on the next request
 * rather than at the next expiry.
 *
 * <p>Only the mechanics live here. The tables, the flows and the endpoints belong to the feature,
 * which plugs into this aspect through {@link SessionGuard}: this aspect declares the port and
 * never imports the feature that adapts it.
 */
@Configuration
public class Auth {

    /** Log scope shared by this aspect and the feature that owns the sessions. */
    public static final Logger LOG = LoggerFactory.getLogger("auth");

    /** Request attribute holding the {@link Principal} of an authenticated call. */
    public static final String PRINCIPAL_ATTRIBUTE = "dev.mooi.mic.auth.principal";

    /** MDC keys scoping every log line written while serving an authenticated call. */
    public static final String PLAYER_ID_KEY = "playerId";
    public static final String SESSION_ID_KEY = "sessionId";

    private static final Pattern DURATION_PATTERN = Pattern.compile("^(\\d+)([smhd])$");
    private static final Pattern COOKIE_NAME_PATTERN = Pattern.compile("^[A-Za-z0-9_-]+$");
    private static final String BEARER_PREFIX = "Bearer ";
    private static final int MAX_USER_AGENT_LENGTH = 512;
    private static final int MAX_IP_ADDRESS_LENGTH = 64;

    @Bean
    Clock authClock() {
        return Clock.systemUTC();
    }

    @Bean
    WebMvcConfigurer authWebMvcConfigurer(Tokens tokens, Settings settings, ObjectProvider<SessionGuard> sessionGuard) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(new AuthInterceptor(tokens, settings, sessionGuard)).addPathPatterns("/**");
            }

            @Override
            public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
                resolvers.add(new PrincipalArgumentResolver());
            }
        };
    }

    // --- contracts ---

    /** Roles are an exact match, not a hierarchy. The wire value is what the API and the SPA see. */
    public enum Role {

        MEMBER("member"),
        ADMIN("admin");

        private final String wire;

        Role(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static Role fromWire(String value) {
            return Arrays.stream(values())
                    .filter(role -> role.wire.equals(value))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Unknown role: " + value));
        }
    }

    /** The identity behind a live session, resolved on every guarded call. */
    public record AuthenticatedPlayer(UUID id, String username, String email, String avatarUrl, Role role,
                                      OffsetDateTime createdAt) {
    }

    /** What a guarded handler receives: who is calling, and which session they are calling under. */
    public record Principal(AuthenticatedPlayer player, UUID sessionId) {
    }

    /**
     * Port implemented by the feature owning the session tables.
     *
     * <p>Returns the player only when the session is alive <em>and</em> the access token's subject
     * matches the session's owner; an empty result is the single answer to every other case, so this
     * aspect never has to know why a session is unusable.
     */
    public interface SessionGuard {

        Optional<AuthenticatedPlayer> resolve(UUID sessionId, UUID playerId);
    }

    /** A bad, expired or revoked credential. Rendered as a 401 by the shared error contract. */
    public static class AuthenticationException extends ResponseStatusException {

        public AuthenticationException(String reason) {
            super(HttpStatus.UNAUTHORIZED, reason);
        }
    }

    /** Marks a handler as requiring a live session. */
    @Retention(RetentionPolicy.RUNTIME)
    @Target({ElementType.METHOD, ElementType.TYPE})
    public @interface Authenticated {
    }

    /** Marks a handler as requiring a live session held by a player with this exact role. */
    @Retention(RetentionPolicy.RUNTIME)
    @Target({ElementType.METHOD, ElementType.TYPE})
    public @interface RequireRole {

        Role value();
    }

    /**
     * Marks a handler as reachable only by another internal service, in addition to whatever player
     * guard already applies. Used on the handful of endpoints that hand out a raw third-party
     * credential: a browser holding a valid access token is not enough to read one.
     */
    @Retention(RetentionPolicy.RUNTIME)
    @Target({ElementType.METHOD, ElementType.TYPE})
    public @interface ServiceCall {
    }

    /**
     * Marks a handler as reachable only by another internal service acting on its own behalf, with no
     * player session: recording the outcome of a run that may outlive the access token that started
     * it, or reconciling runs a restart left behind. Callers must scope every lookup themselves.
     */
    @Retention(RetentionPolicy.RUNTIME)
    @Target({ElementType.METHOD, ElementType.TYPE})
    public @interface ServiceOnly {
    }

    // --- configuration ---

    /**
     * Every auth variable, read and validated at boot: a malformed TTL or a missing secret fails the
     * application start instead of the first sign-in.
     */
    @Getter
    @Component
    public static class Settings {

        private final String googleClientId;
        private final URL googleJwksUri;
        private final String jwtSecret;
        private final Duration accessTokenTtl;
        private final Duration refreshTokenTtl;
        /**
         * Optional ceiling a sliding refresh token cannot slide past, measured from the session's own
         * creation. Empty (the default) means none: an active player never signs in again, and
         * rotation, replay detection and the HttpOnly cookie are what bound a stolen token.
         */
        private final Optional<Duration> sessionMaxLifetime;
        private final Duration replayGrace;
        /** Name, path and flags of the HttpOnly cookie carrying the refresh token. */
        private final String refreshCookieName;
        private final String refreshCookiePath;
        private final boolean refreshCookieSecure;
        /** Transition only: pre-cookie clients send and receive the refresh token in JSON bodies. */
        private final boolean legacyBodyTokenEnabled;
        /** Origins allowed to call the cookie-authenticated endpoints (same list as CORS). */
        private final Set<String> allowedOrigins;
        private final Set<String> adminEmails;
        /**
         * Shared secret required of any {@link ServiceCall} handler. Left unvalidated here on
         * purpose: a service that never uses {@code @ServiceCall} must still boot without it, so the
         * check happens lazily, in {@link AuthInterceptor}, on the first call that needs it.
         */
        private final String serviceToken;
        /**
         * Development only (Mooi session previews): Google is never called and every sign-in resolves
         * to the fixed player {@link #googleMockEmail}. Off unless {@code AUTH_GOOGLE_MOCK_ENABLED=true}.
         */
        private final boolean googleMockEnabled;
        private final String googleMockEmail;

        Settings(@Value("${app.auth.google-client-id:}") String googleClientId,
                 @Value("${app.auth.google-jwks-uri}") String googleJwksUri,
                 @Value("${app.auth.jwt-secret:}") String jwtSecret,
                 @Value("${app.auth.access-token-expires-in}") String accessTokenExpiresIn,
                 @Value("${app.auth.refresh-token-expires-in}") String refreshTokenExpiresIn,
                 @Value("${app.auth.session-max-lifetime:}") String sessionMaxLifetime,
                 @Value("${app.auth.replay-grace-seconds}") long replayGraceSeconds,
                 @Value("${app.auth.refresh-cookie.name}") String refreshCookieName,
                 @Value("${app.auth.refresh-cookie.path}") String refreshCookiePath,
                 @Value("${app.auth.refresh-cookie.secure}") boolean refreshCookieSecure,
                 @Value("${app.auth.legacy-body-token-enabled}") boolean legacyBodyTokenEnabled,
                 @Value("${app.cors.allowed-origins}") String allowedOrigins,
                 @Value("${app.auth.admin-emails:}") String adminEmails,
                 @Value("${app.service.token:}") String serviceToken,
                 @Value("${app.auth.google-mock.enabled:false}") boolean googleMockEnabled,
                 @Value("${app.auth.google-mock.email:}") String googleMockEmail) {
            if (googleClientId == null || googleClientId.isBlank()) {
                throw new IllegalStateException("GOOGLE_CLIENT_ID must be set");
            }
            if (jwtSecret == null || jwtSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
                throw new IllegalStateException("JWT_SECRET must be at least 32 bytes long");
            }
            if (googleMockEnabled && (googleMockEmail == null || !googleMockEmail.contains("@"))) {
                throw new IllegalStateException("AUTH_GOOGLE_MOCK_EMAIL must be an email address");
            }
            if (replayGraceSeconds < 0) {
                throw new IllegalStateException("REPLAY_GRACE_SECONDS must not be negative");
            }
            if (refreshCookieName == null || !COOKIE_NAME_PATTERN.matcher(refreshCookieName).matches()) {
                throw new IllegalStateException("AUTH_REFRESH_COOKIE_NAME must match [A-Za-z0-9_-]+");
            }
            if (refreshCookiePath == null || !refreshCookiePath.startsWith("/")) {
                throw new IllegalStateException("AUTH_REFRESH_COOKIE_PATH must start with /");
            }
            this.googleClientId = googleClientId.strip();
            this.googleJwksUri = toUrl(googleJwksUri);
            this.jwtSecret = jwtSecret;
            this.accessTokenTtl = parseDuration(accessTokenExpiresIn, "ACCESS_TOKEN_EXPIRES_IN");
            this.refreshTokenTtl = parseDuration(refreshTokenExpiresIn, "REFRESH_TOKEN_EXPIRES_IN");
            this.sessionMaxLifetime = sessionMaxLifetime == null || sessionMaxLifetime.isBlank()
                    ? Optional.empty()
                    : Optional.of(parseDuration(sessionMaxLifetime, "SESSION_MAX_LIFETIME"));
            if (this.sessionMaxLifetime.isPresent() && this.sessionMaxLifetime.get().compareTo(this.refreshTokenTtl) < 0) {
                throw new IllegalStateException("SESSION_MAX_LIFETIME must not be shorter than REFRESH_TOKEN_EXPIRES_IN");
            }
            this.replayGrace = Duration.ofSeconds(replayGraceSeconds);
            this.refreshCookieName = refreshCookieName;
            this.refreshCookiePath = refreshCookiePath;
            this.refreshCookieSecure = refreshCookieSecure;
            this.legacyBodyTokenEnabled = legacyBodyTokenEnabled;
            this.allowedOrigins = Arrays.stream(allowedOrigins == null ? new String[0] : allowedOrigins.split(","))
                    .map(String::strip)
                    .filter(origin -> !origin.isEmpty())
                    .collect(Collectors.toUnmodifiableSet());
            this.adminEmails = Arrays.stream(adminEmails == null ? new String[0] : adminEmails.split(","))
                    .map(email -> email.strip().toLowerCase(Locale.ROOT))
                    .filter(email -> !email.isEmpty())
                    .collect(Collectors.toUnmodifiableSet());
            this.serviceToken = serviceToken == null ? "" : serviceToken.strip();
            this.googleMockEnabled = googleMockEnabled;
            this.googleMockEmail = googleMockEnabled ? googleMockEmail.strip().toLowerCase(Locale.ROOT) : "";
        }

        /**
         * The role a Google address is granted. Called at signup and nowhere else: adding an address
         * to {@code ADMIN_EMAILS} later never promotes an existing player.
         */
        public Role resolvePlayerRole(String email) {
            return adminEmails.contains(email.strip().toLowerCase(Locale.ROOT)) ? Role.ADMIN : Role.MEMBER;
        }

        private static URL toUrl(String value) {
            try {
                return URI.create(value).toURL();
            } catch (MalformedURLException | IllegalArgumentException exception) {
                throw new IllegalStateException("GOOGLE_JWKS_URI is not a valid URL: " + value, exception);
            }
        }
    }

    /** Parses the {@code <n><s|m|h|d>} TTL format. Malformed values throw, at boot. */
    public static Duration parseDuration(String value, String name) {
        Matcher matcher = value == null ? null : DURATION_PATTERN.matcher(value.strip());
        if (matcher == null || !matcher.matches()) {
            throw new IllegalStateException(name + " must match <n><s|m|h|d>, got: " + value);
        }
        long amount = Long.parseLong(matcher.group(1));
        if (amount <= 0) {
            throw new IllegalStateException(name + " must be greater than zero, got: " + value);
        }
        return switch (matcher.group(2)) {
            case "s" -> Duration.ofSeconds(amount);
            case "m" -> Duration.ofMinutes(amount);
            case "h" -> Duration.ofHours(amount);
            default -> Duration.ofDays(amount);
        };
    }

    // --- refresh cookie ---

    /**
     * Transport of the refresh token: an {@code HttpOnly} cookie scoped to the auth endpoints, so
     * page scripts never read it and no other request carries it. Mechanics only; the flows that
     * rotate and revoke belong to the feature.
     */
    @Component
    @RequiredArgsConstructor
    public static class RefreshCookies {

        /** Header every SPA auth call sends: a cross-origin page cannot add it without a preflight. */
        public static final String TRANSPORT_HEADER = "X-Mooi-Auth";
        public static final String COOKIE_TRANSPORT = "cookie";

        private final Settings settings;

        /** The refresh secret the browser sent, if any. */
        public Optional<String> read(HttpServletRequest request) {
            if (request.getCookies() == null) {
                return Optional.empty();
            }
            return Arrays.stream(request.getCookies())
                    .filter(cookie -> settings.getRefreshCookieName().equals(cookie.getName()))
                    .map(jakarta.servlet.http.Cookie::getValue)
                    .filter(value -> value != null && !value.isBlank())
                    .findFirst();
        }

        /** True when the caller is a cookie-transport client (the current SPA). */
        public boolean cookieTransport(HttpServletRequest request) {
            return COOKIE_TRANSPORT.equals(request.getHeader(TRANSPORT_HEADER));
        }

        public void write(HttpServletResponse response, String secret) {
            add(response, secret, settings.getRefreshTokenTtl());
        }

        public void clear(HttpServletResponse response) {
            add(response, "", Duration.ZERO);
        }

        private void add(HttpServletResponse response, String value, Duration maxAge) {
            ResponseCookie cookie = ResponseCookie.from(settings.getRefreshCookieName(), value)
                    .httpOnly(true)
                    .secure(settings.isRefreshCookieSecure())
                    .sameSite("Strict")
                    .path(settings.getRefreshCookiePath())
                    .maxAge(maxAge)
                    .build();
            response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        }

        /**
         * CSRF guard for cookie-authenticated endpoints: a browser {@code Origin} must be an allowed
         * one. Requests without it are non-browser clients and carry no cookie of the player.
         */
        public void requireTrustedOrigin(HttpServletRequest request) {
            String origin = request.getHeader(HttpHeaders.ORIGIN);
            if (origin != null && !settings.getAllowedOrigins().contains(origin)) {
                Auth.LOG.warn("Refused auth call from untrusted origin {}", origin);
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Origin not allowed");
            }
        }
    }

    // --- tokens ---

    /**
     * The whole token cryptography: access tokens are signed and verified here, refresh token secrets
     * are minted here, and the digest stored in their place is computed here. The refresh secret
     * itself never leaves this class in a persistable form — only its SHA-256 digest does.
     */
    @Component
    public static class Tokens {

        private static final String ROLE_CLAIM = "role";
        private static final String SESSION_CLAIM = "sid";
        private static final String INVALID_ACCESS_TOKEN = "Invalid access token";
        private static final int REFRESH_TOKEN_BYTES = 32;

        private final Settings settings;
        private final Clock clock;
        private final byte[] secret;
        private final SecureRandom random = new SecureRandom();

        Tokens(Settings settings, Clock clock) {
            this.settings = settings;
            this.clock = clock;
            this.secret = settings.getJwtSecret().getBytes(StandardCharsets.UTF_8);
        }

        /** Claims of a verified access token. */
        public record AccessClaims(UUID playerId, Role role, UUID sessionId) {
        }

        public String signAccessToken(UUID playerId, Role role, UUID sessionId) {
            Instant issuedAt = clock.instant();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(playerId.toString())
                    .claim(ROLE_CLAIM, role.wire())
                    .claim(SESSION_CLAIM, sessionId.toString())
                    .issueTime(Date.from(issuedAt))
                    .expirationTime(Date.from(issuedAt.plus(settings.getAccessTokenTtl())))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            try {
                jwt.sign(new MACSigner(secret));
            } catch (JOSEException exception) {
                throw new IllegalStateException("Unable to sign an access token", exception);
            }
            return jwt.serialize();
        }

        /**
         * Verifies signature, algorithm and expiry. Every rejection carries the same message: which
         * check failed is a detail the caller must not be able to probe.
         */
        public AccessClaims verifyAccessToken(String token) {
            try {
                SignedJWT jwt = SignedJWT.parse(token);
                if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm())) {
                    throw new AuthenticationException(INVALID_ACCESS_TOKEN);
                }
                if (!jwt.verify(new MACVerifier(secret))) {
                    throw new AuthenticationException(INVALID_ACCESS_TOKEN);
                }
                JWTClaimsSet claims = jwt.getJWTClaimsSet();
                Date expiresAt = claims.getExpirationTime();
                if (expiresAt == null || !expiresAt.toInstant().isAfter(clock.instant())) {
                    throw new AuthenticationException(INVALID_ACCESS_TOKEN);
                }
                return new AccessClaims(UUID.fromString(claims.getSubject()),
                        Role.fromWire(claims.getStringClaim(ROLE_CLAIM)),
                        UUID.fromString(claims.getStringClaim(SESSION_CLAIM)));
            } catch (AuthenticationException exception) {
                throw exception;
            } catch (ParseException | JOSEException | IllegalArgumentException | NullPointerException exception) {
                throw new AuthenticationException(INVALID_ACCESS_TOKEN);
            }
        }

        public long accessTokenExpiresInSeconds() {
            return settings.getAccessTokenTtl().toSeconds();
        }

        /** 32 random bytes, base64url. Refresh tokens carry nothing: they are opaque by design. */
        public String generateRefreshToken() {
            byte[] bytes = new byte[REFRESH_TOKEN_BYTES];
            random.nextBytes(bytes);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        }

        /** The 64 character digest stored instead of the secret. */
        public String hashRefreshToken(String token) {
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                return HexFormat.of().formatHex(digest.digest(token.getBytes(StandardCharsets.UTF_8)));
            } catch (NoSuchAlgorithmException exception) {
                throw new IllegalStateException("SHA-256 is not available", exception);
            }
        }
    }

    // --- google ---

    /**
     * Verifies a Google ID token against Google's JWKS, its issuer, our client id as the expected
     * audience, and {@code email_verified}. This is the only place a Google credential reaches us,
     * and it is used once and never stored.
     */
    @Component
    public static class GoogleIdentityProvider {

        private static final Set<String> ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");
        private static final Set<String> REQUIRED_CLAIMS = Set.of("iss", "sub", "aud", "exp", "iat");
        private static final String INVALID_CREDENTIAL = "Invalid Google credential";
        private static final int MAX_USERNAME_LENGTH = 64;
        private static final int MAX_AVATAR_URL_LENGTH = 512;

        private final ConfigurableJWTProcessor<SecurityContext> processor;
        private final GoogleIdentity mockIdentity;

        GoogleIdentityProvider(Settings settings) {
            JWKSource<SecurityContext> jwkSource = JWKSourceBuilder.<SecurityContext>create(settings.getGoogleJwksUri())
                    .retrying(true)
                    .build();
            DefaultJWTProcessor<SecurityContext> jwtProcessor = new DefaultJWTProcessor<>();
            jwtProcessor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource));
            jwtProcessor.setJWTClaimsSetVerifier(
                    new DefaultJWTClaimsVerifier<>(settings.getGoogleClientId(), null, REQUIRED_CLAIMS));
            this.processor = jwtProcessor;
            this.mockIdentity = settings.isGoogleMockEnabled() ? mockIdentityOf(settings.getGoogleMockEmail()) : null;
            if (mockIdentity != null) {
                LOG.warn("Google sign-in is MOCKED: every sign-in resolves to {}", mockIdentity.email());
            }
        }

        /** The Google profile behind a verified ID token. {@code googleId} never leaves the server. */
        public record GoogleIdentity(String googleId, String email, String username, String avatarUrl) {
        }

        /** The fixed development identity every sign-in resolves to, only while Google is mocked. */
        public Optional<GoogleIdentity> mockIdentity() {
            return Optional.ofNullable(mockIdentity);
        }

        public GoogleIdentity verify(String idToken) {
            if (mockIdentity != null) {
                return mockIdentity;
            }
            try {
                JWTClaimsSet claims = processor.process(idToken, null);
                if (!ISSUERS.contains(String.valueOf(claims.getIssuer()))) {
                    throw new AuthenticationException(INVALID_CREDENTIAL);
                }
                if (!Boolean.TRUE.equals(claims.getBooleanClaim("email_verified"))) {
                    throw new AuthenticationException(INVALID_CREDENTIAL);
                }
                String googleId = claims.getSubject();
                String email = claims.getStringClaim("email");
                if (googleId == null || googleId.isBlank() || email == null || email.isBlank()) {
                    throw new AuthenticationException(INVALID_CREDENTIAL);
                }
                String normalizedEmail = email.strip().toLowerCase(Locale.ROOT);
                return new GoogleIdentity(googleId, normalizedEmail,
                        username(claims.getStringClaim("name"), normalizedEmail),
                        truncate(claims.getStringClaim("picture"), MAX_AVATAR_URL_LENGTH));
            } catch (AuthenticationException exception) {
                throw exception;
            } catch (ParseException | BadJOSEException | JOSEException exception) {
                LOG.debug("Google ID token rejected: {}", exception.getMessage());
                throw new AuthenticationException(INVALID_CREDENTIAL);
            }
        }

        private static GoogleIdentity mockIdentityOf(String email) {
            return new GoogleIdentity("mock-" + email, email, username(null, email), null);
        }

        private static String username(String name, String email) {
            String candidate = name != null && !name.isBlank() ? name.strip() : email.substring(0, email.indexOf('@'));
            return truncate(candidate, MAX_USERNAME_LENGTH);
        }
    }

    // --- http guard ---

    /**
     * Runs in front of every handler annotated with {@link Authenticated}, {@link RequireRole} or
     * {@link ServiceOnly}, and steps aside for every other one. Two indexed primary key lookups per call is what buys
     * revocation that takes effect immediately rather than eventually.
     */
    @RequiredArgsConstructor
    public static class AuthInterceptor implements HandlerInterceptor {

        private static final String MISSING_BEARER = "Missing bearer token";
        private static final String SESSION_NOT_ACTIVE = "Session is no longer active";
        private static final String SERVICE_TOKEN_HEADER = "X-Service-Token";
        private static final String SERVICE_TOKEN_REQUIRED = "Service token required";

        private final Tokens tokens;
        private final Settings settings;
        private final ObjectProvider<SessionGuard> sessionGuard;

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
            if (!(handler instanceof HandlerMethod handlerMethod)) {
                return true;
            }
            if (annotation(handlerMethod, ServiceOnly.class) != null) {
                requireServiceToken(request, "A service call");
                return true;
            }
            RequireRole requireRole = annotation(handlerMethod, RequireRole.class);
            if (requireRole == null && annotation(handlerMethod, Authenticated.class) == null) {
                return true;
            }

            Tokens.AccessClaims claims = tokens.verifyAccessToken(bearerToken(request));
            AuthenticatedPlayer player = guard().resolve(claims.sessionId(), claims.playerId())
                    .orElseThrow(() -> new AuthenticationException(SESSION_NOT_ACTIVE));
            if (requireRole != null && player.role() != requireRole.value()) {
                LOG.info("Player {} was refused {} (role {})", player.id(), request.getRequestURI(),
                        player.role().wire());
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Insufficient role");
            }
            if (annotation(handlerMethod, ServiceCall.class) != null) {
                requireServiceToken(request, "Player " + player.id());
            }

            request.setAttribute(PRINCIPAL_ATTRIBUTE, new Principal(player, claims.sessionId()));
            MDC.put(PLAYER_ID_KEY, player.id().toString());
            MDC.put(SESSION_ID_KEY, claims.sessionId().toString());
            return true;
        }

        /**
         * A blank configured token refuses every call rather than accepting one: an unset
         * {@code SERVICE_TOKEN} must fail the calls that need it, not silently open them.
         */
        private void requireServiceToken(HttpServletRequest request, String caller) {
            byte[] expected = settings.getServiceToken().getBytes(StandardCharsets.UTF_8);
            String header = request.getHeader(SERVICE_TOKEN_HEADER);
            byte[] provided = (header == null ? "" : header).getBytes(StandardCharsets.UTF_8);
            if (expected.length == 0 || !MessageDigest.isEqual(expected, provided)) {
                LOG.info("{} was refused {} (missing or invalid service token)", caller, request.getRequestURI());
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, SERVICE_TOKEN_REQUIRED);
            }
        }

        @Override
        public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                    Exception exception) {
            MDC.remove(PLAYER_ID_KEY);
            MDC.remove(SESSION_ID_KEY);
        }

        private SessionGuard guard() {
            SessionGuard guard = sessionGuard.getIfAvailable();
            if (guard == null) {
                throw new IllegalStateException("No Auth.SessionGuard implementation is registered");
            }
            return guard;
        }

        private static <A extends Annotation> A annotation(HandlerMethod handlerMethod, Class<A> type) {
            A onMethod = handlerMethod.getMethodAnnotation(type);
            return onMethod != null ? onMethod : handlerMethod.getBeanType().getAnnotation(type);
        }

        private static String bearerToken(HttpServletRequest request) {
            String header = request.getHeader(HttpHeaders.AUTHORIZATION);
            if (header == null || !header.startsWith(BEARER_PREFIX)) {
                throw new AuthenticationException(MISSING_BEARER);
            }
            String token = header.substring(BEARER_PREFIX.length()).strip();
            if (token.isEmpty()) {
                throw new AuthenticationException(MISSING_BEARER);
            }
            return token;
        }
    }

    /** Injects the {@link Principal} into a guarded handler. Never null: the interceptor ran first. */
    public static class PrincipalArgumentResolver implements HandlerMethodArgumentResolver {

        @Override
        public boolean supportsParameter(MethodParameter parameter) {
            return Principal.class.equals(parameter.getParameterType());
        }

        @Override
        public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer container,
                                      NativeWebRequest request, WebDataBinderFactory binderFactory) {
            return request.getAttribute(PRINCIPAL_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        }
    }

    // --- request metadata ---

    /** Recorded on the session so a player could recognise the device later. */
    public static String readUserAgent(HttpServletRequest request) {
        return truncate(request.getHeader(HttpHeaders.USER_AGENT), MAX_USER_AGENT_LENGTH);
    }

    /** The first hop of {@code X-Forwarded-For} when proxied, the socket address otherwise. */
    public static String readIpAddress(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        String candidate = forwarded != null && !forwarded.isBlank()
                ? forwarded.split(",")[0]
                : request.getRemoteAddr();
        return truncate(candidate, MAX_IP_ADDRESS_LENGTH);
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        String stripped = value.strip();
        if (stripped.isEmpty()) {
            return null;
        }
        return stripped.length() <= maxLength ? stripped : stripped.substring(0, maxLength);
    }
}

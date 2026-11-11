package dev.mooi.mic.shared;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import lombok.Getter;

/**
 * Transversal aspect: agent-provider OAuth2 and credential mechanics.
 *
 * <p>Only the protocol lives here: the provider registry and (from here on) PKCE state signing and
 * the OAuth client, mapping every failure to the status the SPA should act on. What is stored, for
 * whom, and how a credential is handed to another service belongs to
 * {@code AgentConnectionFeature}, which owns the table — this aspect never imports it and holds no
 * state of its own.
 *
 * <p>"Agent provider" means a coding-agent vendor a player brings their own subscription to. Claude is
 * linked exactly like the Claude Code application signs in: OAuth2 with PKCE against Claude Code's own
 * public client, the authorization code shown by Anthropic's callback page and pasted back into Mooi.
 * Every Claude mode yields a Claude OAuth access token, so a session runs it the same way whether it came
 * from that sign-in (short-lived, renewed here) or from {@code claude setup-token} (long-lived, kept for
 * existing links). Anthropic API keys are explicitly out of scope: the product is "bring your Claude
 * subscription", not "bring your API billing".
 *
 * <p>Gemini is linked exactly like the Gemini CLI signs in without a browser: Google OAuth2 with PKCE
 * against the Gemini CLI's own installed-app client, the code shown by Google's Code Assist page and
 * pasted back. Google speaks its own token dialect (form bodies, a public installed-app secret, the
 * account read from {@code userinfo}), so it has its own client, {@link GoogleOAuthClient}. A Gemini API
 * key is the other way in: Google's own CLI offers it as a first-class sign-in, unlike Anthropic's.
 *
 * <p>Self-contained by architecture, which is why the TTL grammar is parsed here rather than
 * borrowed from {@link Github}: transversal aspects do not depend on each other, so a small,
 * deliberate duplication is the correct trade.
 */
@Configuration
public class Agents {

    /** Log scope shared by this aspect and the feature that owns the connections. */
    public static final Logger LOG = LoggerFactory.getLogger("agents");

    private static final Pattern DURATION_PATTERN = Pattern.compile("^(\\d+)([smhd])$");

    // --- contracts ---

    /**
     * How a credential was obtained. For Claude, {@code oauth} and {@code setup_token} yield the same
     * kind of token — a Claude OAuth access token — so only renewal branches on it: an {@code oauth} token
     * expires and is refreshed by this platform, a {@code setup_token} one does not. {@code device_oauth}
     * is a Codex {@code auth.json}. {@code api_key} is a pasted provider API key (Gemini), which never
     * expires and is handed out as is.
     */
    public enum Mode {

        OAUTH("oauth"),
        SETUP_TOKEN("setup_token"),
        DEVICE_OAUTH("device_oauth"),
        API_KEY("api_key");

        private final String wire;

        Mode(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static Mode fromWire(String value) {
            return Arrays.stream(values())
                    .filter(mode -> mode.wire.equals(value))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Unknown agent connection mode: " + value));
        }
    }

    /** The OAuth2 token dialect a provider speaks; each one has its own client in this aspect. */
    public enum Dialect {
        /** JSON bodies, the {@code state} echoed on the exchange, the account in the token response. */
        CLAUDE,
        /** Form bodies, an installed-app client secret, the account read from {@code userinfo}. */
        GOOGLE
    }

    /**
     * One agent provider this application knows how to link.
     *
     * <p>{@code modes} are the ways the SPA may link it, the first sign-in mode first; a pasted credential
     * is recorded as the provider's {@link #pastedMode()}. {@code tokenRefreshSkew} overrides the global
     * renewal margin for a provider whose access tokens live shorter than it. {@code sharesRefreshToken}
     * hands the refresh token to the session runtime too, for a provider that never rotates it (Google):
     * its CLI may then renew a token in-process during a long turn without racing anyone.
     */
    public record Provider(String id, String label, Dialect dialect, List<Mode> modes, boolean oauthEnabled,
                           String clientId, String clientSecret, String authorizeUri, String tokenUri, String scopes,
                           String redirectUri, Duration tokenRefreshSkew, boolean sharesRefreshToken) {

        /** The mode a pasted credential is recorded with, if this provider accepts one. */
        public Optional<Mode> pastedMode() {
            return modes.stream().filter(mode -> mode == Mode.SETUP_TOKEN || mode == Mode.API_KEY).findFirst();
        }

        /** Whether the provider's sign-in is offered and usable: Google's dialect also needs its client secret. */
        public boolean signInAvailable() {
            return oauthEnabled && clientId != null && modes.contains(Mode.OAUTH)
                    && (dialect != Dialect.GOOGLE || clientSecret != null);
        }
    }

    // --- errors ---

    /**
     * Every way linking an agent provider can fail, mapped once to the status the SPA should act on
     * and to a message that says what to do about it. Mirrors {@link Github.GithubException} in
     * shape and in the same reasoning: the vendor's own wording never reaches the client.
     */
    public static class AgentsException extends ResponseStatusException {

        private AgentsException(HttpStatus status, String reason) {
            super(status, reason);
        }

        /** No provider registered under that id. */
        public static AgentsException unknownProvider() {
            return new AgentsException(HttpStatus.NOT_FOUND, "Unknown agent provider");
        }

        /** OAuth2 is not usable for this provider yet: turned off, or no client id configured. */
        public static AgentsException oauthNotConfigured() {
            return new AgentsException(HttpStatus.CONFLICT, "OAuth is not configured for this provider");
        }

        /** A forged, edited, expired or foreign {@code state}: the PKCE round trip did its job. */
        public static AgentsException invalidState() {
            return new AgentsException(HttpStatus.BAD_REQUEST, "Invalid or expired authorization state");
        }

        /** The provider refused the grant — a spent code, a revoked token, a mismatched redirect URI. */
        public static AgentsException rejected(String description) {
            LOG.warn("The agent provider refused the authorization: {}", description);
            return new AgentsException(HttpStatus.BAD_REQUEST, "The agent provider refused the authorization");
        }

        /**
         * The stored grant no longer opens anything — revoked upstream, or expired past renewal.
         *
         * <p>Deliberately not a 401: the SPA reads that status as its own session expiring and would
         * sign the player out of Mooi over an agent-provider problem. A 409 says what is true — the
         * link is there but no longer usable, and re-authorizing repairs it.
         */
        public static AgentsException reauthorize() {
            return new AgentsException(HttpStatus.CONFLICT,
                    "Your agent provider authorization is no longer valid, please connect again");
        }

        /** The agent provider is unreachable, slow or broken. Distinct from a refusal: retrying may work. */
        public static AgentsException unavailable(String detail) {
            LOG.warn("The agent provider is unavailable: {}", detail);
            return new AgentsException(HttpStatus.BAD_GATEWAY, "The agent provider is unavailable, please try again");
        }

        /** A pasted token that is blank or otherwise obviously not a credential. */
        public static AgentsException invalidToken() {
            return new AgentsException(HttpStatus.BAD_REQUEST, "Invalid token");
        }
    }

    // --- configuration ---

    /**
     * Every agent-provider variable, read and validated at boot: a malformed TTL fails the
     * application start instead of the first link attempt.
     *
     * <p>Claude's OAuth client is not configuration: Anthropic registers no third-party clients, so
     * Mooi signs in as Claude Code itself — its public client id, its scopes and its manual-code
     * callback, the one redirect that works from any origin (Anthropic shows the code, the player
     * pastes it). Only whether that sign-in is offered stays an operator switch.
     *
     * <p>Gemini signs in the same way as the Gemini CLI itself: its installed-app client, its scopes and
     * the Code Assist manual-code page. The client id and secret are operator configuration, never source:
     * secret scanners rightly refuse any Google client secret in a repository, so the sign-in is offered
     * only once both are set; a Gemini API key works either way. Google access tokens live one hour, so
     * Gemini renews on its own, shorter margin.
     */
    @Component
    public static class Settings {

        private static final String CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
        /** {@code code=true} makes the callback page display the code to paste instead of redirecting. */
        private static final String CLAUDE_AUTHORIZE_URI = "https://claude.com/cai/oauth/authorize?code=true";
        private static final String CLAUDE_TOKEN_URI = "https://platform.claude.com/v1/oauth/token";
        private static final String CLAUDE_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
        /** The scopes of a Claude Code subscription sign-in, so sessions get every capability it has. */
        private static final String CLAUDE_SCOPES = "org:create_api_key user:profile user:inference "
                + "user:sessions:claude_code user:mcp_servers user:file_upload user:plugins";
        /** Offline access returns a refresh token; consent makes Google issue one again on a relink. */
        private static final String GEMINI_AUTHORIZE_URI =
                "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent";
        private static final String GEMINI_TOKEN_URI = "https://oauth2.googleapis.com/token";
        /** Google's Code Assist page shows the code to paste instead of redirecting. */
        private static final String GEMINI_REDIRECT_URI = "https://codeassist.google.com/authcode";
        private static final String GEMINI_SCOPES = "https://www.googleapis.com/auth/cloud-platform "
                + "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

        @Getter
        private final Duration stateExpiresIn;
        @Getter
        private final Duration tokenRefreshSkew;
        @Getter
        private final Duration requestTimeout;
        private final Map<String, Provider> providers;

        Settings(@Value("${app.agents.state-expires-in}") String stateExpiresIn,
                 @Value("${app.agents.token-refresh-skew}") String tokenRefreshSkew,
                 @Value("${app.agents.request-timeout-ms}") long requestTimeoutMs,
                 @Value("${app.agents.claude.enabled}") boolean claudeOauthEnabled,
                 @Value("${app.agents.gemini.enabled}") boolean geminiOauthEnabled,
                 @Value("${app.agents.gemini.client-id:}") String geminiClientId,
                 @Value("${app.agents.gemini.client-secret:}") String geminiClientSecret,
                 @Value("${app.agents.gemini.token-refresh-skew}") String geminiTokenRefreshSkew) {
            this.stateExpiresIn = parseDuration(stateExpiresIn, "AGENT_STATE_EXPIRES_IN");
            this.tokenRefreshSkew = parseDuration(tokenRefreshSkew, "AGENT_TOKEN_REFRESH_SKEW");
            if (requestTimeoutMs <= 0) {
                throw new IllegalStateException("AGENT_REQUEST_TIMEOUT_MS must be greater than zero");
            }
            this.requestTimeout = Duration.ofMillis(requestTimeoutMs);

            Provider claude = new Provider("claude", "Claude", Dialect.CLAUDE, List.of(Mode.OAUTH, Mode.SETUP_TOKEN),
                    claudeOauthEnabled, CLAUDE_CLIENT_ID, null, CLAUDE_AUTHORIZE_URI, CLAUDE_TOKEN_URI, CLAUDE_SCOPES,
                    CLAUDE_REDIRECT_URI, null, false);
            Provider codex = new Provider("codex", "Codex", null, List.of(Mode.DEVICE_OAUTH), false, null, null, null,
                    null, null, null, null, false);
            Provider gemini = new Provider("gemini", "Gemini", Dialect.GOOGLE, List.of(Mode.OAUTH, Mode.API_KEY),
                    geminiOauthEnabled, blankToNull(geminiClientId), blankToNull(geminiClientSecret),
                    GEMINI_AUTHORIZE_URI, GEMINI_TOKEN_URI,
                    GEMINI_SCOPES, GEMINI_REDIRECT_URI,
                    parseDuration(geminiTokenRefreshSkew, "AGENT_GEMINI_TOKEN_REFRESH_SKEW"), true);
            this.providers = Map.of(claude.id(), claude, codex.id(), codex, gemini.id(), gemini);
        }

        public Optional<Provider> find(String id) {
            return Optional.ofNullable(providers.get(id));
        }

        /** In a stable order, so the SPA lists providers the same way on every load. */
        public List<Provider> all() {
            return providers.values().stream().sorted(java.util.Comparator.comparing(Provider::id)).toList();
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    /** Parses the {@code <n><s|m|h|d>} TTL format. Malformed values throw, at boot. */
    private static Duration parseDuration(String value, String name) {
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

    // --- state ---

    /**
     * The {@code state} parameter of the PKCE round trip, as a signed short-lived token rather than
     * a random string kept in a table.
     *
     * <p>It carries the player and the provider it was minted for, and the PKCE code verifier
     * itself, so nothing needs to be stored between the redirect and the code exchange: the
     * callback hands back a state it never had to look up. Derived from {@code JWT_SECRET} rather
     * than a per-provider secret, since PKCE has no client secret to derive from — the code
     * challenge is what defeats an intercepted authorization code, this signature only proves the
     * state was minted by us, for this player, for this provider.
     */
    @Component
    public static class StateCodec {

        /** Fixed label so the signing key is bound to this purpose and to nothing else. */
        private static final String KEY_LABEL = "mooi:agents:oauth-state";
        private static final String HMAC_ALGORITHM = "HmacSHA256";
        private static final String PROVIDER_CLAIM = "pid";
        private static final String VERIFIER_CLAIM = "cv";
        private static final int VERIFIER_BYTES = 32;

        private final Settings settings;
        private final Clock clock;
        private final byte[] key;
        private final SecureRandom random = new SecureRandom();

        StateCodec(Settings settings, Clock clock, @Value("${app.auth.jwt-secret:}") String jwtSecret) {
            this.settings = settings;
            this.clock = clock;
            this.key = deriveKey(jwtSecret);
        }

        /** What the authorize URL needs: the signed state, and the challenge derived from the verifier. */
        public record Issued(String state, String codeVerifier, String codeChallenge) {
        }

        public Issued issue(UUID playerId, String provider) {
            String codeVerifier = randomUrlSafe(VERIFIER_BYTES);
            Instant issuedAt = clock.instant();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(playerId.toString())
                    .claim(PROVIDER_CLAIM, provider)
                    .claim(VERIFIER_CLAIM, codeVerifier)
                    .jwtID(UUID.randomUUID().toString())
                    .issueTime(Date.from(issuedAt))
                    .expirationTime(Date.from(issuedAt.plus(settings.getStateExpiresIn())))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            try {
                jwt.sign(new MACSigner(key));
            } catch (JOSEException exception) {
                throw new IllegalStateException("Unable to sign an agent authorization state", exception);
            }
            return new Issued(jwt.serialize(), codeVerifier, challenge(codeVerifier));
        }

        /** What the state was minted for. Every rejection is the same failure. */
        public record StateClaims(UUID playerId, String provider, String codeVerifier) {
        }

        public StateClaims verify(String state) {
            try {
                SignedJWT jwt = SignedJWT.parse(state);
                if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm()) || !jwt.verify(new MACVerifier(key))) {
                    throw AgentsException.invalidState();
                }
                JWTClaimsSet claims = jwt.getJWTClaimsSet();
                Date expiresAt = claims.getExpirationTime();
                if (expiresAt == null || !expiresAt.toInstant().isAfter(clock.instant())) {
                    throw AgentsException.invalidState();
                }
                String provider = claims.getStringClaim(PROVIDER_CLAIM);
                String codeVerifier = claims.getStringClaim(VERIFIER_CLAIM);
                if (provider == null || codeVerifier == null) {
                    throw AgentsException.invalidState();
                }
                return new StateClaims(UUID.fromString(claims.getSubject()), provider, codeVerifier);
            } catch (AgentsException exception) {
                throw exception;
            } catch (ParseException | JOSEException | IllegalArgumentException | NullPointerException exception) {
                throw AgentsException.invalidState();
            }
        }

        private String randomUrlSafe(int bytes) {
            byte[] buffer = new byte[bytes];
            random.nextBytes(buffer);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(buffer);
        }

        private static String challenge(String codeVerifier) {
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                return Base64.getUrlEncoder().withoutPadding()
                        .encodeToString(digest.digest(codeVerifier.getBytes(StandardCharsets.UTF_8)));
            } catch (NoSuchAlgorithmException exception) {
                throw new IllegalStateException("SHA-256 is not available", exception);
            }
        }

        /**
         * The JWT secret signs nothing directly: a separate key is derived from it, so the value
         * used here could never be mistaken for, or replayed as, the credential itself.
         */
        private static byte[] deriveKey(String jwtSecret) {
            try {
                Mac mac = Mac.getInstance(HMAC_ALGORITHM);
                mac.init(new SecretKeySpec(jwtSecret.getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM));
                return mac.doFinal(KEY_LABEL.getBytes(StandardCharsets.UTF_8));
            } catch (NoSuchAlgorithmException | InvalidKeyException exception) {
                throw new IllegalStateException("Unable to derive the agent state signing key", exception);
            }
        }
    }

    // --- oauth2 ---

    /**
     * A provider grant. {@code accountLabel} is the account e-mail when the provider tells it ({@code
     * account.email_address} in a Claude token response, Google's {@code userinfo}), else {@code null}:
     * shown to the player so they can tell two linked accounts of the same provider apart, never relied
     * on for anything else.
     */
    public record Tokens(String accessToken, OffsetDateTime accessTokenExpiresAt, String refreshToken,
                         String scope, String accountLabel) {
    }

    private static final String ACCEPT_HEADER = "Accept";
    private static final String JSON = "application/json";
    private static final String FORM = "application/x-www-form-urlencoded";
    private static final int MAX_SCOPE_LENGTH = 512;
    private static final int MAX_ACCOUNT_LABEL_LENGTH = 255;
    private static final int MAX_ERROR_LENGTH = 256;

    /** The authorize URL of a PKCE sign-in, identical across dialects. */
    public static String authorizeUrl(Provider provider, String state, String codeChallenge) {
        return provider.authorizeUri()
                + (provider.authorizeUri().contains("?") ? "&" : "?") + "response_type=code"
                + "&client_id=" + encode(provider.clientId())
                + "&redirect_uri=" + encode(provider.redirectUri())
                + "&scope=" + encode(provider.scopes() == null ? "" : provider.scopes())
                + "&state=" + encode(state)
                + "&code_challenge=" + encode(codeChallenge)
                + "&code_challenge_method=S256";
    }

    /**
     * The only place this application talks to a Claude-dialect OAuth2 token endpoint.
     *
     * <p>PKCE only, no client secret: the code challenge is what protects the exchange. It speaks the
     * grant exactly as Claude Code does — JSON bodies, the {@code state} echoed on the code exchange and
     * the scopes repeated on renewal; a provider that speaks another dialect has its own client
     * ({@link GoogleOAuthClient}), not a branch in this one.
     */
    @Component
    public static class OAuthClient {

        private final TokenEndpoint endpoint;
        private final ObjectMapper objectMapper = JsonMapper.shared();

        OAuthClient(Settings settings, Clock clock) {
            this.endpoint = new TokenEndpoint(settings, clock);
        }

        public Tokens exchangeCode(Provider provider, String code, String state, String codeVerifier) {
            return readTokens(post(provider.tokenUri(), Map.of(
                    "grant_type", "authorization_code",
                    "client_id", provider.clientId(),
                    "code", code,
                    "state", state,
                    "redirect_uri", provider.redirectUri(),
                    "code_verifier", codeVerifier)));
        }

        /** Some providers rotate the refresh token on renewal, some do not; a missing one keeps the old. */
        public Tokens refresh(Provider provider, String refreshToken) {
            return readTokens(post(provider.tokenUri(), Map.of(
                    "grant_type", "refresh_token",
                    "client_id", provider.clientId(),
                    "refresh_token", refreshToken,
                    "scope", provider.scopes() == null ? "" : provider.scopes())));
        }

        private String post(String tokenUri, Map<String, String> fields) {
            return endpoint.send(HttpRequest.newBuilder(URI.create(tokenUri))
                    .header(HttpHeaders.CONTENT_TYPE, JSON)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(fields))));
        }

        private Tokens readTokens(String body) {
            JsonNode node = endpoint.readGrant(body);
            JsonNode account = node.get("account");
            String accountLabel = account != null && account.isObject()
                    ? text(account, "email_address", MAX_ACCOUNT_LABEL_LENGTH)
                    : text(node, "account", MAX_ACCOUNT_LABEL_LENGTH);
            if (accountLabel == null) {
                accountLabel = text(node, "email", MAX_ACCOUNT_LABEL_LENGTH);
            }
            return endpoint.tokens(node, accountLabel);
        }
    }

    /**
     * The only place this application talks to Google's OAuth2 token endpoint, for the Gemini CLI sign-in.
     *
     * <p>PKCE plus the installed-app client secret Google requires. Form bodies, no {@code state} on the exchange, and no scope on renewal: Google keeps
     * the granted scopes with the refresh token, which it never rotates. The account e-mail is not in the
     * token response, so it is read once from {@code userinfo} with the fresh access token.
     */
    @Component
    public static class GoogleOAuthClient {

        private static final String USERINFO_URI = "https://www.googleapis.com/oauth2/v2/userinfo";

        private final TokenEndpoint endpoint;

        GoogleOAuthClient(Settings settings, Clock clock) {
            this.endpoint = new TokenEndpoint(settings, clock);
        }

        public Tokens exchangeCode(Provider provider, String code, String codeVerifier) {
            Tokens tokens = endpoint.tokens(endpoint.readGrant(post(provider.tokenUri(), Map.of(
                    "grant_type", "authorization_code",
                    "client_id", provider.clientId(),
                    "client_secret", provider.clientSecret(),
                    "code", code,
                    "redirect_uri", provider.redirectUri(),
                    "code_verifier", codeVerifier))), null);
            return new Tokens(tokens.accessToken(), tokens.accessTokenExpiresAt(), tokens.refreshToken(),
                    tokens.scope(), accountEmail(tokens.accessToken()));
        }

        public Tokens refresh(Provider provider, String refreshToken) {
            return endpoint.tokens(endpoint.readGrant(post(provider.tokenUri(), Map.of(
                    "grant_type", "refresh_token",
                    "client_id", provider.clientId(),
                    "client_secret", provider.clientSecret(),
                    "refresh_token", refreshToken))), null);
        }

        private String post(String tokenUri, Map<String, String> fields) {
            String body = fields.entrySet().stream()
                    .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                    .collect(java.util.stream.Collectors.joining("&"));
            return endpoint.send(HttpRequest.newBuilder(URI.create(tokenUri))
                    .header(HttpHeaders.CONTENT_TYPE, FORM)
                    .POST(HttpRequest.BodyPublishers.ofString(body)));
        }

        /** Best effort: a missing label only makes two accounts harder to tell apart, never fails a link. */
        private String accountEmail(String accessToken) {
            try {
                String body = endpoint.send(HttpRequest.newBuilder(URI.create(USERINFO_URI))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                        .GET());
                return text(endpoint.readJson(body), "email", MAX_ACCOUNT_LABEL_LENGTH);
            } catch (AgentsException exception) {
                LOG.debug("The Google account e-mail is unavailable: {}", exception.getReason());
                return null;
            }
        }
    }

    /**
     * One HTTP round trip to a token endpoint and the grant it answers, shared by every dialect's client.
     *
     * <p>A 4xx other than 429 is the provider refusing the grant (a spent code, a revoked refresh token),
     * so it is read as a refusal, not as an outage: retrying would not help, re-authorizing does.
     */
    private static final class TokenEndpoint {

        private final Clock clock;
        private final Duration requestTimeout;
        private final HttpClient httpClient;
        private final ObjectMapper objectMapper = JsonMapper.shared();

        TokenEndpoint(Settings settings, Clock clock) {
            this.clock = clock;
            this.requestTimeout = settings.getRequestTimeout();
            this.httpClient = HttpClient.newBuilder().connectTimeout(requestTimeout).build();
        }

        String send(HttpRequest.Builder builder) {
            HttpRequest request = builder.timeout(requestTimeout).header(ACCEPT_HEADER, JSON).build();
            try {
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() / 100 == 4 && response.statusCode() != 429) {
                    throw AgentsException.rejected("the token endpoint answered " + response.statusCode());
                }
                if (response.statusCode() / 100 != 2) {
                    throw AgentsException.unavailable("the token endpoint answered " + response.statusCode());
                }
                return response.body();
            } catch (IOException exception) {
                throw AgentsException.unavailable("the token endpoint failed: " + exception.getMessage());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw AgentsException.unavailable("the token endpoint was interrupted");
            }
        }

        /** The {@code error} field is read first: some providers refuse a grant with a 200 status. */
        JsonNode readGrant(String body) {
            JsonNode node = readJson(body);
            String error = text(node, "error", MAX_ERROR_LENGTH);
            if (error != null) {
                String description = text(node, "error_description", MAX_ERROR_LENGTH);
                throw AgentsException.rejected(description != null ? description : error);
            }
            if (text(node, "access_token") == null) {
                throw AgentsException.unavailable("the token endpoint returned no access token");
            }
            return node;
        }

        Tokens tokens(JsonNode node, String accountLabel) {
            return new Tokens(text(node, "access_token"), expiresAt(node, "expires_in"), text(node, "refresh_token"),
                    text(node, "scope", MAX_SCOPE_LENGTH), accountLabel);
        }

        JsonNode readJson(String body) {
            try {
                return objectMapper.readTree(body);
            } catch (JacksonException exception) {
                throw AgentsException.unavailable("the token endpoint returned a malformed response");
            }
        }

        /** Relative seconds become an absolute instant once, here. Absent or zero means no expiry. */
        private OffsetDateTime expiresAt(JsonNode node, String field) {
            JsonNode value = node.get(field);
            if (value == null || !value.isNumber() || value.asLong() <= 0) {
                return null;
            }
            return OffsetDateTime.ofInstant(clock.instant().plusSeconds(value.asLong()), ZoneOffset.UTC);
        }
    }

    /** Untruncated: token material must survive intact. */
    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isString()) {
            return null;
        }
        String stripped = value.asText().strip();
        return stripped.isEmpty() ? null : stripped;
    }

    /** Truncated to what the column holds, so a long field can never fail an insert. */
    private static String text(JsonNode node, String field, int maxLength) {
        String value = text(node, field);
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}

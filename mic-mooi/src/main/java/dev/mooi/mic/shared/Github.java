package dev.mooi.mic.shared;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

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
 * Transversal aspect: GitHub OAuth2 and REST mechanics.
 *
 * <p>Only the protocol lives here: building the authorization URL, signing and verifying the
 * {@code state} that protects it, trading a code for tokens, renewing them, and reading what a
 * token can see — the profile behind it, the repositories it reaches and the files inside them. What is stored, for whom, and when it is
 * renewed belongs to the feature that owns the connection table — this aspect never imports it and
 * holds no state of its own.
 *
 * <p>Self-contained by architecture, which is why the TTL grammar is parsed here rather than
 * borrowed from {@link Auth}: transversal aspects do not depend on each other, so a small,
 * deliberate duplication is the correct trade.
 */
@Configuration
public class Github {

    /** Log scope shared by this aspect and the feature that owns the connections. */
    public static final Logger LOG = LoggerFactory.getLogger("github");

    private static final Pattern DURATION_PATTERN = Pattern.compile("^(\\d+)([smhd])$");

    // --- errors ---

    /**
     * Every way this integration can fail, mapped once to the status the SPA should act on and to a
     * message that says what to do about it. Rendered by the shared error contract.
     *
     * <p>GitHub's own wording never reaches the client: it is written for an app developer, not for
     * the person clicking the button, and repeating it verbatim would describe our request to
     * whoever provoked the failure.
     */
    public static class GithubException extends ResponseStatusException {

        private GithubException(HttpStatus status, String reason) {
            super(status, reason);
        }

        /** A forged, edited, expired or foreign {@code state}: the CSRF check did its job. */
        public static GithubException invalidState() {
            return new GithubException(HttpStatus.BAD_REQUEST, "Invalid or expired GitHub authorization state");
        }

        /** GitHub refused the grant — a spent code, a revoked token, a mismatched redirect URI. */
        public static GithubException rejected(String description) {
            LOG.warn("GitHub refused the authorization: {}", description);
            return new GithubException(HttpStatus.BAD_REQUEST, "GitHub refused the authorization");
        }

        /** The GitHub account is already linked to a different player. */
        public static GithubException alreadyLinked() {
            return new GithubException(HttpStatus.CONFLICT,
                    "This GitHub account is already linked to another player");
        }

        /**
         * The stored grant no longer opens anything — revoked on GitHub, expired past renewal, or
         * narrowed until it cannot see what is asked of it.
         *
         * Deliberately not a 401: the SPA reads that status as its own session expiring and would
         * sign the player out of Mooi over a GitHub problem. A 409 says what is true — the link is
         * there but no longer usable, and re-authorizing repairs it.
         */
        public static GithubException reauthorize() {
            return new GithubException(HttpStatus.CONFLICT,
                    "Your GitHub authorization is no longer valid, please connect again");
        }

        /** The repository is already in the caller's workspace: a reference has no second copy. */
        public static GithubException alreadyAdded() {
            return new GithubException(HttpStatus.CONFLICT,
                    "This repository is already in your workspace");
        }

        /** Asked for a repository the player's own token cannot see. Indistinguishable, by design, from one that does not exist. */
        public static GithubException repositoryNotFound() {
            return new GithubException(HttpStatus.NOT_FOUND,
                    "Repository not found or not visible to your GitHub account");
        }

        public static GithubException repositoryWriteDenied() {
            return new GithubException(HttpStatus.FORBIDDEN,
                    "GitHub denied this action. Grant Mooi Administration write access and try again");
        }

        public static GithubException repositoryConflict() {
            return new GithubException(HttpStatus.CONFLICT,
                    "GitHub could not create this repository. Check its name and try again");
        }

        /** The file moved on since the caller read it: committing now would silently drop someone's change. */
        public static GithubException fileChanged() {
            return new GithubException(HttpStatus.CONFLICT,
                    "This file changed on GitHub since it was loaded. Reload it and try again");
        }

        /** The grant reads the repository but may not commit to its default branch (permissions or branch protection). */
        public static GithubException contentsWriteDenied() {
            return new GithubException(HttpStatus.FORBIDDEN,
                    "GitHub denied the commit. Check that Mooi may write to this repository and its default branch");
        }

        /**
         * GitHub does not recognise this instance's app credentials, so no authorization could ever
         * complete. Said before the player is sent away, rather than after GitHub shows them a 404.
         */
        public static GithubException notConfigured() {
            LOG.warn("GitHub rejected the configured client credentials: set a real GitHub App client id and "
                    + "secret, or link the account another way (MOOI_DEVELOPMENT_GITHUB_TOKEN on local stacks)");
            return new GithubException(HttpStatus.SERVICE_UNAVAILABLE,
                    "GitHub linking is not set up on this Mooi instance yet");
        }

        /** GitHub is unreachable, slow or broken. Distinct from a refusal: retrying may work. */
        public static GithubException unavailable(String detail) {
            LOG.warn("GitHub is unavailable: {}", detail);
            return new GithubException(HttpStatus.BAD_GATEWAY, "GitHub is unavailable, please try again");
        }
    }

    // --- configuration ---

    /**
     * Every GitHub variable, read and validated at boot: a missing secret or a malformed endpoint
     * fails the application start instead of the first click on the connect button.
     */
    @Getter
    @Component
    public static class Settings {

        private final String clientId;
        private final String clientSecret;
        private final String appSlug;
        private final String redirectUri;
        private final String authorizeUri;
        private final String tokenUri;
        private final String apiBaseUrl;
        private final Duration stateExpiresIn;
        private final Duration tokenRefreshSkew;
        private final Duration requestTimeout;

        Settings(@Value("${app.github.client-id:}") String clientId,
                 @Value("${app.github.client-secret:}") String clientSecret,
                 @Value("${app.github.app-slug:}") String appSlug,
                 @Value("${app.github.redirect-uri:}") String redirectUri,
                 @Value("${app.github.authorize-uri}") String authorizeUri,
                 @Value("${app.github.token-uri}") String tokenUri,
                 @Value("${app.github.api-base-url}") String apiBaseUrl,
                 @Value("${app.github.state-expires-in}") String stateExpiresIn,
                 @Value("${app.github.token-refresh-skew}") String tokenRefreshSkew,
                 @Value("${app.github.request-timeout-ms}") long requestTimeoutMs) {
            this.clientId = require(clientId, "GITHUB_CLIENT_ID");
            this.clientSecret = require(clientSecret, "GITHUB_CLIENT_SECRET");
            this.appSlug = appSlug == null ? "" : appSlug.strip();
            if (this.appSlug.isEmpty()) {
                LOG.warn("GITHUB_APP_SLUG is not set: players cannot install the GitHub App, so only its owner "
                        + "can grant Mooi access to repositories");
            }
            this.redirectUri = validUrl(require(redirectUri, "GITHUB_REDIRECT_URI"), "GITHUB_REDIRECT_URI");
            this.authorizeUri = validUrl(authorizeUri, "GITHUB_AUTHORIZE_URI");
            this.tokenUri = validUrl(tokenUri, "GITHUB_TOKEN_URI");
            this.apiBaseUrl = trimTrailingSlash(validUrl(apiBaseUrl, "GITHUB_API_BASE_URL"));
            this.stateExpiresIn = parseDuration(stateExpiresIn, "GITHUB_STATE_EXPIRES_IN");
            this.tokenRefreshSkew = parseDuration(tokenRefreshSkew, "GITHUB_TOKEN_REFRESH_SKEW");
            if (requestTimeoutMs <= 0) {
                throw new IllegalStateException("GITHUB_REQUEST_TIMEOUT_MS must be greater than zero");
            }
            this.requestTimeout = Duration.ofMillis(requestTimeoutMs);
        }

        private static String require(String value, String name) {
            if (value == null || value.isBlank()) {
                throw new IllegalStateException(name + " must be set");
            }
            return value.strip();
        }

        private static String validUrl(String value, String name) {
            String stripped = value == null ? "" : value.strip();
            try {
                URI.create(stripped).toURL();
            } catch (MalformedURLException | IllegalArgumentException exception) {
                throw new IllegalStateException(name + " is not a valid URL: " + value, exception);
            }
            return stripped;
        }

        private static String trimTrailingSlash(String value) {
            return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
        }
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
     * The {@code state} parameter, as a signed short-lived token rather than a random string kept in
     * a table.
     *
     * <p>It carries the player it was minted for, so the callback can refuse a {@code state} issued
     * for somebody else — the check that actually stops the cross-site attack this parameter exists
     * for, since GitHub offers no PKCE and the code is redeemed server-side with the client secret.
     * Signing it keeps the whole round trip stateless: nothing to store, nothing to clean up, and no
     * window where a pending authorization outlives its ten minutes.
     */
    @Component
    public static class StateCodec {

        /** Fixed label so the signing key is bound to this purpose and to nothing else. */
        private static final String KEY_LABEL = "mooi:github:oauth-state";
        private static final String HMAC_ALGORITHM = "HmacSHA256";

        private final Settings settings;
        private final Clock clock;
        private final byte[] key;

        StateCodec(Settings settings, Clock clock) {
            this.settings = settings;
            this.clock = clock;
            this.key = deriveKey(settings.getClientSecret());
        }

        public String issue(UUID playerId) {
            Instant issuedAt = clock.instant();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(playerId.toString())
                    .jwtID(UUID.randomUUID().toString())
                    .issueTime(Date.from(issuedAt))
                    .expirationTime(Date.from(issuedAt.plus(settings.getStateExpiresIn())))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            try {
                jwt.sign(new MACSigner(key));
            } catch (JOSEException exception) {
                throw new IllegalStateException("Unable to sign a GitHub authorization state", exception);
            }
            return jwt.serialize();
        }

        /** Returns the player the state was minted for. Every rejection is the same failure. */
        public UUID verify(String state) {
            try {
                SignedJWT jwt = SignedJWT.parse(state);
                if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm()) || !jwt.verify(new MACVerifier(key))) {
                    throw GithubException.invalidState();
                }
                JWTClaimsSet claims = jwt.getJWTClaimsSet();
                Date expiresAt = claims.getExpirationTime();
                if (expiresAt == null || !expiresAt.toInstant().isAfter(clock.instant())) {
                    throw GithubException.invalidState();
                }
                return UUID.fromString(claims.getSubject());
            } catch (GithubException exception) {
                throw exception;
            } catch (ParseException | JOSEException | IllegalArgumentException | NullPointerException exception) {
                throw GithubException.invalidState();
            }
        }

        /**
         * The client secret signs nothing directly: a separate key is derived from it, so the value
         * used here could never be mistaken for, or replayed as, the credential itself.
         */
        private static byte[] deriveKey(String clientSecret) {
            try {
                Mac mac = Mac.getInstance(HMAC_ALGORITHM);
                mac.init(new SecretKeySpec(clientSecret.getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM));
                return mac.doFinal(KEY_LABEL.getBytes(StandardCharsets.UTF_8));
            } catch (NoSuchAlgorithmException | InvalidKeyException exception) {
                throw new IllegalStateException("Unable to derive the GitHub state signing key", exception);
            }
        }
    }

    // --- oauth2 and rest ---

    /**
     * A GitHub grant. Both expiries are nullable: a GitHub App with token expiration turned off
     * hands out a non-expiring access token and no refresh token at all, and this integration keeps
     * working in that shape rather than pretending the fields are always there.
     */
    public record Tokens(String accessToken, OffsetDateTime accessTokenExpiresAt, String refreshToken,
                         OffsetDateTime refreshTokenExpiresAt, String scope) {
    }

    /** The GitHub profile behind a token — exactly the fields the connection stores, and no more. */
    public record Viewer(long id, String login, String name, String avatarUrl, String profileUrl) {
    }

    /**
     * A repository as the application ever needs to know it: a name, a description, a branch and a
     * link. No tree, no archive, no clone — what Mooi keeps of a repository is a reference to it,
     * and the code stays where it already lives.
     */
    public record Repository(long id, String owner, String name, String fullName, String description,
                             boolean isPrivate, String defaultBranch, String htmlUrl, String language,
                             int stars, OffsetDateTime pushedAt) {
    }

    /**
     * What a grant can reach, and how far into GitHub it was actually let in.
     *
     * <p>The installation count travels with the list because it is the only thing that explains a
     * short one: zero installations means the player authorized Mooi but never granted it a
     * repository, which from their side looks exactly like their private repositories going missing.
     */
    public record RepositoryAccess(List<Repository> repositories, int installations) {
    }

    /**
     * One entry of a repository directory, as the contents API lists it. The {@code sha} is the
     * blob's git hash: content-addressed, so a caller may cache a file's text under it forever.
     */
    public record ContentEntry(String name, String path, String type, String sha, long size) {

        public boolean isFile() {
            return "file".equals(type);
        }
    }

    /**
     * One file's text on the default branch together with its blob {@code sha}: the revision a later
     * {@link OAuthClient#writeFile} must name, so a commit can never overwrite a change it did not see.
     */
    public record FileContent(String sha, String text) {
    }

    /**
     * The only place this application talks to GitHub.
     *
     * <p>Two habits of GitHub's OAuth endpoint drive the shape of this class. It answers failures
     * with HTTP 200 and an {@code error} field, so the status code alone is never enough to know a
     * grant succeeded. And it reports lifetimes as relative seconds, which are turned into absolute
     * instants here, once, against the injected clock — every caller downstream then compares real
     * timestamps instead of re-deriving them.
     */
    @Component
    public static class OAuthClient {

        private static final String ACCEPT_HEADER = "Accept";
        private static final String JSON = "application/json";
        private static final String GITHUB_JSON = "application/vnd.github+json";
        private static final String GITHUB_RAW = "application/vnd.github.raw+json";
        private static final String FORM = "application/x-www-form-urlencoded";
        private static final String API_VERSION_HEADER = "X-GitHub-Api-Version";
        private static final String API_VERSION = "2022-11-28";
        private static final String TOKEN_ENDPOINT = "the GitHub token endpoint";
        private static final String CREDENTIALS_PROBE_CODE = "mooi-credentials-probe";
        private static final String INCORRECT_CLIENT_CREDENTIALS = "incorrect_client_credentials";
        private static final int MAX_LOGIN_LENGTH = 128;
        private static final int MAX_NAME_LENGTH = 255;
        private static final int MAX_URL_LENGTH = 512;
        private static final int MAX_SCOPE_LENGTH = 512;
        private static final int MAX_ERROR_LENGTH = 256;
        private static final int MAX_FULL_NAME_LENGTH = 255;
        private static final int MAX_DESCRIPTION_LENGTH = 1024;
        private static final int MAX_LANGUAGE_LENGTH = 64;
        private static final int PAGE_SIZE = 100;
        private static final int MAX_PAGES = 3;

        private final Settings settings;
        private final Clock clock;
        private final HttpClient httpClient;
        private final ObjectMapper objectMapper = JsonMapper.shared();
        private volatile boolean credentialsAccepted;

        OAuthClient(Settings settings, Clock clock) {
            this.settings = settings;
            this.clock = clock;
            this.httpClient = HttpClient.newBuilder().connectTimeout(settings.getRequestTimeout()).build();
        }

        /**
         * No {@code scope} parameter: a GitHub App carries its permissions in its own configuration,
         * and asking for scopes here would be silently ignored while suggesting otherwise.
         *
         * <p>{@code prompt=select_account} is what makes a second account reachable. Without it
         * GitHub reuses the session the browser already holds and the authorization it already
         * granted, so relinking returns instantly with the same account and the player is never
         * asked which one they meant. This is the authorization page rather than the installation
         * page for that same reason: only this one can offer an account chooser.
         */
        public String authorizeUrl(String state) {
            return settings.getAuthorizeUri()
                    + "?client_id=" + encode(settings.getClientId())
                    + "&redirect_uri=" + encode(settings.getRedirectUri())
                    + "&state=" + encode(state)
                    + "&prompt=select_account";
        }

        /**
         * Where a player goes to decide which repositories Mooi may read.
         *
         * <p>This is the only flow that can reach a private repository: an authorization alone
         * grants an identity, while the installation is what decides which repositories the grant
         * may read. It redirects back to the same callback with the same {@code code} and
         * {@code state}, so nothing downstream changes.
         *
         * <p>Without a configured slug there is no install page to send anyone to, so the player
         * lands on their own installations screen instead — still the right place to widen access,
         * only one step longer.
         */
        public String installUrl(String state) {
            if (settings.getAppSlug().isBlank()) {
                return "https://github.com/settings/installations";
            }
            return "https://github.com/apps/" + encode(settings.getAppSlug())
                    + "/installations/new?state=" + encode(state);
        }

        /**
         * Proves GitHub knows the configured app before anyone is sent to it.
         *
         * <p>A code that can never be valid is redeemed on purpose. GitHub answers an unknown client
         * id with a 404 and a wrong secret with {@code incorrect_client_credentials}, while a known
         * app gets {@code bad_verification_code}, so the probe tells them apart without a grant. The
         * credentials are fixed for the life of the process, so one success is remembered; a failure
         * is not, so the next click checks again.
         */
        public void ensureCredentialsAccepted() {
            if (credentialsAccepted) {
                return;
            }
            HttpResponse<String> response = exchange(formRequest(Map.of(
                    "client_id", settings.getClientId(),
                    "client_secret", settings.getClientSecret(),
                    "code", CREDENTIALS_PROBE_CODE)), TOKEN_ENDPOINT);
            if (response.statusCode() == HttpStatus.NOT_FOUND.value()) {
                throw GithubException.notConfigured();
            }
            if (response.statusCode() / 100 != 2) {
                throw GithubException.unavailable(TOKEN_ENDPOINT + " answered " + response.statusCode());
            }
            if (INCORRECT_CLIENT_CREDENTIALS.equals(text(readJson(response.body()), "error", MAX_ERROR_LENGTH))) {
                throw GithubException.notConfigured();
            }
            credentialsAccepted = true;
        }

        public Tokens exchangeCode(String code) {
            return readTokens(postForm(Map.of(
                    "client_id", settings.getClientId(),
                    "client_secret", settings.getClientSecret(),
                    "code", code,
                    "redirect_uri", settings.getRedirectUri())));
        }

        /** GitHub rotates both halves on renewal, so the answer replaces the whole grant. */
        public Tokens refresh(String refreshToken) {
            return readTokens(postForm(Map.of(
                    "client_id", settings.getClientId(),
                    "client_secret", settings.getClientSecret(),
                    "grant_type", "refresh_token",
                    "refresh_token", refreshToken)));
        }

        public Viewer fetchViewer(String accessToken) {
            JsonNode body = readJson(get("/user", accessToken, "GET /user"));
            long id = body.path("id").asLong(0L);
            String login = text(body, "login", MAX_LOGIN_LENGTH);
            if (id <= 0 || login == null) {
                throw GithubException.unavailable("GET /user returned no identity");
            }
            return new Viewer(id, login, text(body, "name", MAX_NAME_LENGTH),
                    text(body, "avatar_url", MAX_URL_LENGTH), text(body, "html_url", MAX_URL_LENGTH));
        }

        /**
         * The repositories the player's grant can reach, most recently pushed first.
         *
         * <p>Two sources, merged. {@code /user/repos} answers what the user token sees on its own,
         * which for a GitHub App user token is essentially the public ones. Private repositories
         * live behind the installation: they are only ever returned by the installation endpoints,
         * and only for the repositories the player granted the app when installing it. Reading both
         * is what makes a private repository appear here without a public one disappearing.
         *
         * <p>Paged, but not exhaustively: this list feeds a picker a person reads, not a mirror of
         * an account, so it stops at {@value #MAX_PAGES} pages per source. Somebody with more
         * repositories than that finds theirs by searching, which is faster than any scroll.
         *
         * <p>The installation count is returned rather than discarded because it is already known
         * here, and because it is the difference between "you own no other repository" and "Mooi was
         * never granted one" — two answers a player cannot tell apart from the list alone.
         */
        public RepositoryAccess listRepositories(String accessToken) {
            Map<Long, Repository> byId = new LinkedHashMap<>();
            collectUserRepositories(accessToken, byId);
            int installations = collectInstallationRepositories(accessToken, byId);
            List<Repository> repositories = byId.values().stream()
                    .sorted(Comparator.comparing(Repository::pushedAt,
                            Comparator.nullsLast(Comparator.reverseOrder())))
                    .toList();
            LOG.debug("The GitHub grant reaches {} repositories ({} private) across {} installations",
                    repositories.size(), repositories.stream().filter(Repository::isPrivate).count(),
                    installations);
            return new RepositoryAccess(repositories, installations);
        }

        private void collectUserRepositories(String accessToken, Map<Long, Repository> byId) {
            for (int page = 1; page <= MAX_PAGES; page++) {
                JsonNode body = readJson(get("/user/repos?sort=pushed&visibility=all&per_page=" + PAGE_SIZE
                        + "&affiliation=owner,collaborator,organization_member&page=" + page,
                        accessToken, "GET /user/repos"));
                if (!body.isArray()) {
                    throw GithubException.unavailable("GET /user/repos returned no list");
                }
                body.forEach(node -> collect(node, byId));
                if (body.size() < PAGE_SIZE) {
                    return;
                }
            }
        }

        /**
         * The installations the player granted, and the repositories inside each one.
         *
         * <p>Best effort: a player who never installed the app has no installation, and an
         * installation the token cannot read is not a reason to fail the whole picker. In both
         * cases the public listing above still answers.
         */
        private int collectInstallationRepositories(String accessToken, Map<Long, Repository> byId) {
            JsonNode installations;
            try {
                installations = readJson(get("/user/installations?per_page=" + PAGE_SIZE, accessToken,
                        "GET /user/installations")).path("installations");
            } catch (GithubException exception) {
                LOG.warn("Unable to read the GitHub installations of the player: {}", exception.getMessage());
                return 0;
            }
            if (!installations.isArray()) {
                return 0;
            }
            int granted = 0;
            for (JsonNode installation : installations) {
                long installationId = installation.path("id").asLong(0L);
                if (installationId > 0) {
                    granted++;
                    collectInstallationPages(installationId, accessToken, byId);
                }
            }
            return granted;
        }

        private void collectInstallationPages(long installationId, String accessToken, Map<Long, Repository> byId) {
            String path = "/user/installations/" + installationId + "/repositories";
            for (int page = 1; page <= MAX_PAGES; page++) {
                JsonNode repositories;
                try {
                    repositories = readJson(get(path + "?per_page=" + PAGE_SIZE + "&page=" + page, accessToken,
                            "GET " + path)).path("repositories");
                } catch (GithubException exception) {
                    LOG.warn("Unable to read the repositories of installation {}: {}", installationId,
                            exception.getMessage());
                    return;
                }
                if (!repositories.isArray()) {
                    return;
                }
                repositories.forEach(node -> collect(node, byId));
                if (repositories.size() < PAGE_SIZE) {
                    return;
                }
            }
        }

        /** First source wins: the same repository can be returned by both listings. */
        private void collect(JsonNode node, Map<Long, Repository> byId) {
            Repository repository = toRepository(node);
            byId.putIfAbsent(repository.id(), repository);
        }

        /**
         * One repository, read with the player's own grant.
         *
         * That is what makes it an authorization check as much as a lookup: a repository the player
         * cannot see answers 404 for them, so nothing can be added to a workspace on the strength of
         * a name typed into a request body.
         */
        public Repository fetchRepository(String owner, String name, String accessToken) {
            return toRepository(readJson(get("/repos/" + encode(owner) + "/" + encode(name), accessToken,
                    "GET /repos/" + owner + "/" + name)));
        }

        /**
         * The entries of one directory on the repository's default branch, read with the player's
         * own grant. A missing directory answers like a missing repository: 404, for the caller to
         * word in its own terms.
         */
        public List<ContentEntry> listDirectory(String owner, String name, String path, String accessToken) {
            String description = "GET /repos/" + owner + "/" + name + "/contents/" + path;
            JsonNode body = readJson(get(contentsPath(owner, name, path), accessToken, description));
            if (!body.isArray()) {
                throw GithubException.unavailable(description + " returned no directory");
            }
            List<ContentEntry> entries = new ArrayList<>();
            for (JsonNode node : body) {
                String entryName = text(node, "name");
                String entryPath = text(node, "path");
                String type = text(node, "type");
                if (entryName != null && entryPath != null && type != null) {
                    entries.add(new ContentEntry(entryName, entryPath, type, text(node, "sha"),
                            node.path("size").asLong(0L)));
                }
            }
            return entries;
        }

        /** One file's text on the default branch, raw: no base64 envelope to decode, no size cap of the JSON form. */
        public String readFile(String owner, String name, String path, String accessToken) {
            return get(contentsPath(owner, name, path), accessToken,
                    "GET /repos/" + owner + "/" + name + "/contents/" + path, GITHUB_RAW);
        }

        /**
         * One file on the default branch with its revision, or empty when no file lives at that path.
         *
         * <p>Unlike {@link #readFile}, a 404 is an answer here rather than a failure: a file that does
         * not exist yet is a normal state for a caller that may create it.
         */
        public Optional<FileContent> readFileContent(String owner, String name, String path, String accessToken) {
            String description = "GET /repos/" + owner + "/" + name + "/contents/" + path;
            HttpResponse<String> response = exchange(repositoryRequest(contentsPath(owner, name, path), accessToken)
                    .GET().build(), description);
            int status = response.statusCode();
            if (status == 404) {
                return Optional.empty();
            }
            if (status == 401 || status == 403) {
                LOG.warn("GitHub refused {} with {}", description, status);
                throw GithubException.reauthorize();
            }
            if (status / 100 != 2) {
                throw GithubException.unavailable(description + " answered " + status);
            }
            JsonNode body = readJson(response.body());
            String sha = text(body, "sha");
            if (!"file".equals(text(body, "type")) || sha == null) {
                throw GithubException.unavailable(description + " is not a file");
            }
            // Past 1 MB the JSON form carries no content; the raw form still does.
            String text = "base64".equals(text(body, "encoding"))
                    ? new String(Base64.getMimeDecoder().decode(body.path("content").asText("")), StandardCharsets.UTF_8)
                    : readFile(owner, name, path, accessToken);
            return Optional.of(new FileContent(sha, text));
        }

        /**
         * Commits one file to the default branch as the player and answers its new revision.
         *
         * <p>{@code sha} is the revision the caller read, or null to create the file. GitHub refuses
         * either when the file moved on meanwhile (409 for a stale revision, 422 for a creation that
         * meets an existing file), and both mean the same thing to the caller: reload first.
         */
        public String writeFile(String owner, String name, String path, String text, String sha, String message,
                                String accessToken) {
            Map<String, String> payload = new LinkedHashMap<>();
            payload.put("message", message);
            payload.put("content", Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));
            if (sha != null) {
                payload.put("sha", sha);
            }
            String body;
            try {
                body = objectMapper.writeValueAsString(payload);
            } catch (JacksonException exception) {
                throw GithubException.unavailable("Unable to build the commit request");
            }
            String description = "PUT /repos/" + owner + "/" + name + "/contents/" + path;
            HttpResponse<String> response = exchange(repositoryRequest(contentsPath(owner, name, path), accessToken)
                    .header(HttpHeaders.CONTENT_TYPE, JSON)
                    .PUT(HttpRequest.BodyPublishers.ofString(body)).build(), description);
            String revision = switch (response.statusCode()) {
                case 200, 201 -> text(readJson(response.body()).path("content"), "sha");
                case 401 -> throw GithubException.reauthorize();
                case 403 -> throw GithubException.contentsWriteDenied();
                case 404 -> throw GithubException.repositoryNotFound();
                case 409, 422 -> throw GithubException.fileChanged();
                default -> throw GithubException.unavailable(description + " answered " + response.statusCode());
            };
            if (revision == null) {
                throw GithubException.unavailable(description + " returned no revision");
            }
            return revision;
        }

        /** Every path segment encoded on its own, so the separators survive and nothing else can break out. */
        private static String contentsPath(String owner, String name, String path) {
            String encodedPath = Arrays.stream(path.split("/"))
                    .filter(segment -> !segment.isEmpty())
                    .map(segment -> encode(segment).replace("+", "%20"))
                    .collect(Collectors.joining("/"));
            return "/repos/" + encode(owner) + "/" + encode(name) + "/contents/" + encodedPath;
        }

        /** Creates a repository owned by the linked GitHub user. GitHub's response is authoritative. */
        public Repository createRepository(String name, boolean privateRepository, String accessToken) {
            String body;
            try {
                body = objectMapper.writeValueAsString(Map.of(
                        "name", name, "private", privateRepository, "auto_init", true));
            } catch (JacksonException exception) {
                throw GithubException.unavailable("Unable to build the repository request");
            }
            HttpRequest request = repositoryRequest("/user/repos", accessToken)
                    .header(HttpHeaders.CONTENT_TYPE, JSON)
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build();
            return toRepository(readJson(sendRepositoryWrite(request, "create repository")));
        }

        /** Deletes the exact repository the player selected, after its numeric id was checked. */
        public void deleteRepository(String owner, String name, String accessToken) {
            HttpRequest request = repositoryRequest("/repos/" + encode(owner) + "/" + encode(name), accessToken)
                    .DELETE().build();
            sendRepositoryWrite(request, "delete repository");
        }

        private HttpRequest.Builder repositoryRequest(String path, String accessToken) {
            return HttpRequest.newBuilder(URI.create(settings.getApiBaseUrl() + path))
                    .timeout(settings.getRequestTimeout())
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                    .header(ACCEPT_HEADER, GITHUB_JSON)
                    .header(API_VERSION_HEADER, API_VERSION);
        }

        private String sendRepositoryWrite(HttpRequest request, String action) {
            try {
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                return switch (response.statusCode()) {
                    case 200, 201, 204 -> response.body();
                    case 401 -> throw GithubException.reauthorize();
                    case 403 -> throw GithubException.repositoryWriteDenied();
                    case 404 -> throw GithubException.repositoryNotFound();
                    case 409, 422 -> throw GithubException.repositoryConflict();
                    default -> throw GithubException.unavailable(action + " answered " + response.statusCode());
                };
            } catch (IOException exception) {
                throw GithubException.unavailable(action + " failed: " + exception.getMessage());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw GithubException.unavailable(action + " was interrupted");
            }
        }

        /**
         * Best effort by design. This drops GitHub's copy of the link; ours is dropped either way.
         * The player asked to disconnect, so that must succeed even when GitHub cannot be reached —
         * a failure here is logged and nothing more.
         */
        public void revoke(String accessToken) {
            String payload;
            try {
                payload = objectMapper.writeValueAsString(Map.of("access_token", accessToken));
            } catch (JacksonException exception) {
                LOG.warn("Unable to build the GitHub revocation payload");
                return;
            }
            String credentials = Base64.getEncoder().encodeToString(
                    (settings.getClientId() + ":" + settings.getClientSecret()).getBytes(StandardCharsets.UTF_8));
            HttpRequest request = HttpRequest.newBuilder(URI.create(
                            settings.getApiBaseUrl() + "/application/" + encode(settings.getClientId()) + "/grant"))
                    .timeout(settings.getRequestTimeout())
                    .header(HttpHeaders.AUTHORIZATION, "Basic " + credentials)
                    .header(HttpHeaders.CONTENT_TYPE, JSON)
                    .header(ACCEPT_HEADER, GITHUB_JSON)
                    .header(API_VERSION_HEADER, API_VERSION)
                    .method("DELETE", HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            try {
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() / 100 != 2) {
                    LOG.warn("GitHub refused to revoke the grant ({})", response.statusCode());
                }
            } catch (IOException exception) {
                LOG.warn("Unable to revoke the GitHub grant: {}", exception.getMessage());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                LOG.warn("Revoking the GitHub grant was interrupted");
            }
        }

        /** The {@code error} field is read first: a refusal arrives with a 200 status. */
        private Tokens readTokens(String body) {
            JsonNode node = readJson(body);
            String error = text(node, "error", MAX_ERROR_LENGTH);
            if (error != null) {
                String description = text(node, "error_description", MAX_ERROR_LENGTH);
                throw GithubException.rejected(description != null ? description : error);
            }
            String accessToken = text(node, "access_token");
            if (accessToken == null) {
                throw GithubException.unavailable("the token endpoint returned no access token");
            }
            Instant now = clock.instant();
            return new Tokens(accessToken, expiresAt(node, "expires_in", now), text(node, "refresh_token"),
                    expiresAt(node, "refresh_token_expires_in", now), text(node, "scope", MAX_SCOPE_LENGTH));
        }

        private String postForm(Map<String, String> form) {
            return send(formRequest(form), TOKEN_ENDPOINT);
        }

        private HttpRequest formRequest(Map<String, String> form) {
            String body = form.entrySet().stream()
                    .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                    .collect(Collectors.joining("&"));
            return HttpRequest.newBuilder(URI.create(settings.getTokenUri()))
                    .timeout(settings.getRequestTimeout())
                    .header(HttpHeaders.CONTENT_TYPE, FORM)
                    .header(ACCEPT_HEADER, JSON)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
        }

        /**
         * Every authenticated read of the GitHub API goes through here, so one place decides what a
         * status code means to the player: a token that no longer opens the resource is something
         * they can repair by connecting again, and a missing repository is not a server failure.
         */
        private String get(String path, String accessToken, String description) {
            return get(path, accessToken, description, GITHUB_JSON);
        }

        private String get(String path, String accessToken, String description, String accept) {
            HttpRequest request = HttpRequest.newBuilder(URI.create(settings.getApiBaseUrl() + path))
                    .timeout(settings.getRequestTimeout())
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                    .header(ACCEPT_HEADER, accept)
                    .header(API_VERSION_HEADER, API_VERSION)
                    .GET()
                    .build();
            try {
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                int status = response.statusCode();
                if (status == 401 || status == 403) {
                    LOG.warn("GitHub refused {} with {}", description, status);
                    throw GithubException.reauthorize();
                }
                if (status == 404) {
                    throw GithubException.repositoryNotFound();
                }
                if (status / 100 != 2) {
                    throw GithubException.unavailable(description + " answered " + status);
                }
                return response.body();
            } catch (IOException exception) {
                throw GithubException.unavailable(description + " failed: " + exception.getMessage());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw GithubException.unavailable(description + " was interrupted");
            }
        }

        private String send(HttpRequest request, String description) {
            HttpResponse<String> response = exchange(request, description);
            if (response.statusCode() / 100 != 2) {
                throw GithubException.unavailable(description + " answered " + response.statusCode());
            }
            return response.body();
        }

        /** The raw round trip, for the rare caller that reads a status code as an answer rather than a failure. */
        private HttpResponse<String> exchange(HttpRequest request, String description) {
            try {
                return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            } catch (IOException exception) {
                throw GithubException.unavailable(description + " failed: " + exception.getMessage());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw GithubException.unavailable(description + " was interrupted");
            }
        }

        private JsonNode readJson(String body) {
            try {
                return objectMapper.readTree(body);
            } catch (JacksonException exception) {
                throw GithubException.unavailable("GitHub returned a malformed response");
            }
        }

        /** Truncates every field to what the projects table holds, so no repository can fail an insert. */
        private static Repository toRepository(JsonNode node) {
            long id = node.path("id").asLong(0L);
            String fullName = text(node, "full_name", MAX_FULL_NAME_LENGTH);
            String name = text(node, "name", MAX_LOGIN_LENGTH);
            String owner = text(node.path("owner"), "login", MAX_LOGIN_LENGTH);
            if (id <= 0 || fullName == null || name == null || owner == null) {
                throw GithubException.unavailable("GitHub returned a repository without an identity");
            }
            return new Repository(id, owner, name, fullName, text(node, "description", MAX_DESCRIPTION_LENGTH),
                    node.path("private").asBoolean(false), text(node, "default_branch", MAX_LOGIN_LENGTH),
                    text(node, "html_url", MAX_URL_LENGTH), text(node, "language", MAX_LANGUAGE_LENGTH),
                    node.path("stargazers_count").asInt(0), timestamp(node, "pushed_at"));
        }

        /** An unreadable or absent timestamp is simply unknown: it is decoration, never a decision. */
        private static OffsetDateTime timestamp(JsonNode node, String field) {
            String value = text(node, field);
            if (value == null) {
                return null;
            }
            try {
                return OffsetDateTime.parse(value);
            } catch (DateTimeParseException exception) {
                return null;
            }
        }

        /** Relative seconds become an absolute instant once, here. Absent or zero means no expiry. */
        private static OffsetDateTime expiresAt(JsonNode node, String field, Instant now) {
            JsonNode value = node.get(field);
            if (value == null || !value.isNumber() || value.asLong() <= 0) {
                return null;
            }
            return OffsetDateTime.ofInstant(now.plusSeconds(value.asLong()), ZoneOffset.UTC);
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

        /** Truncated to what the column holds, so a long profile field can never fail an insert. */
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
}

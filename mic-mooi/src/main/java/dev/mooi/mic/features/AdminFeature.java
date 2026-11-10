package dev.mooi.mic.features;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import dev.mooi.mic.shared.Auth;
import lombok.RequiredArgsConstructor;

/**
 * Feature: the administration directory of players.
 *
 * <p>A read model only: one paged query per page of the directory, joining what other features own
 * (sign-ins, projects, agent accounts, GitHub links) by {@code player_id} through their own indexes.
 * Nothing here writes: suspending or signing a player out changes identity, so it belongs to
 * {@link AuthFeature}, and what a player is doing right now (presence, live agent sessions) is
 * memory-resident in {@code mic-sessions}, which streams it to administrators.
 *
 * <p>Self-contained by architecture: API, application logic and contracts live in this single file
 * and may only import transversal aspects from {@code shared}.
 */
@RestController
@RequiredArgsConstructor
public class AdminFeature {

    private final AdminService adminService;

    @GetMapping("/admin/players")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public PlayersPayload players(@RequestParam(defaultValue = "") String query,
                                  @RequestParam(defaultValue = "0") int offset,
                                  @RequestParam(defaultValue = "50") int limit) {
        return adminService.players(query, offset, limit);
    }

    @GetMapping("/admin/players/{playerId}/sign-ins")
    @Auth.RequireRole(Auth.Role.ADMIN)
    public SignInsPayload signIns(@PathVariable UUID playerId) {
        return new SignInsPayload(adminService.signIns(playerId));
    }

    // --- application ---

    @Service
    public static class AdminService {

        private static final int MAX_LIMIT = 100;
        private static final int MAX_QUERY_LENGTH = 100;
        private static final int MAX_SIGN_INS = 20;

        /**
         * Most recently active first. The total rides along as a window count, so a page costs a single
         * round trip; the lateral aggregate reads one player's sign-ins through their player index.
         */
        private static final String PLAYERS = """
                SELECT p.id, p.username, p.email, p.avatar_url, p.role, p.created_at, p.banned_at,
                       s.last_seen_at, s.sign_ins,
                       (SELECT count(*) FROM projects pr WHERE pr.player_id = p.id) AS projects,
                       (SELECT count(*) FROM agent_connections c WHERE c.player_id = p.id) AS agent_accounts,
                       EXISTS (SELECT 1 FROM github_connections g WHERE g.player_id = p.id) AS github_linked,
                       count(*) OVER () AS total
                FROM players p
                CROSS JOIN LATERAL (
                    SELECT max(a.last_used_at) AS last_seen_at,
                           count(*) FILTER (WHERE a.revoked_at IS NULL) AS sign_ins
                    FROM auth_sessions a WHERE a.player_id = p.id
                ) s
                WHERE p.email ILIKE :pattern OR p.username ILIKE :pattern
                ORDER BY s.last_seen_at DESC NULLS LAST, p.created_at DESC, p.id
                LIMIT :limit OFFSET :offset
                """;

        private static final String SIGN_INS = """
                SELECT id, created_at, last_used_at, user_agent, ip_address
                FROM auth_sessions
                WHERE player_id = :playerId AND revoked_at IS NULL
                ORDER BY last_used_at DESC
                LIMIT :limit
                """;

        private final JdbcClient jdbc;

        AdminService(DataSource dataSource) {
            this.jdbc = JdbcClient.create(dataSource);
        }

        public PlayersPayload players(String query, int offset, int limit) {
            long[] total = {0};
            List<PlayerPayload> players = jdbc.sql(PLAYERS)
                    .param("pattern", pattern(query))
                    .param("limit", Math.clamp(limit, 1, MAX_LIMIT))
                    .param("offset", Math.max(offset, 0))
                    .query((row, index) -> {
                        total[0] = row.getLong("total");
                        return new PlayerPayload(row.getObject("id", UUID.class), row.getString("username"),
                                row.getString("email"), row.getString("avatar_url"), row.getString("role"),
                                row.getObject("created_at", OffsetDateTime.class),
                                row.getObject("last_seen_at", OffsetDateTime.class),
                                row.getObject("banned_at", OffsetDateTime.class), row.getInt("sign_ins"),
                                row.getInt("projects"), row.getInt("agent_accounts"), row.getBoolean("github_linked"));
                    })
                    .list();
            return new PlayersPayload(players, total[0]);
        }

        /** The player's live sign-ins, so an administrator recognises their devices before acting. */
        public List<SignInPayload> signIns(UUID playerId) {
            return jdbc.sql(SIGN_INS)
                    .param("playerId", playerId)
                    .param("limit", MAX_SIGN_INS)
                    .query((row, index) -> new SignInPayload(row.getObject("id", UUID.class),
                            row.getObject("created_at", OffsetDateTime.class),
                            row.getObject("last_used_at", OffsetDateTime.class),
                            row.getString("user_agent"), row.getString("ip_address")))
                    .list();
        }

        /** A contains-match on name or email; wildcards typed by the administrator match literally. */
        private static String pattern(String query) {
            String needle = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
            if (needle.length() > MAX_QUERY_LENGTH) {
                needle = needle.substring(0, MAX_QUERY_LENGTH);
            }
            return "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        }
    }

    // --- contracts ---

    /** {@code lastSeenAt} is the latest sign-in activity; whether the player is online now comes live from mic-sessions. */
    public record PlayerPayload(UUID id, String username, String email, String avatarUrl, String role,
                                OffsetDateTime createdAt, OffsetDateTime lastSeenAt, OffsetDateTime bannedAt,
                                int signIns, int projects, int agentAccounts, boolean githubLinked) {
    }

    public record PlayersPayload(List<PlayerPayload> players, long total) {
    }

    public record SignInPayload(UUID id, OffsetDateTime createdAt, OffsetDateTime lastUsedAt, String userAgent,
                                String ipAddress) {
    }

    public record SignInsPayload(List<SignInPayload> signIns) {
    }
}

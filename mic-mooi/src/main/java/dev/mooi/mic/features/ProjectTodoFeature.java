package dev.mooi.mic.features;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.hibernate.annotations.Immutable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import dev.mooi.mic.shared.Auth;
import dev.mooi.mic.shared.Crypto;
import dev.mooi.mic.shared.Github;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;

/**
 * Feature: a project's to-do list, kept in the repository itself as {@code docs/TODOS.md}.
 *
 * <p>The file is the source of truth and Mooi holds no copy: every read goes to the default branch,
 * and every change is a commit there, made with the player's own grant so it is authored by them.
 * The file's blob {@code sha} travels as the list's revision, so a save that did not see the latest
 * change (another device, an agent, a push from a laptop) is refused instead of overwriting it.
 *
 * <p>Mooi only edits files it can render without losing anything: an optional {@code # Title}
 * followed by task-list items, open, in progress or done. Any other content is reported as {@code unsupported}, with
 * the lines that are not understood and the items that a clean-up would keep, and is never changed
 * unless the player asks for that clean-up.
 *
 * <p>Writes are reachable only through mic-sessions ({@link Auth.ServiceCall}), which announces each
 * new list on the player's live channel: buttons, other devices and agents converge on one path.
 *
 * <p>Self-contained by architecture: API, application logic, persistence and contracts live in this
 * single file and may only import transversal aspects from {@code shared}.
 */
@RestController
@RequiredArgsConstructor
public class ProjectTodoFeature {

    private final TodoService todoService;

    @GetMapping("/me/projects/{projectId}/todos")
    @Auth.Authenticated
    @Auth.ServiceCall
    public TodoListPayload todos(@PathVariable UUID projectId, Auth.Principal principal) {
        return todoService.read(principal.player().id(), projectId);
    }

    /** Replaces the whole list in one commit; creates the file when {@code revision} is null. */
    @PutMapping("/me/projects/{projectId}/todos")
    @Auth.Authenticated
    @Auth.ServiceCall
    public TodoListPayload saveTodos(@PathVariable UUID projectId, @Valid @RequestBody SaveTodosRequest request,
                                     Auth.Principal principal) {
        return todoService.save(principal.player().id(), projectId, request);
    }

    // --- application ---

    @Service
    @RequiredArgsConstructor
    public static class TodoService {

        static final String PATH = "docs/TODOS.md";

        private final TodoProjectRepository projects;
        private final TodoGithubConnectionRepository connections;
        private final Github.OAuthClient oauthClient;
        private final Crypto.SecretBox secretBox;
        private final Clock clock;

        @Transactional(readOnly = true)
        public TodoListPayload read(UUID playerId, UUID projectId) {
            TodoProject project = project(playerId, projectId);
            return toPayload(project, oauthClient.readFileContent(project.getOwner(), project.getName(), PATH,
                    accessToken(playerId)));
        }

        /**
         * Commits the list unless it is already what the file says.
         *
         * <p>The current file is read first, for three reasons: a stale revision is refused with a
         * clear answer before GitHub is asked to write, an unchanged list costs no empty commit, and
         * the commit message can say what actually changed.
         */
        @Transactional(readOnly = true)
        public TodoListPayload save(UUID playerId, UUID projectId, SaveTodosRequest request) {
            TodoProject project = project(playerId, projectId);
            String token = accessToken(playerId);
            Optional<Github.FileContent> current = oauthClient.readFileContent(project.getOwner(), project.getName(),
                    PATH, token);
            String currentRevision = current.map(Github.FileContent::sha).orElse(null);
            if (!Objects.equals(currentRevision, request.revision())) {
                throw Github.GithubException.fileChanged();
            }

            List<TodoItem> items = request.items().stream()
                    .map(item -> new TodoItem(TodoDocument.clean(item.text()), item.status()))
                    .toList();
            String title = request.title() == null || request.title().isBlank()
                    ? TodoDocument.DEFAULT_TITLE : TodoDocument.clean(request.title());
            String text = TodoDocument.render(title, items);
            if (current.isPresent() && current.get().text().equals(text)) {
                return toPayload(project, current);
            }

            String message = TodoDocument.commitMessage(current.map(file -> TodoDocument.parse(file.text())), items);
            String revision = oauthClient.writeFile(project.getOwner(), project.getName(), PATH, text,
                    currentRevision, message, token);
            Github.LOG.info("Player {} committed {} to {} ({} items)", playerId, PATH, project.getFullName(),
                    items.size());
            return toPayload(project, Optional.of(new Github.FileContent(revision, text)));
        }

        private TodoProject project(UUID playerId, UUID projectId) {
            return projects.findByIdAndPlayerId(projectId, playerId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
        }

        /** Read-only like every non-owning feature: renewal stays with the GitHub connection feature. */
        private String accessToken(UUID playerId) {
            TodoGithubConnection account = connections.findByPlayerId(playerId)
                    .orElseThrow(Github.GithubException::reauthorize);
            OffsetDateTime expiresAt = account.getAccessTokenExpiresAt();
            if (expiresAt != null && !expiresAt.isAfter(OffsetDateTime.now(clock))) {
                throw Github.GithubException.reauthorize();
            }
            return secretBox.decrypt(account.getAccessToken());
        }

        private static TodoListPayload toPayload(TodoProject project, Optional<Github.FileContent> file) {
            String htmlUrl = project.getHtmlUrl() == null ? null : project.getHtmlUrl() + "/blob/"
                    + (project.getDefaultBranch() == null ? "HEAD" : project.getDefaultBranch()) + "/" + PATH;
            if (file.isEmpty()) {
                return new TodoListPayload(PATH, TodoListState.missing, null, TodoDocument.DEFAULT_TITLE, List.of(),
                        List.of(), List.of(), null, htmlUrl);
            }
            TodoDocument document = TodoDocument.parse(file.get().text());
            if (document.supported()) {
                return new TodoListPayload(PATH, TodoListState.ready, file.get().sha(), document.title(),
                        document.items(), List.of(), List.of(), null, htmlUrl);
            }
            String content = file.get().text();
            return new TodoListPayload(PATH, TodoListState.unsupported, file.get().sha(), document.title(), List.of(),
                    document.issues(), document.salvage(),
                    content.length() > TodoDocument.MAX_PREVIEW ? content.substring(0, TodoDocument.MAX_PREVIEW) : content,
                    htmlUrl);
        }
    }

    /**
     * The one format Mooi reads and writes, parsed and rendered as pure functions.
     *
     * <p>Supported: blank lines, at most one leading {@code # Title}, and task items {@code - [ ] text}
     * (open), {@code - [/] text} (in progress, the marker task tools such as Obsidian use; GitHub shows
     * it as plain text) or {@code - [x] text} (done); {@code *} bullets and an upper-case {@code X}
     * read the same. Everything else is an issue, reported with its line, because rewriting it would
     * lose what it says. Items have no length limit: an item is one line, however long.
     *
     * <p>{@code salvage} is the clean-up offer for unsupported files: every list line that still reads
     * as a task, keeping its status when the marker is a known one, flattened and in file order.
     */
    record TodoDocument(String title, List<TodoItem> items, List<TodoIssue> issues, List<TodoItem> salvage) {

        static final String DEFAULT_TITLE = "TODOs";
        static final int MAX_PREVIEW = 64 * 1024;
        private static final int MAX_ISSUES = 50;
        private static final Pattern TITLE = Pattern.compile("^#\\s+(\\S.*)$");
        private static final Pattern TASK = Pattern.compile("^[-*]\\s\\[([ xX/])]\\s+(\\S.*)$");
        private static final Pattern LOOSE_TASK = Pattern.compile("^\\s*[-*+]\\s+\\[(.?)]\\s*(\\S.*)$");
        private static final Pattern LOOSE_BULLET = Pattern.compile("^\\s*(?:[-*+]|\\d+[.)])\\s+(\\S.*)$");

        boolean supported() {
            return issues.isEmpty();
        }

        static TodoDocument parse(String text) {
            String[] lines = text.replace("\r\n", "\n").split("\n", -1);
            String title = null;
            boolean seenContent = false;
            List<TodoItem> items = new ArrayList<>();
            List<TodoIssue> issues = new ArrayList<>();
            List<TodoItem> salvage = new ArrayList<>();
            for (int index = 0; index < lines.length; index++) {
                String line = lines[index].stripTrailing();
                if (line.isEmpty()) {
                    continue;
                }
                Matcher heading = TITLE.matcher(line);
                Matcher task = TASK.matcher(line);
                if (!seenContent && heading.matches()) {
                    title = clean(heading.group(1));
                } else if (task.matches()) {
                    items.add(new TodoItem(clean(task.group(2)), TodoStatus.ofMarker(task.group(1))));
                } else if (issues.size() < MAX_ISSUES) {
                    issues.add(new TodoIssue(index + 1, line.length() > 200 ? line.substring(0, 200) : line));
                }
                seenContent = true;
                salvage(line, salvage);
            }
            return new TodoDocument(title == null ? DEFAULT_TITLE : title, items, issues, salvage);
        }

        private static void salvage(String line, List<TodoItem> salvage) {
            Matcher task = LOOSE_TASK.matcher(line);
            if (task.matches()) {
                salvage.add(new TodoItem(clean(task.group(2)), TodoStatus.ofMarker(task.group(1))));
                return;
            }
            Matcher bullet = LOOSE_BULLET.matcher(line);
            if (bullet.matches()) {
                salvage.add(new TodoItem(clean(bullet.group(1)), TodoStatus.open));
            }
        }

        static String render(String title, List<TodoItem> items) {
            StringBuilder text = new StringBuilder("# ").append(title).append("\n");
            if (!items.isEmpty()) {
                text.append("\n");
            }
            items.forEach(item -> text.append("- [").append(item.status().marker).append("] ")
                    .append(item.text()).append("\n"));
            return text.toString();
        }

        /** One line, collapsed whitespace: what a task-list item can hold without breaking the file. */
        static String clean(String value) {
            return value.strip().replaceAll("\\s+", " ");
        }

        /** Names the single change when there is one, and stays generic otherwise. */
        static String commitMessage(Optional<TodoDocument> before, List<TodoItem> after) {
            if (before.isEmpty()) {
                return "docs(todos): create to-do list";
            }
            if (!before.get().supported()) {
                return "docs(todos): convert to-do list to the Mooi format";
            }
            List<TodoItem> previous = before.get().items();
            Map<String, Integer> remaining = new HashMap<>();
            previous.forEach(item -> remaining.merge(item.text(), 1, Integer::sum));
            List<TodoItem> added = new ArrayList<>();
            for (TodoItem item : after) {
                if (remaining.merge(item.text(), -1, Integer::sum) < 0) {
                    added.add(item);
                }
            }
            long removedCount = remaining.values().stream().filter(count -> count > 0).mapToLong(Integer::longValue).sum();
            if (added.size() == 1 && removedCount == 0) {
                return "docs(todos): add \"" + summary(added.getFirst().text()) + "\"";
            }
            if (added.isEmpty() && removedCount == 1) {
                String removed = remaining.entrySet().stream().filter(entry -> entry.getValue() > 0)
                        .map(Map.Entry::getKey).findFirst().orElse("");
                return "docs(todos): remove \"" + summary(removed) + "\"";
            }
            if (added.isEmpty() && removedCount == 0 && previous.size() == after.size()) {
                List<TodoItem> moved = new ArrayList<>();
                boolean reordered = false;
                for (int index = 0; index < after.size(); index++) {
                    if (!previous.get(index).text().equals(after.get(index).text())) {
                        reordered = true;
                    } else if (previous.get(index).status() != after.get(index).status()) {
                        moved.add(after.get(index));
                    }
                }
                if (!reordered && moved.size() == 1) {
                    TodoItem item = moved.getFirst();
                    return "docs(todos): " + item.status().verb + " \"" + summary(item.text()) + "\"";
                }
                if (reordered && moved.isEmpty()) {
                    return "docs(todos): reorder to-do list";
                }
            }
            return "docs(todos): update to-do list";
        }

        private static String summary(String text) {
            return text.length() <= 60 ? text : text.substring(0, 57) + "...";
        }
    }

    // --- persistence ---

    /** A read-only view of the projects table owned by {@code ProjectFeature}: the repository to commit to. */
    @Getter
    @Immutable
    @NoArgsConstructor
    @Entity(name = "TodoProject")
    @Table(name = "projects")
    public static class TodoProject {

        @Id
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, updatable = false)
        private UUID playerId;

        @Column(name = "owner", nullable = false)
        private String owner;

        @Column(name = "name", nullable = false)
        private String name;

        @Column(name = "full_name", nullable = false)
        private String fullName;

        @Column(name = "default_branch")
        private String defaultBranch;

        @Column(name = "html_url")
        private String htmlUrl;
    }

    public interface TodoProjectRepository extends JpaRepository<TodoProject, UUID> {

        /** Scoped by player on purpose: an id alone must never be enough to reach somebody's repository. */
        Optional<TodoProject> findByIdAndPlayerId(UUID id, UUID playerId);
    }

    /** A read-only view of the connection table owned by {@code GithubConnectionFeature}. */
    @Getter
    @Immutable
    @NoArgsConstructor
    @Entity(name = "TodoGithubConnection")
    @Table(name = "github_connections")
    public static class TodoGithubConnection {

        @Id
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, updatable = false)
        private UUID playerId;

        @Column(name = "access_token", nullable = false)
        private String accessToken;

        @Column(name = "access_token_expires_at")
        private OffsetDateTime accessTokenExpiresAt;
    }

    public interface TodoGithubConnectionRepository extends JpaRepository<TodoGithubConnection, UUID> {

        Optional<TodoGithubConnection> findByPlayerId(UUID playerId);
    }

    // --- contracts ---

    /** {@code missing}: no file yet; {@code ready}: Mooi manages it; {@code unsupported}: left for the player to decide. */
    public enum TodoListState { missing, ready, unsupported }

    /** What a task item says about its progress, with the marker it is written with in the file. */
    public enum TodoStatus {
        open(' ', "reopen"), inProgress('/', "start"), done('x', "complete");

        final char marker;
        /** How a commit names a change to this status. */
        final String verb;

        TodoStatus(char marker, String verb) {
            this.marker = marker;
            this.verb = verb;
        }

        /** Any marker other than {@code x} or {@code /} reads as open: it is what a clean-up can honestly keep. */
        static TodoStatus ofMarker(String marker) {
            return switch (marker.toLowerCase(Locale.ROOT)) {
                case "x" -> done;
                case "/" -> inProgress;
                default -> open;
            };
        }
    }

    public record TodoItem(String text, TodoStatus status) {
    }

    /** A line Mooi cannot render, 1-based as an editor shows it. */
    public record TodoIssue(int line, String text) {
    }

    /**
     * {@code revision} is the file's blob sha, null while it is missing. {@code issues}, {@code salvage}
     * and {@code content} are only filled for an unsupported file.
     */
    public record TodoListPayload(String path, TodoListState state, String revision, String title,
                                  List<TodoItem> items, List<TodoIssue> issues, List<TodoItem> salvage,
                                  String content, String htmlUrl) {
    }

    /** An item is one non-blank line of any length, so it can never break the file apart. */
    public record SaveTodosRequest(
            @Size(max = 128) String revision,
            @Size(max = 200) @jakarta.validation.constraints.Pattern(regexp = "[^\\r\\n]*") String title,
            @NotNull @Size(max = 500) List<@Valid @NotNull SaveTodoItem> items) {
    }

    public record SaveTodoItem(
            @NotBlank @jakarta.validation.constraints.Pattern(regexp = "[^\\r\\n]*") String text,
            @NotNull TodoStatus status) {
    }
}

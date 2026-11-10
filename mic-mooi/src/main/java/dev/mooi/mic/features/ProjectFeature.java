package dev.mooi.mic.features;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.hibernate.annotations.Immutable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

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
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.Setter;

/**
 * Feature: the GitHub repositories a player brought into their workspace.
 *
 * <p>A project is a reference, never a copy. What this feature persists is the handful of columns
 * needed to show a repository in a list — id, names, description, branch, link, language, stars —
 * and nothing else: no code, no tree, no archive, no clone. The code stays on GitHub, where it
 * already is, and every heavier read happens live against the player's own grant.
 *
 * <p>The one column that is not GitHub's is {@code webApplication}: the player's own answer to
 * whether the repository is a web application. Nothing can infer it reliably from metadata, so it is
 * asked when the project is added, can be corrected later, and decides whether the project's
 * sessions offer deploy and preview at all. {@code developmentDeploymentReady} is the platform's own:
 * set once the agent's development deployment setup passed its test, after which the project's
 * sessions deploy their root Compose file directly instead of going through that setup again.
 *
 * <p>That grant is also the authorization rule. Imported repository metadata is fetched from GitHub
 * with the caller's token; newly created repository metadata comes from GitHub's creation response.
 *
 * <p>Self-contained by architecture: API, application logic, persistence and contracts live in this
 * single file and may only import transversal aspects from {@code shared}.
 */
@RestController
@RequiredArgsConstructor
public class ProjectFeature {

    private final ProjectService projectService;

    @GetMapping("/me/projects")
    @Auth.Authenticated
    public ProjectsResponse projects(Auth.Principal principal) {
        return new ProjectsResponse(projectService.list(principal.player().id()));
    }

    /** 201 with the created project: the SPA inserts the answer instead of reloading the list. */
    @PostMapping("/me/projects")
    @Auth.Authenticated
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectPayload addProject(@Valid @RequestBody AddProjectRequest request, Auth.Principal principal) {
        return projectService.add(principal.player().id(), request.fullName(), request.webApplication());
    }

    @PostMapping("/me/projects/new")
    @Auth.Authenticated
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectPayload createProject(@Valid @RequestBody CreateProjectRequest request, Auth.Principal principal) {
        return projectService.create(principal.player().id(), request.name(), request.isPrivate(),
                request.webApplication());
    }

    /** Only the player-owned setting is editable; GitHub metadata is never taken from a request body. */
    @PatchMapping("/me/projects/{projectId}")
    @Auth.Authenticated
    public ProjectPayload updateProject(@PathVariable UUID projectId,
                                        @Valid @RequestBody UpdateProjectRequest request,
                                        Auth.Principal principal) {
        return projectService.update(principal.player().id(), projectId, request.webApplication());
    }

    /** Service-only: the setup's test may finish after the player's access token expired. Idempotent. */
    @PutMapping("/internal/projects/{projectId}/development/deployment/ready")
    @Auth.ServiceOnly
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markDevelopmentDeploymentReady(@PathVariable UUID projectId) {
        projectService.markDevelopmentDeploymentReady(projectId);
    }

    /** Removes the local project reference only. */
    @DeleteMapping("/me/projects/{projectId}")
    @Auth.Authenticated
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeProject(@PathVariable UUID projectId, Auth.Principal principal) {
        projectService.remove(principal.player().id(), projectId);
    }

    /** Permanently deletes the repository on GitHub and then its local project reference. */
    @DeleteMapping("/me/projects/{projectId}/repository")
    @Auth.Authenticated
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRepository(@PathVariable UUID projectId, Auth.Principal principal) {
        projectService.delete(principal.player().id(), projectId);
    }

    // --- application ---

    /**
     * Everything a workspace does with its repositories: listing, importing, creating and deleting.
     *
     * <p>Every method is scoped to the calling player, and no method ever trusts the client for
     * repository metadata. GitHub resolves imports and returns the metadata for newly created ones.
     */
    @Service
    @RequiredArgsConstructor
    public static class ProjectService {

        private final ProjectRepository projectRepository;
        private final LinkedAccountRepository linkedAccountRepository;
        private final Github.OAuthClient oauthClient;
        private final Crypto.SecretBox secretBox;
        private final Clock clock;

        /** Most recently added first: the list is read as a history of what the player brought in. */
        @Transactional(readOnly = true)
        public List<ProjectPayload> list(UUID playerId) {
            return projectRepository.findByPlayerIdOrderByAddedAtDesc(playerId).stream()
                    .map(ProjectService::toPayload)
                    .toList();
        }

        /**
         * Adds a repository the player can actually reach.
         *
         * <p>The order matters: GitHub is asked first, so the row is written from what GitHub says
         * rather than from what the request claimed, and a repository invisible to the player's
         * grant fails as a 404 before anything is persisted. The duplicate check runs on GitHub's
         * numeric id, not on the name, so renaming a repository upstream cannot smuggle a second
         * copy of it into the workspace.
         */
        @Transactional
        public ProjectPayload add(UUID playerId, String fullName, boolean webApplication) {
            int separator = fullName.indexOf('/');
            String owner = fullName.substring(0, separator);
            String name = fullName.substring(separator + 1);

            Github.Repository repository = oauthClient.fetchRepository(owner, name, accessToken(playerId));

            projectRepository.findByPlayerIdAndGithubRepoId(playerId, repository.id())
                    .ifPresent(existing -> {
                        throw Github.GithubException.alreadyAdded();
                    });

            return save(playerId, repository, webApplication);
        }

        @Transactional
        public ProjectPayload create(UUID playerId, String name, boolean privateRepository, boolean webApplication) {
            Github.Repository repository = oauthClient.createRepository(name, privateRepository, accessToken(playerId));
            return save(playerId, repository, webApplication);
        }

        private ProjectPayload save(UUID playerId, Github.Repository repository, boolean webApplication) {
            Project project = new Project();
            project.setPlayerId(playerId);
            project.setGithubRepoId(repository.id());
            project.setOwner(repository.owner());
            project.setName(repository.name());
            project.setFullName(repository.fullName());
            project.setDescription(repository.description());
            project.setPrivateRepository(repository.isPrivate());
            project.setDefaultBranch(repository.defaultBranch());
            project.setHtmlUrl(repository.htmlUrl());
            project.setLanguage(repository.language());
            project.setStars(repository.stars());
            project.setWebApplication(webApplication);
            project.setAddedAt(OffsetDateTime.now(clock));

            Project saved = projectRepository.save(project);
            Github.LOG.info("Player {} added repository {}", playerId, repository.fullName());
            return toPayload(saved);
        }

        /** Scoped by player like every other write: someone else's id reads as not found. */
        @Transactional
        public ProjectPayload update(UUID playerId, UUID projectId, boolean webApplication) {
            Project project = projectRepository.findByIdAndPlayerId(projectId, playerId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
            project.setWebApplication(webApplication);
            Github.LOG.info("Player {} marked repository {} as {}", playerId, project.getFullName(),
                    webApplication ? "a web application" : "not a web application");
            return toPayload(project);
        }

        /** Keeps the first time only: later setups change the deployment, never whether it was set up. */
        @Transactional
        public void markDevelopmentDeploymentReady(UUID projectId) {
            Project project = projectRepository.findById(projectId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
            if (project.getDevelopmentDeploymentReadyAt() == null) {
                project.setDevelopmentDeploymentReadyAt(OffsetDateTime.now(clock));
                Github.LOG.info("Repository {} completed its development deployment setup", project.getFullName());
            }
        }

        /** Refuses to delete a repository if its saved name now resolves to another GitHub id. */
        @Transactional
        public void delete(UUID playerId, UUID projectId) {
            Project project = projectRepository.findByIdAndPlayerId(projectId, playerId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
            String token = accessToken(playerId);
            Github.Repository current = oauthClient.fetchRepository(project.getOwner(), project.getName(), token);
            if (current.id() != project.getGithubRepoId()) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "This repository has changed on GitHub. Refresh the project before deleting it");
            }
            oauthClient.deleteRepository(project.getOwner(), project.getName(), token);
            projectRepository.delete(project);
            Github.LOG.info("Player {} deleted GitHub repository {}", playerId, project.getFullName());
        }

        @Transactional
        public void remove(UUID playerId, UUID projectId) {
            projectRepository.findByIdAndPlayerId(projectId, playerId).ifPresent(project -> {
                projectRepository.delete(project);
                Github.LOG.info("Player {} removed repository {} from workspace", playerId, project.getFullName());
            });
        }

        /**
         * Opens the player's GitHub credential for the single call that needs it.
         *
         * <p>Renewal is deliberately not attempted here: the connection feature owns that token and
         * is the only writer of it. This feature reads, and when what it reads is unusable it says
         * so — the player repairs the link on the account screen with one click.
         */
        private String accessToken(UUID playerId) {
            LinkedAccount account = linkedAccountRepository.findByPlayerId(playerId)
                    .orElseThrow(Github.GithubException::reauthorize);
            OffsetDateTime expiresAt = account.getAccessTokenExpiresAt();
            if (expiresAt != null && !expiresAt.isAfter(OffsetDateTime.now(clock))) {
                throw Github.GithubException.reauthorize();
            }
            return secretBox.decrypt(account.getAccessToken());
        }

        private static ProjectPayload toPayload(Project project) {
            return new ProjectPayload(project.getId(), project.getGithubRepoId(), project.getOwner(),
                    project.getName(), project.getFullName(), project.getDescription(),
                    project.isPrivateRepository(), project.getDefaultBranch(), project.getHtmlUrl(),
                    project.getLanguage(), project.getStars(), project.isWebApplication(),
                    project.getDevelopmentDeploymentReadyAt() != null, project.getAddedAt());
        }
    }

    // --- persistence ---

    /**
     * A repository brought into a workspace, held by reference.
     *
     * <p>Every column here is metadata a list needs to render. Nothing in this table, now or later,
     * holds repository content: no source, no tree, no archive. Growing it in that direction would
     * turn a cheap index of links into a mirror of GitHub, which this application deliberately is
     * not.
     */
    @Getter
    @Setter
    @NoArgsConstructor
    @Entity(name = "Project")
    @Table(name = "projects")
    public static class Project extends Db.Auditable {

        @Id
        @GeneratedValue
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, updatable = false)
        private UUID playerId;

        /** GitHub's numeric id, not the name: a repository can be renamed or moved, this cannot. */
        @Column(name = "github_repo_id", nullable = false, updatable = false)
        private long githubRepoId;

        @Column(name = "owner", nullable = false, length = 128)
        private String owner;

        @Column(name = "name", nullable = false, length = 128)
        private String name;

        @Column(name = "full_name", nullable = false, length = 255)
        private String fullName;

        @Column(name = "description", length = 1024)
        private String description;

        @Column(name = "is_private", nullable = false)
        private boolean privateRepository;

        @Column(name = "default_branch", length = 128)
        private String defaultBranch;

        @Column(name = "html_url", length = 512)
        private String htmlUrl;

        @Column(name = "language", length = 64)
        private String language;

        @Column(name = "stars", nullable = false)
        private int stars;

        /** The player's answer, not GitHub's: gates deploy and preview for this project's sessions. */
        @Column(name = "is_web_application", nullable = false)
        private boolean webApplication;

        /** Platform-owned: when a development deployment setup first passed its test; NULL before. */
        @Column(name = "development_deployment_ready_at")
        private OffsetDateTime developmentDeploymentReadyAt;

        /** When the player added it here — unrelated to when the repository was created on GitHub. */
        @Column(name = "added_at", nullable = false, updatable = false)
        private OffsetDateTime addedAt;
    }

    public interface ProjectRepository extends JpaRepository<Project, UUID> {

        List<Project> findByPlayerIdOrderByAddedAtDesc(UUID playerId);

        /** The duplicate check, on GitHub's id so a rename upstream cannot create a second row. */
        Optional<Project> findByPlayerIdAndGithubRepoId(UUID playerId, long githubRepoId);

        /** Scoped by player on purpose: an id alone must never be enough to reach somebody's row. */
        Optional<Project> findByIdAndPlayerId(UUID projectId, UUID playerId);
    }

    /**
     * A read-only view of the connection table owned by {@code GithubConnectionFeature}.
     *
     * <p>The duplication is deliberate, and it is the architecture's trade: a feature may not import
     * another feature, so the alternative to these four columns would be a shared aspect holding
     * business logic that belongs to the connection. Mapping the table twice is the smaller cost,
     * and {@code @Immutable} makes the asymmetry structural rather than a convention — this side can
     * only ever read, and renewal stays where the connection lives.
     */
    @Getter
    @Immutable
    @NoArgsConstructor
    @Entity(name = "ProjectGithubConnection")
    @Table(name = "github_connections")
    public static class LinkedAccount {

        @Id
        @Column(name = "id", nullable = false, updatable = false)
        private UUID id;

        @Column(name = "player_id", nullable = false, updatable = false)
        private UUID playerId;

        /** AES-256-GCM ciphertext; the plaintext exists only inside the request that needs it. */
        @Column(name = "access_token", nullable = false, length = 1024)
        private String accessToken;

        /** NULL means the token does not expire, so a null is fresh rather than stale. */
        @Column(name = "access_token_expires_at")
        private OffsetDateTime accessTokenExpiresAt;
    }

    public interface LinkedAccountRepository extends JpaRepository<LinkedAccount, UUID> {

        Optional<LinkedAccount> findByPlayerId(UUID playerId);
    }

    // --- contracts ---

    /**
     * The only thing the client decides. The pattern is GitHub's own name grammar, so a malformed
     * value is refused before any call leaves the application.
     */
    public record AddProjectRequest(
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$",
                    message = "must be a GitHub repository name like owner/repository")
            String fullName,
            /** Required rather than defaulted: the answer must be the player's, never assumed. */
            @NotNull Boolean webApplication) {
    }

    public record CreateProjectRequest(
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9._-]{1,100}$", message = "must be a valid GitHub repository name")
            String name,
            @NotNull Boolean isPrivate,
            /** Required like on import: whether deploy and preview apply is the player's answer. */
            @NotNull Boolean webApplication) {
    }

    public record UpdateProjectRequest(@NotNull Boolean webApplication) {
    }

    /** Repository metadata only — the same reference-not-copy rule the table is built on. */
    public record ProjectPayload(UUID id, long githubRepoId, String owner, String name, String fullName,
                                 String description, boolean isPrivate, String defaultBranch,
                                 String htmlUrl, String language, int stars, boolean webApplication,
                                 boolean developmentDeploymentReady, OffsetDateTime addedAt) {
    }

    public record ProjectsResponse(List<ProjectPayload> projects) {
    }
}

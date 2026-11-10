package dev.mooi.mic.features;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.server.ResponseStatusException;

import dev.mooi.mic.shared.Auth;
import dev.mooi.mic.shared.Crypto;
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
import lombok.Setter;

/** Durable, project-scoped record of each production deployment attempt; the chat that prepared it is optional. */
@RestController
@RequiredArgsConstructor
public class ProductionDeploymentFeature {
    private final DeploymentService service;

    @GetMapping("/me/production/deployments")
    @Auth.Authenticated
    public DeploymentPage list(@RequestParam(defaultValue = "0") int page, Auth.Principal principal) {
        return service.list(principal.player().id(), page);
    }

    @GetMapping("/me/projects/{projectId}/production/deployments")
    @Auth.Authenticated
    public DeploymentPage listProject(@PathVariable UUID projectId, @RequestParam(defaultValue = "0") int page,
                                      Auth.Principal principal) {
        return service.listProject(projectId, principal.player().id(), page);
    }

    @GetMapping("/me/projects/{projectId}/production/deployments/{operationId}")
    @Auth.Authenticated
    public DeploymentDetail detail(@PathVariable UUID projectId, @PathVariable UUID operationId,
                                   Auth.Principal principal) {
        return service.detail(projectId, principal.player().id(), operationId);
    }

    @DeleteMapping("/me/projects/{projectId}/production/deployments/{operationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Auth.Authenticated
    public void delete(@PathVariable UUID projectId, @PathVariable UUID operationId,
                       Auth.Principal principal) {
        service.delete(projectId, principal.player().id(), operationId);
    }

    @PostMapping("/me/projects/{projectId}/production/deployments")
    @Auth.Authenticated
    @Auth.ServiceCall
    public DeploymentPayload start(@PathVariable UUID projectId, @Valid @RequestBody StartDeployment body,
                                   Auth.Principal principal) {
        return service.start(projectId, principal.player().id(), body);
    }

    /** Service-only: a deployment may outlive the access token of the player who started it. */
    @PutMapping("/internal/projects/{projectId}/production/deployments/{operationId}")
    @Auth.ServiceOnly
    public DeploymentPayload finish(@PathVariable UUID projectId, @PathVariable UUID operationId,
                                    @Valid @RequestBody FinishDeployment body) {
        return service.finish(projectId, operationId, body);
    }

    /** The runner names the deployments it still runs; every other unfinished one was orphaned by a restart. */
    @PostMapping("/internal/production/deployments/reconcile")
    @Auth.ServiceOnly
    public Reconciled reconcile(@Valid @RequestBody ReconcileDeployments body) {
        return new Reconciled(service.interruptOrphans(Set.copyOf(body.active())));
    }

    public record DeploymentFiles(@NotBlank @Size(max = 65536) String manifest,
                                  @NotBlank @Size(max = 65536) String script,
                                  @Size(max = 65536) String statusScript) { }
    public record StartDeployment(UUID operationId, UUID sessionId, @NotBlank @Size(max = 255) String releaseTag,
                                  @Valid DeploymentFiles files) { }
    public record FinishDeployment(@NotBlank String state, @Size(max = 2000) String message,
                                   @Size(max = 2000) List<String> logs) { }
    public record DeploymentPayload(UUID operationId, UUID projectId, UUID sessionId, String releaseTag,
                                    String state, Instant startedAt, Instant finishedAt) { }
    public record ReconcileDeployments(@NotNull @Size(max = 1000) List<@NotNull UUID> active) { }
    public record Reconciled(int interrupted) { }
    public record DeploymentPage(List<DeploymentPayload> deployments, boolean hasMore) { }
    public record DeploymentDetail(DeploymentPayload deployment, DeploymentFiles files,
                                   String message, List<String> logs) { }

    @Service
    @RequiredArgsConstructor
    public static class DeploymentService {
        /** A run this recent may still be starting while the runner names its active ones: the next sweep sees it. */
        private static final Duration SETTLING = Duration.ofMinutes(1);
        private static final String INTERRUPTED = "Production deployment interrupted: its runner stopped before it finished";

        private final DeploymentRepository deployments;
        private final DeploymentFilesRepository files;
        private final ProjectRepository projects;
        private final Crypto.SecretBox box;

        private void requireProject(UUID projectId, UUID playerId) {
            if (!projects.existsByIdAndPlayerId(projectId, playerId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
            }
        }

        @Transactional(readOnly = true)
        public DeploymentPage list(UUID playerId, int page) {
            if (page < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid page");
            var rows = deployments.findByPlayerIdOrderByStartedAtDesc(playerId, PageRequest.of(page, 30));
            return new DeploymentPage(rows.stream().map(this::payload).toList(), rows.hasNext());
        }

        @Transactional(readOnly = true)
        public DeploymentPage listProject(UUID projectId, UUID playerId, int page) {
            requireProject(projectId, playerId);
            if (page < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid page");
            var rows = deployments.findByProjectIdAndPlayerIdOrderByStartedAtDesc(projectId, playerId, PageRequest.of(page, 30));
            return new DeploymentPage(rows.stream().map(this::payload).toList(), rows.hasNext());
        }

        @Transactional(readOnly = true)
        public DeploymentDetail detail(UUID projectId, UUID playerId, UUID operationId) {
            requireProject(projectId, playerId);
            var row = deployments.findById(operationId).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found"));
            if (!row.getPlayerId().equals(playerId) || !row.getProjectId().equals(projectId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found");
            }
            var saved = files.findById(operationId).orElse(null);
            if (saved == null) return new DeploymentDetail(payload(row), null, null, List.of());
            var snapshot = new DeploymentFiles(
                    box.decrypt(saved.getManifest()), box.decrypt(saved.getScript()),
                    saved.getStatusScript() == null ? null : box.decrypt(saved.getStatusScript()));
            var output = saved.getResultLogs() == null ? List.<String>of()
                    : List.of(box.decrypt(saved.getResultLogs()).split("\n", -1));
            return new DeploymentDetail(payload(row), snapshot,
                    saved.getResultMessage() == null ? null : box.decrypt(saved.getResultMessage()), output);
        }

        @Transactional
        public void delete(UUID projectId, UUID playerId, UUID operationId) {
            requireProject(projectId, playerId);
            var row = deployments.findById(operationId).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found"));
            if (!row.getPlayerId().equals(playerId) || !row.getProjectId().equals(projectId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found");
            }
            if (row.getFinishedAt() == null) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Wait for the deployment to finish before deleting its data");
            }
            files.findById(operationId).ifPresent(files::delete);
            deployments.delete(row);
        }

        @Transactional
        public DeploymentPayload start(UUID projectId, UUID playerId, StartDeployment input) {
            requireProject(projectId, playerId);
            if (input.operationId() == null || input.files() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Operation and files are required");
            }
            var existing = deployments.findById(input.operationId());
            if (existing.isPresent()) {
                var row = existing.get();
                if (!row.getPlayerId().equals(playerId) || !row.getProjectId().equals(projectId)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found");
                }
                return payload(row);
            }
            var row = new Deployment();
            row.setOperationId(input.operationId());
            row.setPlayerId(playerId);
            row.setProjectId(projectId);
            row.setSessionId(input.sessionId());
            row.setReleaseTag(input.releaseTag());
            row.setState("running");
            row.setStartedAt(Instant.now());
            deployments.save(row);
            var snapshot = new DeploymentFileSnapshot();
            snapshot.setOperationId(input.operationId());
            snapshot.setManifest(box.encrypt(input.files().manifest()));
            snapshot.setScript(box.encrypt(input.files().script()));
            snapshot.setStatusScript(input.files().statusScript() == null ? null : box.encrypt(input.files().statusScript()));
            files.save(snapshot);
            return payload(row);
        }

        @Transactional
        public DeploymentPayload finish(UUID projectId, UUID operationId, FinishDeployment input) {
            if (!input.state().equals("succeeded") && !input.state().equals("failed")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid deployment state");
            }
            var row = deployments.findById(operationId).filter(found -> found.getProjectId().equals(projectId))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found"));
            conclude(row, input.state(), input.message(), input.logs());
            return payload(row);
        }

        /** Fails every unfinished deployment outside `active`; answers how many it failed. */
        @Transactional
        public int interruptOrphans(Set<UUID> active) {
            var orphans = deployments.findByFinishedAtIsNullAndStartedAtBefore(Instant.now().minus(SETTLING))
                    .stream().filter(row -> !active.contains(row.getOperationId())).toList();
            orphans.forEach(row -> conclude(row, "failed", INTERRUPTED, null));
            return orphans.size();
        }

        /** The first outcome wins: a later finish or reconcile never rewrites a concluded deployment. */
        private void conclude(Deployment row, String state, String message, List<String> logs) {
            if (row.getFinishedAt() != null) return;
            row.setState(state);
            row.setFinishedAt(Instant.now());
            files.findById(row.getOperationId()).ifPresent(saved -> {
                saved.setResultMessage(message == null ? null : box.encrypt(message));
                saved.setResultLogs(logs == null || logs.isEmpty() ? null : box.encrypt(String.join("\n", logs)));
            });
        }

        private DeploymentPayload payload(Deployment row) {
            return new DeploymentPayload(row.getOperationId(), row.getProjectId(), row.getSessionId(),
                    row.getReleaseTag(), row.getState(), row.getStartedAt(), row.getFinishedAt());
        }
    }

    @Getter @Setter @NoArgsConstructor
    @Entity(name = "ProductionDeployment")
    @Table(name = "production_deployments")
    public static class Deployment {
        @Id @Column(name = "operation_id") private UUID operationId;
        @Column(name = "player_id", nullable = false) private UUID playerId;
        @Column(name = "project_id", nullable = false) private UUID projectId;
        @Column(name = "session_id") private UUID sessionId;
        @Column(name = "release_tag", nullable = false) private String releaseTag;
        @Column(name = "state", nullable = false) private String state;
        @Column(name = "started_at", nullable = false) private Instant startedAt;
        @Column(name = "finished_at") private Instant finishedAt;
    }

    @Getter @Setter @NoArgsConstructor
    @Entity(name = "ProductionDeploymentFiles")
    @Table(name = "production_deployment_files")
    public static class DeploymentFileSnapshot {
        @Id @Column(name = "operation_id") private UUID operationId;
        @Column(name = "manifest", nullable = false, columnDefinition = "text") private String manifest;
        @Column(name = "script", nullable = false, columnDefinition = "text") private String script;
        @Column(name = "status_script", columnDefinition = "text") private String statusScript;
        @Column(name = "result_message", columnDefinition = "text") private String resultMessage;
        @Column(name = "result_logs", columnDefinition = "text") private String resultLogs;
    }

    @Getter @NoArgsConstructor
    @Entity(name = "ProductionDeploymentProject")
    @Table(name = "projects")
    public static class ProjectReference {
        @Id @Column(name = "id") private UUID id;
        @Column(name = "player_id") private UUID playerId;
    }

    public interface DeploymentRepository extends JpaRepository<Deployment, UUID> {
        Page<Deployment> findByPlayerIdOrderByStartedAtDesc(UUID playerId, Pageable pageable);
        Page<Deployment> findByProjectIdAndPlayerIdOrderByStartedAtDesc(UUID projectId, UUID playerId, Pageable pageable);
        List<Deployment> findByFinishedAtIsNullAndStartedAtBefore(Instant cutoff);
    }
    public interface DeploymentFilesRepository extends JpaRepository<DeploymentFileSnapshot, UUID> { }
    public interface ProjectRepository extends JpaRepository<ProjectReference, UUID> {
        boolean existsByIdAndPlayerId(UUID id, UUID playerId);
    }
}

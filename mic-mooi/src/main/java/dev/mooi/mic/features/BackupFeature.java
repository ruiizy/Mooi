package dev.mooi.mic.features;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
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

/**
 * Durable, project-scoped record of every backup and of each operation run on it: the backup itself,
 * restores (into a disposable verification instance or into production) and its deletion. Each
 * operation keeps the exact script it ran and its redacted output; the backup data lives wherever
 * the project's backup.sh stores it.
 */
@RestController
@RequiredArgsConstructor
public class BackupFeature {
    private final BackupService service;

    @GetMapping("/me/backups")
    @Auth.Authenticated
    public BackupPage list(@RequestParam(defaultValue = "0") int page, Auth.Principal principal) {
        return service.list(principal.player().id(), page);
    }

    @GetMapping("/me/projects/{projectId}/backups")
    @Auth.Authenticated
    public BackupPage listProject(@PathVariable UUID projectId, @RequestParam(defaultValue = "0") int page,
                                  Auth.Principal principal) {
        return service.listProject(projectId, principal.player().id(), page);
    }

    @GetMapping("/me/projects/{projectId}/backups/{backupId}")
    @Auth.Authenticated
    public BackupDetail detail(@PathVariable UUID projectId, @PathVariable UUID backupId, Auth.Principal principal) {
        return service.detail(projectId, principal.player().id(), backupId);
    }

    @PostMapping("/me/projects/{projectId}/backups")
    @Auth.Authenticated
    @Auth.ServiceCall
    public BackupPayload start(@PathVariable UUID projectId, @Valid @RequestBody StartBackup body,
                               Auth.Principal principal) {
        return service.start(projectId, principal.player().id(), body);
    }

    @PostMapping("/me/projects/{projectId}/backups/{backupId}/operations")
    @Auth.Authenticated
    @Auth.ServiceCall
    public OperationPayload startOperation(@PathVariable UUID projectId, @PathVariable UUID backupId,
                                           @Valid @RequestBody StartOperation body, Auth.Principal principal) {
        return service.startOperation(projectId, principal.player().id(), backupId, body);
    }

    /** Service-only: an operation may outlive the access token of the player who started it. */
    @PutMapping("/internal/projects/{projectId}/backups/{backupId}/operations/{operationId}")
    @Auth.ServiceOnly
    public OperationPayload finishOperation(@PathVariable UUID projectId, @PathVariable UUID backupId,
                                            @PathVariable UUID operationId, @Valid @RequestBody FinishOperation body) {
        return service.finishOperation(projectId, backupId, operationId, body);
    }

    /** The runner names the operations it still runs; every other unfinished one was orphaned by a restart. */
    @PostMapping("/internal/backups/operations/reconcile")
    @Auth.ServiceOnly
    public Reconciled reconcile(@Valid @RequestBody ReconcileOperations body) {
        return new Reconciled(service.interruptOrphans(Set.copyOf(body.active())));
    }

    /** Forgets the backup without running delete.sh: its stored data, if any, stays where it is. */
    @DeleteMapping("/me/projects/{projectId}/backups/{backupId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Auth.Authenticated
    @Auth.ServiceCall
    public void delete(@PathVariable UUID projectId, @PathVariable UUID backupId, Auth.Principal principal) {
        service.delete(projectId, principal.player().id(), backupId);
    }

    /** `startedAt` names the stored backup, so it is chosen by the runner and kept to the second. */
    public record StartBackup(@NotNull UUID backupId, @NotNull UUID operationId, UUID sessionId,
                              @NotBlank @Size(max = 255) String releaseTag, @NotNull Instant startedAt,
                              @NotBlank @Size(max = 65536) String script) { }
    public record StartOperation(@NotNull UUID operationId, @NotBlank String action, String target,
                                 @NotBlank @Size(max = 65536) String script) { }
    public record FinishOperation(@NotBlank String state, @Size(max = 2000) String message,
                                  @Size(max = 2000) List<String> logs) { }
    public record ReconcileOperations(@NotNull @Size(max = 1000) List<@NotNull UUID> active) { }
    public record Reconciled(int interrupted) { }
    public record BackupPayload(UUID id, UUID projectId, UUID sessionId, String releaseTag, String state,
                                Instant startedAt, Instant finishedAt, Instant verifiedAt, Instant restoredAt) { }
    public record OperationPayload(UUID operationId, UUID backupId, String action, String target, String state,
                                   Instant startedAt, Instant finishedAt) { }
    public record OperationDetail(OperationPayload operation, String script, String message, List<String> logs) { }
    public record BackupPage(List<BackupPayload> backups, boolean hasMore) { }
    public record BackupDetail(BackupPayload backup, List<OperationDetail> operations) { }

    @Service
    @RequiredArgsConstructor
    public static class BackupService {
        private static final Set<String> ACTIONS = Set.of("restore", "delete");
        private static final Set<String> TARGETS = Set.of("production", "verification");
        private static final Set<String> OUTCOMES = Set.of("succeeded", "failed");
        /** A run this recent may still be starting while the runner names its active ones: the next sweep sees it. */
        private static final Duration SETTLING = Duration.ofMinutes(1);
        private static final String INTERRUPTED = "Backup operation interrupted: its runner stopped before it finished";

        private final BackupRepository backups;
        private final OperationRepository operations;
        private final ProjectRepository projects;
        private final Crypto.SecretBox box;

        private void requireProject(UUID projectId, UUID playerId) {
            if (!projects.existsByIdAndPlayerId(projectId, playerId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
            }
        }

        private Backup owned(UUID projectId, UUID playerId, UUID backupId) {
            requireProject(projectId, playerId);
            var row = backups.findById(backupId).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "Backup not found"));
            if (!row.getPlayerId().equals(playerId) || !row.getProjectId().equals(projectId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Backup not found");
            }
            return row;
        }

        @Transactional(readOnly = true)
        public BackupPage list(UUID playerId, int page) {
            if (page < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid page");
            var rows = backups.findByPlayerIdOrderByStartedAtDesc(playerId, PageRequest.of(page, 30));
            return new BackupPage(rows.stream().map(this::payload).toList(), rows.hasNext());
        }

        @Transactional(readOnly = true)
        public BackupPage listProject(UUID projectId, UUID playerId, int page) {
            requireProject(projectId, playerId);
            if (page < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid page");
            var rows = backups.findByProjectIdAndPlayerIdOrderByStartedAtDesc(projectId, playerId, PageRequest.of(page, 30));
            return new BackupPage(rows.stream().map(this::payload).toList(), rows.hasNext());
        }

        @Transactional(readOnly = true)
        public BackupDetail detail(UUID projectId, UUID playerId, UUID backupId) {
            var row = owned(projectId, playerId, backupId);
            var history = operations.findByBackupIdOrderByStartedAtDesc(backupId).stream()
                    .map(operation -> new OperationDetail(operationPayload(operation), box.decrypt(operation.getScript()),
                            operation.getResultMessage() == null ? null : box.decrypt(operation.getResultMessage()),
                            operation.getResultLogs() == null ? List.of()
                                    : List.of(box.decrypt(operation.getResultLogs()).split("\n", -1))))
                    .toList();
            return new BackupDetail(payload(row), history);
        }

        @Transactional
        public BackupPayload start(UUID projectId, UUID playerId, StartBackup input) {
            requireProject(projectId, playerId);
            var existing = backups.findById(input.backupId());
            if (existing.isPresent()) return payload(owned(projectId, playerId, input.backupId()));
            var now = input.startedAt().truncatedTo(ChronoUnit.SECONDS);
            var row = new Backup();
            row.setId(input.backupId());
            row.setPlayerId(playerId);
            row.setProjectId(projectId);
            row.setSessionId(input.sessionId());
            row.setReleaseTag(input.releaseTag());
            row.setState("running");
            row.setStartedAt(now);
            backups.save(row);
            operations.save(newOperation(input.operationId(), row.getId(), "backup", null, input.script(), now));
            return payload(row);
        }

        @Transactional
        public OperationPayload startOperation(UUID projectId, UUID playerId, UUID backupId, StartOperation input) {
            var backup = owned(projectId, playerId, backupId);
            if (!ACTIONS.contains(input.action())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid backup operation");
            }
            if (input.action().equals("restore") ? !TARGETS.contains(String.valueOf(input.target())) : input.target() != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid restore target");
            }
            if (input.action().equals("restore") && !backup.getState().equals("succeeded")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a successful backup can be restored");
            }
            var existing = operations.findById(input.operationId());
            if (existing.isPresent()) {
                if (!existing.get().getBackupId().equals(backupId)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Operation not found");
                }
                return operationPayload(existing.get());
            }
            return operationPayload(operations.save(newOperation(input.operationId(), backupId, input.action(),
                    input.target(), input.script(), Instant.now())));
        }

        @Transactional
        public OperationPayload finishOperation(UUID projectId, UUID backupId, UUID operationId, FinishOperation input) {
            if (!OUTCOMES.contains(input.state())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid operation state");
            }
            var backup = backups.findById(backupId).filter(row -> row.getProjectId().equals(projectId))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Backup not found"));
            var operation = operations.findById(operationId).filter(row -> row.getBackupId().equals(backupId))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Operation not found"));
            return conclude(backup, operation, input.state(), input.message(), input.logs());
        }

        /** Fails every unfinished operation outside `active`, with its backup when it was the backup run itself. */
        @Transactional
        public int interruptOrphans(Set<UUID> active) {
            var orphans = operations.findByFinishedAtIsNullAndStartedAtBefore(Instant.now().minus(SETTLING))
                    .stream().filter(row -> !active.contains(row.getOperationId())).toList();
            orphans.forEach(operation -> backups.findById(operation.getBackupId()).ifPresent(backup ->
                    conclude(backup, operation, "failed", INTERRUPTED, null)));
            return orphans.size();
        }

        /** The first outcome wins: a later finish or reconcile never rewrites a concluded operation. */
        private OperationPayload conclude(Backup backup, Operation operation, String state, String message,
                                          List<String> logs) {
            if (operation.getFinishedAt() != null) return operationPayload(operation);
            var now = Instant.now();
            operation.setState(state);
            operation.setFinishedAt(now);
            operation.setResultMessage(message == null ? null : box.encrypt(message));
            operation.setResultLogs(logs == null || logs.isEmpty() ? null : box.encrypt(String.join("\n", logs)));
            var succeeded = state.equals("succeeded");
            switch (operation.getAction()) {
                case "backup" -> {
                    backup.setState(state);
                    backup.setFinishedAt(now);
                }
                case "restore" -> {
                    if (succeeded && "production".equals(operation.getTarget())) backup.setRestoredAt(now);
                    if (succeeded && "verification".equals(operation.getTarget())) backup.setVerifiedAt(now);
                }
                case "delete" -> {
                    if (succeeded) {
                        var payload = operationPayload(operation);
                        backups.delete(backup);
                        return payload;
                    }
                }
                default -> { }
            }
            return operationPayload(operation);
        }

        @Transactional
        public void delete(UUID projectId, UUID playerId, UUID backupId) {
            backups.delete(owned(projectId, playerId, backupId));
        }

        private Operation newOperation(UUID operationId, UUID backupId, String action, String target, String script,
                                       Instant startedAt) {
            var operation = new Operation();
            operation.setOperationId(operationId);
            operation.setBackupId(backupId);
            operation.setAction(action);
            operation.setTarget(target);
            operation.setState("running");
            operation.setStartedAt(startedAt);
            operation.setScript(box.encrypt(script));
            return operation;
        }

        private BackupPayload payload(Backup row) {
            return new BackupPayload(row.getId(), row.getProjectId(), row.getSessionId(), row.getReleaseTag(),
                    row.getState(), row.getStartedAt(), row.getFinishedAt(), row.getVerifiedAt(), row.getRestoredAt());
        }

        private OperationPayload operationPayload(Operation row) {
            return new OperationPayload(row.getOperationId(), row.getBackupId(), row.getAction(), row.getTarget(),
                    row.getState(), row.getStartedAt(), row.getFinishedAt());
        }
    }

    @Getter @Setter @NoArgsConstructor
    @Entity(name = "Backup")
    @Table(name = "backups")
    public static class Backup {
        @Id @Column(name = "id") private UUID id;
        @Column(name = "player_id", nullable = false) private UUID playerId;
        @Column(name = "project_id", nullable = false) private UUID projectId;
        @Column(name = "session_id") private UUID sessionId;
        @Column(name = "release_tag", nullable = false) private String releaseTag;
        @Column(name = "state", nullable = false) private String state;
        @Column(name = "started_at", nullable = false) private Instant startedAt;
        @Column(name = "finished_at") private Instant finishedAt;
        @Column(name = "verified_at") private Instant verifiedAt;
        @Column(name = "restored_at") private Instant restoredAt;
    }

    @Getter @Setter @NoArgsConstructor
    @Entity(name = "BackupOperation")
    @Table(name = "backup_operations")
    public static class Operation {
        @Id @Column(name = "operation_id") private UUID operationId;
        @Column(name = "backup_id", nullable = false) private UUID backupId;
        @Column(name = "action", nullable = false) private String action;
        @Column(name = "target") private String target;
        @Column(name = "state", nullable = false) private String state;
        @Column(name = "started_at", nullable = false) private Instant startedAt;
        @Column(name = "finished_at") private Instant finishedAt;
        @Column(name = "script", nullable = false, columnDefinition = "text") private String script;
        @Column(name = "result_message", columnDefinition = "text") private String resultMessage;
        @Column(name = "result_logs", columnDefinition = "text") private String resultLogs;
    }

    @Getter @NoArgsConstructor
    @Entity(name = "BackupProject")
    @Table(name = "projects")
    public static class ProjectReference {
        @Id @Column(name = "id") private UUID id;
        @Column(name = "player_id") private UUID playerId;
    }

    public interface BackupRepository extends JpaRepository<Backup, UUID> {
        Page<Backup> findByPlayerIdOrderByStartedAtDesc(UUID playerId, Pageable pageable);
        Page<Backup> findByProjectIdAndPlayerIdOrderByStartedAtDesc(UUID projectId, UUID playerId, Pageable pageable);
    }
    public interface OperationRepository extends JpaRepository<Operation, UUID> {
        List<Operation> findByBackupIdOrderByStartedAtDesc(UUID backupId);
        List<Operation> findByFinishedAtIsNullAndStartedAtBefore(Instant cutoff);
    }
    public interface ProjectRepository extends JpaRepository<ProjectReference, UUID> {
        boolean existsByIdAndPlayerId(UUID id, UUID playerId);
    }
}

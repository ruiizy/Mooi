package dev.mooi.mic.features;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.jpa.repository.JpaRepository;
import org.hibernate.annotations.Immutable;
import org.springframework.http.HttpStatus;
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

import dev.mooi.mic.shared.Auth;
import dev.mooi.mic.shared.Crypto;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.Setter;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Encrypted, project-scoped deployment configuration: the DEPLOYMENT.md manifest, deploy.sh and
 * status.sh (as an active and a draft revision) plus the environment values they need. Nothing is
 * stored in Git, and environment values only ever leave this service towards mic-sessions.
 */
@RestController
@RequiredArgsConstructor
public class ProductionRecipeFeature {
    private final RecipeService service;

    @GetMapping("/me/projects/{projectId}/production/recipe")
    @Auth.Authenticated
    @Auth.ServiceCall
    public RecipePayload get(@PathVariable UUID projectId, Auth.Principal principal) {
        return service.get(projectId, principal.player().id());
    }

    @GetMapping("/me/projects/{projectId}/production/recipe/status")
    @Auth.Authenticated
    @Auth.ServiceCall
    public RecipeStatus status(@PathVariable UUID projectId, Auth.Principal principal) {
        return service.status(projectId, principal.player().id());
    }

    @PutMapping("/me/projects/{projectId}/production/recipe/draft")
    @Auth.Authenticated
    @Auth.ServiceCall
    public RecipePayload draft(@PathVariable UUID projectId, @Valid @RequestBody RecipeInput body,
                               Auth.Principal principal) {
        return service.draft(projectId, principal.player().id(), body);
    }

    /** Service-only: a draft is published once a run proves it, which may outlive the player's access token. */
    @PostMapping("/internal/projects/{projectId}/production/recipe/publish")
    @Auth.ServiceOnly
    public RecipePayload publish(@PathVariable UUID projectId) {
        return service.publish(projectId);
    }

    @DeleteMapping("/me/projects/{projectId}/production/recipe")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Auth.Authenticated
    @Auth.ServiceCall
    public void delete(@PathVariable UUID projectId, Auth.Principal principal) {
        service.delete(projectId, principal.player().id());
    }

    @GetMapping("/me/projects/{projectId}/production/recipe/environment")
    @Auth.Authenticated
    @Auth.ServiceCall
    public EnvironmentValues environment(@PathVariable UUID projectId, Auth.Principal principal) {
        return service.environment(projectId, principal.player().id());
    }

    @PutMapping("/me/projects/{projectId}/production/recipe/environment")
    @Auth.Authenticated
    @Auth.ServiceCall
    public RecipePayload updateEnvironment(@PathVariable UUID projectId, @Valid @RequestBody EnvironmentUpdate body,
                                           Auth.Principal principal) {
        return service.updateEnvironment(projectId, principal.player().id(), body);
    }

    /** A draft may be partial while the agent writes it document by document; deploying requires all three. */
    public record RecipeInput(@NotNull @Size(max = 65536) String manifest,
                              @NotNull @Size(max = 65536) String script,
                              @NotNull @Size(max = 65536) String statusScript) { }

    /** Environment names only: values are write-only for every caller except the deploy runner. */
    public record RecipePayload(RecipeInput active, RecipeInput draft, long revision, List<String> environment) { }
    public record RecipeStatus(boolean configured, boolean hasDraft, long revision) { }
    public record EnvironmentValues(Map<String, String> values) { }
    /** A null value removes that variable. */
    public record EnvironmentUpdate(@NotNull @Size(max = 100) Map<String, String> values) { }

    @Service
    @RequiredArgsConstructor
    public static class RecipeService {
        private static final Pattern NAME = Pattern.compile("MOOI_PRODUCTION_[A-Z0-9_]{1,100}");
        private static final int MAX_VARIABLES = 100;
        private static final int MAX_VALUE = 8192;

        private final RecipeRepository recipes;
        private final ProjectReferenceRepository projects;
        private final Crypto.SecretBox box;
        private final ObjectMapper json = JsonMapper.shared();

        private void requireProject(UUID projectId, UUID playerId) {
            if (!projects.existsByIdAndPlayerId(projectId, playerId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
            }
        }

        @Transactional(readOnly = true)
        public RecipePayload get(UUID projectId, UUID playerId) {
            requireProject(projectId, playerId);
            return recipes.findById(projectId).map(this::payload).orElse(new RecipePayload(null, null, 0, List.of()));
        }

        @Transactional(readOnly = true)
        public RecipeStatus status(UUID projectId, UUID playerId) {
            requireProject(projectId, playerId);
            return recipes.findById(projectId)
                    .map(row -> new RecipeStatus(row.getActiveScript() != null || row.getDraftScript() != null,
                                                 row.getDraftScript() != null, row.getRevision()))
                    .orElse(new RecipeStatus(false, false, 0));
        }

        @Transactional
        public RecipePayload draft(UUID projectId, UUID playerId, RecipeInput input) {
            requireProject(projectId, playerId);
            if (input.manifest().isBlank() && input.script().isBlank() && input.statusScript().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A draft needs at least one document");
            }
            Recipe row = findOrCreate(projectId);
            row.setDraftManifest(box.encrypt(input.manifest()));
            row.setDraftScript(box.encrypt(input.script()));
            row.setDraftStatusScript(box.encrypt(input.statusScript()));
            row.setRevision(row.getRevision() + 1);
            return payload(recipes.save(row));
        }

        @Transactional
        public RecipePayload publish(UUID projectId) {
            Recipe row = recipes.findById(projectId).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.CONFLICT, "No deployment configuration exists"));
            if (row.getDraftScript() == null) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "No draft deployment configuration exists");
            }
            row.setActiveManifest(row.getDraftManifest());
            row.setActiveScript(row.getDraftScript());
            row.setActiveStatusScript(row.getDraftStatusScript());
            row.setDraftManifest(null);
            row.setDraftScript(null);
            row.setDraftStatusScript(null);
            row.setRevision(row.getRevision() + 1);
            return payload(row);
        }

        @Transactional
        public void delete(UUID projectId, UUID playerId) {
            requireProject(projectId, playerId);
            recipes.findById(projectId).ifPresent(recipes::delete);
        }

        @Transactional(readOnly = true)
        public EnvironmentValues environment(UUID projectId, UUID playerId) {
            requireProject(projectId, playerId);
            return new EnvironmentValues(recipes.findById(projectId).map(this::values).orElse(Map.of()));
        }

        @Transactional
        public RecipePayload updateEnvironment(UUID projectId, UUID playerId, EnvironmentUpdate update) {
            requireProject(projectId, playerId);
            Recipe row = findOrCreate(projectId);
            Map<String, String> values = new TreeMap<>(values(row));
            update.values().forEach((name, value) -> {
                if (!NAME.matcher(name).matches()) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Environment names must use the MOOI_PRODUCTION_ prefix and uppercase letters, digits or underscores");
                }
                if (value == null) {
                    values.remove(name);
                } else if (value.length() > MAX_VALUE) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Environment values cannot exceed 8 KB");
                } else {
                    values.put(name, value);
                }
            });
            if (values.size() > MAX_VARIABLES) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A project can store at most 100 variables");
            }
            row.setEnvironment(values.isEmpty() ? null : box.encrypt(json.writeValueAsString(values)));
            return payload(recipes.save(row));
        }

        private Recipe findOrCreate(UUID projectId) {
            return recipes.findById(projectId).orElseGet(() -> {
                Recipe created = new Recipe();
                created.setProjectId(projectId);
                return created;
            });
        }

        private Map<String, String> values(Recipe row) {
            if (row.getEnvironment() == null) return Map.of();
            return json.readValue(box.decrypt(row.getEnvironment()), new TypeReference<TreeMap<String, String>>() { });
        }

        private RecipePayload payload(Recipe row) {
            return new RecipePayload(
                    unpack(row.getActiveManifest(), row.getActiveScript(), row.getActiveStatusScript()),
                    unpack(row.getDraftManifest(), row.getDraftScript(), row.getDraftStatusScript()),
                    row.getRevision(), List.copyOf(values(row).keySet()));
        }

        private RecipeInput unpack(String manifest, String script, String statusScript) {
            return script == null ? null : new RecipeInput(box.decrypt(manifest), box.decrypt(script),
                    statusScript == null ? "" : box.decrypt(statusScript));
        }
    }

    @Getter @Setter @NoArgsConstructor
    @Entity(name = "ProductionRecipe")
    @Table(name = "production_recipes")
    public static class Recipe {
        @Id @Column(name = "project_id") private UUID projectId;
        @Column(name = "active_manifest", columnDefinition = "text") private String activeManifest;
        @Column(name = "active_script", columnDefinition = "text") private String activeScript;
        @Column(name = "active_status_script", columnDefinition = "text") private String activeStatusScript;
        @Column(name = "draft_manifest", columnDefinition = "text") private String draftManifest;
        @Column(name = "draft_script", columnDefinition = "text") private String draftScript;
        @Column(name = "draft_status_script", columnDefinition = "text") private String draftStatusScript;
        @Column(name = "environment", columnDefinition = "text") private String environment;
        @Column(name = "revision", nullable = false) private long revision;
    }

    @Getter @Immutable @NoArgsConstructor
    @Entity(name = "ProductionRecipeProject")
    @Table(name = "projects")
    public static class ProjectReference {
        @Id @Column(name = "id") private UUID id;
        @Column(name = "player_id") private UUID playerId;
    }

    public interface RecipeRepository extends JpaRepository<Recipe, UUID> { }
    public interface ProjectReferenceRepository extends JpaRepository<ProjectReference, UUID> {
        boolean existsByIdAndPlayerId(UUID id, UUID playerId);
    }
}

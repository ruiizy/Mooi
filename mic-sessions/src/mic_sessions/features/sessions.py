"""Feature: agent sessions.

The whole feature — wire contracts, in-memory registry, orchestration and REST/SSE endpoints —
lives in this single file (project architecture rule): it may only import transversal aspects from
`shared/`.

A session pairs one player, one project and one agent provider with a managed workspace: `Session` is the
in-memory record of that pairing, `SessionRegistry` is the process-wide table of live sessions
(there is no database), and `record` is the one fold that turns events into session state — every
endpoint below goes through it and nothing else assigns a session's status.

Every chat owns a Git clone: a session on its own branch, a production chat on the default branch,
whose repository changes reach GitHub only through the platform once the user approves them. Production
deployments themselves are project-scoped (see the production section): they run without a chat and
fetch only the selected release into a temporary checkout.

Sessions and their event logs are memory-resident. After an ungraceful restart they cannot be
resumed; marked on-disk session directories are reconciled at startup. `start_reaper()` closes idle sessions and `close_all()` closes sessions during a
graceful shutdown; `main.py`'s lifespan owns calling both.
"""

from __future__ import annotations

import asyncio
import difflib
import hmac
import json
import logging
import os
import re
import secrets
import signal
import tempfile
import time
from collections.abc import AsyncIterator, Callable, Coroutine, Iterable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4
from urllib.parse import quote

import httpx

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from mic_sessions.shared import images, mooi, previews, workspaces
from mic_sessions.shared.agents import (
    PROVIDERS,
    RECOVERABLE_DETAIL,
    STATUS_COMPACTING,
    STATUS_FAILED,
    STATUS_PROVISIONING,
    STATUS_READY,
    STATUS_WAITING,
    STATUS_WORKING,
    AgentConfig,
    AgentEvent,
    AgentRuntime,
    Ask,
    Emit,
    PermissionRequest,
    QuestionRequest,
    changes_updated,
    create_runtime,
    describe,
    message_user,
    session_configuration,
    session_status,
)
from mic_sessions.shared.auth import Caller, current_caller
from mic_sessions.shared.docker import (
    Docker,
    DockerError,
    DockerManifestError,
    DockerManifests,
    DockerPortRequest,
    redact_deployment_output,
    root_compose_file,
)
from mic_sessions.shared.env import backup_environment, development_environment, get_settings, production_environment
from mic_sessions.shared.events import Event, EventLog, sse_frame, sse_heartbeat
from mic_sessions.shared.scripts import run_script
from mic_sessions.shared.web import ApiException

LOG = logging.getLogger("sessions")

_BRANCH_PATTERN = r"^[A-Za-z0-9._\-/]{1,120}$"
_UNSET_PATH = Path()
_LAST_EVENT_ID_HEADER = "Last-Event-ID"

PENDING_KIND_PERMISSION = "permission"
PENDING_KIND_QUESTION = "question"

# Event types the fold below reacts to; deployment updates are independent of chat turns.
EVENT_SESSION_STATUS = "session.status"
EVENT_PERMISSION_REQUEST = "permission.request"
EVENT_QUESTION_REQUEST = "question.request"
EVENT_PERMISSION_RESOLVED = "permission.resolved"
EVENT_QUESTION_RESOLVED = "question.resolved"
EVENT_TURN_RESULT = "turn.result"
EVENT_TOOL_USE = "tool.use"
EVENT_TOOL_RESULT = "tool.result"
EVENT_SESSION_CONFIGURATION = "session.configuration"
EVENT_DEPLOYMENT_UPDATED = "deployment.updated"
EVENT_DEPLOYMENT_LOG = "deployment.log"
EVENT_DEPLOYMENT_SETUP = "deployment.setup"
EVENT_DEPLOYMENT_CONFIGURED = "deployment.configured"
EVENT_PRODUCTION_UPDATED = "production.updated"
EVENT_SESSION_CLEARED = "session.cleared"
EVENT_SESSION_COMPACTION = "session.compaction"
EVENT_MERGE_COMPLETED = "merge.completed"

# --- wire contracts ---------------------------------------------------------------------------


DeploymentState = Literal["stopped", "starting", "running", "stopping", "failed"]
DeploymentAction = Literal["start", "stop"]
# Deploy asked the agent to set the deployment up in the chat; it stays "preparing" until its test runs.
DeploymentSetup = Literal["preparing", "tested"]
DeploymentErrorCode = Literal[
    "unsupported_project", "docker_unavailable", "invalid_compose",
    "startup_failed", "health_check_failed", "timeout", "cancelled", "cleanup_failed",
]
_PREVIEW_PATH = re.compile(r"/preview/[a-z2-7]{32}/")


class DeploymentContract(BaseModel):
    """Strict, immutable deployment contracts; nullable fields remain present on the wire."""

    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)


class DeploymentReason(DeploymentContract):
    code: DeploymentErrorCode
    # Callers must supply a public, redacted message, never raw SDK/subprocess output.
    message: str = Field(min_length=1, max_length=1000, pattern=r"\S")


def _validate_preview_url(value: str | None) -> None:
    # A path of whatever host serves Mooi; ownership and inspected port are verified by orchestration.
    if value is not None and not _PREVIEW_PATH.fullmatch(value):
        raise ValueError("Preview URL must be the path /preview/<id>/")


class DeploymentResult(DeploymentContract):
    schemaVersion: Literal[1]
    operationId: UUID
    action: DeploymentAction
    success: bool
    state: Literal["running", "stopped", "failed"]
    reason: DeploymentReason | None
    previewUrl: str | None
    cleanupRequired: bool

    @model_validator(mode="after")
    def validate_outcome(self) -> DeploymentResult:
        _validate_preview_url(self.previewUrl)
        if self.success:
            expected = "running" if self.action == "start" else "stopped"
            if self.state != expected or self.reason is not None or self.cleanupRequired:
                raise ValueError("Successful deployment result must match its action and need no cleanup")
            if (self.previewUrl is not None) != (self.state == "running"):
                raise ValueError("Only a running result must contain a preview URL")
        elif self.state != "failed" or self.reason is None or self.previewUrl is not None:
            raise ValueError("Failed deployment result must include a reason and no preview URL")
        return self


class DeploymentSnapshot(DeploymentContract):
    state: DeploymentState
    operationId: UUID | None
    phase: str | None = Field(max_length=120, pattern=r"\S")
    previewUrl: str | None
    result: DeploymentResult | None
    cleanupRequired: bool
    updatedAt: AwareDatetime

    @model_validator(mode="after")
    def validate_state(self) -> DeploymentSnapshot:
        _validate_preview_url(self.previewUrl)
        if (self.previewUrl is not None) != (self.state == "running"):
            raise ValueError("Only a running snapshot must contain a preview URL")
        if self.state != "stopped" and self.operationId is None:
            raise ValueError("An active or failed deployment must identify its operation")
        if self.cleanupRequired and self.state not in ("failed", "stopping"):
            raise ValueError("Cleanup is only pending for a failed or stopping deployment")
        if self.state in ("starting", "stopping"):
            if self.result is not None:
                raise ValueError("An operation in progress cannot have a final result")
        elif self.result is None and (self.state != "stopped" or self.operationId is not None):
            raise ValueError("A completed operation must contain its final result")
        if self.result is not None and (
            self.result.operationId != self.operationId
            or self.result.state != self.state
            or self.result.previewUrl != self.previewUrl
            or self.result.cleanupRequired != self.cleanupRequired
        ):
            raise ValueError("Snapshot and final result must describe the same operation outcome")
        return self


class DeploymentLog(DeploymentContract):
    """A batch of redacted Docker Compose command and output lines of one start operation."""

    operationId: UUID
    # Monotonic per operation, so clients can order and discard duplicates on replay.
    index: int = Field(ge=0)
    lines: list[str] = Field(min_length=1, max_length=50)


# A plain session works on its own branch; the platform chats (production deployment and backups) work
# on a clone of the default branch and edit their project's platform-stored documents.
SessionKind = Literal["session", "production", "backup"]
_PLATFORM_KINDS = frozenset({"production", "backup"})


class CreateSessionRequest(BaseModel):
    projectId: UUID
    provider: str
    connectionId: UUID
    branch: str | None = Field(default=None, pattern=_BRANCH_PATTERN)
    model: str | None = None
    effort: str | None = None
    kind: SessionKind = "session"
    # Delivered as the first user message once the agent is ready, exactly as if the user sent it.
    initialMessage: str | None = Field(default=None, min_length=1, max_length=100_000)


class ProductionSnapshot(BaseModel):
    """The live deployment state of one project in this process; output travels separately."""

    state: Literal["idle", "running", "succeeded", "failed"] = "idle"
    operationId: UUID | None = None
    message: str | None = None
    releaseTag: str | None = None
    releaseUrl: str | None = None
    releaseCommit: str | None = None
    startedAt: datetime | None = None
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ProductionStatusResult(BaseModel):
    state: Literal["healthy", "unhealthy"]
    output: str
    checkedAt: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ProductionStoredFiles(BaseModel):
    """DEPLOYMENT.md, deploy.sh and status.sh as stored: virtual documents living only in the platform.
    A draft may still miss documents while the agent writes them one by one."""

    manifest: str
    script: str
    statusScript: str = ""

    @property
    def complete(self) -> bool:
        return all(text.strip() for text in (self.manifest, self.script, self.statusScript))


class ProductionFiles(ProductionStoredFiles):
    """A complete draft as written by the user or the agent."""

    manifest: str = Field(min_length=1, max_length=65536, pattern=r"\S")
    script: str = Field(min_length=1, max_length=65536, pattern=r"\S")
    statusScript: str = Field(min_length=1, max_length=65536, pattern=r"\S")


class ProductionFilesPatch(BaseModel):
    """Some documents, merged into the current draft so each one is saved as soon as it is written."""

    manifest: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")
    script: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")
    statusScript: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")

    @model_validator(mode="after")
    def validate_documents(self) -> ProductionFilesPatch:
        if not self.model_dump(exclude_none=True):
            raise ValueError("Send at least one document")
        return self


class ProductionDocuments(BaseModel):
    active: ProductionStoredFiles | None = None
    draft: ProductionStoredFiles | None = None
    revision: int = 0
    environment: list[str] = Field(default_factory=list)


class ProductionEnvironmentVariable(BaseModel):
    name: str
    configured: bool
    required: bool
    # A MOOI_DEVELOPMENT_ value, managed in the project's sessions.
    inherited: bool = False


class ProductionOverview(BaseModel):
    # All three documents exist (as draft or active), so a deployment can run.
    configured: bool
    deployed: bool
    hasDraft: bool
    revision: int
    environment: list[ProductionEnvironmentVariable]
    snapshot: ProductionSnapshot
    chatSessionId: UUID | None
    # The live chat's configuration succeeded in a real deployment since its last draft: it may be closed.
    chatTested: bool = False


class ProductionEnvironmentUpdate(BaseModel):
    """A null value removes the variable. Values never travel back to the browser."""

    values: dict[str, str | None] = Field(max_length=100)


class DevelopmentEnvironmentVariable(BaseModel):
    name: str
    # A project value, or a server-wide default from .env.
    configured: bool = True
    required: bool = False


class DevelopmentEnvironment(BaseModel):
    """The project's development environment as the browser sees it: names only."""

    environment: list[DevelopmentEnvironmentVariable]


class AgentEnvironment(BaseModel):
    """What an agent reads: the project's own values. Server-wide defaults from .env belong to the
    operator, so only their names are listed."""

    values: dict[str, str]
    serverProvided: list[str]


class GithubRelease(BaseModel):
    tag: str
    name: str
    url: str
    publishedAt: datetime | None = None


class ReleaseList(BaseModel):
    releases: list[GithubRelease]


class StartProductionRequest(BaseModel):
    tag: str = Field(min_length=1, max_length=120)
    create: bool = False


_PRODUCTION_PLATFORM_ENVIRONMENT = frozenset({
    "MOOI_PRODUCTION_RELEASE_TAG", "MOOI_PRODUCTION_RELEASE_SHA", "MOOI_PRODUCTION_RELEASE_URL",
})
_PRODUCTION_VARIABLE = re.compile(r"\bMOOI_(?:PRODUCTION|DEVELOPMENT)_[A-Z0-9_]+\b")
_PRODUCTION_DEFAULTED = re.compile(r"\$\{(MOOI_(?:PRODUCTION|DEVELOPMENT)_[A-Z0-9_]+):?[-=+]")
_PRODUCTION_FILE_NAMES = {"DEPLOYMENT.md": "manifest", "deploy.sh": "script", "status.sh": "statusScript"}


def _required_environment(files: ProductionStoredFiles | None) -> list[str]:
    """Variables the scripts mention, minus shell-defaulted ones and the platform's release data."""
    if files is None:
        return []
    scripts = (files.script, files.statusScript)
    names = {name for text in scripts for name in _PRODUCTION_VARIABLE.findall(text)}
    defaulted = {name for text in scripts for name in _PRODUCTION_DEFAULTED.findall(text)}
    return sorted(names - defaulted - _PRODUCTION_PLATFORM_ENVIRONMENT)


async def _resolve_production_release(project: mooi.Project, caller: Caller,
                                      body: StartProductionRequest) -> tuple[dict, str]:
    if body.create:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", body.tag):
            raise ApiException.bad_request("Invalid release version")
        branch = quote(project.default_branch or "main", safe="")
        main = await _github_api(caller, project.full_name, "GET", f"branches/{branch}")
        main_sha = main["commit"]["sha"]
        try:
            await _github_api(caller, project.full_name, "GET", f"git/ref/tags/{quote(body.tag, safe='')}")
        except ApiException as error:
            if error.status_code != status.HTTP_404_NOT_FOUND:
                raise
        else:
            raise ApiException.conflict("This GitHub version already exists; choose another version")
        release = await _github_api(caller, project.full_name, "POST", "releases", {
            "tag_name": body.tag, "target_commitish": main_sha, "name": body.tag,
            "draft": False, "prerelease": False, "generate_release_notes": True})
    else:
        release = await _github_api(caller, project.full_name, "GET", f"releases/tags/{quote(body.tag, safe='')}")
        if release.get("draft") or release.get("tag_name") != body.tag:
            raise ApiException.conflict("The selected GitHub release is not published")
    commit = await _github_api(caller, project.full_name, "GET", f"commits/{quote(body.tag, safe='')}")
    release_sha = commit["sha"]
    if body.create and release_sha != main_sha:
        raise ApiException.conflict("The new release tag does not point to the selected default branch commit")
    return release, release_sha


_FIRST_RELEASE_TAG = "v1.0.0"
_SEMANTIC_TAG = re.compile(r"(v?)(\d+)\.(\d+)\.(\d+)")


async def _next_release_tag(caller: Caller, project: mooi.Project) -> str:
    """The patch after the highest semantic release, keeping its `v` prefix; v1.0.0 before any."""
    releases = await _github_api(caller, project.full_name, "GET", "releases?per_page=100")
    versions = [match for item in releases if (match := _SEMANTIC_TAG.fullmatch(item.get("tag_name") or ""))]
    if not versions:
        return _FIRST_RELEASE_TAG
    latest = max(versions, key=lambda match: tuple(int(part) for part in match.groups()[1:]))
    prefix, major, minor, patch = latest.groups()
    return f"{prefix}{major}.{minor}.{int(patch) + 1}"


async def _test_release(caller: Caller, project: mooi.Project, fresh: bool) -> StartProductionRequest:
    """The release a chat tests with. `fresh` (repository changes were pushed since the last release)
    creates the next release on the default branch; otherwise the one currently deployed (latest
    successful deployment) or, before any, v1.0.0 — created on the default branch when missing."""
    if fresh:
        return StartProductionRequest(tag=await _next_release_tag(caller, project), create=True)
    deployed = await _current_release(caller, project.id)
    if deployed:
        return StartProductionRequest(tag=deployed)
    try:
        await _github_api(caller, project.full_name, "GET", f"releases/tags/{_FIRST_RELEASE_TAG}")
    except ApiException as error:
        if error.status_code != status.HTTP_404_NOT_FOUND:
            raise
        return StartProductionRequest(tag=_FIRST_RELEASE_TAG, create=True)
    return StartProductionRequest(tag=_FIRST_RELEASE_TAG)


async def _current_release(caller: Caller, project_id: UUID) -> str | None:
    """The release running in production: the one of the latest successful deployment."""
    for page in range(10):
        data = await mooi.fetch_production_deployments(caller, project_id, page)
        deployed = next((item["releaseTag"] for item in data.get("deployments", [])
                         if item.get("state") == "succeeded"), None)
        if deployed or not data.get("hasMore"):
            return deployed
    return None


async def _production_documents(caller: Caller, project_id: UUID) -> ProductionDocuments:
    return ProductionDocuments.model_validate(await mooi.fetch_production_recipe(caller, project_id))


async def _github_api(caller: Caller, full_name: str, method: str, path: str,
                      payload: dict | None = None) -> Any:
    token = await mooi.fetch_github_token(caller)
    url = f"https://api.github.com/repos/{full_name}/{path}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.request(method, url, headers={
                "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"}, json=payload)
    except httpx.HTTPError:
        raise ApiException.bad_gateway("Could not reach GitHub") from None
    if response.status_code >= 400:
        raise ApiException(response.status_code if response.status_code < 500 else 502,
                           "GitHub could not complete the release request")
    return response.json()


class PendingPayload(BaseModel):
    kind: str
    requestId: str


class SessionPayload(BaseModel):
    id: UUID
    kind: SessionKind
    projectId: UUID
    projectFullName: str
    provider: str
    connectionId: UUID
    providerLabel: str
    branch: str
    baseBranch: str
    status: str
    detail: str | None
    createdAt: datetime
    updatedAt: datetime
    lastSeq: int
    usage: dict[str, Any] = Field(default_factory=dict)
    pending: PendingPayload | None
    capabilities: dict[str, bool]
    model: str
    effort: str | None
    deployment: DeploymentSnapshot
    deploymentSetup: DeploymentSetup | None = None
    deploymentConfigured: bool = False
    # A normal session's clone; hidden for platform chats.
    workspacePath: str | None
    baseCommit: str | None
    # Failed with its runtime and workspace intact: `POST /sessions/{id}/recover` reconnects it.
    recoverable: bool = False


class SessionsResponse(BaseModel):
    sessions: list[SessionPayload]


class WorkspacePayload(BaseModel):
    sessionId: UUID
    status: str
    branch: str
    baseBranch: str
    path: str | None
    baseCommit: str | None
    headCommit: str | None
    headBranch: str | None
    dirtyFiles: int
    sizeBytes: int
    createdAt: datetime
    deploymentState: str
    previewUrl: str | None


class WorkspacesResponse(BaseModel):
    root: str
    workspaces: list[WorkspacePayload]
    totalBytes: int


class DeploymentSetupRequest(BaseModel):
    instructions: str = Field(min_length=1, max_length=20_000)


class ImageUploadRequest(BaseModel):
    mediaType: Literal["image/png", "image/jpeg", "image/webp", "image/gif"]
    data: str = Field(min_length=1, max_length=images.MAX_ENCODED)
    name: str | None = Field(default=None, max_length=200)
    width: int | None = None
    height: int | None = None


class SendMessageRequest(BaseModel):
    text: str = Field(default="", max_length=100_000)
    images: list[ImageUploadRequest] = Field(default_factory=list, max_length=images.MAX_IMAGES)


class AsideRequest(BaseModel):
    question: str = Field(min_length=1, max_length=10_000)


class UpdateSessionConfigurationRequest(BaseModel):
    # `model_fields_set` below distinguishes an omitted field from an explicit
    # null effort, which is how clients select a model with no effort setting.
    model: str | None = Field(default=None, min_length=1, max_length=120)
    effort: str | None = Field(default=None, max_length=40)


class SendMessageResponse(BaseModel):
    seq: int
    # Stored image metadata, in upload order, so the sender can show its local copies at once.
    images: list[dict[str, Any]] = Field(default_factory=list)


class PermissionDecisionRequest(BaseModel):
    decision: Literal["allow", "deny"]
    message: str | None = None
    updatedInput: dict[str, Any] | None = None


class QuestionAnswerRequest(BaseModel):
    answers: dict[str, str | list[str]]
    response: str | None = None


class ChangedFilePayload(BaseModel):
    path: str
    change: str
    added: int
    removed: int


class ChangesPayload(BaseModel):
    status: Literal["ready", "error"] = "ready"
    error: str | None = None
    branch: str
    baseBranch: str
    added: int
    removed: int
    files: list[ChangedFilePayload]


class FileDiffPayload(BaseModel):
    path: str
    diff: str
    # "text", or "binary" / "too_large" when the file has no readable diff.
    preview: Literal["text", "binary", "too_large"] = "text"
    truncated: bool = False


MergeState = Literal["clean", "conflicts", "up_to_date", "merged"]


class MergeRequest(BaseModel):
    message: str = Field(min_length=1, max_length=200)


class MergePayload(BaseModel):
    state: MergeState
    targetBranch: str
    conflicts: list[str]
    commit: str | None = None


# --- in-memory session record ------------------------------------------------------------------


@dataclass(frozen=True)
class PendingInfo:
    """What the session is currently blocked on, mirrored from the runtime's own `ask` calls since
    the `AgentRuntime` protocol does not expose its pending requests directly."""

    kind: str
    request_id: str


@dataclass
class Session:
    """One live pairing of player, project, provider and workspace.

    Registered immediately in provisioning; runtime and workspace arrive asynchronously.
    A failed session remains inspectable until closed.
    """

    id: UUID
    kind: SessionKind
    player_id: UUID
    project_id: UUID
    project_full_name: str
    provider: str
    connection_id: UUID
    branch: str
    base_branch: str
    base_commit: str
    status: str
    detail: str | None
    created_at: datetime
    updated_at: datetime
    workspace: Path
    log: EventLog
    runtime: AgentRuntime | None
    deployment: DeploymentSnapshot
    agent_token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    # The agent acts for its session's latest caller on the token-guarded agent endpoints.
    agent_caller: Caller | None = field(default=None, repr=False)
    # The chat's documents passed their real test since its last draft: it may be closed.
    platform_tested: bool = False
    # The platform brief went out in this conversation; clearing or compacting it sends the brief again.
    platform_briefed: bool = False
    # The active platform documents when the chat opened: its Platform files list only what it changed.
    platform_baseline: BaseModel | None = None
    # The production chat pushed repository changes that no release contains yet: its next test creates one.
    production_release_pending: bool = False
    # A chat's own deployment setup conversation, if any (see `DeploymentSetup`).
    deployment_setup: DeploymentSetup | None = None
    # Outcome of the latest start; None before any, when a root Compose file proves an earlier setup.
    deployment_verified: bool | None = None
    # The workspace holds a root Compose file, refreshed with its changes: the setup can be changed.
    deployment_configured: bool = False
    # Redacted output tail of the latest start, read by the agent that sets the deployment up.
    deployment_output: list[str] = field(default_factory=list)
    config: AgentConfig = field(default_factory=lambda: AgentConfig("", None))
    usage: dict[str, Any] = field(default_factory=dict)
    closing: bool = False
    turn_id: str | None = None
    pending: PendingInfo | None = None
    # Side questions being answered right now; they never enter the log.
    asides: int = 0
    interactions: dict[str, dict[str, Any]] = field(default_factory=dict)
    # --- push-based changes refresh ---
    changes_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    changes_task: asyncio.Task[None] | None = None
    changes_revision: int = 0
    changes_dirty: bool = False
    tasks: set[asyncio.Task[None]] = field(default_factory=set)
    operation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    deployment_task: asyncio.Task[None] | None = None
    deployment_monitor: asyncio.Task[None] | None = None
    last_human_activity: datetime = field(default_factory=lambda: datetime.now(UTC))
    activity_heartbeat_at: float | None = None

    def to_payload(self) -> SessionPayload:
        descriptor = describe(self.provider)
        return SessionPayload(
            id=self.id,
            kind=self.kind,
            projectId=self.project_id,
            projectFullName=self.project_full_name,
            provider=self.provider,
            connectionId=self.connection_id,
            providerLabel=descriptor.label,
            branch=self.branch,
            baseBranch=self.base_branch,
            status=self.status,
            detail=self.detail,
            createdAt=self.created_at,
            updatedAt=self.updated_at,
            lastSeq=self.log.last_seq,
            usage=self.usage,
            pending=PendingPayload(kind=self.pending.kind, requestId=self.pending.request_id)
            if self.pending is not None
            else None,
            capabilities=descriptor.capabilities.as_payload(),
            model=self.config.model,
            effort=self.config.effort,
            deployment=self.deployment,
            deploymentSetup=self.deployment_setup,
            deploymentConfigured=self.deployment_configured,
            workspacePath=None if self.kind in _PLATFORM_KINDS or self.workspace == _UNSET_PATH else str(self.workspace),
            baseCommit=self.base_commit or None,
            recoverable=self.status == STATUS_FAILED and _recoverable(self),
        )


def _recoverable(session: Session) -> bool:
    """A failure that left the runtime and the workspace in place loses no work: it can reconnect."""
    return not session.closing and session.runtime is not None and session.workspace != _UNSET_PATH


def new_session(
    session_id: UUID,
    player_id: UUID,
    project_id: UUID,
    project_full_name: str,
    provider: str,
    connection_id: UUID,
    branch: str,
    base_branch: str,
    kind: SessionKind = "session",
) -> Session:
    """Builds a session in `provisioning`, before any of the slow orchestration steps have run."""
    now = datetime.now(UTC)
    return Session(
        id=session_id,
        kind=kind,
        player_id=player_id,
        project_id=project_id,
        project_full_name=project_full_name,
        provider=provider,
        connection_id=connection_id,
        branch=branch,
        base_branch=base_branch,
        base_commit="",
        status="provisioning",
        detail=None,
        created_at=now,
        updated_at=now,
        last_human_activity=now,
        workspace=_UNSET_PATH,
        log=EventLog(),
        usage={"context": {"percent": None, "usedTokens": 0, "limitTokens": None,
                           "updatedAt": now.timestamp()}},
        runtime=None,
        deployment=DeploymentSnapshot(
            state="stopped",
            operationId=None,
            phase=None,
            previewUrl=None,
            result=None,
            cleanupRequired=False,
            updatedAt=now,
        ),
    )


class SessionRegistry:
    """The process-wide table of live sessions. Reads need no lock (no `await` runs between a dict
    read and its use, so nothing else can interleave); mutations do, to keep the two limits in
    `add` correct under concurrent creations."""

    def __init__(self) -> None:
        self._sessions: dict[UUID, Session] = {}
        self._lock = asyncio.Lock()

    def check_limits(self, player_id: UUID) -> None:
        """Fails fast before the expensive clone/workspace/runtime work — best effort only:
        `add` is what actually enforces the limits atomically once the session is ready."""
        settings = get_settings()
        if len(self._sessions) >= settings.max_sessions:
            raise ApiException.conflict("The pod has reached its session limit")
        owned = sum(1 for session in self._sessions.values() if session.player_id == player_id)
        if owned >= settings.max_sessions_per_player:
            raise ApiException.conflict("You have reached your session limit")

    async def add(self, session: Session) -> None:
        settings = get_settings()
        async with self._lock:
            if session.kind in _PLATFORM_KINDS and any(
                existing.player_id == session.player_id and existing.project_id == session.project_id
                and existing.kind == session.kind and not existing.closing
                for existing in self._sessions.values()
            ):
                raise ApiException.conflict(f"A {session.kind} chat already exists for this project")
            if len(self._sessions) >= settings.max_sessions:
                raise ApiException.conflict("The pod has reached its session limit")
            owned = sum(1 for existing in self._sessions.values() if existing.player_id == session.player_id)
            if owned >= settings.max_sessions_per_player:
                raise ApiException.conflict("You have reached your session limit")
            self._sessions[session.id] = session

    def get_for(self, caller: Caller, session_id: UUID) -> Session:
        """404 whether the session is missing or owned by another player — the same answer for
        both, so a caller cannot probe for the existence of someone else's session."""
        session = self._sessions.get(session_id)
        if session is None or session.player_id != caller.player_id:
            raise ApiException.not_found("Session not found")
        return session

    def get(self, session_id: UUID) -> Session | None:
        return self._sessions.get(session_id)

    def list_for(self, player_id: UUID, project_id: UUID | None) -> list[Session]:
        sessions = [session for session in self._sessions.values() if session.player_id == player_id]
        if project_id is not None:
            sessions = [session for session in sessions if session.project_id == project_id]
        return sorted(sessions, key=lambda session: session.created_at, reverse=True)

    async def remove(self, session_id: UUID) -> Session | None:
        async with self._lock:
            return self._sessions.pop(session_id, None)

    def count(self) -> int:
        return len(self._sessions)

    def all(self) -> list[Session]:
        return list(self._sessions.values())


@lru_cache
def get_registry() -> SessionRegistry:
    return SessionRegistry()


_reaper_task: asyncio.Task[None] | None = None


# --- the event fold ----------------------------------------------------------------------------


def record(session: Session, type_: str, data: dict[str, Any]) -> Event:
    """Appends one event to the session's log and applies the state transition it implies.

    This is the single fold over events: the log is the source of truth and every
    piece of session state that the SPA can also derive — `status`, `detail`, `pending` — is
    derived here from the very events the SPA receives, so server and client can never disagree.
    Nothing else in this feature assigns `session.status` or `session.pending`.

    Deployment updates share sequence/replay with chat but never acquire a turnId, mutate chat
    state or renew idle activity. Their payloads are validated before appending to the log.
    Other events bump display `updated_at`; expiry uses the separate human activity clock.
    Sync on purpose: everything runs on one event loop, so the runtime's pump task and the request
    handlers never interleave mid-function and no lock is needed.
    """
    if type_ == EVENT_DEPLOYMENT_UPDATED:
        snapshot = DeploymentSnapshot.model_validate(data)
        event = session.log.append(type_, snapshot.model_dump(mode="json"))
        session.deployment = snapshot
        if snapshot.state != "running":
            previews.withdraw(session.id)  # The preview path dies with the running state.
        return event
    if type_ == EVENT_DEPLOYMENT_LOG:
        return session.log.append(type_, DeploymentLog.model_validate(data).model_dump(mode="json"))

    if type_ == "message.user":
        session.turn_id = uuid4().hex
    if type_ == EVENT_SESSION_STATUS and data.get("status") == STATUS_FAILED:
        data = {**data, "recoverable": _recoverable(session)}
    event = session.log.append(type_, {**data, "turnId": session.turn_id})
    session.updated_at = event.at
    if type_ == "message.user":
        _touch_activity(session, event.at)

    if type_ == "session.usage":
        previous_quota = session.usage.get("quota")
        session.usage = {**session.usage, **{key: data[key] for key in ("context", "quota") if key in data}}
        if isinstance(data.get("quota"), dict):
            session.usage["quota"] = {**(previous_quota or {}), **data["quota"]}
    elif type_ == EVENT_SESSION_STATUS:
        session.status = str(data.get("status") or session.status)
        session.detail = data.get("detail")
        if session.status in (STATUS_FAILED, "closed"):
            session.interactions.clear()
            session.pending = None
    elif type_ in (EVENT_PERMISSION_REQUEST, EVENT_QUESTION_REQUEST):
        kind = PENDING_KIND_PERMISSION if type_ == EVENT_PERMISSION_REQUEST else PENDING_KIND_QUESTION
        session.status = STATUS_WAITING
        session.pending = PendingInfo(kind=kind, request_id=str(data.get("requestId") or ""))
        session.interactions[session.pending.request_id] = {"kind": kind, **data}
    elif type_ in (EVENT_PERMISSION_RESOLVED, EVENT_QUESTION_RESOLVED):
        session.interactions.pop(str(data.get("requestId")), None)
        remaining = next(iter(session.interactions.values()), None)
        session.status = STATUS_WAITING if remaining else STATUS_WORKING
        session.pending = PendingInfo(remaining["kind"], remaining["requestId"]) if remaining else None
    elif type_ == EVENT_TURN_RESULT:
        session.status = STATUS_READY
        session.pending = None
        session.interactions.clear()
        session.turn_id = None
    elif type_ == EVENT_SESSION_CLEARED:
        session.pending = None
        session.interactions.clear()
        session.turn_id = None
        session.usage = {**session.usage, "context": None}
        session.platform_briefed = False
        session.deployment_setup = None
    elif type_ == EVENT_DEPLOYMENT_SETUP:
        session.deployment_setup = data.get("state")
    elif type_ == EVENT_DEPLOYMENT_CONFIGURED:
        session.deployment_configured = bool(data.get("configured"))
    elif type_ == EVENT_SESSION_COMPACTION and data.get("phase") == "completed":
        session.platform_briefed = False
    elif type_ == EVENT_SESSION_CONFIGURATION:
        if data.get("model") and data["model"] != session.config.model:
            session.usage = {**session.usage, "context": None}
        session.config = AgentConfig(
            model=str(data.get("model") or session.config.model),
            effort=data.get("effort"),
        )

    _observe_changes(session, type_, data)
    return event


def _record_event(session: Session, event: AgentEvent) -> Event:
    """Records an event helper from `shared/agents.py` through the fold above."""
    return record(session, event["type"], event["data"])


def _record_status(session: Session, status_: str, detail: str | None = None) -> Event:
    """Records a `session.status` event, built by the same helper the adapters use. Carries the
    clone path once it exists, so a live client learns where provisioning placed the workspace."""
    event = session_status(status_, detail)
    if session.kind == "session" and session.workspace != _UNSET_PATH:
        event["data"]["workspacePath"] = str(session.workspace)
        event["data"]["baseCommit"] = session.base_commit or None
    return _record_event(session, event)


# --- push-based changes refresh ----------------------------------------------------------------


def _changes_payload(session: Session, summary: workspaces.ChangesSummary) -> ChangesPayload:
    return ChangesPayload(
        status="ready",
        error=None,
        branch=session.branch,
        baseBranch=session.base_branch,
        added=summary.added,
        removed=summary.removed,
        files=[
            ChangedFilePayload(path=file.path, change=file.change, added=file.added, removed=file.removed)
            for file in summary.files
        ],
    )


def _changes_error_payload(session: Session) -> ChangesPayload:
    return ChangesPayload(
        status="error",
        error="Could not calculate changes. Retry to refresh.",
        branch=session.branch,
        baseBranch=session.base_branch,
        added=0,
        removed=0,
        files=[],
    )


def _observe_changes(session: Session, type_: str, data: dict[str, Any]) -> None:
    """Marks the workspace dirty from every possible tool mutation and every terminal turn state.

    The event fold is the only observation point, so tools added by the provider do not have to be
    added to a fragile allowlist before their writes can refresh the panel.
    """
    if type_ == EVENT_TOOL_RESULT:
        _schedule_changes_refresh(session, debounce=True)
    elif type_ == EVENT_TURN_RESULT or (type_ == EVENT_SESSION_STATUS and data.get("status") == STATUS_FAILED):
        _schedule_changes_refresh(session, debounce=False)


def _sync_deployment_configured(session: Session) -> bool:
    """Publishes whether the workspace holds a root Compose file whenever that changes."""
    if session.kind != "session" or session.workspace == _UNSET_PATH:
        return False
    configured = root_compose_file(session.workspace) is not None
    if configured != session.deployment_configured:
        record(session, EVENT_DEPLOYMENT_CONFIGURED, {"configured": configured})
    return configured


def _schedule_changes_refresh(session: Session, *, debounce: bool) -> None:
    """Ensures one trailing worker exists and preserves signals that arrive while it calculates."""
    if session.workspace == _UNSET_PATH or session.closing:
        return
    session.changes_revision += 1
    session.changes_dirty = True
    pending = session.changes_task
    if pending is not None and not pending.done():
        if debounce:
            return
        pending.cancel()
    delay = get_settings().changes_debounce_seconds if debounce else 0.0
    session.changes_task = _spawn(session, _refresh_changes(session, delay))


async def _refresh_changes(session: Session, delay: float) -> None:
    """Runs the single trailing changes worker and publishes ready/error states through the log."""
    try:
        if delay > 0:
            await asyncio.sleep(delay)
        while not session.closing:
            revision = session.changes_revision
            session.changes_dirty = False
            try:
                async with session.operation_lock:
                    if session.closing:
                        return
                    async with session.changes_lock:
                        summary = await workspaces.changes(session.workspace, session.base_commit)
                    _sync_deployment_configured(session)
                _record_event(session, changes_updated(_changes_payload(session, summary).model_dump()))
            except asyncio.CancelledError:
                raise
            except Exception:
                LOG.warning("Session %s could not refresh its changes", session.id, exc_info=True)
                if not session.closing:
                    _record_event(session, changes_updated(_changes_error_payload(session).model_dump()))
                if not session.changes_dirty and session.changes_revision == revision:
                    return
            if not session.changes_dirty and session.changes_revision == revision:
                return
    finally:
        if session.changes_task is asyncio.current_task():
            session.changes_task = None


def _spawn(session: Session, coro: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
    """Keeps a strong reference to a background task for as long as it runs — the event loop only
    holds a weak one — and hands `_teardown` something to cancel."""
    task = asyncio.create_task(coro)
    session.tasks.add(task)
    task.add_done_callback(session.tasks.discard)
    return task


def _runtime(session: Session) -> AgentRuntime:
    """Reject commands while provisioning has not yet assigned a runtime."""
    if session.runtime is None:
        raise ApiException.conflict("The workspace is still being prepared")
    return session.runtime


def _emitter(session: Session) -> Emit:
    """The `Emit` the adapter publishes through: a thin async wrapper over the sync fold."""

    async def emit(type_: str, data: dict[str, Any]) -> None:
        if not session.closing:
            record(session, type_, data)

    return emit


def _asker(session: Session) -> Ask:
    """The `Ask` the adapter announces its blocked state through — deliberately near-empty.

    An adapter emits `permission.request` / `question.request` *before* calling `ask`, so `record`
    has already moved the session to `waiting` by the time this runs: deriving that state from the
    event instead of from the callback keeps one fold for both server and SPA. The
    callback stays in the protocol as the explicit blocked signal for a future adapter whose SDK
    cannot emit one.
    """

    async def ask(request: PermissionRequest | QuestionRequest) -> dict[str, Any]:
        LOG.debug("Session %s is blocked on request %s", session.id, request.request_id)
        return {}

    return ask


# --- endpoints ---------------------------------------------------------------------------------

router = APIRouter(tags=["sessions"])


async def _teardown(session: Session) -> None:
    """Join provisioning and runtime shutdown before deleting this session's clone."""
    tasks = [task for task in session.tasks if task is not asyncio.current_task()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    session.tasks.difference_update(tasks)
    session.changes_task = None
    try:
        await _cleanup_workspace(session)
    finally:
        session.log.close()


async def _cleanup_workspace(session: Session) -> None:
    # Teardown has joined deployment workers. Provisioning error paths cannot have
    # admitted a deployment. Never delete recovery evidence when Docker cleanup fails.
    docker_clean = True
    previews.withdraw(session.id)
    try:
        manifests = _deployment_storage()
        if manifests.directory(session.id).exists():
            _owned_deployment(session, manifests)
            await Docker().cleanup(manifests=manifests, session_id=session.id)
        _deployment_slots.discard(session.id)
    except Exception:
        LOG.debug("Background operation encountered an exception", exc_info=True)
        docker_clean = False
        LOG.warning("Session %s deployment cleanup failed; retaining workspace", session.id)
    if session.runtime is not None:
        try:
            await session.runtime.close()
        except Exception:
            LOG.exception("Session %s runtime shutdown failed; retaining workspace", session.id)
            return
        session.runtime = None
    if docker_clean and session.workspace != _UNSET_PATH:
        try:
            await workspaces.remove_workspace(session.id)
            session.workspace = _UNSET_PATH
        except Exception:
            LOG.exception("Session %s workspace cleanup failed", session.id)


async def _close_registered_session(session: Session) -> None:
    """Close a session while its operation lock is held."""
    removed = await get_registry().remove(session.id)
    if removed is None:
        return
    session.closing = True
    _record_status(session, "closed", "This session was closed")
    await _teardown(session)
    LOG.info("Session %s closed", session.id)


async def close_session(session_id: UUID) -> None:
    """Closes and removes one registered session. Reused by `DELETE /sessions/{id}` and by the
    idle reaper and shutdown hook, neither of which has a caller to check ownership against — that
    check, when one is needed, is the caller's job before calling this."""
    registry = get_registry()
    session = registry.get(session_id)
    if session is None:
        return
    async with session.operation_lock:
        await _close_registered_session(session)


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionRequest, caller: Annotated[Caller, Depends(current_caller)]
) -> SessionPayload:
    """Reserve a session immediately; provision it in a tracked background task."""
    descriptor = describe(body.provider)
    registry = get_registry()
    await descriptor.prepare(caller, str(body.connectionId))
    config = descriptor.configure(body.model, body.effort)
    if body.kind == "session":
        if body.branch is None:
            raise ApiException.bad_request("A branch is required for a session")
        await workspaces.get_workspaces().validate_branch(body.branch)
    if body.kind in _PLATFORM_KINDS:
        # A new platform chat always replaces the project's previous one of the same kind.
        for existing in registry.list_for(caller.player_id, body.projectId):
            if existing.kind == body.kind and not existing.closing:
                await close_session(existing.id)

    session = new_session(
        session_id=uuid4(),
        player_id=caller.player_id,
        project_id=body.projectId,
        project_full_name="",
        provider=descriptor.id,
        connection_id=body.connectionId,
        branch=body.branch if body.kind == "session" else "",
        base_branch="",
        kind=body.kind,
    )

    session.config = config
    session.agent_caller = caller
    project = await mooi.fetch_project(caller, body.projectId)
    session.project_full_name = project.full_name
    session.base_branch = project.default_branch
    if session.kind in _PLATFORM_KINDS:
        session.branch = project.default_branch
        session.platform_baseline = (await _production_documents(caller, body.projectId)).active \
            if session.kind == "production" else (await _backup_documents(caller, body.projectId)).active
    await registry.add(session)
    _record_status(session, STATUS_PROVISIONING, "Preparing the workspace")
    _spawn(session, _provision(session, caller, project, body.initialMessage))
    return session.to_payload()


async def _provision(session: Session, caller: Caller, project: mooi.Project,
                     initial_message: str | None = None) -> None:
    descriptor = describe(session.provider)
    started_at = time.perf_counter()
    try:
        _record_status(session, STATUS_PROVISIONING, "Loading the project")
        session.project_full_name = project.full_name
        session.base_branch = project.default_branch

        _record_status(session, STATUS_PROVISIONING, f"Loading {descriptor.label} and repository credentials")
        credential, github_token = await asyncio.gather(
            mooi.fetch_agent_credential(caller, str(session.connection_id)),
            mooi.fetch_github_token(caller),
        )
        _record_status(session, STATUS_PROVISIONING, f"Cloning {project.full_name}")
        workspace = await workspaces.create_workspace(project, session.id, session.branch, github_token)
        session.workspace = workspace.path
        session.base_commit = workspace.base_commit
        _sync_deployment_configured(session)

        _record_status(session, STATUS_PROVISIONING, f"Starting {descriptor.label}")
        runtime = create_runtime(
            descriptor.id,
            credential,
            session.workspace,
            session.branch,
            _emitter(session),
            _asker(session),
            session.config,
            instructions=_session_instructions(session),
            environment=_session_environment(session),
        )
        session.runtime = runtime
        await runtime.start()

        if session.closing:
            return
        _record_status(session, STATUS_READY)
        if initial_message:
            async with session.operation_lock:
                if not session.closing and session.status == STATUS_READY:
                    # A failed delivery is already recorded on the session by `_deliver`.
                    with suppress(ApiException):
                        await _deliver(session, runtime, initial_message)
    except asyncio.CancelledError:
        await _cleanup_workspace(session)
        raise
    except Exception:
        if session.closing:
            return
        LOG.exception("Session %s could not be provisioned", session.id)
        await _cleanup_workspace(session)
        record(session, "error", {"message": "The session could not be started. Check provider and repository access."})
        _record_status(session, STATUS_FAILED, "Workspace provisioning failed")
    finally:
        LOG.info("Session %s provisioning finished in %.0f ms", session.id, (time.perf_counter() - started_at) * 1000)


@router.get("/sessions/providers/{provider}")
async def session_provider(provider: str, connectionId: UUID,
                           caller: Annotated[Caller, Depends(current_caller)], refresh: bool = False) -> dict[str, Any]:
    descriptor = describe(provider)
    await descriptor.prepare(caller, str(connectionId), refresh=refresh)
    return descriptor.configuration()


@router.get("/sessions/workspaces")
async def list_workspaces(
    caller: Annotated[Caller, Depends(current_caller)], projectId: UUID
) -> WorkspacesResponse:
    """Overview of every clone the caller holds for one project, read live from disk."""
    sessions = [session for session in get_registry().list_for(caller.player_id, projectId)
                if session.kind == "session"]

    async def describe_workspace(session: Session) -> WorkspacePayload:
        cloned = session.workspace != _UNSET_PATH
        inspection = await workspaces.inspect(session.workspace) if cloned else None
        return WorkspacePayload(
            sessionId=session.id,
            status=session.status,
            branch=session.branch,
            baseBranch=session.base_branch,
            path=str(session.workspace) if cloned else None,
            baseCommit=session.base_commit or None,
            headCommit=inspection.head_commit if inspection else None,
            headBranch=inspection.head_branch if inspection else None,
            dirtyFiles=inspection.dirty_files if inspection else 0,
            sizeBytes=inspection.size_bytes if inspection else 0,
            createdAt=session.created_at,
            deploymentState=session.deployment.state,
            previewUrl=session.deployment.previewUrl,
        )

    payloads = await asyncio.gather(*(describe_workspace(session) for session in sessions))
    return WorkspacesResponse(
        root=str(workspaces.get_workspaces().root / "sessions"),
        workspaces=list(payloads),
        totalBytes=sum(payload.sizeBytes for payload in payloads),
    )


@router.get("/sessions")
async def list_sessions(
    caller: Annotated[Caller, Depends(current_caller)], projectId: UUID | None = None
) -> SessionsResponse:
    sessions = get_registry().list_for(caller.player_id, projectId)
    return SessionsResponse(sessions=[session.to_payload() for session in sessions])


@router.get("/sessions/{session_id}")
async def get_session(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> SessionPayload:
    return get_registry().get_for(caller, session_id).to_payload()


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> None:
    """Always `204`: an unknown id and another player's session both no-op here, deliberately not
    `get_for`'s `404` — either way the caller learns nothing about whether the id exists."""
    try:
        get_registry().get_for(caller, session_id)
    except ApiException:
        return
    await close_session(session_id)


@router.get("/sessions/{session_id}/events")
async def stream_session_events(
    session_id: UUID,
    request: Request,
    caller: Annotated[Caller, Depends(current_caller)],
    after: int = 0,
) -> StreamingResponse:
    """Live tail of the session's event log.

    Subscribes *before* replaying: `EventLog.subscribe` registers its queue synchronously, so any
    event appended between that call and `replay()` lands in the queue instead of being lost, and
    is simply skipped as a duplicate once the live loop reaches it — its `seq` is not greater than
    the last replayed one. `Last-Event-ID` is accepted as a fallback for `after`.
    """
    session = get_registry().get_for(caller, session_id)
    last_event_id = request.headers.get(_LAST_EVENT_ID_HEADER)
    if last_event_id is not None:
        with suppress(ValueError):
            after = int(last_event_id)

    settings = get_settings()
    queue = session.log.subscribe()

    async def frames() -> AsyncIterator[str]:
        try:
            last_seq = after
            replay = session.log.replay(after)
            # Includes the current deployment even when its update has fallen out of replay.
            sync = Event(session.log.last_seq, datetime.now(UTC), "session.sync", {
                "session": session.to_payload().model_dump(mode="json"),
                "pending": list(session.interactions.values()),
            })
            if after < session.log.first_seq - 1 or after > session.log.last_seq:
                last_seq = session.log.first_seq - 1
                replay = session.log.replay(last_seq)
                yield sse_frame(Event(last_seq, datetime.now(UTC), "history.reset", {
                    "message": "Earlier trace events are no longer retained in memory. Showing available history."
                }))
            for event in replay:
                yield sse_frame(event)
                last_seq = event.seq
            yield sse_frame(sync)
            last_seq = sync.seq
            next_usage_check = 0.0
            next_auth_check = time.monotonic()
            while True:
                if time.monotonic() >= next_auth_check:
                    try:
                        await current_caller(request)
                    except Exception:
                        LOG.debug("Background operation encountered an exception", exc_info=True)
                        return
                    next_auth_check = time.monotonic() + settings.introspection_cache_seconds
                if await request.is_disconnected():
                    return
                if time.monotonic() >= next_usage_check:
                    next_usage_check = time.monotonic() + 60
                    if session.runtime is not None and session.status in (STATUS_READY, STATUS_WORKING, STATUS_WAITING):
                        try:
                            await session.runtime.refresh_usage()
                        except Exception:
                            LOG.debug("Visible session usage refresh unavailable")
                try:
                    event = await asyncio.wait_for(queue.get(), settings.sse_heartbeat_seconds)
                except TimeoutError:
                    yield sse_heartbeat()
                    continue
                if event is None:
                    return
                if event.seq > last_seq:
                    yield sse_frame(event)
                    last_seq = event.seq
        finally:
            session.log.unsubscribe(queue)

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/sessions/{session_id}/messages", status_code=status.HTTP_202_ACCEPTED)
async def send_message(
    session_id: UUID, body: SendMessageRequest, caller: Annotated[Caller, Depends(current_caller)]
) -> SendMessageResponse:
    session = get_registry().get_for(caller, session_id)
    session.agent_caller = caller
    if not body.text.strip() and not body.images:
        raise ApiException.bad_request("Message cannot be blank")
    if body.images and not describe(session.provider).capabilities.images:
        raise ApiException.bad_request("This agent does not accept images")
    async with session.operation_lock:
        if session.status != STATUS_READY or session.closing or session.deployment.state == "starting":
            raise ApiException.conflict("The session is not ready to accept a message")
        # Configuration events describe the user's selection for the next turn.
        # Reconcile here even after provisioning, which may have started with an
        # older selection. A failed update leaves the draft and session retryable.
        runtime = _runtime(session)
        try:
            refresh = getattr(runtime, "refresh_credential", None)
            if refresh:
                await refresh(await mooi.fetch_agent_credential(caller, str(session.connection_id)))
            await runtime.set_configuration(session.config)
        except ApiException:
            raise
        except Exception:
            LOG.warning("Session %s could not apply its configuration", session.id, exc_info=True)
            raise ApiException.bad_gateway("The agent could not apply the selected configuration") from None
        if session.status != STATUS_READY or session.closing or session.deployment.state == "starting":
            raise ApiException.conflict("The session is not ready to accept a message")
        attached = await images.store(session.workspace, [
            images.Upload(item.data, item.mediaType, item.name, item.width, item.height) for item in body.images])
        return await _deliver(session, runtime, body.text.strip() if attached else body.text, attached)


async def _deliver(session: Session, runtime: AgentRuntime, text: str,
                   attached: list[images.Image] | None = None) -> SendMessageResponse:
    """Records the user message and hands it to the agent; the caller holds the operation lock.

    A platform conversation opens with its brief around the user's text, recorded as the message
    itself: the transcript always shows exactly what the agent received."""
    if session.kind in _PLATFORM_KINDS and not session.platform_briefed:
        text = _production_prompt(session, text) if session.kind == "production" else _backup_prompt(session, text)
        session.platform_briefed = True
    attached = attached or []
    event = _record_event(session, message_user(uuid4().hex, text, attached))
    _record_status(session, STATUS_WORKING)
    try:
        await runtime.send(text, attached)
    except Exception:
        # A dead transport is reconnected, resuming the conversation, and the message sent once more.
        LOG.warning("Session %s could not deliver a message; reconnecting the agent", session.id, exc_info=True)
        try:
            await runtime.recover()
            await runtime.send(text, attached)
        except Exception:
            LOG.warning("Session %s could not reconnect its agent", session.id, exc_info=True)
            record(session, "error", {"message": "The message could not be delivered to the agent"})
            _record_status(session, STATUS_FAILED, RECOVERABLE_DETAIL)
            raise ApiException.bad_gateway("The message could not be delivered") from None
    return SendMessageResponse(seq=event.seq, images=[image.payload() for image in attached])


_ASIDE_STATUSES = (STATUS_READY, STATUS_WORKING, STATUS_WAITING)
_ASIDE_FAILED = "The agent could not answer the side question. Try again."


@router.post("/sessions/{session_id}/asides")
async def ask_aside(
    session_id: UUID, body: AsideRequest, caller: Annotated[Caller, Depends(current_caller)]
) -> StreamingResponse:
    """Answers a side question beside the conversation, even mid-turn, as NDJSON chunks.

    The answer is ephemeral: it is streamed to the asker only, never recorded in the event log and
    never seen by the agent's live conversation."""
    session = get_registry().get_for(caller, session_id)
    question = body.question.strip()
    if not question:
        raise ApiException.bad_request("The side question cannot be blank")
    if not describe(session.provider).capabilities.asides:
        raise ApiException.bad_request("This agent does not answer side questions")
    if session.closing or session.status not in _ASIDE_STATUSES:
        raise ApiException.conflict("The session cannot answer side questions right now")
    if session.asides:
        raise ApiException.conflict("A side question is already being answered")
    runtime = _runtime(session)
    _touch_activity(session)

    def line(payload: dict[str, Any]) -> str:
        return json.dumps(payload) + "\n"

    async def chunks() -> AsyncIterator[str]:
        session.asides += 1
        try:
            async for text in runtime.aside(question):
                if text:
                    yield line({"type": "delta", "text": text})
            yield line({"type": "done"})
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.warning("Session %s could not answer a side question", session.id, exc_info=True)
            yield line({"type": "error", "message": _ASIDE_FAILED})
        finally:
            session.asides -= 1

    return StreamingResponse(chunks(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sessions/{session_id}/recover", status_code=status.HTTP_204_NO_CONTENT)
async def recover_session(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> None:
    """Reconnects a failed session's agent, resuming its conversation when the provider can."""
    session = get_registry().get_for(caller, session_id)
    session.agent_caller = caller
    async with session.operation_lock:
        if session.status != STATUS_FAILED or session.closing:
            raise ApiException.conflict("Only a failed session can be reconnected")
        if not _recoverable(session):
            raise ApiException.conflict("This session cannot be recovered. Start a new one.")
        _touch_activity(session)
        try:
            await _runtime(session).recover()
        except Exception:
            LOG.warning("Session %s could not reconnect its agent", session.id, exc_info=True)
            record(session, "error", {"message": "The agent could not reconnect. Try again in a moment."})
            _record_status(session, STATUS_FAILED, RECOVERABLE_DETAIL)
            raise ApiException.bad_gateway("The agent could not reconnect") from None
        record(session, "agent.activity", {
            "kind": "stream_recovered",
            "description": "Reconnected and restored the conversation. Send a message to continue.",
        })
        _record_status(session, STATUS_READY)


@router.get("/sessions/{session_id}/images/{image_id}")
async def session_image(
    session_id: UUID, image_id: str, caller: Annotated[Caller, Depends(current_caller)]
) -> FileResponse:
    """One image the player attached or the agent produced; ids are random or content hashes, so the
    bytes never change."""
    session = get_registry().get_for(caller, session_id)
    if session.workspace == _UNSET_PATH:
        raise ApiException.not_found("Unknown image")
    path, media_type = images.locate(session.workspace, image_id)
    return FileResponse(path, media_type=media_type, headers={
        "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


@router.patch("/sessions/{session_id}/configuration")
async def update_session_configuration(
    session_id: UUID,
    body: UpdateSessionConfigurationRequest,
    caller: Annotated[Caller, Depends(current_caller)],
) -> SessionPayload:
    session = get_registry().get_for(caller, session_id)
    descriptor = describe(session.provider)
    await descriptor.prepare(caller, str(session.connection_id))
    async with session.operation_lock:
        if (session.closing or session.deployment.state == "starting"
                or session.status not in (STATUS_PROVISIONING, STATUS_READY, STATUS_WORKING, STATUS_WAITING)):
            raise ApiException.conflict("Configuration cannot be changed for this session")

        changed_fields = body.model_fields_set
        if not changed_fields:
            raise ApiException.bad_request("Provide a model or effort to change")
        if "model" in changed_fields and body.model is None:
            raise ApiException.bad_request("Model cannot be null")

        model = body.model if "model" in changed_fields else session.config.model
        effort = body.effort if "effort" in changed_fields else (
            None if model != session.config.model else session.config.effort
        )
        candidate = descriptor.configure(model, effort)
        # Never touch a running turn or a runtime still being provisioned.
        # send_message applies the latest selection under this same lock.
        _touch_activity(session)
        _record_event(session, session_configuration(candidate.model, candidate.effort))
        return session.to_payload()


@router.post("/sessions/{session_id}/interrupt", status_code=status.HTTP_202_ACCEPTED)
async def interrupt_session(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> None:
    """Request interruption; only the provider's terminal result makes the session ready."""
    session = get_registry().get_for(caller, session_id)
    async with session.operation_lock:
        if session.status not in (STATUS_WORKING, STATUS_WAITING) or session.closing:
            raise ApiException.conflict("There is no active turn to interrupt")
        await _runtime(session).interrupt()
        _touch_activity(session)


@router.post("/sessions/{session_id}/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_session_conversation(
    session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]
) -> None:
    session = get_registry().get_for(caller, session_id)
    async with session.operation_lock:
        if session.status != STATUS_READY or session.closing or session.deployment.state == "starting":
            raise ApiException.conflict("The session is not ready to clear its conversation")
        await _reset_conversation(session, caller)
        _touch_activity(session)


@router.post("/sessions/{session_id}/compact", status_code=status.HTTP_202_ACCEPTED)
async def compact_session_conversation(
    session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]
) -> None:
    session = get_registry().get_for(caller, session_id)
    async with session.operation_lock:
        if session.status != STATUS_READY or session.closing or session.deployment.state == "starting":
            raise ApiException.conflict("The session is not ready to compact its conversation")
        _runtime(session)
        _touch_activity(session)
        previous_context = session.usage.get("context")
        record(session, EVENT_SESSION_COMPACTION, {"phase": "started"})
        _record_status(session, STATUS_COMPACTING)
        record(session, "session.usage", {"context": None})
        _spawn(session, _run_compaction(session, previous_context))


async def _run_compaction(session: Session, previous_context: dict[str, Any] | None) -> None:
    """Own the long provider operation after the HTTP request has returned."""
    async with session.operation_lock:
        if session.closing or session.status != STATUS_COMPACTING:
            return
        try:
            await _runtime(session).compact()
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.exception("Session %s could not compact its conversation", session.id)
            record(session, "session.usage", {"context": previous_context})
            record(session, EVENT_SESSION_COMPACTION, {"phase": "failed"})
            record(session, "error", {"message": "The agent could not compact the conversation. Try again."})
            if session.status == STATUS_COMPACTING:
                _record_status(session, STATUS_READY)
        else:
            record(session, EVENT_SESSION_COMPACTION, {"phase": "completed"})
            if session.status == STATUS_COMPACTING:
                _record_status(session, STATUS_READY)


@router.post("/sessions/{session_id}/permissions/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_permission(
    session_id: UUID,
    request_id: str,
    body: PermissionDecisionRequest,
    caller: Annotated[Caller, Depends(current_caller)],
) -> None:
    session = get_registry().get_for(caller, session_id)
    pending = session.interactions.get(request_id)
    if pending is None or pending["kind"] != "permission":
        raise ApiException.not_found("Unknown permission request")
    await _runtime(session).resolve(request_id, body.model_dump())
    _touch_activity(session)


@router.post("/sessions/{session_id}/questions/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_question(
    session_id: UUID,
    request_id: str,
    body: QuestionAnswerRequest,
    caller: Annotated[Caller, Depends(current_caller)],
) -> None:
    session = get_registry().get_for(caller, session_id)
    pending = session.interactions.get(request_id)
    if pending is None or pending["kind"] != "question":
        raise ApiException.not_found("Unknown question request")
    expected = {question["question"] for question in pending.get("questions", [])}
    if set(body.answers) != expected or any(not answer for answer in body.answers.values()):
        raise ApiException.bad_request("Answer every question before continuing")
    for question in pending.get("questions", []):
        answer = body.answers[question["question"]]
        if isinstance(answer, list) and not question.get("multiSelect"):
            raise ApiException.bad_request("This question requires a single answer")
        values = answer if isinstance(answer, list) else [answer]
        if any(not value.strip() for value in values):
            raise ApiException.bad_request("Answers cannot be blank")
    await _runtime(session).resolve(request_id, body.model_dump())
    _touch_activity(session)


@router.get("/sessions/{session_id}/changes")
async def get_changes(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> ChangesPayload:
    session = get_registry().get_for(caller, session_id)
    async with session.operation_lock:
        if session.workspace == _UNSET_PATH:
            return _changes_payload(session, workspaces.ChangesSummary(files=[], added=0, removed=0))
        try:
            async with session.changes_lock:
                summary = await workspaces.changes(session.workspace, session.base_commit)
            _sync_deployment_configured(session)
            return _changes_payload(session, summary)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.warning("Session %s could not load its changes", session.id, exc_info=True)
            return _changes_error_payload(session)


@router.get("/sessions/{session_id}/changes/file")
async def get_file_diff(
    session_id: UUID, path: str, caller: Annotated[Caller, Depends(current_caller)]
) -> FileDiffPayload:
    session = get_registry().get_for(caller, session_id)
    async with session.operation_lock:
        if session.workspace == _UNSET_PATH:
            raise ApiException.conflict("The workspace is still being prepared")
        diff = await workspaces.file_diff(session.workspace, session.base_commit, path)
        return FileDiffPayload(path=path, diff=diff.diff, preview=diff.preview, truncated=diff.truncated)



# --- merge into the default branch -------------------------------------------------------------


def _require_mergeable(session: Session) -> None:
    """Merging reads the whole working tree, so no turn, question or deployment may be mid-flight."""
    if session.kind in _PLATFORM_KINDS:
        raise ApiException.conflict("Platform chats publish their documents after a successful test")
    if session.workspace == _UNSET_PATH:
        raise ApiException.conflict("The workspace is still being prepared")
    if (session.status != STATUS_READY or session.closing or session.pending is not None
            or session.deployment.state == "starting"):
        raise ApiException.conflict("Wait for the agent to finish before merging")


def _merge_payload(preview: workspaces.MergePreview, commit: str | None = None) -> MergePayload:
    state: MergeState = ("merged" if commit else "conflicts" if preview.conflicts
                         else "up_to_date" if preview.up_to_date else "clean")
    return MergePayload(state=state, targetBranch=preview.target, conflicts=preview.conflicts, commit=commit)


def _conflict_prompt(session: Session, preview: workspaces.MergePreview) -> str:
    target = f"origin/{preview.target}"
    base = preview.merge_base or f"$(git merge-base HEAD {target})"
    files = "\n".join(f"- `{path}`" for path in preview.conflicts) or "- (none reported)"
    return f"""Resolve the merge conflicts between this branch `{session.branch}` and `{preview.target}`.

`{target}` has just been fetched; do not fetch, pull, push, rebase, reset or switch branches. Both branches were last in sync at commit `{base}`.

Files expected to conflict:
{files}

1. Commit any pending change on `{session.branch}` so nothing is lost.
2. Analyze both branches since `{base}`: read `git log` and `git diff` for `{base}..HEAD` and for `{base}..{target}` to understand every feature each side added.
3. Run `git merge --no-ff --no-commit {target}`.
4. Resolve every conflict preserving the features of both branches, making whatever technical and functional decisions are needed so both keep working. When both sides implement the same feature, keep the most complete version using the cleanest, most maintainable and scalable approach.
5. Make sure no conflict markers remain and the project still builds and its checks pass where practical, then commit the merge.
6. Finish with a short summary of the decisions you took."""


async def _reset_conversation(session: Session, caller: Caller) -> AgentRuntime:
    """Replaces the runtime with a fresh one on the same workspace: a new conversation with no
    context from the previous one, for every provider alike."""
    previous = _runtime(session)
    credential = await mooi.fetch_agent_credential(caller, str(session.connection_id))
    await previous.close()
    session.runtime = None
    record(session, EVENT_SESSION_CLEARED, {})
    runtime = create_runtime(session.provider, credential, session.workspace, session.branch,
                             _emitter(session), _asker(session), session.config,
                             instructions=_session_instructions(session),
                             environment=_session_environment(session))
    session.runtime = runtime
    try:
        await runtime.start()
    except Exception:
        LOG.exception("Session %s could not restart its agent", session.id)
        record(session, "error", {"message": "The agent could not be restarted. Reconnect to try again."})
        _record_status(session, STATUS_FAILED, RECOVERABLE_DETAIL)
        raise ApiException.bad_gateway("The agent could not be restarted") from None
    return runtime


@router.post("/sessions/{session_id}/merge/check")
async def check_merge(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> MergePayload:
    """Dry-runs the merge against the freshly fetched default branch without touching the checkout."""
    session = get_registry().get_for(caller, session_id)
    token = await mooi.fetch_github_token(caller)
    async with session.operation_lock:
        _require_mergeable(session)
        _touch_activity(session)
        return _merge_payload(await workspaces.preview_merge(session.workspace, session.base_branch, token))


@router.post("/sessions/{session_id}/merge")
async def merge_session(
    session_id: UUID, body: MergeRequest, caller: Annotated[Caller, Depends(current_caller)]
) -> MergePayload:
    """Squashes the session's work onto the default branch as one commit and pushes it. Conflicts
    that appeared since the check are answered, not raised: the client offers resolution instead."""
    session = get_registry().get_for(caller, session_id)
    message = body.message.strip()
    if not message:
        raise ApiException.bad_request("The commit title cannot be blank")
    token, identity = await asyncio.gather(mooi.fetch_github_token(caller), mooi.fetch_github_identity(caller))
    async with session.operation_lock:
        _require_mergeable(session)
        _touch_activity(session)
        async with session.changes_lock:
            preview, commit = await workspaces.merge(session.workspace, session.base_branch, message, identity, token)
        if commit is not None:
            session.base_commit = commit
            record(session, EVENT_MERGE_COMPLETED, {"targetBranch": preview.target, "commit": commit, "message": message})
            _record_status(session, STATUS_READY)
            _schedule_changes_refresh(session, debounce=False)
        return _merge_payload(preview, commit)


@router.post("/sessions/{session_id}/merge/resolve", status_code=status.HTTP_202_ACCEPTED)
async def resolve_merge_conflicts(
    session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]
) -> SendMessageResponse:
    """Clears the conversation and asks the agent to merge the default branch in, resolving conflicts."""
    session = get_registry().get_for(caller, session_id)
    token, identity = await asyncio.gather(mooi.fetch_github_token(caller), mooi.fetch_github_identity(caller))
    async with session.operation_lock:
        _require_mergeable(session)
        preview = await workspaces.preview_merge(session.workspace, session.base_branch, token)
        if not preview.conflicts:
            raise ApiException.conflict(f"There are no conflicts with {preview.target} anymore; merge it directly")
        await workspaces.set_identity(session.workspace, identity)
        runtime = await _reset_conversation(session, caller)
        return await _deliver(session, runtime, _conflict_prompt(session, preview))


# Capacity also includes orphaned/failed resources after a session leaves the registry.
_deployment_slots: set[UUID] = set()
_deployment_capacity_lock = asyncio.Lock()
_deployment_recovery_blocked = False


async def reconcile_deployments() -> set[UUID] | None:
    """Boot-only cleanup, before workspace reconciliation; None preserves every workspace."""
    global _deployment_recovery_blocked
    _deployment_slots.clear()
    try:
        manifests = _deployment_storage()
        session_ids = manifests.session_ids()
    except Exception:
        LOG.debug("Background operation encountered an exception", exc_info=True)
        _deployment_recovery_blocked = True
        LOG.warning("Deployment recovery unavailable; preserving all workspaces and blocking Deploy")
        return None
    _deployment_recovery_blocked = False
    _deployment_slots.update(session_ids)
    preserved: set[UUID] = set()
    for session_id in session_ids:
        try:
            manifests.load(session_id)  # Validate even dangling/corrupt directory entries.
            await Docker().cleanup(manifests=manifests, session_id=session_id)
        except Exception:
            LOG.debug("Background operation encountered an exception", exc_info=True)
            preserved.add(session_id)
            LOG.warning("Deployment %s recovery failed; retaining resources and workspace", session_id)
        else:
            _deployment_slots.discard(session_id)
    return preserved


async def _reserve_deployment(session_id: UUID) -> None:
    async with _deployment_capacity_lock:
        if _deployment_recovery_blocked:
            raise ApiException.conflict("Restore deployment records and restart the service before deploying")
        if session_id in _deployment_slots:
            raise ApiException.conflict("Previous deployment resources require cleanup")
        if len(_deployment_slots) >= get_settings().max_deployments:
            raise ApiException(status.HTTP_429_TOO_MANY_REQUESTS, "Deployment capacity is full; stop an active deployment")
        _deployment_slots.add(session_id)


# --- development: the environment every session of a project shares ---------------------------
#
# A project's MOOI_DEVELOPMENT_ values live encrypted in mic-mooi: a value saved in one session is
# there for every other session of the project, for its previews and, inherited, for its production
# deployments and backups. Each session's agent reads and saves them through the token-guarded agent
# endpoints below, guided by its session instructions; the browser only ever sees their names.


async def _development_environment(caller: Caller, project_id: UUID) -> dict[str, str]:
    """Server-wide MOOI_DEVELOPMENT_ values from .env, overridden by the project's stored ones."""
    values = development_environment()
    values.update(await mooi.fetch_development_environment(caller, project_id))
    return {name: value for name, value in values.items() if value}


def _agent_environment(stored: dict[str, str], server: dict[str, str]) -> AgentEnvironment:
    return AgentEnvironment(values=dict(sorted(stored.items())),
                            serverProvided=sorted(name for name, value in server.items()
                                                  if value and name not in stored))


def _development_overview(stored: Iterable[str]) -> DevelopmentEnvironment:
    names = set(stored) | {name for name, value in development_environment().items() if value}
    return DevelopmentEnvironment(environment=[DevelopmentEnvironmentVariable(name=name) for name in sorted(names)])


def _session_instructions(session: Session) -> str:
    """A plain session's standing guidance, added to the agent's system instructions: platform chats
    carry their own brief instead."""
    if session.kind != "session":
        return ""
    base = f"http://127.0.0.1:{get_settings().sessions_port}/sessions/{session.id}/development/agent/environment"
    return f"""## Project development environment
This project keeps development environment variables named `MOOI_DEVELOPMENT_<NAME>` encrypted in the Mooi platform. Every session of the project shares them: a value saved here is available in every other session, in the Deploy preview and, inherited, in production deployments and backups.
- Use them for configuration the project needs to run (API keys, tokens, service URLs...). Save a value when the user gives you one or asks you to set, change or remove it. When a value you need is missing, ask the user; never invent credentials.
- Read them again whenever you need them: the user and other sessions can change them at any time. Tell the user a value only when they ask for it.
- Never write their values to the repository. The Deploy preview's root Compose file reads them through interpolation, for example `OPENAI_API_KEY: ${{MOOI_DEVELOPMENT_OPENAI_API_KEY}}`; when you run the project yourself, pass the values a command needs through its environment.

Use Python urllib with an inline JSON body, never a temporary file, and send the header `X-Environment-Token: {session.agent_token}`:
- `GET {base}`: `values` (the project's variables) and `serverProvided` (names of server-wide defaults whose values you cannot read).
- `PUT {base}` with JSON `{{"values": {{"MOOI_DEVELOPMENT_NAME": "value"}}}}` (null removes a variable): saves them and returns the stored names.

## Shared Docker host
Docker here is the host's shared engine: other projects' live containers, volumes and networks (production ones included) run on it, and the same names may appear in this repository.
- Compose commands are scoped to this session's project through `COMPOSE_PROJECT_NAME={_compose_project(session)}`; keep it, never pass `--project-name`/`-p` or override it.
- Only act on resources labelled `com.docker.compose.project={_compose_project(session)}`. Never stop, remove, recreate, prune or attach to anything else, even when a name conflicts: report the conflict to the user instead."""


def _compose_project(session: Session) -> str:
    """Compose project of a plain session's own commands, distinct from the host's stacks and from
    its Deploy preview project."""
    return f"mooi-session-{session.id.hex[:12]}"


def _session_environment(session: Session) -> dict[str, str]:
    """Variables every agent tool command of a plain session receives. Scoping Compose keeps a
    repository whose project name matches a host stack (Mooi's own dev stack and its production
    `mooi` project) from recreating that stack's containers. Platform chats run the real
    deployment scripts, so they keep the scripts' own project names."""
    return {"COMPOSE_PROJECT_NAME": _compose_project(session)} if session.kind == "session" else {}


@router.get("/development/projects/{project_id}/environment")
async def development_environment_overview(project_id: UUID,
                                           caller: Annotated[Caller, Depends(current_caller)]) -> DevelopmentEnvironment:
    return _development_overview(await mooi.fetch_development_environment(caller, project_id))


@router.put("/development/projects/{project_id}/environment")
async def update_development_environment(project_id: UUID, body: ProductionEnvironmentUpdate,
                                         caller: Annotated[Caller, Depends(current_caller)]) -> DevelopmentEnvironment:
    return _development_overview(await mooi.write_development_environment(caller, project_id, body.values))


def _agent_environment_access(session_id: UUID, request: Request) -> tuple[Session, Caller]:
    session = get_registry().get(session_id)
    token = request.headers.get("X-Environment-Token", "")
    if (request.client is None or request.client.host not in ("127.0.0.1", "::1")
            or session is None or session.kind != "session" or session.closing
            or not hmac.compare_digest(token, session.agent_token)
            or session.agent_caller is None):
        raise ApiException.not_found("Development environment not found")
    return session, session.agent_caller


@router.get("/sessions/{session_id}/development/agent/environment")
async def agent_development_environment(session_id: UUID, request: Request) -> AgentEnvironment:
    session, caller = _agent_environment_access(session_id, request)
    return _agent_environment(await mooi.fetch_development_environment(caller, session.project_id),
                              development_environment())


@router.put("/sessions/{session_id}/development/agent/environment")
async def agent_save_development_environment(session_id: UUID, request: Request,
                                             body: ProductionEnvironmentUpdate) -> DevelopmentEnvironment:
    session, caller = _agent_environment_access(session_id, request)
    return _development_overview(await mooi.write_development_environment(caller, session.project_id, body.values))


# --- production: project-scoped configuration, deployments and GitHub releases -----------------
#
# A project's production configuration (DEPLOYMENT.md, deploy.sh, status.sh and environment values)
# lives encrypted in mic-mooi. Deployments and status checks are project-scoped: they never need a
# chat. The optional production chat (a `kind="production"` session) edits the configuration through
# the token-guarded agent endpoints below. A failed deployment is never handed to it automatically:
# the user decides whether to adjust it in the chat.


EVENT_PRODUCTION_SYNC = "production.sync"
EVENT_PRODUCTION_LOG = "production.log"
EVENT_PRODUCTION_CONFIGURATION = "production.configuration"
_PRODUCTION_LOG_LIMIT = 2000
_PRODUCTION_BASE_ENVIRONMENT = ("PATH", "HOME", "USER", "LANG", "SSH_AUTH_SOCK")


@dataclass
class ProductionRun:
    """One project's live production state in this process: at most one deployment at a time,
    its output kept in memory for the console and persisted with the history entry when done."""

    project_id: UUID
    player_id: UUID
    snapshot: ProductionSnapshot = field(default_factory=ProductionSnapshot)
    logs: list[str] = field(default_factory=list)
    log: EventLog = field(default_factory=lambda: EventLog(limit=256))
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task[None] | None = None


_production_runs: dict[UUID, ProductionRun] = {}
_production_capacity_lock = asyncio.Lock()
_production_status_capacity = asyncio.Semaphore(16)


def _production_run(caller: Caller, project_id: UUID) -> ProductionRun:
    """Only call after mic-mooi has confirmed the caller owns the project."""
    run = _production_runs.get(project_id)
    if run is None:
        run = _production_runs[project_id] = ProductionRun(project_id=project_id, player_id=caller.player_id)
    elif run.player_id != caller.player_id:
        raise ApiException.not_found("Project not found")
    return run


async def _owned_production(caller: Caller, project_id: UUID) -> tuple[mooi.Project, ProductionRun]:
    project = await mooi.fetch_project(caller, project_id)
    return project, _production_run(caller, project_id)


def _production_chat(player_id: UUID, project_id: UUID) -> Session | None:
    return next((session for session in get_registry().list_for(player_id, project_id)
                 if session.kind == "production" and not session.closing), None)


def _publish_production(run: ProductionRun, snapshot: ProductionSnapshot) -> None:
    run.snapshot = snapshot
    run.log.append(EVENT_PRODUCTION_UPDATED, snapshot.model_dump(mode="json"))


def _publish_production_sync(run: ProductionRun) -> None:
    run.log.append(EVENT_PRODUCTION_SYNC, {"snapshot": run.snapshot.model_dump(mode="json"), "logs": run.logs})


def _publish_production_output(run: ProductionRun, operation_id: UUID, lines: list[str]) -> None:
    run.logs = [*run.logs, *lines][-_PRODUCTION_LOG_LIMIT:]
    run.log.append(EVENT_PRODUCTION_LOG, {"operationId": str(operation_id), "lines": lines})


def _notify_production_configuration(run: ProductionRun, documents: ProductionDocuments) -> None:
    run.log.append(EVENT_PRODUCTION_CONFIGURATION, {"revision": documents.revision})


async def _production_environment(caller: Caller, project_id: UUID) -> dict[str, str]:
    """The inherited development environment plus the deployment's own values: server-wide
    MOOI_PRODUCTION_ ones from .env, overridden by the project's stored ones."""
    values, stored = await asyncio.gather(_development_environment(caller, project_id),
                                          mooi.fetch_production_environment(caller, project_id))
    values.update(production_environment())
    values.update(stored)
    return {name: value for name, value in values.items() if value}


def _require_environment(files: ProductionStoredFiles, environment: dict[str, str]) -> None:
    missing = [name for name in _required_environment(files) if name not in environment]
    if missing:
        raise ApiException.conflict("Set the missing environment variables: " + ", ".join(missing))


def _production_process_environment(environment: dict[str, str], snapshot: ProductionSnapshot) -> dict[str, str]:
    process_environment = {key: value for key, value in os.environ.items() if key in _PRODUCTION_BASE_ENVIRONMENT}
    process_environment.update(environment)
    process_environment.update({"MOOI_PRODUCTION_RELEASE_TAG": snapshot.releaseTag or "",
                                "MOOI_PRODUCTION_RELEASE_SHA": snapshot.releaseCommit or "",
                                "MOOI_PRODUCTION_RELEASE_URL": snapshot.releaseUrl or ""})
    return process_environment


def _production_prompt(session: Session, request: str) -> str:
    """The production chat's brief around the user's request, sent visibly as the conversation's first
    message (and again after it is cleared or compacted)."""
    base = f"http://127.0.0.1:{get_settings().sessions_port}/sessions/{session.id}/production/agent"
    branch = session.base_branch
    return f"""You are the production deployment assistant of https://github.com/{session.project_full_name}.

The working directory is a clone of the default branch `{branch}`. Read it to understand how the project builds, runs and is configured.

## Deployment documents
The production configuration is exactly three VIRTUAL documents stored only in the Mooi platform. Never write them to the repository or to any file:
- `DEPLOYMENT.md` (field `manifest`): what the deployment does, its target, method, prerequisites, required environment variables and how the service is verified.
- `deploy.sh` (field `script`): a non-interactive bash script the platform runs from a detached checkout of the GitHub release the user selects (that checkout is the working directory). It must start with `set -euo pipefail`, be repeatable, read every secret from environment variables and deploy exactly `MOOI_PRODUCTION_RELEASE_SHA`.
- `status.sh` (field `statusScript`): a non-interactive, read-only bash script, safe to run repeatedly from an empty working directory, that exits 0 only while the deployed service is healthy and prints concise status details. It must not depend on release variables.

Save each document with the platform API as soon as you write or change it, one document per request, so the user follows your progress in the Platform files tab.

## Environment
Scripts read configuration only from variables named `MOOI_PRODUCTION_<NAME>` and the project's development variables `MOOI_DEVELOPMENT_<NAME>`, which they inherit from the project's sessions: reuse a development value (an API key, a service URL...) when production needs exactly the same one, and give production its own `MOOI_PRODUCTION_` variable when it must differ. The platform provides `MOOI_PRODUCTION_RELEASE_TAG`, `MOOI_PRODUCTION_RELEASE_SHA` and `MOOI_PRODUCTION_RELEASE_URL`. Every other `MOOI_PRODUCTION_` or `MOOI_DEVELOPMENT_` variable the scripts mention without a shell default (`${{NAME:-default}}`) is required. Ask the user for each missing value (hosts, users, keys, tokens, domains...) and never invent credentials. Save the `MOOI_PRODUCTION_` values the user gives you with the environment endpoint; the user can also set them in the Environment section of the deployment overview. Development values belong to the project's sessions: ask the user to set a missing one from any session. Read the stored values with the environment endpoint whenever you need them, and tell the user a value only when they ask for it.

## Repository changes
Only when the deployment truly needs files inside the repository (for example a Dockerfile, a Compose file or a CI workflow), create or edit them in the working directory: the user sees them in the Changes tab. Never change application behaviour for it.
Before committing, ask the user whether to commit and push them to `{branch}`, listing every changed file (use your question tool when available, otherwise ask and wait for the reply). Only after an explicit yes, publish them with the commit endpoint; never run `git commit` or `git push` yourself. If the user declines, revert those files and adapt the deployment without them.

## Platform API
Use Python urllib with an inline JSON body, never a temporary file, and send the header `X-Production-Edit-Token: {session.agent_token}`:
- `GET {base}/documents`: active and draft documents plus the names of stored environment variables.
- `PATCH {base}/documents` with any of the JSON keys `manifest`, `script`, `statusScript`: saves those documents into the draft and keeps the others.
- `GET {base}/environment`: `values` (the project's stored `MOOI_PRODUCTION_` and inherited `MOOI_DEVELOPMENT_` values the scripts receive) and `serverProvided` (names of server-wide values whose values you cannot read).
- `PUT {base}/environment` with JSON `{{"values": {{"MOOI_PRODUCTION_NAME": "value"}}}}` (null removes a variable).
- `POST {base}/repository/commit` with JSON `{{"message": "<commit title>"}}`: commits every repository change onto `{branch}` as one commit and pushes it. It answers 409 with the conflicting files when `{branch}` moved in a conflicting way.
- `GET {base}/deployments/{{operationId}}`: read-only detail of a past attempt (files, result, redacted output).
- `POST {base}/deployments` with an empty JSON body `{{}}`: runs a real test deployment of the draft (or the active configuration when there is no draft). The platform chooses the release itself: right after you commit repository changes, a new release it creates from `{branch}`; otherwise the release currently deployed in production (latest successful deployment) or, when nothing was ever deployed, {_FIRST_RELEASE_TAG}, created on `{branch}` when missing. It returns the deployment snapshot.
- `GET {base}/deployment?wait=120`: waits up to 120 seconds while a deployment runs, then returns its snapshot (state running, succeeded or failed; message; releaseTag) and the latest redacted output. Repeat it while the state is running.

## Testing
Testing is mandatory: finish every setup, update or fix with a successful test deployment. Once all three documents are saved, every required variable is stored and any repository change is committed, start the test and wait for its result. If it fails, find the cause in the output, save the corrected documents (ask the user for anything missing) and test again. A successful test deploys that release to production and makes the draft the active configuration. Only after a successful test tell the user clearly that the deployment is tested and working: they can deploy any release with the Deploy button and close this chat.

Never run deploy.sh yourself and never choose, create or publish releases yourself: the test endpoint does it.

## Request
{request}"""


def _production_comparison(caller: Caller, project_id: UUID, documents: ProductionDocuments,
                           ) -> tuple[ProductionStoredFiles | None, ProductionStoredFiles | None]:
    """What the Platform files compare: a live chat's own changes since it opened, like a session's
    changes since its base commit; otherwise the pending draft against the active configuration.
    Closing the chat accepts its changes, which a successful test already published."""
    chat = _production_chat(caller.player_id, project_id)
    before = chat.platform_baseline if chat is not None else documents.active
    return before, documents.draft or documents.active


def _document_texts(before: BaseModel | None, after: BaseModel | None, field_name: str) -> tuple[str, str]:
    return (getattr(before, field_name) if before else "", getattr(after, field_name) if after else "")


def _documents_changes_payload(names: dict[str, str], before: BaseModel | None,
                               after: BaseModel | None) -> ChangesPayload:
    """Platform documents (file name -> field) written and different from `before`: one the agent has
    not written yet is no change. Shared by every platform chat, like a session's changes."""
    files: list[ChangedFilePayload] = []
    added = removed = 0
    for path, field_name in names.items():
        old, new = _document_texts(before, after, field_name)
        if old == new or not new.strip():
            continue
        delta = list(difflib.ndiff(old.splitlines(), new.splitlines()))
        file_added = sum(line.startswith("+ ") for line in delta)
        file_removed = sum(line.startswith("- ") for line in delta)
        files.append(ChangedFilePayload(path=path, change="modified" if old else "added",
                                        added=file_added, removed=file_removed))
        added += file_added
        removed += file_removed
    return ChangesPayload(branch="Current configuration", baseBranch="Previous configuration",
                          added=added, removed=removed, files=files)


def _documents_file_diff(names: dict[str, str], before: BaseModel | None, after: BaseModel | None,
                         path: str) -> FileDiffPayload:
    field_name = names.get(path)
    if field_name is None:
        raise ApiException.not_found("Platform document not found")
    old, new = _document_texts(before, after, field_name)
    diff = "".join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                        fromfile=f"a/{path}", tofile=f"b/{path}"))
    return FileDiffPayload(path=path, diff=diff)


async def _save_production_draft(caller: Caller, project_id: UUID,
                                 changes: ProductionFiles | ProductionFilesPatch) -> ProductionDocuments:
    """Merges the given documents into the draft, which starts from the active configuration."""
    run = _production_run(caller, project_id)
    async with run.lock:
        if run.snapshot.state == "running":
            raise ApiException.conflict("Wait until the deployment completes")
        current = await _production_documents(caller, project_id)
        base = current.draft or current.active or ProductionStoredFiles(manifest="", script="")
        files = base.model_copy(update=changes.model_dump(exclude_none=True))
        documents = ProductionDocuments.model_validate(
            await mooi.write_production_recipe(caller, project_id, files.model_dump()))
        # Any change, from the agent or the user, needs a new successful test before the chat can close.
        if (chat := _production_chat(caller.player_id, project_id)) is not None:
            chat.platform_tested = False
        _notify_production_configuration(run, documents)
        return documents


async def _save_production_environment(caller: Caller, project_id: UUID,
                                       body: ProductionEnvironmentUpdate) -> ProductionDocuments:
    run = _production_run(caller, project_id)
    documents = ProductionDocuments.model_validate(
        await mooi.write_production_environment(caller, project_id, body.values))
    _notify_production_configuration(run, documents)
    return documents


@router.get("/production/projects/{project_id}")
async def production_overview(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> ProductionOverview:
    _, run = await _owned_production(caller, project_id)
    documents, development = await asyncio.gather(_production_documents(caller, project_id),
                                                  _development_environment(caller, project_id))
    files = documents.draft or documents.active
    required = set(_required_environment(files))
    stored = set(documents.environment)
    server = {name for name, value in production_environment().items() if value}
    chat = _production_chat(caller.player_id, project_id)
    return ProductionOverview(
        configured=files is not None and files.complete, deployed=documents.active is not None,
        hasDraft=documents.draft is not None, revision=documents.revision,
        environment=[ProductionEnvironmentVariable(name=name, configured=name in stored or name in server
                                                   or name in development, required=name in required,
                                                   inherited=name.startswith("MOOI_DEVELOPMENT_"))
                     for name in sorted(required | stored)],
        snapshot=run.snapshot, chatSessionId=chat.id if chat else None,
        chatTested=bool(chat and chat.platform_tested),
    )


@router.get("/production/projects/{project_id}/events")
async def stream_production_events(project_id: UUID, request: Request,
                                   caller: Annotated[Caller, Depends(current_caller)]) -> StreamingResponse:
    """Live production state: a `production.sync` snapshot with the retained output, then updates,
    output batches and configuration changes. Reconnecting simply starts from a fresh sync."""
    _, run = await _owned_production(caller, project_id)
    settings = get_settings()
    queue = run.log.subscribe()

    async def frames() -> AsyncIterator[str]:
        try:
            last_seq = run.log.last_seq
            yield sse_frame(Event(last_seq, datetime.now(UTC), EVENT_PRODUCTION_SYNC,
                                  {"snapshot": run.snapshot.model_dump(mode="json"), "logs": run.logs}))
            next_auth_check = time.monotonic() + settings.introspection_cache_seconds
            while True:
                if time.monotonic() >= next_auth_check:
                    try:
                        await current_caller(request)
                    except Exception:
                        LOG.debug("Production stream authentication ended", exc_info=True)
                        return
                    next_auth_check = time.monotonic() + settings.introspection_cache_seconds
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), settings.sse_heartbeat_seconds)
                except TimeoutError:
                    yield sse_heartbeat()
                    continue
                if event is None:
                    return
                if event.seq > last_seq:
                    yield sse_frame(event)
                    last_seq = event.seq
        finally:
            run.log.unsubscribe(queue)

    return StreamingResponse(frames(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.get("/production/projects/{project_id}/documents")
async def production_documents(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> ProductionDocuments:
    return await _production_documents(caller, project_id)


@router.put("/production/projects/{project_id}/documents/draft")
async def save_production_documents(project_id: UUID, body: ProductionFiles,
                                    caller: Annotated[Caller, Depends(current_caller)]) -> ProductionDocuments:
    await _owned_production(caller, project_id)
    return await _save_production_draft(caller, project_id, body)


@router.put("/production/projects/{project_id}/environment")
async def update_production_environment(project_id: UUID, body: ProductionEnvironmentUpdate,
                                        caller: Annotated[Caller, Depends(current_caller)]) -> ProductionDocuments:
    await _owned_production(caller, project_id)
    return await _save_production_environment(caller, project_id, body)


@router.delete("/production/projects/{project_id}/configuration", status_code=status.HTTP_204_NO_CONTENT)
async def delete_production_configuration(project_id: UUID,
                                          caller: Annotated[Caller, Depends(current_caller)]) -> Response:
    """Removes the documents and environment values; history and the deployed service stay."""
    _, run = await _owned_production(caller, project_id)
    async with run.lock:
        if run.snapshot.state == "running":
            raise ApiException.conflict("Wait until the deployment completes")
        await mooi.delete_production_recipe(caller, project_id)
        chat = _production_chat(caller.player_id, project_id)
        if chat is not None:
            await close_session(chat.id)
        _notify_production_configuration(run, ProductionDocuments())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/production/projects/{project_id}/changes")
async def production_changes(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> ChangesPayload:
    documents = await _production_documents(caller, project_id)
    return _documents_changes_payload(_PRODUCTION_FILE_NAMES, *_production_comparison(caller, project_id, documents))


@router.get("/production/projects/{project_id}/changes/file")
async def production_file_diff(project_id: UUID, path: str,
                               caller: Annotated[Caller, Depends(current_caller)]) -> FileDiffPayload:
    documents = await _production_documents(caller, project_id)
    return _documents_file_diff(_PRODUCTION_FILE_NAMES, *_production_comparison(caller, project_id, documents), path)


@router.get("/production/projects/{project_id}/releases")
async def production_releases(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> ReleaseList:
    project, _ = await _owned_production(caller, project_id)
    data = await _github_api(caller, project.full_name, "GET", "releases?per_page=50")
    return ReleaseList(releases=[GithubRelease(tag=item["tag_name"], name=item.get("name") or item["tag_name"],
                                               url=item["html_url"], publishedAt=item.get("published_at"))
                                 for item in data if not item.get("draft")])


@router.post("/production/projects/{project_id}/deployments", status_code=status.HTTP_202_ACCEPTED)
async def start_production(project_id: UUID, body: StartProductionRequest,
                           caller: Annotated[Caller, Depends(current_caller)]) -> ProductionSnapshot:
    project, run = await _owned_production(caller, project_id)
    return await _start_production(run, caller, project, body)


async def _start_production(run: ProductionRun, caller: Caller, project: mooi.Project,
                            body: StartProductionRequest) -> ProductionSnapshot:
    project_id = project.id
    async with run.lock:
        if run.snapshot.state == "running":
            return run.snapshot
        if (backup := _backup_runs.get(project_id)) is not None and backup.snapshot.state == "running":
            raise ApiException.conflict("Wait until the running backup operation completes")
        documents = await _production_documents(caller, project_id)
        files = documents.draft or documents.active
        if files is None:
            raise ApiException.conflict("Set up the production deployment first")
        if not files.complete:
            raise ApiException.conflict("Finish DEPLOYMENT.md, deploy.sh and status.sh before deploying")
        environment = await _production_environment(caller, project_id)
        _require_environment(files, environment)
        release, release_sha = await _resolve_production_release(project, caller, body)
        now = datetime.now(UTC)
        snapshot = ProductionSnapshot(state="running", operationId=uuid4(), message=f"Fetching release {body.tag}",
                                      releaseTag=body.tag, releaseUrl=release["html_url"], releaseCommit=release_sha,
                                      startedAt=now, updatedAt=now)
        previous, previous_logs = run.snapshot, run.logs
        async with _production_capacity_lock:
            running = sum(1 for item in _production_runs.values() if item.snapshot.state == "running")
            if running >= get_settings().max_deployments:
                raise ApiException(status.HTTP_429_TOO_MANY_REQUESTS, "Production deployment capacity is full")
            run.logs = []
            _publish_production(run, snapshot)
        chat = _production_chat(caller.player_id, project_id)
        try:
            await mooi.start_production_deployment(caller, project_id, snapshot.operationId,
                                                   chat.id if chat else None, body.tag, files.model_dump())
        except Exception:
            run.snapshot, run.logs = previous, previous_logs
            _publish_production_sync(run)
            raise
        run.task = asyncio.create_task(_run_production(run, caller, project, files, environment,
                                                       documents.draft is not None))
        return snapshot


async def _run_production(run: ProductionRun, caller: Caller, project: mooi.Project, files: ProductionStoredFiles,
                          environment: dict[str, str], publish_draft: bool) -> None:
    """Run deploy.sh against a temporary checkout of the selected release."""
    started = run.snapshot
    operation_id = started.operationId
    assert operation_id is not None and started.releaseTag is not None and started.releaseCommit is not None
    checkout: Path | None = None

    async def conclude(state: Literal["succeeded", "failed"], message: str) -> None:
        """Persist first, so clients reloading history on the final snapshot see the outcome."""
        try:
            await mooi.finish_production_deployment(caller, project.id, operation_id, state, message, run.logs)
        except Exception:
            LOG.warning("Could not save %s deployment %s", state, operation_id, exc_info=True)
        _publish_production(run, started.model_copy(update={
            "state": state, "message": message, "updatedAt": datetime.now(UTC)}))

    try:
        token = await mooi.fetch_github_token(caller)
        checkout = await workspaces.get_workspaces().create_release_checkout(
            operation_id, project.full_name, started.releaseTag, started.releaseCommit, token)
        _publish_production(run, started.model_copy(update={"message": "Running deploy.sh",
                                                            "updatedAt": datetime.now(UTC)}))
        redacted = (str(checkout), *(value for value in environment.values() if len(value) >= 4))
        code = await run_script(files.script, cwd=checkout, timeout=get_settings().deployment_timeout_seconds,
                                environment=_production_process_environment(environment, started),
                                redact=lambda text: redact_deployment_output(text, redacted),
                                on_output=lambda lines: _publish_production_output(run, operation_id, lines))
        if code != 0:
            raise RuntimeError(f"deploy.sh exited with code {code}")
        if publish_draft:
            documents = ProductionDocuments.model_validate(await mooi.publish_production_recipe(caller, project.id))
            _notify_production_configuration(run, documents)
        chat = _production_chat(run.player_id, run.project_id)
        if chat is not None:
            chat.platform_tested = True
        await conclude("succeeded", "Production deployment completed")
    except asyncio.CancelledError:
        await conclude("failed", "Production deployment interrupted")
        raise
    except Exception as error:
        if isinstance(error, TimeoutError):
            message = "Deployment timed out"
        elif isinstance(error, (RuntimeError, ApiException)):
            message = str(error) or "Production deployment failed"
        else:
            LOG.warning("Production deployment %s failed", operation_id, exc_info=True)
            message = "Production deployment failed"
        await conclude("failed", message)
    finally:
        if checkout is not None:
            with suppress(Exception):
                await workspaces.get_workspaces().remove_release_checkout(operation_id)


@router.post("/production/projects/{project_id}/status")
async def check_production_status(project_id: UUID,
                                  caller: Annotated[Caller, Depends(current_caller)]) -> ProductionStatusResult:
    _, run = await _owned_production(caller, project_id)
    if run.snapshot.state == "running":
        raise ApiException.conflict("Wait until the deployment completes")
    documents = await _production_documents(caller, project_id)
    files = documents.active or documents.draft
    if files is None or not files.statusScript.strip():
        raise ApiException.conflict("Add status.sh to the deployment configuration first")
    environment = await _production_environment(caller, project_id)
    _require_environment(files, environment)
    try:
        await asyncio.wait_for(_production_status_capacity.acquire(), timeout=0.1)
    except TimeoutError:
        raise ApiException(status.HTTP_429_TOO_MANY_REQUESTS, "Status checks are busy; try again shortly") from None
    try:
        with tempfile.TemporaryDirectory(prefix="mooi-status-") as directory:
            return await _run_production_status(files.statusScript, Path(directory),
                                                _production_process_environment(environment, run.snapshot),
                                                environment)
    finally:
        _production_status_capacity.release()


async def _run_production_status(script: str, workspace: Path, environment: dict[str, str],
                                 available: dict[str, str]) -> ProductionStatusResult:
    process = await asyncio.create_subprocess_exec(
        "bash", "-se", cwd=workspace, stdin=asyncio.subprocess.PIPE,
        env=environment, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        async with asyncio.timeout(30):
            assert process.stdin is not None and process.stdout is not None
            try:
                process.stdin.write(script.encode())
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                process.stdin.close()
            chunks: list[bytes] = []
            size = 0
            while chunk := await process.stdout.read(4096):
                size += len(chunk)
                if size > 32768:
                    raise RuntimeError("Status output exceeded 32 KB")
                chunks.append(chunk)
            code = await process.wait()
    except (TimeoutError, RuntimeError) as error:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        await process.wait()
        return ProductionStatusResult(state="unhealthy", output=str(error) or "Status check timed out")
    finally:
        if process.returncode is None:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
    secrets = tuple(value for value in available.values() if len(value) >= 4)
    output = redact_deployment_output(b"".join(chunks).decode("utf-8", "replace"), secrets).strip()
    return ProductionStatusResult(state="healthy" if code == 0 else "unhealthy",
                                  output=output[:32768] or f"Status script exited with code {code}")


@router.delete("/production/projects/{project_id}/deployments/{operation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_production_deployment(project_id: UUID, operation_id: UUID,
                                       caller: Annotated[Caller, Depends(current_caller)]) -> Response:
    _, run = await _owned_production(caller, project_id)
    async with run.lock:
        if run.snapshot.operationId == operation_id and run.snapshot.state == "running":
            raise ApiException.conflict("Wait for the deployment to finish before deleting its data")
        await mooi.delete_production_deployment(caller, project_id, operation_id)
        if run.snapshot.operationId == operation_id:
            run.snapshot, run.logs = ProductionSnapshot(), []
            _publish_production_sync(run)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _agent_recipe_access(session_id: UUID, request: Request) -> tuple[Session, Caller]:
    session = get_registry().get(session_id)
    token = request.headers.get("X-Production-Edit-Token", "")
    if (request.client is None or request.client.host not in ("127.0.0.1", "::1")
            or session is None or session.kind != "production" or session.closing
            or not hmac.compare_digest(token, session.agent_token)
            or session.agent_caller is None):
        raise ApiException.not_found("Deployment configuration not found")
    return session, session.agent_caller


@router.get("/sessions/{session_id}/production/agent/documents")
async def agent_production_documents(session_id: UUID, request: Request) -> ProductionDocuments:
    session, caller = _agent_recipe_access(session_id, request)
    return await _production_documents(caller, session.project_id)


@router.put("/sessions/{session_id}/production/agent/documents")
@router.patch("/sessions/{session_id}/production/agent/documents")
async def agent_save_production_documents(session_id: UUID, request: Request,
                                          body: ProductionFilesPatch) -> ProductionDocuments:
    """Saves some or all documents into the draft; a full PUT behaves exactly like a PATCH of all three."""
    session, caller = _agent_recipe_access(session_id, request)
    return await _save_production_draft(caller, session.project_id, body)


@router.post("/sessions/{session_id}/production/agent/repository/commit")
async def agent_commit_repository(session_id: UUID, request: Request, body: MergeRequest) -> MergePayload:
    """Publishes the chat's repository changes, which the agent only calls after the user approved
    them: one commit onto the default branch, pushed as a fast-forward and never forced."""
    session, caller = _agent_recipe_access(session_id, request)
    payload = await _commit_platform_repository(session, caller, body)
    if payload.commit is not None:
        session.production_release_pending = True
    return payload


async def _commit_platform_repository(session: Session, caller: Caller, body: MergeRequest) -> MergePayload:
    """One commit of a platform chat's repository changes onto the default branch, pushed as a
    fast-forward and never forced."""
    message = body.message.strip()
    if not message:
        raise ApiException.bad_request("The commit title cannot be blank")
    if session.workspace == _UNSET_PATH:
        raise ApiException.conflict("The workspace is still being prepared")
    token, identity = await asyncio.gather(mooi.fetch_github_token(caller), mooi.fetch_github_identity(caller))
    async with session.changes_lock:
        preview, commit = await workspaces.merge(session.workspace, session.base_branch, message, identity, token)
    if preview.conflicts:
        raise ApiException.conflict(f"{preview.target} changed in the same files: " + ", ".join(preview.conflicts))
    if commit is not None:
        session.base_commit = commit
        record(session, EVENT_MERGE_COMPLETED, {"targetBranch": preview.target, "commit": commit, "message": message})
        _schedule_changes_refresh(session, debounce=False)
    return _merge_payload(preview, commit)


@router.get("/sessions/{session_id}/production/agent/environment")
async def agent_production_environment(session_id: UUID, request: Request) -> AgentEnvironment:
    session, caller = _agent_recipe_access(session_id, request)
    development, stored = await asyncio.gather(mooi.fetch_development_environment(caller, session.project_id),
                                               mooi.fetch_production_environment(caller, session.project_id))
    return _agent_environment({**development, **stored}, {**development_environment(), **production_environment()})


@router.put("/sessions/{session_id}/production/agent/environment")
async def agent_save_production_environment(session_id: UUID, request: Request,
                                            body: ProductionEnvironmentUpdate) -> ProductionDocuments:
    session, caller = _agent_recipe_access(session_id, request)
    return await _save_production_environment(caller, session.project_id, body)


@router.get("/sessions/{session_id}/production/agent/deployments/{operation_id}")
async def agent_production_deployment_detail(session_id: UUID, operation_id: UUID, request: Request) -> dict:
    session, caller = _agent_recipe_access(session_id, request)
    return await mooi.fetch_production_deployment_detail(caller, session.project_id, operation_id)


@router.post("/sessions/{session_id}/production/agent/deployments", status_code=status.HTTP_202_ACCEPTED)
async def agent_test_production(session_id: UUID, request: Request) -> ProductionSnapshot:
    """A real deployment of the current configuration with the release `_test_release` picks."""
    session, caller = _agent_recipe_access(session_id, request)
    project = await mooi.fetch_project(caller, session.project_id)
    run = _production_run(caller, session.project_id)
    release = await _test_release(caller, project, session.production_release_pending)
    snapshot = await _start_production(run, caller, project, release)
    if release.create and snapshot.releaseTag == release.tag:
        session.production_release_pending = False
    return snapshot


@router.get("/sessions/{session_id}/production/agent/deployment")
async def agent_production_deployment(session_id: UUID, request: Request, wait: int = 0) -> dict:
    """The live deployment snapshot and its latest output, optionally waiting while it runs."""
    session, caller = _agent_recipe_access(session_id, request)
    run = _production_run(caller, session.project_id)
    task = run.task
    if wait > 0 and run.snapshot.state == "running" and task is not None and not task.done():
        await asyncio.wait({task}, timeout=min(wait, 120))
    return {"snapshot": run.snapshot.model_dump(mode="json"), "output": run.logs[-200:]}


async def close_productions() -> None:
    """Interrupts running deployments on shutdown; each records itself as interrupted."""
    tasks = [run.task for run in _production_runs.values() if run.task is not None and not run.task.done()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    for run in _production_runs.values():
        run.log.close()


# --- backups: project-scoped configuration, backups and restores -------------------------------
#
# A project's backup configuration (BACKUP.md, backup.sh, restore.sh, delete.sh and MOOI_BACKUP_
# values) lives encrypted in mic-mooi next to the durable record of every backup and of each
# operation run on it. Like production, operations are project-scoped and never need a chat: they
# run one at a time per project, never alongside a production deployment, from a checkout of the
# backup's release. The optional backup chat (a `kind="backup"` session) writes the configuration
# through the token-guarded agent endpoints and has to prove it: a backup followed by a restore of
# that same backup into a disposable verification instance, both with the current documents. Only
# that proof publishes a draft. Restoring into production is only ever the user's explicit action,
# and only onto the release the backup was taken from.


EVENT_BACKUP_SYNC = "backup.sync"
EVENT_BACKUP_UPDATED = "backup.updated"
EVENT_BACKUP_LOG = "backup.log"
EVENT_BACKUP_CONFIGURATION = "backup.configuration"
_BACKUP_FILE_NAMES = {"BACKUP.md": "manifest", "backup.sh": "backupScript",
                      "restore.sh": "restoreScript", "delete.sh": "deleteScript"}
_BACKUP_SCRIPT_NAMES = {"backup": "backup.sh", "restore": "restore.sh", "delete": "delete.sh"}
_BACKUP_PLATFORM_ENVIRONMENT = frozenset({
    "MOOI_BACKUP_ID", "MOOI_BACKUP_RELEASE_TAG", "MOOI_BACKUP_TARGET", "MOOI_BACKUP_CREATED_AT",
}) | _PRODUCTION_PLATFORM_ENVIRONMENT
_BACKUP_VARIABLE = re.compile(r"\bMOOI_(?:BACKUP|PRODUCTION|DEVELOPMENT)_[A-Z0-9_]+\b")
_BACKUP_DEFAULTED = re.compile(r"\$\{(MOOI_(?:BACKUP|PRODUCTION|DEVELOPMENT)_[A-Z0-9_]+):?[-=+]")

BackupAction = Literal["backup", "restore", "delete"]
RestoreTarget = Literal["production", "verification"]


class BackupStoredFiles(BaseModel):
    """BACKUP.md, backup.sh, restore.sh and delete.sh as stored: virtual documents living only in the
    platform. A draft may still miss documents while the agent writes them one by one."""

    manifest: str
    backupScript: str
    restoreScript: str
    deleteScript: str

    @property
    def complete(self) -> bool:
        return all(text.strip() for text in (self.manifest, self.backupScript, self.restoreScript, self.deleteScript))


class BackupFiles(BackupStoredFiles):
    """A complete draft as written by the user."""

    manifest: str = Field(min_length=1, max_length=65536, pattern=r"\S")
    backupScript: str = Field(min_length=1, max_length=65536, pattern=r"\S")
    restoreScript: str = Field(min_length=1, max_length=65536, pattern=r"\S")
    deleteScript: str = Field(min_length=1, max_length=65536, pattern=r"\S")


class BackupFilesPatch(BaseModel):
    """Some documents, merged into the current draft so each one is saved as soon as it is written."""

    manifest: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")
    backupScript: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")
    restoreScript: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")
    deleteScript: str | None = Field(default=None, min_length=1, max_length=65536, pattern=r"\S")

    @model_validator(mode="after")
    def validate_documents(self) -> BackupFilesPatch:
        if not self.model_dump(exclude_none=True):
            raise ValueError("Send at least one document")
        return self


class BackupDocuments(BaseModel):
    active: BackupStoredFiles | None = None
    draft: BackupStoredFiles | None = None
    revision: int = 0
    environment: list[str] = Field(default_factory=list)


class BackupSnapshot(BaseModel):
    """The live backup operation of one project in this process; output travels separately."""

    state: Literal["idle", "running", "succeeded", "failed"] = "idle"
    operationId: UUID | None = None
    action: BackupAction | None = None
    target: RestoreTarget | None = None
    backupId: UUID | None = None
    # The name backup.sh stores the backup under: MOOI_BACKUP_ID.
    backupKey: str | None = None
    backupCreatedAt: datetime | None = None
    releaseTag: str | None = None
    message: str | None = None
    startedAt: datetime | None = None
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(UTC))


class BackupEnvironmentVariable(BaseModel):
    name: str
    configured: bool
    required: bool
    # A MOOI_PRODUCTION_ value, managed with the production deployment, or a MOOI_DEVELOPMENT_ one,
    # managed in the project's sessions.
    inherited: bool = False


class BackupOverview(BaseModel):
    # All four documents exist (as draft or active).
    configured: bool
    # An active configuration exists: it passed a backup and a verification restore.
    active: bool
    hasDraft: bool
    revision: int
    environment: list[BackupEnvironmentVariable]
    snapshot: BackupSnapshot
    chatSessionId: UUID | None
    chatTested: bool = False
    # The release production runs: new backups belong to it and only its backups restore into production.
    deployedRelease: str | None = None


class RestoreBackupRequest(BaseModel):
    target: RestoreTarget


class AgentRestoreRequest(BaseModel):
    backupId: UUID


@dataclass
class BackupRun:
    """One project's live backup state in this process: at most one operation at a time, its output
    kept in memory for the console and persisted with the operation record when done."""

    project_id: UUID
    player_id: UUID
    snapshot: BackupSnapshot = field(default_factory=BackupSnapshot)
    logs: list[str] = field(default_factory=list)
    log: EventLog = field(default_factory=lambda: EventLog(limit=256))
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task[None] | None = None
    # Backups the chat's agent made, with the (revision, draft) of the documents that made them: a
    # verification restore run with those very documents completes the proof.
    proofs: dict[UUID, tuple[int, bool]] = field(default_factory=dict)


_backup_runs: dict[UUID, BackupRun] = {}


def _backup_run(caller: Caller, project_id: UUID) -> BackupRun:
    """Only call after mic-mooi has confirmed the caller owns the project."""
    run = _backup_runs.get(project_id)
    if run is None:
        run = _backup_runs[project_id] = BackupRun(project_id=project_id, player_id=caller.player_id)
    elif run.player_id != caller.player_id:
        raise ApiException.not_found("Project not found")
    return run


async def _owned_backups(caller: Caller, project_id: UUID) -> tuple[mooi.Project, BackupRun]:
    project = await mooi.fetch_project(caller, project_id)
    return project, _backup_run(caller, project_id)


def _backup_chat(player_id: UUID, project_id: UUID) -> Session | None:
    return next((session for session in get_registry().list_for(player_id, project_id)
                 if session.kind == "backup" and not session.closing), None)


async def _backup_documents(caller: Caller, project_id: UUID) -> BackupDocuments:
    return BackupDocuments.model_validate(await mooi.fetch_backup_recipe(caller, project_id))


def _publish_backup(run: BackupRun, snapshot: BackupSnapshot) -> None:
    run.snapshot = snapshot
    run.log.append(EVENT_BACKUP_UPDATED, snapshot.model_dump(mode="json"))


def _publish_backup_sync(run: BackupRun) -> None:
    run.log.append(EVENT_BACKUP_SYNC, {"snapshot": run.snapshot.model_dump(mode="json"), "logs": run.logs})


def _publish_backup_output(run: BackupRun, operation_id: UUID, lines: list[str]) -> None:
    run.logs = [*run.logs, *lines][-_PRODUCTION_LOG_LIMIT:]
    run.log.append(EVENT_BACKUP_LOG, {"operationId": str(operation_id), "lines": lines})


def _notify_backup_configuration(run: BackupRun, revision: int) -> None:
    run.log.append(EVENT_BACKUP_CONFIGURATION, {"revision": revision})


def _backup_key(backup_id: UUID, started_at: datetime, release_tag: str) -> str:
    """MOOI_BACKUP_ID: date, time and release of the backup plus a unique suffix, sortable and safe as a file name."""
    release = re.sub(r"[^A-Za-z0-9._-]", "-", release_tag)[:60]
    return f"{started_at.astimezone(UTC):%Y%m%d-%H%M%S}-{release}-{backup_id.hex[:8]}"


def _backup_required_environment(files: BackupStoredFiles | None) -> list[str]:
    """Variables the scripts mention, minus shell-defaulted ones and the platform's own."""
    if files is None:
        return []
    scripts = (files.backupScript, files.restoreScript, files.deleteScript)
    names = {name for text in scripts for name in _BACKUP_VARIABLE.findall(text)}
    defaulted = {name for text in scripts for name in _BACKUP_DEFAULTED.findall(text)}
    return sorted(names - defaulted - _BACKUP_PLATFORM_ENVIRONMENT)


async def _backup_environment(caller: Caller, project_id: UUID) -> dict[str, str]:
    """The production environment the scripts may reuse (hosts, keys..., with the development values
    it inherits) plus the backup's own values: server-wide ones from .env overridden by the project's
    stored ones."""
    values = await _production_environment(caller, project_id)
    values.update(backup_environment())
    values.update(await mooi.fetch_backup_environment(caller, project_id))
    return {name: value for name, value in values.items() if value}


def _require_backup_environment(files: BackupStoredFiles, environment: dict[str, str]) -> None:
    missing = [name for name in _backup_required_environment(files) if name not in environment]
    if missing:
        raise ApiException.conflict("Set the missing environment variables: " + ", ".join(missing))


async def _find_backup(caller: Caller, project_id: UUID, backup_id: UUID) -> dict:
    return (await mooi.fetch_backup_detail(caller, project_id, backup_id))["backup"]


async def _admit_backup_operation(run: BackupRun, caller: Caller, project: mooi.Project, action: BackupAction, *,
                                  backup: dict | None = None, target: RestoreTarget | None = None,
                                  chat: Session | None = None) -> BackupSnapshot:
    """Validates and records one operation, then runs it in the background. The chat's agent runs its
    draft (or the active documents without one); the user only ever runs the active, proven ones."""
    async with run.lock:
        if run.snapshot.state == "running":
            raise ApiException.conflict("Wait until the current backup operation completes")
        production = _production_runs.get(project.id)
        if production is not None and production.snapshot.state == "running":
            raise ApiException.conflict("Wait until the production deployment completes")
        documents = await _backup_documents(caller, project.id)
        uses_draft = chat is not None and documents.draft is not None
        files = documents.draft if uses_draft else documents.active
        if files is None:
            raise ApiException.conflict("Set up and test the backup configuration first")
        if not files.complete:
            raise ApiException.conflict("Finish BACKUP.md, backup.sh, restore.sh and delete.sh first")
        environment = await _backup_environment(caller, project.id)
        _require_backup_environment(files, environment)
        deployed = await _current_release(caller, project.id)
        now = datetime.now(UTC).replace(microsecond=0)
        if backup is None:
            if deployed is None:
                raise ApiException.conflict("Deploy the project to production before backing it up")
            backup_id, release_tag, created_at = uuid4(), deployed, now
        else:
            backup_id, release_tag = UUID(backup["id"]), backup["releaseTag"]
            created_at = datetime.fromisoformat(backup["startedAt"].replace("Z", "+00:00"))
            if action == "restore" and backup["state"] != "succeeded":
                raise ApiException.conflict("Only a successful backup can be restored")
            if action == "restore" and target == "production" and deployed != release_tag:
                raise ApiException.conflict(
                    f"This backup belongs to {release_tag} but production runs {deployed or 'no release'}. "
                    f"Deploy {release_tag} before restoring it.")
        release: dict = {}
        release_sha = ""
        if action != "delete":
            release, release_sha = await _resolve_production_release(project, caller, StartProductionRequest(tag=release_tag))
        script = getattr(files, f"{action}Script")
        operation_id = uuid4()
        snapshot = BackupSnapshot(state="running", operationId=operation_id, action=action, target=target,
                                  backupId=backup_id, backupKey=_backup_key(backup_id, created_at, release_tag),
                                  backupCreatedAt=created_at, releaseTag=release_tag, message=f"Preparing {_BACKUP_SCRIPT_NAMES[action]}",
                                  startedAt=now, updatedAt=now)
        previous, previous_logs = run.snapshot, run.logs
        async with _production_capacity_lock:
            running = sum(1 for item in (*_production_runs.values(), *_backup_runs.values())
                          if item.snapshot.state == "running")
            if running >= get_settings().max_deployments:
                raise ApiException(status.HTTP_429_TOO_MANY_REQUESTS, "Operation capacity is full; try again shortly")
            run.logs = []
            _publish_backup(run, snapshot)
        try:
            if action == "backup":
                await mooi.start_backup(caller, project.id, backup_id, operation_id, chat.id if chat else None,
                                        release_tag, created_at, script)
            else:
                await mooi.start_backup_operation(caller, project.id, backup_id, operation_id, action, target, script)
        except Exception:
            run.snapshot, run.logs = previous, previous_logs
            _publish_backup_sync(run)
            raise
        proof = (documents.revision, uses_draft)
        proves = False
        if chat is not None and action == "backup":
            run.proofs[backup_id] = proof
        elif chat is not None and action == "restore":
            proves = run.proofs.get(backup_id) == proof
        run.task = asyncio.create_task(_run_backup_operation(
            run, caller, project, script, environment, release.get("html_url", ""), release_sha,
            publish_draft=proves and uses_draft, proves=proves))
        return snapshot


def _backup_process_environment(environment: dict[str, str], snapshot: BackupSnapshot,
                                release_url: str, release_sha: str) -> dict[str, str]:
    process_environment = {key: value for key, value in os.environ.items() if key in _PRODUCTION_BASE_ENVIRONMENT}
    process_environment.update(environment)
    process_environment.update({
        "MOOI_BACKUP_ID": snapshot.backupKey or "", "MOOI_BACKUP_RELEASE_TAG": snapshot.releaseTag or "",
        "MOOI_BACKUP_CREATED_AT": snapshot.backupCreatedAt.strftime("%Y-%m-%dT%H:%M:%SZ") if snapshot.backupCreatedAt else "",
        "MOOI_PRODUCTION_RELEASE_TAG": snapshot.releaseTag or "", "MOOI_PRODUCTION_RELEASE_SHA": release_sha,
        "MOOI_PRODUCTION_RELEASE_URL": release_url,
    })
    if snapshot.target is not None:
        process_environment["MOOI_BACKUP_TARGET"] = snapshot.target
    return process_environment


async def _run_backup_operation(run: BackupRun, caller: Caller, project: mooi.Project, script: str,
                                environment: dict[str, str], release_url: str, release_sha: str, *,
                                publish_draft: bool, proves: bool) -> None:
    """Runs one script: backup.sh and restore.sh from a checkout of the backup's release, delete.sh
    from an empty directory."""
    started = run.snapshot
    operation_id, backup_id, action = started.operationId, started.backupId, started.action
    assert operation_id is not None and backup_id is not None and action is not None and started.releaseTag is not None
    name = _BACKUP_SCRIPT_NAMES[action]
    checkout: Path | None = None
    scratch: tempfile.TemporaryDirectory[str] | None = None
    succeeded_message = {"backup": "Backup completed", "delete": "Backup deleted",
                         "restore": "Restore verified in a disposable instance" if started.target == "verification"
                         else "Backup restored into production"}[action]

    async def conclude(state: Literal["succeeded", "failed"], message: str) -> None:
        """Persist first, so clients reloading the list on the final snapshot see the outcome."""
        try:
            await mooi.finish_backup_operation(caller, project.id, backup_id, operation_id, state, message, run.logs)
        except Exception:
            LOG.warning("Could not save %s backup operation %s", state, operation_id, exc_info=True)
        _publish_backup(run, started.model_copy(update={"state": state, "message": message,
                                                        "updatedAt": datetime.now(UTC)}))

    try:
        if action == "delete":
            scratch = tempfile.TemporaryDirectory(prefix="mooi-backup-")
            directory = Path(scratch.name)
        else:
            token = await mooi.fetch_github_token(caller)
            checkout = directory = await workspaces.get_workspaces().create_release_checkout(
                operation_id, project.full_name, started.releaseTag, release_sha, token)
        _publish_backup(run, started.model_copy(update={"message": f"Running {name}", "updatedAt": datetime.now(UTC)}))
        redacted = (str(directory), *(value for value in environment.values() if len(value) >= 4))
        code = await run_script(script, cwd=directory, timeout=get_settings().backup_timeout_seconds,
                                environment=_backup_process_environment(environment, started, release_url, release_sha),
                                redact=lambda text: redact_deployment_output(text, redacted),
                                on_output=lambda lines: _publish_backup_output(run, operation_id, lines))
        if code != 0:
            raise RuntimeError(f"{name} exited with code {code}")
        if publish_draft:
            documents = BackupDocuments.model_validate(await mooi.publish_backup_recipe(caller, project.id))
            _notify_backup_configuration(run, documents.revision)
        if proves and (chat := _backup_chat(run.player_id, run.project_id)) is not None:
            chat.platform_tested = True
        if action == "delete":
            run.proofs.pop(backup_id, None)
        await conclude("succeeded", succeeded_message)
    except asyncio.CancelledError:
        await conclude("failed", f"{name} was interrupted")
        raise
    except Exception as error:
        if isinstance(error, TimeoutError):
            message = f"{name} timed out"
        elif isinstance(error, (RuntimeError, ApiException)):
            message = str(error) or f"{name} failed"
        else:
            LOG.warning("Backup operation %s failed", operation_id, exc_info=True)
            message = f"{name} failed"
        await conclude("failed", message)
    finally:
        if checkout is not None:
            with suppress(Exception):
                await workspaces.get_workspaces().remove_release_checkout(operation_id)
        if scratch is not None:
            with suppress(Exception):
                scratch.cleanup()


def _backup_comparison(caller: Caller, project_id: UUID, documents: BackupDocuments,
                       ) -> tuple[BackupStoredFiles | None, BackupStoredFiles | None]:
    """A live chat's own changes since it opened; otherwise the pending draft against the active documents."""
    chat = _backup_chat(caller.player_id, project_id)
    before = chat.platform_baseline if chat is not None else documents.active
    return before, documents.draft or documents.active


async def _save_backup_draft(caller: Caller, project_id: UUID, changes: BackupFiles | BackupFilesPatch) -> BackupDocuments:
    """Merges the given documents into the draft, which starts from the active configuration."""
    run = _backup_run(caller, project_id)
    async with run.lock:
        if run.snapshot.state == "running":
            raise ApiException.conflict("Wait until the backup operation completes")
        current = await _backup_documents(caller, project_id)
        base = current.draft or current.active or BackupStoredFiles(manifest="", backupScript="",
                                                                   restoreScript="", deleteScript="")
        files = base.model_copy(update=changes.model_dump(exclude_none=True))
        documents = BackupDocuments.model_validate(await mooi.write_backup_recipe(caller, project_id, files.model_dump()))
        # Any change, from the agent or the user, needs a new proof before the chat can close.
        if (chat := _backup_chat(caller.player_id, project_id)) is not None:
            chat.platform_tested = False
        _notify_backup_configuration(run, documents.revision)
        return documents


async def _save_backup_environment(caller: Caller, project_id: UUID,
                                   body: ProductionEnvironmentUpdate) -> BackupDocuments:
    run = _backup_run(caller, project_id)
    documents = BackupDocuments.model_validate(await mooi.write_backup_environment(caller, project_id, body.values))
    _notify_backup_configuration(run, documents.revision)
    return documents


def _backup_prompt(session: Session, request: str) -> str:
    """The backup chat's brief around the user's request, sent visibly as the conversation's first
    message (and again after it is cleared or compacted)."""
    base = f"http://127.0.0.1:{get_settings().sessions_port}/sessions/{session.id}/backup/agent"
    branch = session.base_branch
    return f"""You are the backup assistant of https://github.com/{session.project_full_name}.

The working directory is a clone of the default branch `{branch}`. Read it to understand how the project runs in production and every piece of persistent state it keeps (databases, volumes, uploaded files...).

## Production
Backups always belong to the release running in production. Read the production deployment with `GET {base}/production`: its active DEPLOYMENT.md, deploy.sh and status.sh, the release currently deployed and the names of its `MOOI_PRODUCTION_` variables. Your scripts receive those variables too (for example the SSH host, user and key), so reuse them instead of asking again.

## Backup documents
The backup configuration is exactly four VIRTUAL documents stored only in the Mooi platform. Never write them to the repository or to any file:
- `BACKUP.md` (field `manifest`): what is backed up, where backups are stored and how they are named, how the instance is stopped and started, how a restore is verified and the required environment variables.
- `backup.sh` (field `backupScript`): creates backup `MOOI_BACKUP_ID` of the production instance. It must capture every piece of persistent state consistently and verify the backup it produced (complete, readable, checksum) before exiting 0, printing its location, size and a short fingerprint of the data (for example row counts) that a restore can be compared with.
- `restore.sh` (field `restoreScript`): restores backup `MOOI_BACKUP_ID` according to `MOOI_BACKUP_TARGET`:
  - `verification`: an analogous, disposable instance of release `MOOI_BACKUP_RELEASE_TAG`, fully isolated from production (its own name, ports, volumes or database; no public domain, and nothing that writes to production). Create it, restore the backup into it while it is stopped, start it, prove the data came back and the service answers (compare with the fingerprint backup.sh printed), then always destroy it, even on failure. Production is never touched.
  - `production`: the real production instance: stop it, restore the backup, start it again and verify it answers.
- `delete.sh` (field `deleteScript`): permanently removes backup `MOOI_BACKUP_ID` from its storage and succeeds when it no longer exists.

Every script is non-interactive bash starting with `set -euo pipefail`, runs from a detached checkout of the backup's release (delete.sh from an empty directory), reads every secret from environment variables, never prints secrets and prints concise progress. The instance being backed up or restored must be stopped while its data is copied: stop it first and always start it again with a `trap` on EXIT, even when the script fails.

Save each document with the platform API as soon as you write or change it, one document per request, so the user follows your progress in the Platform files tab.

## Environment
The platform provides `MOOI_BACKUP_ID` (date, time and release of the backup plus a unique suffix: use it as the backup's name), `MOOI_BACKUP_CREATED_AT`, `MOOI_BACKUP_RELEASE_TAG`, `MOOI_BACKUP_TARGET` (restore.sh) and the backup release's `MOOI_PRODUCTION_RELEASE_TAG`, `MOOI_PRODUCTION_RELEASE_SHA` and `MOOI_PRODUCTION_RELEASE_URL`. Backup settings use variables named `MOOI_BACKUP_<NAME>` (storage location, bucket credentials, encryption key...). The scripts also receive the project's development variables `MOOI_DEVELOPMENT_<NAME>`, which production inherits from the project's sessions. Every `MOOI_BACKUP_`, `MOOI_PRODUCTION_` or `MOOI_DEVELOPMENT_` variable the scripts mention without a shell default (`${{NAME:-default}}`) is required. Ask the user for each missing backup value and never invent credentials; save the values they give you with the environment endpoint. A missing `MOOI_PRODUCTION_` value belongs to the deployment: ask the user to set it in Deployments; a missing `MOOI_DEVELOPMENT_` value belongs to the project's sessions: ask the user to set it from any session. Read the stored values with the environment endpoint whenever you need them, and tell the user a value only when they ask for it.

## Repository changes
Backups should almost never need repository changes. Only when they truly do, edit files in the working directory (the user sees them in the Changes tab), ask the user whether to commit and push them to `{branch}` listing every changed file, and only after an explicit yes publish them with the commit endpoint; never run `git commit` or `git push` yourself. Backups run from the release deployed in production, so committed changes only apply once the user deploys a new release from Deployments: tell them.

## Platform API
Use Python urllib with an inline JSON body, never a temporary file, and send the header `X-Backup-Edit-Token: {session.agent_token}`:
- `GET {base}/documents`: active and draft documents plus the names of stored backup environment variables.
- `PATCH {base}/documents` with any of the JSON keys `manifest`, `backupScript`, `restoreScript`, `deleteScript`: saves those documents into the draft and keeps the others.
- `GET {base}/environment`: `values` (the project's stored `MOOI_BACKUP_` values plus the inherited `MOOI_PRODUCTION_` and `MOOI_DEVELOPMENT_` ones the scripts receive) and `serverProvided` (names of server-wide values whose values you cannot read).
- `PUT {base}/environment` with JSON `{{"values": {{"MOOI_BACKUP_NAME": "value"}}}}` (null removes a variable).
- `GET {base}/production`: the production deployment documents, the deployed release and its environment variable names (read-only).
- `POST {base}/repository/commit` with JSON `{{"message": "<commit title>"}}`: commits every repository change onto `{branch}` as one commit and pushes it.
- `GET {base}/backups`: the latest backups (id, release, state, dates).
- `GET {base}/backups/{{backupId}}`: one backup with every operation run on it, its script, result and redacted output.
- `POST {base}/backups` with an empty JSON body `{{}}`: runs a real backup of production with the draft (or the active documents when there is no draft) for the release currently deployed. It returns the operation snapshot with the new `backupId` and `backupKey`.
- `POST {base}/restores` with JSON `{{"backupId": "<id>"}}`: restores that backup into the disposable verification instance (`MOOI_BACKUP_TARGET=verification`). You can never restore into production: only the user can, explicitly, from the Backups page.
- `GET {base}/operation?wait=120`: waits up to 120 seconds while an operation runs, then returns its snapshot (state running, succeeded or failed; message) and the latest redacted output. Repeat it while the state is running.

## Testing
Testing is mandatory: finish every setup, update or fix with a successful backup followed by a successful verification restore of that same backup, both run with the current documents (saving any document afterwards requires both again). If a step fails, find the cause in the output, save the corrected documents (ask the user for anything missing) and repeat. This proof makes the draft the active configuration. Only after it tell the user clearly that backups are tested and working: they can create backups, restore one into production and delete old ones from the Backups page, and close this chat.

Never run the scripts yourself and never touch production data directly: the platform runs them.

## Request
{request}"""


@router.get("/backups/projects/{project_id}")
async def backup_overview(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> BackupOverview:
    _, run = await _owned_backups(caller, project_id)
    documents, production, deployed, development = await asyncio.gather(
        _backup_documents(caller, project_id), _production_documents(caller, project_id),
        _current_release(caller, project_id), _development_environment(caller, project_id))
    files = documents.draft or documents.active
    required = set(_backup_required_environment(files))
    stored = set(documents.environment) | set(production.environment) | set(development)
    server = {name for name, value in (*production_environment().items(), *backup_environment().items()) if value}
    chat = _backup_chat(caller.player_id, project_id)
    return BackupOverview(
        configured=files is not None and files.complete, active=documents.active is not None,
        hasDraft=documents.draft is not None, revision=documents.revision,
        environment=[BackupEnvironmentVariable(name=name, configured=name in stored or name in server,
                                               required=name in required,
                                               inherited=name.startswith(("MOOI_PRODUCTION_", "MOOI_DEVELOPMENT_")))
                     for name in sorted(required | set(documents.environment))],
        snapshot=run.snapshot, chatSessionId=chat.id if chat else None,
        chatTested=bool(chat and chat.platform_tested), deployedRelease=deployed,
    )


@router.get("/backups/projects/{project_id}/events")
async def stream_backup_events(project_id: UUID, request: Request,
                               caller: Annotated[Caller, Depends(current_caller)]) -> StreamingResponse:
    """Live backup state: a `backup.sync` snapshot with the retained output, then updates, output
    batches and configuration changes. Reconnecting simply starts from a fresh sync."""
    _, run = await _owned_backups(caller, project_id)
    settings = get_settings()
    queue = run.log.subscribe()

    async def frames() -> AsyncIterator[str]:
        try:
            last_seq = run.log.last_seq
            yield sse_frame(Event(last_seq, datetime.now(UTC), EVENT_BACKUP_SYNC,
                                  {"snapshot": run.snapshot.model_dump(mode="json"), "logs": run.logs}))
            next_auth_check = time.monotonic() + settings.introspection_cache_seconds
            while True:
                if time.monotonic() >= next_auth_check:
                    try:
                        await current_caller(request)
                    except Exception:
                        LOG.debug("Backup stream authentication ended", exc_info=True)
                        return
                    next_auth_check = time.monotonic() + settings.introspection_cache_seconds
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), settings.sse_heartbeat_seconds)
                except TimeoutError:
                    yield sse_heartbeat()
                    continue
                if event is None:
                    return
                if event.seq > last_seq:
                    yield sse_frame(event)
                    last_seq = event.seq
        finally:
            run.log.unsubscribe(queue)

    return StreamingResponse(frames(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.get("/backups/projects/{project_id}/documents")
async def backup_documents(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> BackupDocuments:
    return await _backup_documents(caller, project_id)


@router.put("/backups/projects/{project_id}/documents/draft")
async def save_backup_documents(project_id: UUID, body: BackupFiles,
                                caller: Annotated[Caller, Depends(current_caller)]) -> BackupDocuments:
    await _owned_backups(caller, project_id)
    return await _save_backup_draft(caller, project_id, body)


@router.put("/backups/projects/{project_id}/environment")
async def update_backup_environment(project_id: UUID, body: ProductionEnvironmentUpdate,
                                    caller: Annotated[Caller, Depends(current_caller)]) -> BackupDocuments:
    await _owned_backups(caller, project_id)
    return await _save_backup_environment(caller, project_id, body)


@router.delete("/backups/projects/{project_id}/configuration", status_code=status.HTTP_204_NO_CONTENT)
async def delete_backup_configuration(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> Response:
    """Removes the documents and environment values; recorded backups and their stored data stay."""
    _, run = await _owned_backups(caller, project_id)
    async with run.lock:
        if run.snapshot.state == "running":
            raise ApiException.conflict("Wait until the backup operation completes")
        await mooi.delete_backup_recipe(caller, project_id)
        if (chat := _backup_chat(caller.player_id, project_id)) is not None:
            await close_session(chat.id)
        run.proofs.clear()
        _notify_backup_configuration(run, 0)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/backups/projects/{project_id}/changes")
async def backup_changes(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> ChangesPayload:
    documents = await _backup_documents(caller, project_id)
    return _documents_changes_payload(_BACKUP_FILE_NAMES, *_backup_comparison(caller, project_id, documents))


@router.get("/backups/projects/{project_id}/changes/file")
async def backup_file_diff(project_id: UUID, path: str,
                           caller: Annotated[Caller, Depends(current_caller)]) -> FileDiffPayload:
    documents = await _backup_documents(caller, project_id)
    return _documents_file_diff(_BACKUP_FILE_NAMES, *_backup_comparison(caller, project_id, documents), path)


@router.post("/backups/projects/{project_id}/backups", status_code=status.HTTP_202_ACCEPTED)
async def create_backup(project_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> BackupSnapshot:
    project, run = await _owned_backups(caller, project_id)
    return await _admit_backup_operation(run, caller, project, "backup")


@router.post("/backups/projects/{project_id}/backups/{backup_id}/restore", status_code=status.HTTP_202_ACCEPTED)
async def restore_backup(project_id: UUID, backup_id: UUID, body: RestoreBackupRequest,
                         caller: Annotated[Caller, Depends(current_caller)]) -> BackupSnapshot:
    project, run = await _owned_backups(caller, project_id)
    backup = await _find_backup(caller, project_id, backup_id)
    return await _admit_backup_operation(run, caller, project, "restore", backup=backup, target=body.target)


@router.post("/backups/projects/{project_id}/backups/{backup_id}/delete", status_code=status.HTTP_202_ACCEPTED)
async def delete_backup_data(project_id: UUID, backup_id: UUID,
                             caller: Annotated[Caller, Depends(current_caller)]) -> BackupSnapshot:
    """Runs delete.sh; the backup's record disappears once its data is gone."""
    project, run = await _owned_backups(caller, project_id)
    backup = await _find_backup(caller, project_id, backup_id)
    return await _admit_backup_operation(run, caller, project, "delete", backup=backup)


@router.delete("/backups/projects/{project_id}/backups/{backup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def forget_backup(project_id: UUID, backup_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> Response:
    """Forgets the record without running delete.sh, for backups whose data is already gone."""
    _, run = await _owned_backups(caller, project_id)
    async with run.lock:
        if run.snapshot.backupId == backup_id and run.snapshot.state == "running":
            raise ApiException.conflict("Wait until the backup operation completes")
        await mooi.delete_backup(caller, project_id, backup_id)
        run.proofs.pop(backup_id, None)
        if run.snapshot.backupId == backup_id:
            run.snapshot, run.logs = BackupSnapshot(), []
            _publish_backup_sync(run)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _agent_backup_access(session_id: UUID, request: Request) -> tuple[Session, Caller]:
    session = get_registry().get(session_id)
    token = request.headers.get("X-Backup-Edit-Token", "")
    if (request.client is None or request.client.host not in ("127.0.0.1", "::1")
            or session is None or session.kind != "backup" or session.closing
            or not hmac.compare_digest(token, session.agent_token)
            or session.agent_caller is None):
        raise ApiException.not_found("Backup configuration not found")
    return session, session.agent_caller


@router.get("/sessions/{session_id}/backup/agent/documents")
async def agent_backup_documents(session_id: UUID, request: Request) -> BackupDocuments:
    session, caller = _agent_backup_access(session_id, request)
    return await _backup_documents(caller, session.project_id)


@router.put("/sessions/{session_id}/backup/agent/documents")
@router.patch("/sessions/{session_id}/backup/agent/documents")
async def agent_save_backup_documents(session_id: UUID, request: Request, body: BackupFilesPatch) -> BackupDocuments:
    session, caller = _agent_backup_access(session_id, request)
    return await _save_backup_draft(caller, session.project_id, body)


@router.get("/sessions/{session_id}/backup/agent/environment")
async def agent_backup_environment(session_id: UUID, request: Request) -> AgentEnvironment:
    session, caller = _agent_backup_access(session_id, request)
    development, production, stored = await asyncio.gather(
        mooi.fetch_development_environment(caller, session.project_id),
        mooi.fetch_production_environment(caller, session.project_id),
        mooi.fetch_backup_environment(caller, session.project_id))
    return _agent_environment({**development, **production, **stored},
                              {**development_environment(), **production_environment(), **backup_environment()})


@router.put("/sessions/{session_id}/backup/agent/environment")
async def agent_save_backup_environment(session_id: UUID, request: Request,
                                        body: ProductionEnvironmentUpdate) -> BackupDocuments:
    session, caller = _agent_backup_access(session_id, request)
    return await _save_backup_environment(caller, session.project_id, body)


@router.get("/sessions/{session_id}/backup/agent/production")
async def agent_backup_production(session_id: UUID, request: Request) -> dict:
    session, caller = _agent_backup_access(session_id, request)
    documents, deployed = await asyncio.gather(_production_documents(caller, session.project_id),
                                               _current_release(caller, session.project_id))
    return {"active": documents.active.model_dump() if documents.active else None,
            "environment": documents.environment, "deployedRelease": deployed}


@router.post("/sessions/{session_id}/backup/agent/repository/commit")
async def agent_commit_backup_repository(session_id: UUID, request: Request, body: MergeRequest) -> MergePayload:
    session, caller = _agent_backup_access(session_id, request)
    return await _commit_platform_repository(session, caller, body)


@router.get("/sessions/{session_id}/backup/agent/backups")
async def agent_backups(session_id: UUID, request: Request) -> dict:
    session, caller = _agent_backup_access(session_id, request)
    return await mooi.fetch_backups(caller, session.project_id)


@router.get("/sessions/{session_id}/backup/agent/backups/{backup_id}")
async def agent_backup_detail(session_id: UUID, backup_id: UUID, request: Request) -> dict:
    session, caller = _agent_backup_access(session_id, request)
    return await mooi.fetch_backup_detail(caller, session.project_id, backup_id)


@router.post("/sessions/{session_id}/backup/agent/backups", status_code=status.HTTP_202_ACCEPTED)
async def agent_test_backup(session_id: UUID, request: Request) -> BackupSnapshot:
    session, caller = _agent_backup_access(session_id, request)
    project = await mooi.fetch_project(caller, session.project_id)
    return await _admit_backup_operation(_backup_run(caller, project.id), caller, project, "backup", chat=session)


@router.post("/sessions/{session_id}/backup/agent/restores", status_code=status.HTTP_202_ACCEPTED)
async def agent_test_restore(session_id: UUID, request: Request, body: AgentRestoreRequest) -> BackupSnapshot:
    """Always the disposable verification instance: the agent can never restore into production."""
    session, caller = _agent_backup_access(session_id, request)
    project = await mooi.fetch_project(caller, session.project_id)
    backup = await _find_backup(caller, project.id, body.backupId)
    return await _admit_backup_operation(_backup_run(caller, project.id), caller, project, "restore",
                                         backup=backup, target="verification", chat=session)


@router.get("/sessions/{session_id}/backup/agent/operation")
async def agent_backup_operation(session_id: UUID, request: Request, wait: int = 0) -> dict:
    """The live operation snapshot and its latest output, optionally waiting while it runs."""
    session, caller = _agent_backup_access(session_id, request)
    run = _backup_run(caller, session.project_id)
    task = run.task
    if wait > 0 and run.snapshot.state == "running" and task is not None and not task.done():
        await asyncio.wait({task}, timeout=min(wait, 120))
    return {"snapshot": run.snapshot.model_dump(mode="json"), "output": run.logs[-200:]}


async def close_backups() -> None:
    """Interrupts running backup operations on shutdown; each records itself as interrupted."""
    tasks = [run.task for run in _backup_runs.values() if run.task is not None and not run.task.done()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    for run in _backup_runs.values():
        run.log.close()


# --- deployment: the agent sets it up and tests it in the chat, then Compose runs it directly ----
#
# Deploy on a session without a verified setup clears the chat and sends the setup brief as a visible
# message, like merge conflicts: the agent prepares the root Docker Compose and ends with a test
# through the token-guarded agent endpoints, which run the very same deterministic deployment. Once a
# start succeeds, or when a root Compose file exists before any start, Deploy runs directly until one
# fails again. Changing the setup sends the same brief with the user's request.


_WEB_DEPENDENCIES = ("vite", "react", "vue", "@angular/core", "next")
_WEB_SCAN_IGNORED = {"node_modules", "target", "build", "dist", "venv", "__pycache__"}
_WEB_SCAN_MAX_DEPTH = 4

PHASE_PREPARING = "Preparing the deployment"
PHASE_BUILDING = "Building images and starting containers"
PHASE_PROBING = "Waiting for the application to answer"
PHASE_STOPPING = "Stopping the application"


@dataclass(frozen=True)
class DeploymentPlan:
    """What the root Compose file says to run: its file, the one browser port and how to probe it."""

    compose: str
    port: DockerPortRequest
    expectation: Literal["html", "http"]


def _web_roots(checkout: Path) -> set[Path]:
    """Roots of every web frontend package, so Compose can never leave one out of the preview."""
    roots: set[Path] = set()
    for current_value, directories, files in os.walk(checkout, followlinks=False):
        current = Path(current_value)
        depth = len(current.relative_to(checkout).parts)
        directories[:] = [name for name in directories if depth < _WEB_SCAN_MAX_DEPTH
                          and name not in _WEB_SCAN_IGNORED and not name.startswith(".")]
        if "package.json" not in files:
            continue
        try:
            package = json.loads((current / "package.json").read_text())
            dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
        except (OSError, ValueError, TypeError, AttributeError):
            continue
        if any(name in dependencies for name in _WEB_DEPENDENCIES):
            roots.add(current)
    return roots


async def _deployment_plan(docker: Docker, checkout: Path, *, deadline: float,
                           variables: dict[str, str]) -> DeploymentPlan:
    """Reads the preview straight from the root Compose; anything ambiguous is left to the agent."""
    checkout = checkout.resolve()
    compose = await docker.describe_existing_compose(checkout, deadline=deadline, variables=variables)
    services = {build.context: build.service for build in compose.builds}
    web_roots = _web_roots(checkout)
    if any(root not in services for root in web_roots):
        raise DockerError("invalid_compose", "Compose does not build every web frontend of the repository")
    web_services = {services[root] for root in web_roots}
    ports = [port for port in compose.ports
             if port.protocol == "tcp" and (not web_services or port.service in web_services)]
    if len(ports) != 1:
        raise DockerError("invalid_compose", "Compose must publish exactly one browser port"
                          + (" on the web frontend service" if web_services else ""))
    return DeploymentPlan(compose.file, ports[0], "html" if web_services else "http")


_ROOT_URL = re.compile(r"""(?i)\b(?:src|href|action|poster)\s*=\s*["']?(/(?!/)[^"'\s>]*)""")
_PAGE_LIMIT_BYTES = 262144


async def _verify_base_path(endpoint: str, base: str) -> None:
    """The proxy never rewrites root-absolute URLs: a page still built for `/` would load blank in the
    preview. Fail with the offending URLs so the next Deploy hands them to the setup agent."""
    page = bytearray()
    try:
        async with httpx.AsyncClient(trust_env=False, follow_redirects=False) as client:
            async with client.stream("GET", f"{endpoint}/",
                                     timeout=get_settings().deployment_probe_timeout_seconds) as response:
                async for chunk in response.aiter_bytes():
                    page.extend(chunk[:_PAGE_LIMIT_BYTES - len(page)])
                    if len(page) >= _PAGE_LIMIT_BYTES:
                        break
    except httpx.HTTPError:
        return  # Readiness has just verified the page; a transient miss is not a base path verdict.
    outside = sorted({url for url in _ROOT_URL.findall(page.decode("utf-8", "replace"))
                      if not url.startswith(base)})
    if outside:
        raise DockerError("health_check_failed", f"The frontend is not built for MOOI_PREVIEW_BASE_PATH ({base})",
                          detail="Root-absolute URLs in GET / that leave the preview path:\n"
                                 + "\n".join(outside[:10]))


def _deployment_prompt(session: Session, instructions: str | None = None) -> str:
    """The visible brief of a deployment setup conversation, with the user's requested change or the
    last failure when there is one."""
    settings = get_settings()
    base = f"http://127.0.0.1:{settings.sessions_port}/sessions/{session.id}/deployment/agent"
    result = session.deployment.result
    failure = ""
    if session.deployment.state == "failed" and result is not None and result.reason is not None:
        tail = "\n".join(session.deployment_output[-60:])
        failure = f"\n## Last attempt\nMooi's last deployment failed: {result.reason.message}\n" + (
            f"```\n{tail}\n```\n" if tail else "")
    request = (f"\n## Requested change\nApply this change to the existing setup, keeping everything else working:\n"
               f"{instructions.strip()}\n") if instructions else ""
    return f"""Set up this repository so Mooi deploys it as a live web preview, then test it.

The working directory is this session's branch `{session.branch}`. This conversation only prepares the deployment. When a setup already exists, check it and finish or repair it instead of recreating a working one.
{request}{failure}
## How Mooi deploys
- It resolves the single Compose file at the repository root (`compose.yaml`, `compose.yml`, `docker-compose.yaml` or `docker-compose.yml`), with the root `.env` when present and the project's development environment variables (`MOOI_DEVELOPMENT_<NAME>`) for interpolation.
- It builds every service with a `build` section and starts all of them.
- It reads exactly one published TCP port, the one of the service building the web frontend (a Vite, React, Vue, Angular or Next package), or the only one of an API-only product, and then removes every publication: no container is ever reachable from outside.
- It waits for every container healthcheck, then expects `GET /` on that port to answer 2xx/3xx, with an HTML document when there is a frontend.
- With a frontend, that HTML must reference no root-absolute URL (`src`, `href`, `action`) outside `MOOI_PREVIEW_BASE_PATH`; otherwise the deployment fails listing them.
- The browser reaches the app only through Mooi's reverse proxy, under the path `/preview/<random-id>/` of Mooi's own host (a domain or a bare IP), embedded in an iframe from Mooi. Compose interpolation receives that path, with leading and trailing slash, as `MOOI_PREVIEW_BASE_PATH`; it changes on every deploy.
- The proxy strips the prefix, so containers keep serving from `/`. It forwards the public Host header plus `X-Forwarded-Proto/Host/For/Prefix`, keeps path-absolute redirects and cookie paths inside the prefix, relays WebSockets and lets Mooi frame the app; the iframe may use the microphone, camera and clipboard. Root-absolute URLs the browser builds itself (`/assets/...`, `fetch('/api/...')`, router paths) are NOT rewritten: they leave the preview.

## Rules
1. Read the root AGENTS.md/CLAUDE.md and the instructions that apply to the files you edit.
2. Give each deployable artifact its own Dockerfile at its root, with a `.dockerignore`, dependency cache layers, slim or alpine multistage images, and frontends built as static files without dev servers or HMR.
3. Keep ONE root Compose file that builds those Dockerfiles through `build.context` and `build.dockerfile`. Databases and caches run as services with named volumes and credentials you choose yourself; give every variable an explicit literal value or, for what the user provides (third-party API keys, tokens, service URLs...), a project development variable such as `${{MOOI_DEVELOPMENT_OPENAI_API_KEY}}`.
4. Prefer one public frontend port: a static server that proxies the API routes to the backend by its Compose service name, and a frontend that calls the API through same-origin routes. Build the frontend for its public base path: pass `${{MOOI_PREVIEW_BASE_PATH:-/}}` as a build argument (the default keeps production at the root) and use it as the bundler base (Vite `base`, Next `basePath`, Angular `baseHref`...), the router basename and the prefix of every API, asset and WebSocket URL. Accept any Host header (no host allowlists) and never hard-code localhost or absolute origins.
5. Every service listens on 0.0.0.0 and has a healthcheck on an existing endpoint or a TCP/process check against 127.0.0.1, never localhost. Never add endpoints, dependencies or authentication exceptions for it.
6. Do not use `container_name`, `env_file`, `profiles`, bind mounts, external networks or volumes, `privileged`, host networking or the Docker socket.
7. Only edit deployment files and the minimal base-path wiring of rule 4: never other application source, dependency manifests, authentication rules or runtime application configuration. For third-party credentials, reuse or ask the user for development variables and save them as described in your instructions; use harmless placeholders only when the application still starts without them, and never fabricate real ones.
8. Never run `docker` or `docker compose` yourself and do not commit or push: the test endpoint runs the deployment.

## Mooi deployment API
Use Python urllib with an inline JSON body, never a temporary file, and send the header `X-Deployment-Token: {session.agent_token}`:
- `POST {base}/start` with an empty JSON body `{{}}`: runs Mooi's deployment of the working tree exactly as the Deploy button does, replacing the running preview if any, and returns its snapshot. The user follows its output in the deployment console.
- `GET {base}?wait=120`: waits up to 120 seconds while the deployment starts, then returns its snapshot (`state` starting, running or failed; `phase`; `result.reason` on failure) and the latest redacted output. Repeat it while the state is starting.

## Testing
Testing is mandatory: once the setup is ready, start the test and wait for its result. If it fails, find the cause in the output, fix the setup and test again; ask the user only for what you cannot decide yourself. Once the state is running, finish with a short summary of what you changed and tell the user the deployment is tested and live in the Preview tab: they can clear this chat and keep iterating."""


def _failure_lines(error: DockerError) -> list[str]:
    """The public failure plus the tail of its output, written to the console for the user."""
    tail = (error.detail or "").strip().splitlines()[-40:]
    return [f"✖ {error}", *tail]


async def _admit_deployment_start(session: Session, *, by_agent: bool = False) -> DeploymentSnapshot:
    """Atomically admit once; the spawned worker owns finalization and rollback. The setup agent
    starts its test from inside its own turn, so only it may deploy while the chat is busy.

    No provider/Docker I/O under operation_lock.
    """
    async with session.operation_lock:
        if session.closing:
            raise ApiException.conflict("The session is closing")
        if session.deployment.state in ("starting", "running"):
            return session.deployment
        if session.deployment.state == "stopping" or session.deployment.cleanupRequired:
            raise ApiException.conflict("Stop the previous deployment before deploying again")
        if session.deployment_task is not None and not session.deployment_task.done():
            raise ApiException.conflict("A deployment operation is still finishing")
        if (not by_agent and (session.status != STATUS_READY or session.pending is not None or session.interactions)
                or session.runtime is None or session.workspace == _UNSET_PATH):
            raise ApiException.conflict("The chat must be ready with no pending requests before deploying")
        await _reserve_deployment(session.id)
        operation_id = uuid4()
        snapshot = DeploymentSnapshot(state="starting", operationId=operation_id, phase=PHASE_PREPARING,
                                      previewUrl=None, result=None, cleanupRequired=False,
                                      updatedAt=datetime.now(UTC))
        # The event-loop cannot execute the worker until this lock scope has returned.
        record(session, EVENT_DEPLOYMENT_UPDATED, snapshot.model_dump())
        _touch_activity(session, snapshot.updatedAt)
        session.deployment_task = _spawn(session, _run_deployment_start(session, operation_id))
        return snapshot


# Public reasons are selected by code: engine diagnostics never cross the API boundary.
_DEPLOYMENT_MESSAGES: dict[str, str] = {
    "unsupported_project": "The Docker setup uses features Mooi cannot run",
    "docker_unavailable": "Check Docker Compose and access to the configured Docker engine",
    "invalid_compose": "The repository has no usable root Docker Compose setup",
    "startup_failed": "The application could not be built or started",
    "health_check_failed": "The application did not become ready",
    "timeout": "The deployment timed out",
    "cancelled": "Deployment was cancelled",
    "cleanup_failed": "Resources may remain; restore Docker access and retry Stop before deploying again",
}


def _deployment_reason(code: str) -> DeploymentReason:
    if code not in _DEPLOYMENT_MESSAGES:
        code = "startup_failed"
    return DeploymentReason(code=code, message=_DEPLOYMENT_MESSAGES[code])


def _publish_deployment_phase(session: Session, operation_id: UUID, phase: str) -> None:
    if (session.closing or session.deployment.operationId != operation_id
            or session.deployment.state not in ("starting", "stopping")):
        return
    record(session, EVENT_DEPLOYMENT_UPDATED, session.deployment.model_copy(update={
        "phase": phase, "updatedAt": datetime.now(UTC),
    }).model_dump())


class _DeploymentLogWriter:
    """Publishes the Compose output of one start operation as batched `deployment.log` events.

    The log shares the session event log with the chat, so it must not be able to evict the
    conversation: it stops after `deployment_log_lines` lines and says so once. Publication is
    best effort and stale operations are dropped rather than interleaved with a newer one.
    """

    _BATCH_LINES = 50
    _LINE_CHARS = 2000
    _FLUSH_SECONDS = 0.25

    def __init__(self, session: Session, operation_id: UUID) -> None:
        self._session = session
        self._operation_id = operation_id
        self._sensitive = (str(session.workspace), str(get_settings().workspace_root))
        self._remaining = get_settings().deployment_log_lines
        self._truncated = False
        self._lines: list[str] = []
        self._index = 0
        self._timer: asyncio.TimerHandle | None = None
        session.deployment_output = []

    def __call__(self, line: str) -> None:
        if self._truncated:
            return
        if self._remaining:
            self._remaining -= 1
            self._lines.append(redact_deployment_output(line, self._sensitive)[:self._LINE_CHARS])
        else:
            self._truncated = True
            self._lines.append("… log truncated")
        if len(self._lines) >= self._BATCH_LINES or self._truncated:
            self.flush()
        elif self._timer is None:
            self._timer = asyncio.get_running_loop().call_later(self._FLUSH_SECONDS, self.flush)

    def protect(self, values: Iterable[str]) -> None:
        """Also redacts these values (the project's development environment) from every later line."""
        self._sensitive = (*self._sensitive, *(value for value in values if len(value) >= 4))

    def conclude(self, lines: list[str]) -> None:
        """Explains a failure in the console, even once the line budget is spent."""
        self.flush()
        for start in range(0, len(lines), self._BATCH_LINES):
            self._lines = [redact_deployment_output(line, self._sensitive)[:self._LINE_CHARS]
                           for line in lines[start:start + self._BATCH_LINES]]
            self.flush()

    def flush(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        lines, self._lines = self._lines, []
        if (not lines or self._session.closing
                or self._session.deployment.operationId != self._operation_id):
            return
        record(self._session, EVENT_DEPLOYMENT_LOG,
               {"operationId": self._operation_id, "index": self._index, "lines": lines})
        self._index += 1
        self._session.deployment_output = [*self._session.deployment_output, *lines][-200:]


def _deployment_finish(session: Session, operation_id: UUID, action: DeploymentAction, *,
                       reason: DeploymentReason | None = None, url: str | None = None,
                       cleanup: bool = False) -> None:
    # No await: stop admission and terminal publication cannot interleave. Never take the
    # operation lock here: close holds it while joining workers.
    if session.deployment.operationId != operation_id:
        return
    state = "failed" if reason else ("running" if action == "start" else "stopped")
    result = DeploymentResult(schemaVersion=1, operationId=operation_id, action=action,
                              success=reason is None, state=state, reason=reason,
                              previewUrl=url, cleanupRequired=cleanup)
    record(session, EVENT_DEPLOYMENT_UPDATED, DeploymentSnapshot(
        state=state, operationId=operation_id, phase=None, previewUrl=url, result=result,
        cleanupRequired=cleanup, updatedAt=datetime.now(UTC)).model_dump())
    if action == "start" and (reason is None or reason.code != "cancelled"):
        session.deployment_verified = reason is None
        if reason is None and session.deployment_setup == "preparing":
            record(session, EVENT_DEPLOYMENT_SETUP, {"state": "tested"})


def _deployment_storage() -> DockerManifests:
    return DockerManifests(get_settings().workspace_root)


def _owned_deployment(session: Session, manifests: DockerManifests):
    manifest = manifests.load(session.id)
    if manifest.owner_id != session.player_id:
        raise DockerManifestError("Deployment owner does not match session")
    return manifest


async def _join_deployment(task: asyncio.Task) -> None:
    """Join even during repeated cancellation; callers must never race a late Docker up."""
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
    # Workers finalize their own failures; still retrieve exceptions from an aborted task.
    if not task.cancelled():
        task.result()


async def _deployment_down(session: Session) -> None:
    manifests = _deployment_storage()
    if manifests.directory(session.id).exists():
        _owned_deployment(session, manifests)
        await Docker().down(manifests=manifests, session_id=session.id)
    _deployment_slots.discard(session.id)


def _deployment_cleanup_required(session: Session) -> bool:
    """Unreadable/foreign evidence is never proof that resources have been removed."""
    try:
        manifests = _deployment_storage()
        if not manifests.directory(session.id).exists():
            return False
        return _owned_deployment(session, manifests).cleanup_state != "stopped"
    except Exception:
        LOG.debug("Background operation encountered an exception", exc_info=True)
        return True


async def _settle_deployment_cleanup(session: Session) -> bool:
    # Each attempt has its own bounded stop budget. Shield and join even if the caller is
    # cancelled repeatedly; no late down can race the next deployment operation.
    for _ in range(2):
        task = asyncio.create_task(_deployment_down(session))
        try:
            await _join_deployment(task)
        except Exception as error:
            LOG.warning("Deployment %s cleanup failed with %s", session.id,
                        getattr(error, "code", "cleanup_failed"), exc_info=True)
            if isinstance(error, DockerError) and error.detail:
                LOG.debug("Deployment %s: %s", session.id, error.detail)
        if not _deployment_cleanup_required(session):
            _deployment_slots.discard(session.id)
            return False
    return True



async def _run_deployment_start(session: Session, operation_id: UUID) -> None:
    """Deploys the root Compose deterministically. A failure explains itself in the console, and the
    next Deploy hands it to the agent's setup conversation."""
    failure: list[str] = []
    log = _DeploymentLogWriter(session, operation_id)
    try:
        deadline = asyncio.get_running_loop().time() + get_settings().deployment_timeout_seconds
        async with asyncio.timeout_at(deadline):
            docker, manifests = Docker(), _deployment_storage()
            # The project's development environment, for Compose interpolation only.
            variables = (await _development_environment(session.agent_caller, session.project_id)
                         if session.agent_caller is not None else development_environment())
            log.protect(variables.values())
            # Known before the build: the frontend is built for the public path it will be served at.
            label = previews.reserve()
            variables = {**variables, "MOOI_PREVIEW_BASE_PATH": previews.base_path(label)}
            await docker.preflight(cwd=session.workspace, deadline=deadline)
            if manifests.directory(session.id).exists():
                _owned_deployment(session, manifests)
                # Normalize even a failed manifest using its frozen configuration. Ownership
                # is verified before touching the engine; absence is proved before rearming.
                await docker.down(manifests=manifests, session_id=session.id, deadline=deadline)
                await docker.rearm(manifests=manifests, session_id=session.id)
            else:
                manifests.create(session.id, session.player_id)
            plan = await _deployment_plan(docker, session.workspace, deadline=deadline, variables=variables)
            _publish_deployment_phase(session, operation_id, PHASE_BUILDING)
            await docker.freeze_compose(manifests=manifests, session_id=session.id, checkout=session.workspace,
                                        compose_files=(Path(plan.compose),), web_service=plan.port.service,
                                        deadline=deadline, variables=variables)
            await docker.configure_endpoint(manifests=manifests, session_id=session.id, port=plan.port,
                                            deadline=deadline)
            try:
                await docker.up(manifests=manifests, session_id=session.id, deadline=deadline, on_line=log)
            finally:
                log.flush()
            _publish_deployment_phase(session, operation_id, PHASE_PROBING)
            readiness = await docker.readiness(
                manifests=manifests, session_id=session.id, expectation=plan.expectation, deadline=deadline,
            )
            if plan.expectation == "html":
                await _verify_base_path(readiness.endpoint.url, previews.base_path(label))
            if session.closing or session.deployment.operationId != operation_id:
                raise asyncio.CancelledError
            # No await between publishing the path and the running snapshot that carries it.
            _deployment_finish(session, operation_id, "start",
                               url=previews.publish(session.id, label, readiness.endpoint.url))
            session.deployment_monitor = _spawn(session, _monitor_deployment(session, operation_id))
            return
    except asyncio.CancelledError:
        code = "cancelled"
    except TimeoutError:
        code = "timeout"
        failure = [f"✖ The deployment did not finish within {get_settings().deployment_timeout_seconds} seconds"]
    except DockerError as error:
        code, failure = error.code, _failure_lines(error)
    except DockerManifestError:
        code = "cleanup_failed"
    except Exception:
        code = "startup_failed"
    LOG.warning("Deployment %s start failed with %s", session.id, code, exc_info=True)
    log.conclude(failure)
    # Rollback has its own stop deadline, independent of the exhausted start deadline.
    # Shield AND join it: stop/close must wait for every possible engine mutation.
    cleanup = await _settle_deployment_cleanup(session)
    _deployment_finish(session, operation_id, "start", reason=_deployment_reason(code), cleanup=cleanup)


@router.post("/sessions/{session_id}/deployment/start", status_code=status.HTTP_202_ACCEPTED)
async def start_deployment(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> DeploymentSnapshot:
    session = get_registry().get_for(caller, session_id)
    if session.kind in _PLATFORM_KINDS:
        raise ApiException.conflict("Previews are only available for regular sessions")
    session.agent_caller = caller
    # Read live rather than cached on the session: the player can change the setting at any time.
    # Stop stays ungated, so a deployment started before the change can always be torn down.
    project = await mooi.fetch_project(caller, session.project_id)
    if not project.web_application:
        raise ApiException.conflict("Deploy and preview are only available for web applications")
    if _deployment_configured(session):
        return await _admit_deployment_start(session)
    return await _admit_deployment_setup(session, caller)


@router.post("/sessions/{session_id}/deployment/setup", status_code=status.HTTP_202_ACCEPTED)
async def change_deployment_setup(session_id: UUID, body: DeploymentSetupRequest,
                                  caller: Annotated[Caller, Depends(current_caller)]) -> DeploymentSnapshot:
    """Clears the chat and asks the agent to change the deployment setup as requested, then test it."""
    session = get_registry().get_for(caller, session_id)
    if session.kind in _PLATFORM_KINDS:
        raise ApiException.conflict("Previews are only available for regular sessions")
    session.agent_caller = caller
    project = await mooi.fetch_project(caller, session.project_id)
    if not project.web_application:
        raise ApiException.conflict("Deploy and preview are only available for web applications")
    return await _admit_deployment_setup(session, caller, body.instructions)


def _deployment_configured(session: Session) -> bool:
    """A successful start proves the setup and a failed one hands it back to the agent; with neither,
    a root Compose file means it was set up before (another session, a merge, a restart)."""
    present = _sync_deployment_configured(session)
    return session.deployment_verified if session.deployment_verified is not None else present


async def _admit_deployment_setup(session: Session, caller: Caller, instructions: str | None = None) -> DeploymentSnapshot:
    """Clears the conversation and sends the setup brief as a visible message: the agent prepares the
    deployment and tests it, while the deployment itself stays untouched until that test. A requested
    change needs the deployment stopped."""
    async with session.operation_lock:
        if session.closing:
            raise ApiException.conflict("The session is closing")
        if instructions and session.deployment.state in ("starting", "running"):
            raise ApiException.conflict("Stop the deployment before changing its setup")
        if session.deployment.state in ("starting", "running"):
            return session.deployment
        if session.deployment.state == "stopping" or session.deployment.cleanupRequired:
            raise ApiException.conflict("Stop the previous deployment before deploying again")
        if (session.status != STATUS_READY or session.pending is not None or session.interactions
                or session.runtime is None or session.workspace == _UNSET_PATH):
            raise ApiException.conflict("The chat must be ready with no pending requests before deploying")
        prompt = _deployment_prompt(session, instructions)
        runtime = await _reset_conversation(session, caller)
        record(session, EVENT_DEPLOYMENT_SETUP, {"state": "preparing"})
        await _deliver(session, runtime, prompt)
        _touch_activity(session)
        return session.deployment


def _agent_deployment_access(session_id: UUID, request: Request) -> Session:
    """Only the agent of a live setup conversation, from inside the pod, with the chat's token."""
    session = get_registry().get(session_id)
    token = request.headers.get("X-Deployment-Token", "")
    if (request.client is None or request.client.host not in ("127.0.0.1", "::1")
            or session is None or session.kind != "session" or session.closing
            or session.deployment_setup is None
            or not hmac.compare_digest(token, session.agent_token)):
        raise ApiException.not_found("Deployment setup not found")
    return session


@router.post("/sessions/{session_id}/deployment/agent/start", status_code=status.HTTP_202_ACCEPTED)
async def agent_start_deployment(session_id: UUID, request: Request) -> DeploymentSnapshot:
    """The setup's test: the same deployment Deploy runs, replacing a running or leftover one first."""
    session = _agent_deployment_access(session_id, request)
    async with session.operation_lock:
        if session.closing:
            raise ApiException.conflict("The session is closing")
        if session.deployment.state == "running" or session.deployment.cleanupRequired:
            _admit_deployment_stop(session)
    task = session.deployment_task
    if session.deployment.state == "stopping" and task is not None:
        with suppress(Exception):
            await _join_deployment(task)
    return await _admit_deployment_start(session, by_agent=True)


@router.get("/sessions/{session_id}/deployment/agent")
async def agent_deployment(session_id: UUID, request: Request, wait: int = 0) -> dict:
    """The deployment snapshot and its latest output, optionally waiting while it starts."""
    session = _agent_deployment_access(session_id, request)
    task = session.deployment_task
    if wait > 0 and session.deployment.state == "starting" and task is not None and not task.done():
        await asyncio.wait({task}, timeout=min(wait, 120))
    return {"snapshot": session.deployment.model_dump(mode="json"), "output": session.deployment_output[-200:]}


async def _run_deployment_stop(session: Session, operation_id: UUID, previous: asyncio.Task | None) -> None:
    # Failed/cancelled workers must not skip cleanup. Join them before any new engine mutation.
    for task in (previous, session.deployment_monitor):
        if task is None:
            continue
        if task is session.deployment_monitor:
            task.cancel()
        try:
            await _join_deployment(task)
        except Exception:
            LOG.warning("Deployment %s stop could not join previous worker", session.id, exc_info=True)
    session.deployment_monitor = None
    cleanup = await _settle_deployment_cleanup(session)
    if cleanup:
        LOG.warning("Deployment %s stop failed with cleanup_failed", session.id)
    _deployment_finish(session, operation_id, "stop",
                       reason=_deployment_reason("cleanup_failed") if cleanup else None,
                       cleanup=cleanup)


@router.post("/sessions/{session_id}/deployment/stop", status_code=status.HTTP_202_ACCEPTED)
async def stop_deployment(session_id: UUID, response: Response,
                          caller: Annotated[Caller, Depends(current_caller)]) -> DeploymentSnapshot:
    session = get_registry().get_for(caller, session_id)
    async with session.operation_lock:
        if session.closing:
            raise ApiException.conflict("The session is closing")
        if session.deployment.state == "stopped":
            response.status_code = status.HTTP_200_OK
            return session.deployment
        return _admit_deployment_stop(session)


def _admit_deployment_stop(session: Session) -> DeploymentSnapshot:
    """Admits a stop of whatever runs or remains; the caller holds the operation lock."""
    if session.deployment.state == "stopping":
        return session.deployment
    previous = session.deployment_task
    operation_id = uuid4()
    snapshot = DeploymentSnapshot(state="stopping", operationId=operation_id, phase=PHASE_STOPPING,
                                  previewUrl=None, result=None,
                                  cleanupRequired=session.deployment.cleanupRequired,
                                  updatedAt=datetime.now(UTC))
    record(session, EVENT_DEPLOYMENT_UPDATED, snapshot.model_dump())
    _touch_activity(session, snapshot.updatedAt)
    if previous is not None and not previous.done():
        previous.cancel()
    session.deployment_task = _spawn(session, _run_deployment_stop(session, operation_id, previous))
    return snapshot


def _touch_activity(session: Session, at: datetime | None = None) -> None:
    session.last_human_activity = at or datetime.now(UTC)
    session.updated_at = session.last_human_activity


@router.post("/sessions/{session_id}/activity", status_code=status.HTTP_204_NO_CONTENT)
async def session_activity(session_id: UUID, caller: Annotated[Caller, Depends(current_caller)]) -> Response:
    session = get_registry().get_for(caller, session_id)
    if session.closing:
        raise ApiException.conflict("The session is closing")
    now = asyncio.get_running_loop().time()
    if (session.activity_heartbeat_at is None
            or now - session.activity_heartbeat_at >= get_settings().session_activity_interval_seconds):
        session.activity_heartbeat_at = now
        _touch_activity(session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _monitor_deployment(session: Session, operation_id: UUID) -> None:
    """One bounded read per interval; never restart, invoke AI, or renew human activity."""
    while not session.closing and session.deployment.state == "running" and session.deployment.operationId == operation_id:
        await asyncio.sleep(get_settings().deployment_monitor_interval_seconds)
        if session.closing or session.deployment.state != "running" or session.deployment.operationId != operation_id:
            return
        try:
            manifests = _deployment_storage()
            _owned_deployment(session, manifests)
            await Docker().check_running(manifests=manifests, session_id=session.id)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.debug("Background operation encountered an exception", exc_info=True)
            if not session.closing and session.deployment.state == "running" and session.deployment.operationId == operation_id:
                _deployment_finish(session, operation_id, "start",
                                   reason=_deployment_reason("health_check_failed"), cleanup=True)
            return


# --- lifecycle safety --------------------------------------------------------------------------


async def _reap_idle_sessions() -> None:
    """Reap only ready/failed sessions; never expire active turns or pending user input."""
    settings = get_settings()
    timeout = timedelta(minutes=settings.session_idle_timeout_minutes)
    cutoff = datetime.now(UTC) - timeout
    idle = [session.id for session in get_registry().all()
            if session.status in (STATUS_READY, STATUS_FAILED) and session.last_human_activity < cutoff]
    for session_id in idle:
        session = get_registry().get(session_id)
        if session is None:
            continue
        async with session.operation_lock:
            # Earlier cleanup may have awaited Docker while this session received activity.
            if (not session.closing and session.status in (STATUS_READY, STATUS_FAILED)
                    and session.last_human_activity < cutoff):
                LOG.info("Session %s reaped after %s idle", session_id, timeout)
                await _close_registered_session(session)


async def _reaper_loop() -> None:
    settings = get_settings()
    interval = max(60, settings.session_idle_timeout_minutes * 60 // 4)
    while True:
        await asyncio.sleep(interval)
        with suppress(Exception):
            await _reap_idle_sessions()


def start_reaper() -> None:
    """Starts the background idle reaper. Called once from `main.py`'s `lifespan` on startup;
    `close_all` cancels it again on shutdown."""
    global _reaper_task
    if _reaper_task is None:
        _reaper_task = asyncio.create_task(_reaper_loop())


async def close_all() -> None:
    """Closes every live session — runtime disconnect and workspace removal, via `close_session` —
    and stops the reaper. Called once from `main.py`'s `lifespan` on shutdown."""
    global _reaper_task
    if _reaper_task is not None:
        _reaper_task.cancel()
        with suppress(asyncio.CancelledError):
            await _reaper_task
        _reaper_task = None
    for session in get_registry().all():
        await close_session(session.id)
    await close_productions()
    await close_backups()

"""Transversal aspect: a typed client for `mic-mooi`.

Every call forwards the caller's own bearer token, so `mic-mooi` still enforces its own
authorization; the service-only endpoints (the agent credential, the GitHub clone token) also carry
`X-Service-Token` — a browser holding a valid access token cannot reach them
directly, only this service can. Upstream 4xx responses are re-raised with the same status and the
upstream `message` when the body carries one (the same `ApiError` shape `mic-mooi` returns);
5xx responses and network failures collapse to a single `ApiException.bad_gateway`, since none of
those carry information this service should forward verbatim.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from collections.abc import Awaitable, Callable
from datetime import datetime
from uuid import UUID

import httpx

from mic_sessions.shared.auth import Caller, verify_access_token
from mic_sessions.shared.env import get_settings
from mic_sessions.shared.web import ApiException, get_http_client

_SERVICE_TOKEN_HEADER = "X-Service-Token"
# Renewed this long before expiry, so a call started on a still valid token never lands on an expired one.
_RENEWAL_MARGIN_SECONDS = 120


@dataclass(frozen=True)
class Project:
    id: UUID
    full_name: str
    default_branch: str
    is_private: bool
    html_url: str
    # Player-declared in `mic-mooi`; only web applications may be deployed and previewed.
    web_application: bool
    # Platform-owned: a development deployment setup passed its test, so sessions deploy directly.
    development_deployment_ready: bool = False


@dataclass(frozen=True)
class Credential:
    provider: str
    mode: str
    token: str = field(repr=False)
    expires_at: datetime | None
    connection_id: str | None = None
    save: Callable[[str], Awaitable[None]] | None = field(default=None, repr=False)
    session_model: str | None = None
    session_effort: str | None = None
    # The platform's default adapter for this provider; None is the provider's first one.
    session_adapter: str | None = None


@dataclass(frozen=True)
class GitIdentity:
    """Author of the commits this service writes on the player's behalf."""

    name: str
    email: str


def _bearer(caller: Caller) -> dict[str, str]:
    return {"Authorization": f"Bearer {caller.token}"}


def _service_headers(caller: Caller | None) -> dict[str, str]:
    """`None` is this service acting on its own behalf, for the endpoints no player token may reach."""
    return {**(_bearer(caller) if caller else {}), _SERVICE_TOKEN_HEADER: get_settings().service_token}


def _raise_for_status(response: httpx.Response, not_found_message: str) -> None:
    if response.status_code == 404:
        raise ApiException.not_found(not_found_message)
    if 400 <= response.status_code < 500:
        message = not_found_message
        try:
            message = response.json().get("message") or message
        except ValueError:
            pass
        raise ApiException(response.status_code, message)
    if response.status_code >= 500:
        raise ApiException.bad_gateway()


async def _get(client: httpx.AsyncClient, url: str, headers: dict[str, str], not_found_message: str) -> dict:
    try:
        response = await client.get(url, headers=headers)
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, not_found_message)
    return response.json()


async def fetch_project(caller: Caller, project_id: UUID) -> Project:
    settings = get_settings()
    body = await _get(
        get_http_client(),
        f"{settings.mooi_api_base_url}/me/projects",
        _bearer(caller),
        "Project not found",
    )
    for project in body.get("projects", []):
        if project.get("id") == str(project_id):
            return Project(
                id=UUID(project["id"]),
                full_name=project["fullName"],
                default_branch=project["defaultBranch"],
                is_private=project["isPrivate"],
                html_url=project["htmlUrl"],
                web_application=bool(project.get("webApplication", False)),
                development_deployment_ready=bool(project.get("developmentDeploymentReady", False)),
            )
    raise ApiException.not_found("Project not found")


async def fetch_github_token(caller: Caller) -> str:
    settings = get_settings()
    body = await _get(
        get_http_client(),
        f"{settings.mooi_api_base_url}/me/github/token",
        _service_headers(caller),
        "No GitHub account linked",
    )
    return body["token"]


async def fetch_production_recipe(caller: Caller, project_id: UUID) -> dict:
    return await _get(get_http_client(),
                      f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/recipe",
                      _service_headers(caller), "Project not found")


async def fetch_production_recipe_status(caller: Caller, project_id: UUID) -> dict:
    return await _get(get_http_client(),
                      f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/recipe/status",
                      _service_headers(caller), "Project not found")


async def fetch_production_deployment_detail(caller: Caller, project_id: UUID, operation_id: UUID) -> dict:
    return await _get(get_http_client(),
                      f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/deployments/{operation_id}",
                      _service_headers(caller), "Deployment not found")


async def fetch_production_deployments(caller: Caller, project_id: UUID, page: int = 0) -> dict:
    return await _get(get_http_client(),
                      f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/deployments?page={page}",
                      _service_headers(caller), "Project not found")


async def delete_production_deployment(caller: Caller, project_id: UUID, operation_id: UUID) -> None:
    try:
        response = await get_http_client().delete(
            f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/deployments/{operation_id}",
            headers=_service_headers(caller))
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, "Deployment not found")


async def write_production_recipe(caller: Caller, project_id: UUID, recipe: dict) -> dict:
    try:
        response = await get_http_client().put(
            f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/recipe/draft",
            headers=_service_headers(caller), json=recipe)
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, "Project not found")
    return response.json()


async def publish_production_recipe(project_id: UUID) -> dict:
    """Service-only: runs once a deployment proves the draft, possibly after the player's access token expired."""
    return await _send("POST", f"/internal/projects/{project_id}/production/recipe/publish", None,
                       "Project not found") or {}


async def delete_production_recipe(caller: Caller, project_id: UUID) -> None:
    try:
        response = await get_http_client().delete(
            f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/recipe",
            headers=_service_headers(caller))
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, "Project not found")


async def fetch_production_environment(caller: Caller, project_id: UUID) -> dict[str, str]:
    """Stored environment values: for the deploy and status runners and the production agent."""
    payload = await _get(get_http_client(),
                         f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/recipe/environment",
                         _service_headers(caller), "Project not found")
    return {str(key): str(value) for key, value in (payload.get("values") or {}).items()}


async def write_production_environment(caller: Caller, project_id: UUID, values: dict[str, str | None]) -> dict:
    try:
        response = await get_http_client().put(
            f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/recipe/environment",
            headers=_service_headers(caller), json={"values": values})
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, "Project not found")
    return response.json()


async def start_production_deployment(caller: Caller, project_id: UUID, operation_id: UUID,
                                      session_id: UUID | None, release_tag: str, files: dict) -> None:
    try:
        response = await get_http_client().post(
            f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/production/deployments",
            headers=_service_headers(caller),
            json={"operationId": str(operation_id), "sessionId": str(session_id) if session_id else None,
                  "releaseTag": release_tag, "files": files})
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, "Project not found")


async def finish_production_deployment(project_id: UUID, operation_id: UUID,
                                       state: str, message: str, logs: list[str]) -> None:
    """Service-only, so the outcome is saved even after the starting player's access token expired."""
    await _send("PUT", f"/internal/projects/{project_id}/production/deployments/{operation_id}", None,
                "Deployment not found", {"state": state, "message": message, "logs": logs})


async def reconcile_production_deployments(active: list[UUID]) -> int:
    """Fails every unfinished deployment outside `active`: ones a restart of this service orphaned."""
    body = await _send("POST", "/internal/production/deployments/reconcile", None, "Not found",
                       {"active": [str(operation_id) for operation_id in active]})
    return int((body or {}).get("interrupted", 0))


async def _send(method: str, path: str, caller: Caller | None, not_found_message: str,
                payload: dict | None = None) -> dict | None:
    """A service call that changes state in `mic-mooi`; answers its JSON body, or None when it has none."""
    try:
        response = await get_http_client().request(method, f"{get_settings().mooi_api_base_url}{path}",
                                                    headers=_service_headers(caller), json=payload)
    except httpx.HTTPError:
        raise ApiException.bad_gateway() from None
    _raise_for_status(response, not_found_message)
    return response.json() if response.content else None


async def renewed(caller: Caller) -> Caller:
    """`caller` itself while its token stays valid, else a new token for the same sign-in. For callers
    kept beyond their request (an agent's chat, a long run): `mic-mooi` refuses once the player signed
    out or the sign-in reached its maximum lifetime, exactly as a refresh would."""
    if caller.expires_at - time.time() > _RENEWAL_MARGIN_SECONDS:
        return caller
    body = await _send("POST", f"/internal/auth/sessions/{caller.session_id}/access-token", None,
                       "Session is no longer active", {"playerId": str(caller.player_id)})
    return verify_access_token((body or {})["accessToken"])


# --- development: the environment every session of a project shares ---------------------------


async def mark_development_deployment_ready(project_id: UUID) -> None:
    """Service-only and idempotent: the setup's test may finish after the player's access token expired."""
    await _send("PUT", f"/internal/projects/{project_id}/development/deployment/ready", None, "Project not found")


async def fetch_development_environment(caller: Caller, project_id: UUID) -> dict[str, str]:
    payload = await _get(get_http_client(),
                         f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/development/environment",
                         _service_headers(caller), "Project not found")
    return {str(key): str(value) for key, value in (payload.get("values") or {}).items()}


async def write_development_environment(caller: Caller, project_id: UUID, values: dict[str, str | None]) -> list[str]:
    """Merges the values (null removes one) and answers the names now stored."""
    payload = await _send("PUT", f"/me/projects/{project_id}/development/environment", caller, "Project not found",
                          {"values": values})
    return [str(name) for name in (payload or {}).get("environment") or []]


# --- to-dos: the project's docs/TODOS.md, read and committed on its default branch -------------


async def fetch_todos(caller: Caller, project_id: UUID) -> dict:
    return await _get(get_http_client(), f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/todos",
                      _service_headers(caller), "Project not found")


async def write_todos(caller: Caller, project_id: UUID, todos: dict) -> dict:
    """Commits the whole list against the revision the caller read; a stale one answers 409."""
    return await _send("PUT", f"/me/projects/{project_id}/todos", caller, "Project not found", todos) or {}


# --- backups: configuration and durable records ------------------------------------------------


async def fetch_backup_recipe(caller: Caller, project_id: UUID) -> dict:
    return await _get(get_http_client(), f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/backups/recipe",
                      _service_headers(caller), "Project not found")


async def write_backup_recipe(caller: Caller, project_id: UUID, recipe: dict) -> dict:
    return await _send("PUT", f"/me/projects/{project_id}/backups/recipe/draft", caller, "Project not found", recipe)


async def publish_backup_recipe(project_id: UUID) -> dict:
    """Service-only: runs once a restore proves the draft, possibly after the player's access token expired."""
    return await _send("POST", f"/internal/projects/{project_id}/backups/recipe/publish", None,
                       "Project not found") or {}


async def delete_backup_recipe(caller: Caller, project_id: UUID) -> None:
    await _send("DELETE", f"/me/projects/{project_id}/backups/recipe", caller, "Project not found")


async def fetch_backup_environment(caller: Caller, project_id: UUID) -> dict[str, str]:
    """Stored environment values: for the backup runner and the backup agent."""
    payload = await _get(get_http_client(),
                         f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/backups/recipe/environment",
                         _service_headers(caller), "Project not found")
    return {str(key): str(value) for key, value in (payload.get("values") or {}).items()}


async def write_backup_environment(caller: Caller, project_id: UUID, values: dict[str, str | None]) -> dict:
    return await _send("PUT", f"/me/projects/{project_id}/backups/recipe/environment", caller, "Project not found",
                       {"values": values})


async def fetch_backups(caller: Caller, project_id: UUID, page: int = 0) -> dict:
    return await _get(get_http_client(), f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/backups?page={page}",
                      _service_headers(caller), "Project not found")


async def fetch_backup_detail(caller: Caller, project_id: UUID, backup_id: UUID) -> dict:
    return await _get(get_http_client(), f"{get_settings().mooi_api_base_url}/me/projects/{project_id}/backups/{backup_id}",
                      _service_headers(caller), "Backup not found")


async def start_backup(caller: Caller, project_id: UUID, backup_id: UUID, operation_id: UUID, session_id: UUID | None,
                       release_tag: str, started_at: datetime, script: str) -> None:
    await _send("POST", f"/me/projects/{project_id}/backups", caller, "Project not found", {
        "backupId": str(backup_id), "operationId": str(operation_id),
        "sessionId": str(session_id) if session_id else None, "releaseTag": release_tag,
        "startedAt": started_at.isoformat().replace("+00:00", "Z"), "script": script})


async def start_backup_operation(caller: Caller, project_id: UUID, backup_id: UUID, operation_id: UUID,
                                 action: str, target: str | None, script: str) -> None:
    await _send("POST", f"/me/projects/{project_id}/backups/{backup_id}/operations", caller, "Backup not found", {
        "operationId": str(operation_id), "action": action, "target": target, "script": script})


async def finish_backup_operation(project_id: UUID, backup_id: UUID, operation_id: UUID,
                                  state: str, message: str, logs: list[str]) -> None:
    """Service-only, so the outcome is saved even after the starting player's access token expired."""
    await _send("PUT", f"/internal/projects/{project_id}/backups/{backup_id}/operations/{operation_id}", None,
                "Backup not found", {"state": state, "message": message, "logs": logs})


async def reconcile_backup_operations(active: list[UUID]) -> int:
    """Fails every unfinished backup operation outside `active`: ones a restart of this service orphaned."""
    body = await _send("POST", "/internal/backups/operations/reconcile", None, "Not found",
                       {"active": [str(operation_id) for operation_id in active]})
    return int((body or {}).get("interrupted", 0))


async def delete_backup(caller: Caller, project_id: UUID, backup_id: UUID) -> None:
    await _send("DELETE", f"/me/projects/{project_id}/backups/{backup_id}", caller, "Backup not found")


async def fetch_github_identity(caller: Caller) -> GitIdentity:
    """The linked GitHub account as a commit author, using GitHub's private noreply address so the
    player's real email is never written into repository history."""
    settings = get_settings()
    body = await _get(
        get_http_client(),
        f"{settings.mooi_api_base_url}/me/github/connection",
        _bearer(caller),
        "No GitHub account linked",
    )
    connection = body.get("connection")
    if not connection:
        raise ApiException.not_found("No GitHub account linked")
    login = connection["login"]
    return GitIdentity(
        name=connection.get("name") or login,
        email=f"{connection['githubUserId']}+{login}@users.noreply.github.com",
    )


async def fetch_agent_credential(caller: Caller, connection_id: str) -> Credential:
    settings = get_settings()
    body = await _get(
        get_http_client(),
        f"{settings.mooi_api_base_url}/me/agents/connections/{connection_id}/credential",
        _service_headers(caller),
        "No agent provider linked",
    )
    expires_at = body.get("expiresAt")

    async def save(token: str) -> None:
        response = await get_http_client().put(
            f"{settings.mooi_api_base_url}/me/agents/{body['provider']}/credential",
            headers=_service_headers(caller),
            json={"token": token, "connectionId": body.get("connectionId")},
        )
        _raise_for_status(response, "Agent connection changed; reconnect the session")

    return Credential(
        provider=body["provider"],
        mode=body["mode"],
        token=body["token"],
        connection_id=body.get("connectionId"),
        session_model=body.get("sessionModel"),
        session_effort=body.get("sessionEffort"),
        session_adapter=body.get("sessionAdapter"),
        save=save if body["provider"] == "codex" else None,
        expires_at=datetime.fromisoformat(expires_at) if expires_at else None,
    )


async def link_codex(caller: Caller, token: str, account_label: str | None, name: str) -> None:
    response = await get_http_client().post(
        f"{get_settings().mooi_api_base_url}/me/agents/codex/device-connection",
        headers=_service_headers(caller), json={"token": token, "accountLabel": account_label, "name": name},
    )
    _raise_for_status(response, "Could not save the Codex connection")

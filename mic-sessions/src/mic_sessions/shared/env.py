"""Transversal aspect: environment configuration.

Settings are read from process environment variables, layered over an `.env` file chain (the
artifact's own `.env`, then the monorepo root `.env`), mirroring the precedence `mic-mooi` gets
from its `Env` aspect. No external dependency beyond `pydantic-settings` is required.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from dotenv import dotenv_values


def _recipe_environment(prefix: str) -> dict[str, str]:
    """Load recipe variables with the same root/artifact/process precedence as Settings."""
    values: dict[str, str] = {}
    for path in ("../.env", ".env"):
        values.update({key: value for key, value in dotenv_values(path).items()
                       if key.startswith(prefix) and value is not None})
    values.update({key: value for key, value in os.environ.items() if key.startswith(prefix)})
    return values


def development_environment() -> dict[str, str]:
    return _recipe_environment("MOOI_DEVELOPMENT_")


def production_environment() -> dict[str, str]:
    return _recipe_environment("MOOI_PRODUCTION_")


def backup_environment() -> dict[str, str]:
    return _recipe_environment("MOOI_BACKUP_")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore")

    # Application
    app_name: str = "mic-sessions"
    app_version: str = "0.1.0"
    sessions_port: int = 44913

    # Upstream API
    mooi_api_base_url: str = "http://localhost:39615"
    service_token: str = ""
    jwt_secret: str = ""
    introspection_cache_seconds: int = 30

    # Web
    cors_origin: str = "http://localhost:28471"

    # Workspaces
    workspace_root: Path = Path(".workspaces")
    git_binary: str = "git"
    git_timeout_seconds: int = Field(default=180, gt=0)

    # Sessions
    max_sessions: int = Field(default=8, gt=0)
    max_sessions_per_player: int = Field(default=4, gt=0)
    event_log_limit: int = Field(default=5000, gt=0)
    event_log_bytes: int = Field(default=8 * 1024 * 1024, gt=0)
    sse_heartbeat_seconds: int = Field(default=15, gt=0)
    # Agent traces: spans kept per conversation, and characters kept of each span's input and output.
    trace_max_spans: int = Field(default=5000, gt=0)
    trace_detail_chars: int = Field(default=8000, ge=256)
    changes_debounce_seconds: float = Field(default=1.5, ge=0)
    # Dependency and cache directories hidden from Changes even when no .gitignore lists them.
    changes_excluded_directories: Annotated[list[str], NoDecode] = Field(default_factory=lambda: [
        "node_modules", "bower_components", "jspm_packages", ".pnpm-store", ".yarn/cache", ".venv", "venv",
        "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".next", ".nuxt", ".svelte-kit",
        ".turbo", ".parcel-cache", ".angular", ".gradle", ".dart_tool",
    ])
    # Largest file shown as a text diff, and largest diff text returned (cut at a line boundary).
    changes_preview_max_bytes: int = Field(default=4 * 1024 * 1024, ge=64 * 1024)
    # Most files the Files tab lists for one workspace.
    files_max_listed: int = Field(default=50_000, ge=1_000)

    # Session deployments. Docker talks to the host engine, not a nested daemon.
    docker_binary: str = Field(default="docker", min_length=1)
    docker_host: str = "unix:///var/run/docker.sock"
    docker_cli_plugin_dir: Path | None = None
    docker_command_timeout_seconds: int = Field(default=30, gt=0)
    docker_build_timeout_seconds: int = Field(default=1200, gt=0)
    docker_output_limit_bytes: int = Field(default=65536, gt=0)
    deployment_timeout_seconds: int = Field(default=1800, gt=0)
    deployment_readiness_timeout_seconds: int = Field(default=90, gt=0)
    deployment_stop_timeout_seconds: int = Field(default=60, gt=0)
    deployment_probe_timeout_seconds: int = Field(default=5, gt=0)
    deployment_monitor_interval_seconds: int = Field(default=15, gt=0)
    deployment_log_tail_lines: int = Field(default=40, gt=0)
    deployment_log_lines: int = Field(default=2000, gt=0)
    max_deployments: int = Field(default=4, gt=0)
    backup_timeout_seconds: int = Field(default=3600, gt=0)
    # Previews are reachable only through Mooi's embedded reverse proxy, under `/preview/<id>/` of the
    # host serving this service. The upstream says how mic-sessions reaches the web container: a
    # loopback-only publication on the engine host, or a private Docker network shared with
    # mic-sessions when it runs as a container next to the deployments.
    preview_upstream: Literal["loopback", "network"] = "loopback"
    preview_network: str = Field(default="mooi-previews", pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$")

    # Shared browser toolchain; the image installs it outside service/user volumes.
    agent_browser_directory: Path = Path(__file__).resolve().parents[3] / "browser"

    # Agent runtime — namespaced per provider (AGENT_<PROVIDER>_*); read by that adapter alone.
    agent_claude_model: str = "sonnet"
    agent_claude_effort: str = "high"
    agent_claude_disallowed_tools: Annotated[list[str], NoDecode] = []
    # Largest single CLI message (a tool result carrying screenshots or a big file read is one line).
    agent_claude_max_message_bytes: int = Field(default=64 * 1024 * 1024, ge=1024 * 1024)
    # Run the agent's shell commands through RTK (when installed) to compress their output.
    agent_claude_rtk: bool = True
    # Claude Code CLI the `cli` adapter launches (a name on PATH or a path); the image pins its version.
    agent_claude_cli: str = "claude"
    # Reconnections tried, with backoff, when a provider stream breaks before the session fails.
    agent_recovery_attempts: int = Field(default=3, ge=0, le=10)

    # Logging
    log_level: str = "INFO"

    @field_validator("docker_binary")
    @classmethod
    def _validate_docker_binary(cls, value: str) -> str:
        if not value.strip() or "\x00" in value or "\n" in value or "\r" in value:
            raise ValueError("Docker binary must be an executable name or path")
        return value

    @field_validator("docker_cli_plugin_dir", mode="before")
    @classmethod
    def _validate_docker_cli_plugin_dir(cls, value: object) -> Path | None:
        if value is None or value == "":
            return None
        path = Path(value)
        if not path.is_absolute():
            raise ValueError("Docker CLI plugin directory must be absolute")
        return path

    @field_validator("docker_host")
    @classmethod
    def _validate_docker_host(cls, value: str) -> str:
        if (
            not value.startswith("unix:///")
            or not value.removeprefix("unix://").strip("/")
            or any(character.isspace() or ord(character) < 32 for character in value)
            or any(character in value for character in "?#\x7f")
        ):
            raise ValueError("Docker host must be an absolute unix socket URI")
        return value

    @field_validator("agent_claude_disallowed_tools", "changes_excluded_directories", mode="before")
    @classmethod
    def _split_comma_list(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("workspace_root", mode="after")
    @classmethod
    def _resolve_workspace_root(cls, value: Path) -> Path:
        return value.resolve()


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if len(settings.jwt_secret.encode("utf-8")) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 bytes long")
    if not settings.service_token.strip():
        raise RuntimeError("SERVICE_TOKEN must be set")
    if not settings.mooi_api_base_url.startswith(("http://", "https://")):
        raise RuntimeError("MOOI_API_BASE_URL must be a valid URL")
    return settings

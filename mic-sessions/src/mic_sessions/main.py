"""ASGI entrypoint: assembles the app from the transversal aspects and features.

The sessions feature owns its own router; `session_count` is registered here for `/health` to read.
`_lifespan` starts the sessions feature's idle reaper on boot and closes every live session
(workspace + runtime) on graceful shutdown — the feature exports `start_reaper()`/`close_all()`;
this module only calls them. The preview gateway wraps the whole API: requests for a preview
path go to the embedded reverse proxy before any API middleware runs.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from mic_sessions.features import agent_connections, health, sessions
from mic_sessions.shared import previews, web, workspaces
from mic_sessions.shared.env import get_settings
from mic_sessions.shared.logging import CorrelationIdMiddleware, configure_logging


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.workspace_root.mkdir(parents=True, exist_ok=True)
    preserved = await sessions.reconcile_deployments()
    await sessions.reconcile_session_compose()
    if preserved is not None:
        await workspaces.get_workspaces().reconcile(preserve=preserved)
    await web.open_http_client()
    sessions.start_reaper()
    try:
        yield
    finally:
        await agent_connections.close_all()
        await sessions.close_all()
        await previews.close()
        await web.close_http_client()


def create_app() -> previews.PreviewGateway:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=_lifespan)
    web.install(app)
    app.add_middleware(CorrelationIdMiddleware)
    app.include_router(health.router)
    app.include_router(agent_connections.router)
    app.include_router(sessions.router)
    app.state.session_count = sessions.get_registry().count

    return previews.PreviewGateway(app)


app = create_app()

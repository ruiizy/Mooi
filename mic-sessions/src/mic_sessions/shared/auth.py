"""Transversal aspect: identity verification.

Two layers: (a) a local, stateless HS256 check of the access token minted
by `mic-mooi` (signature, expiry, subject) — cheap and rejects forgeries outright; (b) an
authoritative liveness check against `mic-mooi`'s own `GET /me`, cached briefly per
`(playerId, sid)` so a revoked Mooi session stops session traffic quickly without a per-request
hop. Both checks answer with the same message: which one failed is not something a caller should
be able to probe.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from uuid import UUID

import httpx
import jwt
from fastapi import Request

from mic_sessions.shared.env import get_settings
from mic_sessions.shared.logging import player_id_var
from mic_sessions.shared.web import ApiException, get_http_client

_UNAUTHORIZED_MESSAGE = "Invalid or expired session"
_BEARER_PREFIX = "Bearer "


@dataclass(frozen=True)
class Caller:
    player_id: UUID
    session_id: UUID
    role: str
    token: str
    # Epoch seconds: lets whoever keeps a caller beyond its request renew the token in time.
    expires_at: float


def verify_access_token(token: str) -> Caller:
    """Local HS256 verification: signature, expiry, and the `sub`/`sid`/`role` claims."""
    settings = get_settings()
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return Caller(
            player_id=UUID(str(claims["sub"])),
            session_id=UUID(str(claims["sid"])),
            role=str(claims["role"]),
            token=token,
            expires_at=float(claims["exp"]),
        )
    except (jwt.PyJWTError, KeyError, ValueError):
        raise ApiException.unauthorized(_UNAUTHORIZED_MESSAGE) from None


class _Introspector:
    """Caches a liveness check per `(playerId, sid)` for `introspection_cache_seconds`."""

    def __init__(self) -> None:
        self._cache: dict[tuple[UUID, UUID], float] = {}
        self._lock = asyncio.Lock()

    async def introspect(self, caller: Caller, http_client: httpx.AsyncClient) -> None:
        settings = get_settings()
        key = (caller.player_id, caller.session_id)
        now = time.monotonic()
        async with self._lock:
            expiry = self._cache.get(key)
            if expiry is not None and expiry > now:
                return

        response = await http_client.get(
            f"{settings.mooi_api_base_url}/me",
            headers={"Authorization": f"{_BEARER_PREFIX}{caller.token}"},
        )
        if response.status_code != 200:
            async with self._lock:
                self._cache.pop(key, None)
            raise ApiException.unauthorized(_UNAUTHORIZED_MESSAGE)

        async with self._lock:
            self._cache[key] = now + settings.introspection_cache_seconds


_introspector = _Introspector()


async def current_caller(request: Request) -> Caller:
    """FastAPI dependency: verifies the token, checks liveness, and scopes the request's logs."""
    header = request.headers.get("Authorization", "")
    if not header.startswith(_BEARER_PREFIX):
        raise ApiException.unauthorized(_UNAUTHORIZED_MESSAGE)
    token = header[len(_BEARER_PREFIX) :].strip()
    if not token:
        raise ApiException.unauthorized(_UNAUTHORIZED_MESSAGE)

    caller = verify_access_token(token)
    await _introspector.introspect(caller, get_http_client())
    player_id_var.set(str(caller.player_id))
    return caller

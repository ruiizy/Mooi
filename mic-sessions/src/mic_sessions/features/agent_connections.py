"""Agent-owned sign-ins linked through this service: owner-bound, expiring attempts in which the
provider's own binary signs in (Codex device code, agy's Google OAuth with a pasted code); the
resulting credential goes straight to `mic-mooi` and never reaches the browser or the logs."""
from __future__ import annotations

import asyncio
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from mic_sessions.shared import antigravity
from mic_sessions.shared.auth import Caller, current_caller
from mic_sessions.shared.codex import Client
from mic_sessions.shared.env import get_settings
from mic_sessions.shared.mooi import link_antigravity, link_codex, renewed
from mic_sessions.shared.web import ApiException

LOG = logging.getLogger("sessions")

router = APIRouter()


@dataclass
class Attempt:
    owner: str
    name: str = ""
    task: asyncio.Task | None = None
    state: str = "pending"
    client: Client | None = None
    login_id: str | None = None
    ready: asyncio.Future | None = None
    finished: asyncio.Event = field(default_factory=asyncio.Event)


_attempts: dict[str, Attempt] = {}


async def _login(attempt: Attempt):
    with tempfile.TemporaryDirectory(prefix="mooi-codex-login-") as directory:
        client = Client(Path(directory), Path(directory))
        attempt.client = client
        try:
            async with asyncio.timeout(600):
                await client.start()
                login = (await client.call("account_login_start", {"type": "chatgptDeviceCode"})).root
                attempt.login_id = login.login_id
                attempt.ready.set_result({"verificationUrl": login.verification_url, "userCode": login.user_code})
                completed = await client.call("wait_for_login_completed", login.login_id)
                attempt.state = "authorized" if completed.success else "failed"
                # Completion is committed by an authenticated poll with a fresh Mooi token.
                if completed.success:
                    await attempt.finished.wait()
        except asyncio.CancelledError:
            attempt.state = "cancelled"
            raise
        except TimeoutError:
            attempt.state = "expired"
            if not attempt.ready.done():
                attempt.ready.set_exception(ApiException(502, "Codex login timed out. Try again."))
        except Exception:
            attempt.state = "failed"
            if not attempt.ready.done():
                attempt.ready.set_exception(ApiException(502, "Could not start Codex login. Try again."))
        finally:
            await client.close()
            attempt.client = None
            if attempt.state == "pending":
                attempt.state = "expired"


@router.post("/agents/codex/authorization")
async def start(caller: Annotated[Caller, Depends(current_caller)],
                name: Annotated[str, Query(min_length=1, max_length=100)]):
    name = name.strip()
    if not name:
        raise ApiException.bad_request("An account title is required")
    owner = str(caller.player_id)
    replaced = []
    for key, existing in list(_attempts.items()):
        if existing.owner == owner or existing.state in ("failed", "cancelled", "connected", "expired"):
            if existing.task and not existing.task.done():
                existing.task.cancel()
                replaced.append(existing.task)
            _attempts.pop(key, None)
    if len(_attempts) >= 32:
        raise ApiException(429, "Too many login attempts. Try again later.")
    key = uuid4().hex
    attempt = Attempt(owner, name=name, ready=asyncio.get_running_loop().create_future())
    _attempts[key] = attempt
    attempt.task = asyncio.create_task(_login(attempt))
    try:
        await asyncio.gather(*replaced, return_exceptions=True)
        async with asyncio.timeout(45):
            details = await asyncio.shield(attempt.ready)
        return {"id": key, **details}
    except BaseException as error:
        attempt.task.cancel()
        await asyncio.gather(attempt.task, return_exceptions=True)
        _attempts.pop(key, None)
        if isinstance(error, asyncio.CancelledError):
            raise
        raise ApiException(502, "Could not start Codex login. Try again.") from None


def _owned(key: str, caller: Caller) -> Attempt:
    attempt = _attempts.get(key)
    if attempt is None or attempt.owner != str(caller.player_id):
        raise ApiException.not_found("Login attempt not found")
    return attempt


@router.get("/agents/codex/authorization/{key}")
async def status(key: str, caller: Annotated[Caller, Depends(current_caller)]):
    attempt = _owned(key, caller)
    if attempt.state == "authorized" and attempt.client:
        # Claim before awaiting so overlapping polls cannot commit twice.
        attempt.state = "saving"
        try:
            account = await attempt.client.call("account_read", {"refreshToken": True})
            label = getattr(account.account.root, "email", None) if account.account else None
            home = attempt.client.home
            await link_codex(caller, (home / "auth.json").read_text(), label, attempt.name)
            attempt.state = "connected"
        except Exception:
            attempt.state = "failed"
        finally:
            attempt.finished.set()
            if attempt.task:
                await asyncio.gather(attempt.task, return_exceptions=True)
    return {"status": attempt.state}


@router.delete("/agents/codex/authorization/{key}", status_code=204)
async def cancel(key: str, caller: Annotated[Caller, Depends(current_caller)]):
    attempt = _owned(key, caller)
    if attempt.task:
        attempt.task.cancel()
        await asyncio.gather(attempt.task, return_exceptions=True)
    _attempts.pop(key, None)


# --- Antigravity: agy's own Google sign-in, the player pastes the code Google shows ---------------

# An attempt left unfinished this long is closed: the URL agy printed (its PKCE state) dies with it.
GOOGLE_ATTEMPT_SECONDS = 600
_ATTEMPT_LIMIT = 32
# Used when agy reported no email for the new sign-in.
_GOOGLE_ACCOUNT_LABEL = "Google account"
# Status per `antigravity.LoginError.kind`.
_LOGIN_STATUS = {"invalid": 400, "rejected": 422, "ended": 410, "timeout": 504, "failed": 502}


@dataclass
class GoogleAttempt:
    owner: str
    name: str
    login: antigravity.Login
    # `pending` until the code arrives, then `submitting` until the attempt is dropped.
    state: str = "pending"
    expiry: asyncio.Task | None = None


_google_attempts: dict[str, GoogleAttempt] = {}


class GoogleCode(BaseModel):
    # The code Google's page shows, or the full URL of the page the sign-in lands on.
    code: str = Field(min_length=1, max_length=antigravity.LOGIN_CODE_LIMIT)


def _sentence(text: str) -> str:
    text = text.strip()
    return (text[:1].upper() + text[1:] + ("" if text.endswith(".") else ".")) if text else "Try again."


def _login_failure(error: antigravity.AntigravityError, fallback: int = 502) -> ApiException:
    """User-safe status and message; the diagnostic (never a code or token) goes to the log only."""
    kind = error.kind if isinstance(error, antigravity.LoginError) else "failed"
    LOG.info("Antigravity sign-in failed (%s): %s", kind, error.detail or "no detail")
    return ApiException(_LOGIN_STATUS.get(kind, fallback), _sentence(error.cause))


def _take_google(key: str) -> GoogleAttempt | None:
    """Removes the attempt from the registry synchronously (no await in between, so an owner never has
    two live attempts); the caller closes its login."""
    attempt = _google_attempts.pop(key, None)
    if attempt and attempt.expiry and attempt.expiry is not asyncio.current_task():
        attempt.expiry.cancel()
    return attempt


async def _discard_google(key: str) -> None:
    attempt = _take_google(key)
    if attempt:
        await attempt.login.close()


async def _expire_google(key: str, attempt: GoogleAttempt) -> None:
    await asyncio.sleep(GOOGLE_ATTEMPT_SECONDS)
    # A code being redeemed finishes on its own timeouts and drops the attempt itself.
    if _google_attempts.get(key) is attempt and attempt.state == "pending":
        await _discard_google(key)


@router.post("/agents/antigravity/authorization")
async def start_google(caller: Annotated[Caller, Depends(current_caller)],
                       name: Annotated[str, Query(min_length=1, max_length=100)]):
    """Starts agy's Google sign-in in a private temporary home and answers the authorization URL to
    open; the code Google then shows is posted to `…/{attemptId}/code`. One attempt per player: a new
    one replaces the previous."""
    name = name.strip()
    if not name:
        raise ApiException.bad_request("An account title is required")
    owner = str(caller.player_id)
    replaced: list[GoogleAttempt] = []
    for key, existing in list(_google_attempts.items()):
        if existing.owner == owner and _take_google(key):
            replaced.append(existing)
    if len(_google_attempts) >= _ATTEMPT_LIMIT:
        await asyncio.gather(*(attempt.login.close() for attempt in replaced), return_exceptions=True)
        raise ApiException(429, "Too many sign-in attempts. Try again later.")
    key = uuid4().hex
    attempt = GoogleAttempt(owner, name, antigravity.Login(get_settings().agent_antigravity_cli))
    _google_attempts[key] = attempt
    await asyncio.gather(*(previous.login.close() for previous in replaced), return_exceptions=True)
    try:
        url = await attempt.login.start()
    except antigravity.AntigravityError as error:
        await _discard_google(key)
        raise _login_failure(error) from None
    except BaseException:
        await _discard_google(key)
        raise
    if _google_attempts.get(key) is not attempt:
        # Cancelled or replaced while agy was starting.
        await attempt.login.close()
        raise ApiException(410, "This sign-in was cancelled. Start again.")
    attempt.expiry = asyncio.create_task(_expire_google(key, attempt))
    return {"attemptId": key, "authorizationUrl": url, "expiresIn": GOOGLE_ATTEMPT_SECONDS}


def _owned_google(key: str, caller: Caller) -> GoogleAttempt:
    attempt = _google_attempts.get(key)
    if attempt is None or attempt.owner != str(caller.player_id):
        raise ApiException.not_found("Sign-in attempt not found")
    return attempt


@router.post("/agents/antigravity/authorization/{key}/code")
async def submit_google(key: str, body: GoogleCode, caller: Annotated[Caller, Depends(current_caller)]):
    """Hands the pasted code to agy once, captures the sign-in it stored and links it to `mic-mooi` with
    the caller's own token; answers the new connection. A code that is not one (empty, several lines)
    keeps the attempt; any other outcome ends it."""
    attempt = _owned_google(key, caller)
    if attempt.state != "pending":
        raise ApiException.conflict("This sign-in is already being completed")
    try:
        code = antigravity.login_code(body.code)
    except antigravity.AntigravityError as error:
        raise _login_failure(error, 400) from None
    attempt.state = "submitting"
    try:
        try:
            bundle, account = await attempt.login.submit(code)
        except antigravity.AntigravityError as error:
            raise _login_failure(error) from None
        # The exchange may outlast the request's access token: link with a still valid one.
        try:
            return await link_antigravity(await renewed(caller), bundle, account or _GOOGLE_ACCOUNT_LABEL,
                                          attempt.name)
        except ApiException as error:
            # The attempt ends here either way: a 400 would tell the SPA to keep it and retry the code.
            if error.status_code == 400:
                raise ApiException(422, "Mooi could not store this sign-in. Start the sign-in again.") from None
            raise
    finally:
        if _google_attempts.get(key) is attempt:
            await _discard_google(key)
        else:
            await attempt.login.close()


@router.delete("/agents/antigravity/authorization/{key}", status_code=204)
async def cancel_google(key: str, caller: Annotated[Caller, Depends(current_caller)]):
    _owned_google(key, caller)
    await _discard_google(key)


async def close_all():
    tasks = [attempt.task for attempt in _attempts.values() if attempt.task]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _attempts.clear()
    google = [taken for key in list(_google_attempts) if (taken := _take_google(key))]
    await asyncio.gather(*(attempt.login.close() for attempt in google), return_exceptions=True)

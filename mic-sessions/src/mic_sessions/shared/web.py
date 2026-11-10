"""Transversal aspect: HTTP edge.

Owns CORS for the SPA origin and the single error contract returned by every endpoint, mirroring
`mic-mooi`'s `Web.ApiError` so both services fail the same way on the wire.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from http import HTTPStatus

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from mic_sessions.shared.env import get_settings
from mic_sessions.shared.logging import CORRELATION_ID_HEADER, correlation_id_var

LOG = logging.getLogger("sessions")

_http_client: httpx.AsyncClient | None = None


class FieldIssue(BaseModel):
    field: str
    message: str


class ApiError(BaseModel):
    timestamp: datetime
    status: int
    error: str
    message: str
    path: str
    correlationId: str
    issues: list[FieldIssue] = []


class ApiException(Exception):
    """The one exception every feature raises to fail a request with a specific status."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message

    @classmethod
    def bad_request(cls, message: str) -> ApiException:
        return cls(status.HTTP_400_BAD_REQUEST, message)

    @classmethod
    def unauthorized(cls, message: str = "Unauthorized") -> ApiException:
        return cls(status.HTTP_401_UNAUTHORIZED, message)

    @classmethod
    def forbidden(cls, message: str = "Forbidden") -> ApiException:
        return cls(status.HTTP_403_FORBIDDEN, message)

    @classmethod
    def not_found(cls, message: str = "Not found") -> ApiException:
        return cls(status.HTTP_404_NOT_FOUND, message)

    @classmethod
    def conflict(cls, message: str) -> ApiException:
        return cls(status.HTTP_409_CONFLICT, message)

    @classmethod
    def bad_gateway(cls, message: str = "Upstream service failure") -> ApiException:
        return cls(status.HTTP_502_BAD_GATEWAY, message)


def _build(status_code: int, message: str, request: Request, issues: list[FieldIssue] | None = None) -> JSONResponse:
    body = ApiError(
        timestamp=datetime.now(UTC),
        status=status_code,
        error=HTTPStatus(status_code).phrase,
        message=message,
        path=request.url.path,
        correlationId=correlation_id_var.get(),
        issues=issues or [],
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


async def open_http_client() -> None:
    """Opens the single `httpx.AsyncClient` shared by every outbound call to `mic-mooi`."""
    global _http_client
    _http_client = httpx.AsyncClient(timeout=10.0)


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


def get_http_client() -> httpx.AsyncClient:
    if _http_client is None:
        raise RuntimeError("The shared HTTP client has not been opened yet")
    return _http_client


def install(app: FastAPI) -> None:
    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_origin],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[CORRELATION_ID_HEADER, "Content-Disposition"],
    )

    @app.exception_handler(ApiException)
    async def on_api_exception(request: Request, exc: ApiException) -> JSONResponse:
        return _build(exc.status_code, exc.message, request)

    @app.exception_handler(RequestValidationError)
    async def on_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        issues = [
            FieldIssue(field=".".join(str(part) for part in error["loc"][1:]), message=error["msg"])
            for error in exc.errors()
        ]
        return _build(status.HTTP_400_BAD_REQUEST, "Request validation failed", request, issues)

    @app.exception_handler(HTTPException)
    async def on_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        return _build(exc.status_code, str(exc.detail), request)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        LOG.error("Unhandled failure on %s %s", request.method, request.url.path, exc_info=exc)
        return _build(status.HTTP_500_INTERNAL_SERVER_ERROR, "Unexpected server error", request)

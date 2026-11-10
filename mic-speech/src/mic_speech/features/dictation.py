"""Feature: push-to-talk dictation bridge.

`WS /api/stt/stream` relays raw PCM16 (mono, 16 kHz, little endian) from the browser to one
engine realtime session and streams the running transcript back, full duplex: browser audio and
engine results are awaited at the same time, so partials never wait behind audio.

Browser protocol — binary audio frames (even length, at most 500 ms; the SPA sends 100 ms), then
exactly one `{"type":"stop"}`. Server messages: `ready`, `partial` (whole running text), `final` (definitive
text, may be empty) and `error` (followed by close). Close codes: 1000 normal, 1008 origin or
invalid/expired session, 1011 transcription failure, 1013 busy.

One dictation at a time per machine. A new dictation waits briefly for the previous one to be
released (a browser that abandoned it is only noticed after its queued frames), then gets `busy`.
The session is released (engine socket closed, metrics queued, lock freed) before `final` is
sent, so the next dictation can start at once. The engine socket never holds the lock longer than
`ENGINE_CLOSE_TIMEOUT_SECONDS`: an engine still behind real time acknowledges a close only after
transcribing its backlog, so an abandoned session is dropped instead. Audio and text are never
stored nor logged: only counts and timings.

The engine stream starts at the speech onset (`_OnsetGate`): a realtime session whose first audio
is near-silent stays deaf for several seconds and loses the words spoken meanwhile, whatever
follows. Chrome's echo-cancelled capture opens with such frames, mostly on a resumed audio engine.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import sys
import time
from array import array
from collections import deque

from fastapi import APIRouter, WebSocket
from websockets.asyncio.client import ClientConnection, connect

from mic_speech.shared.engine import get_engine
from mic_speech.shared.env import Settings, get_settings
from mic_speech.shared.metrics import Dictation, get_metrics

LOG = logging.getLogger("speech.dictation")

router = APIRouter()

SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2
MAX_FRAME_BYTES = 16000
DEADLINE_MARGIN_SECONDS = 30
IDLE_TIMEOUT_SECONDS = 30
ENGINE_OPEN_TIMEOUT_SECONDS = 15
ENGINE_CLOSE_TIMEOUT_SECONDS = 1
ENGINE_MAX_MESSAGE_BYTES = 1 << 20
LOCK_WAIT_SECONDS = 3
CONTEXT_BOOST = 3.0
# A frame this loud (RMS, PCM16) opens the engine stream: above room noise, below any speech onset.
ONSET_RMS = 500
# Audio kept before the onset frame: the engine needs a short lead-in to catch the first word.
PREROLL_BYTES = BYTES_PER_SECOND // 5

BUSY_MESSAGE = "Dictation is busy. Try again."
INVALID_MESSAGE = "The session expired or the audio is not valid. Try again."
FAILURE_MESSAGE = "The audio could not be transcribed."

_lock = asyncio.Lock()
_background: set[asyncio.Task] = set()


class _InvalidSession(Exception):
    """Client broke the protocol or a deadline expired: close with 1008."""


def _rms(frame: bytes) -> float:
    samples = array("h", frame)
    if sys.byteorder == "big":
        samples.byteswap()
    return math.sqrt(math.sumprod(samples, samples) / len(samples))


class _OnsetGate:
    """Holds the audio back until the first frame with sound, then releases it with its pre-roll.

    Leading silence carries no words, so dropping it loses nothing; the engine only ever sees a
    stream that starts on real signal. Once open, every frame passes through untouched.
    """

    def __init__(self) -> None:
        self.open = False
        self.held_back_bytes = 0
        self._preroll: deque[bytes] = deque()
        self._preroll_bytes = 0

    def admit(self, frame: bytes) -> list[bytes]:
        """Returns the frames to forward to the engine now, in order."""
        if self.open:
            return [frame]
        if _rms(frame) >= ONSET_RMS:
            self.open = True
            frames = [*self._preroll, frame]
            self.held_back_bytes -= self._preroll_bytes
            self._preroll.clear()
            return frames
        self.held_back_bytes += len(frame)
        self._preroll.append(frame)
        self._preroll_bytes += len(frame)
        while self._preroll_bytes - len(self._preroll[0]) >= PREROLL_BYTES:
            self._preroll_bytes -= len(self._preroll.popleft())
        return []


class _Transcription:
    """One engine realtime session plus the text assembled from its events."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._engine: ClientConnection | None = None
        self.finalized: list[str] = []
        self.draft = ""
        self.received_bytes = 0
        self.onset = _OnsetGate()
        self.partials = 0
        self.created_at = time.perf_counter()
        self.first_partial_ms: float | None = None
        self.stop_at: float | None = None
        self.final_at: float | None = None

    @property
    def engine(self) -> ClientConnection:
        if self._engine is None:
            raise RuntimeError("Engine session is not open")
        return self._engine

    async def open(self, url: str) -> None:
        self._engine = await connect(
            url, max_size=ENGINE_MAX_MESSAGE_BYTES, open_timeout=ENGINE_OPEN_TIMEOUT_SECONDS,
            close_timeout=ENGINE_CLOSE_TIMEOUT_SECONDS,
        )
        if (await self._receive_event()).get("type") != "session.created":
            raise RuntimeError("Engine did not create a session")
        session: dict = {
            "sample_rate": SAMPLE_RATE,
            "language": self._settings.speech_language,
            "automatic_punctuation": True,
        }
        if self._settings.speech_contexts:
            session["speech_contexts"] = [{"phrases": self._settings.speech_contexts, "boost": CONTEXT_BOOST}]
        await self.engine.send(json.dumps({"type": "session.update", "session": session}))
        if (await self._receive_event()).get("type") != "session.updated":
            raise RuntimeError("Engine rejected the language setting")

    async def _receive_event(self) -> dict:
        return json.loads(await asyncio.wait_for(self.engine.recv(), ENGINE_OPEN_TIMEOUT_SECONDS))

    async def close(self) -> None:
        engine, self._engine = self._engine, None
        if engine is not None:
            await engine.close()

    def apply(self, raw: str | bytes) -> str | None:
        """Folds one engine event into the text; returns `partial`, `completed` or None (ignored)."""
        event = json.loads(raw)
        kind = event.get("type")
        if kind == "error":
            raise RuntimeError("Engine reported a transcription error")
        if kind == "conversation.item.input_audio_transcription.delta":
            self.draft += event.get("delta") or ""
            return "partial"
        if kind == "conversation.item.input_audio_transcription.completed":
            transcript = (event.get("transcript") or "").strip()
            if transcript:
                self.finalized.append(transcript)
            self.draft = ""
            return "completed"
        return None

    def text(self) -> str:
        return " ".join(part for part in (*self.finalized, self.draft.strip()) if part).strip()

    def mark_partial(self) -> None:
        self.partials += 1
        if self.first_partial_ms is None:
            self.first_partial_ms = (time.perf_counter() - self.created_at) * 1000


async def _send(websocket: WebSocket, message: dict) -> None:
    try:
        await websocket.send_json(message)
    except Exception:  # noqa: BLE001 - the browser may already be gone; nothing left to tell it
        pass


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except Exception:  # noqa: BLE001 - already closed
        pass


async def _cancel(task: asyncio.Task | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except BaseException:  # noqa: BLE001 - its outcome no longer matters
        pass


def _record(dictation: _Transcription, outcome: str) -> None:
    # Only a transcription the engine finished has a finalization latency; silence ends at once.
    stop_to_final_ms = (
        (dictation.final_at - dictation.stop_at) * 1000
        if outcome in ("final", "empty") and dictation.onset.open and dictation.stop_at and dictation.final_at
        else None
    )
    entry = Dictation(
        outcome=outcome,
        audio_seconds=dictation.received_bytes / BYTES_PER_SECOND,
        first_partial_ms=dictation.first_partial_ms,
        partial_count=dictation.partials,
        stop_to_final_ms=stop_to_final_ms,
    )
    LOG.info(
        "Dictation outcome=%s audio_s=%.1f lead_silence_s=%.1f first_partial_ms=%s partials=%d stop_to_final_ms=%s",
        outcome, entry.audio_seconds, dictation.onset.held_back_bytes / BYTES_PER_SECOND,
        _ms(entry.first_partial_ms), entry.partial_count, _ms(stop_to_final_ms),
    )

    async def write() -> None:
        try:
            await get_metrics().record(entry)
        except Exception:  # noqa: BLE001 - metrics never fail a dictation
            LOG.warning("Could not record dictation metrics", exc_info=True)

    task = asyncio.create_task(write())
    _background.add(task)
    task.add_done_callback(_background.discard)


def _ms(value: float | None) -> str:
    return "-" if value is None else f"{value:.0f}"


def _validate_frame(dictation: _Transcription, frame: bytes, max_seconds: int) -> None:
    if not frame or len(frame) % 2 or len(frame) > MAX_FRAME_BYTES:
        raise _InvalidSession("Invalid audio frame")
    dictation.received_bytes += len(frame)
    if dictation.received_bytes > max_seconds * BYTES_PER_SECOND:
        raise _InvalidSession("Maximum dictation length exceeded")


def _is_stop(text: str | None) -> bool:
    try:
        return json.loads(text or "") == {"type": "stop"}
    except ValueError:
        return False


@router.websocket("/api/stt/stream")
async def stream(websocket: WebSocket) -> None:
    settings = get_settings()
    if websocket.headers.get("origin") != settings.cors_origin:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        await asyncio.wait_for(_lock.acquire(), LOCK_WAIT_SECONDS)
    except TimeoutError:
        await _send(websocket, {"type": "error", "message": BUSY_MESSAGE})
        await _close(websocket, 1013)
        return

    dictation = _Transcription(settings)
    browser_task: asyncio.Task | None = None
    engine_task: asyncio.Task | None = None
    released = False
    outcome = "error"

    async def release() -> None:
        nonlocal released
        if released:
            return
        released = True
        try:
            await _cancel(browser_task)
            await _cancel(engine_task)
            await dictation.close()
            _record(dictation, outcome)
        except Exception:  # noqa: BLE001 - release must always free the lock
            LOG.warning("Dictation release failed", exc_info=True)
        finally:
            _lock.release()

    async def finish(text: str) -> None:
        nonlocal outcome
        dictation.final_at = time.perf_counter()
        outcome = "final" if text else "empty"
        await release()
        await _send(websocket, {"type": "final", "text": text})

    loop = asyncio.get_running_loop()
    try:
        await dictation.open(get_engine().realtime_url)
        await _send(websocket, {"type": "ready", "maxSeconds": settings.speech_max_seconds})
        deadline = loop.time() + settings.speech_max_seconds + DEADLINE_MARGIN_SECONDS
        browser_task = asyncio.create_task(websocket.receive())
        engine_task = asyncio.create_task(dictation.engine.recv())
        stopping = False

        while True:
            remaining = deadline - loop.time()
            pending = {task for task in (browser_task, engine_task) if task is not None}
            done, _ = await asyncio.wait(
                pending, timeout=max(0.0, min(IDLE_TIMEOUT_SECONDS, remaining)), return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                raise _InvalidSession("Dictation timed out")

            if browser_task is not None and browser_task in done:
                message = browser_task.result()
                if message["type"] == "websocket.disconnect":
                    outcome = "cancelled"
                    return
                frame = message.get("bytes")
                if frame is not None:
                    _validate_frame(dictation, frame, settings.speech_max_seconds)
                    for audio in dictation.onset.admit(frame):
                        await dictation.engine.send(audio)
                    browser_task = asyncio.create_task(websocket.receive())
                elif _is_stop(message.get("text")):
                    stopping = True
                    dictation.stop_at = time.perf_counter()
                    browser_task = None
                    if not dictation.onset.open:  # silence only: nothing to transcribe
                        await finish("")
                        break
                    await dictation.engine.send(json.dumps({"type": "input_audio_buffer.commit"}))
                else:
                    raise _InvalidSession("Unexpected client message")

            if engine_task in done:
                event = dictation.apply(engine_task.result())
                if event == "completed" and stopping:
                    await finish(dictation.text())
                    break
                if event is not None:
                    dictation.mark_partial()
                    await _send(websocket, {"type": "partial", "text": dictation.text()})
                engine_task = asyncio.create_task(dictation.engine.recv())

        await _close(websocket, 1000)
    except _InvalidSession as error:
        LOG.info("Dictation rejected: %s", error)
        await release()
        await _send(websocket, {"type": "error", "message": INVALID_MESSAGE})
        await _close(websocket, 1008)
    except Exception:  # noqa: BLE001 - any engine or transport failure ends this dictation only
        LOG.warning("Dictation failed", exc_info=True)
        await release()
        await _send(websocket, {"type": "error", "message": FAILURE_MESSAGE})
        await _close(websocket, 1011)
    finally:
        await release()

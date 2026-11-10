"""Transversal aspect: live event delivery.

Every live view reaches the browser through one mechanism: a Server-Sent Events stream served by
`event_stream`, fed by a `Fanout` of bounded subscriber queues. Two kinds of source exist:

- `EventLog`: one session's append-only transcript with a monotonic `seq`. It is the single source of
  truth for the transcript, so its stream is a live tail and a client that reconnects simply replays
  from its last `seq`. The log is a bounded ring buffer (`EVENT_LOG_LIMIT`/`EVENT_LOG_BYTES`); expired
  cursors receive an explicit history reset and a current snapshot from the stream endpoint.
- `Channels`: one live channel per player for everything outside a transcript (session summaries,
  production and backup operations, environment and configuration changes). Nothing is retained:
  a client that (re)connects receives a fresh `sync` snapshot first, then live events.

Each event is serialized exactly once, when it is created, and that frame is shared by every
subscriber. A subscriber that falls behind its bounded queue is dropped rather than allowed to buffer
unboundedly; it reconnects and resumes from its cursor or a fresh snapshot.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable, Hashable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from fastapi.responses import StreamingResponse

from mic_sessions.shared.env import get_settings

LOG = logging.getLogger("sessions")

_SUBSCRIBER_QUEUE_LIMIT = 256
_HEARTBEAT = ": ping\n\n"
_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


@dataclass(frozen=True)
class Event:
    seq: int
    at: datetime
    type: str
    data: dict[str, Any]
    # The encoded SSE frame, built once and shared by every subscriber and replay.
    frame: str


def new_event(seq: int, type_: str, data: dict[str, Any]) -> Event:
    at = datetime.now(UTC)
    payload = json.dumps({"seq": seq, "at": at.isoformat(), **data}, ensure_ascii=False, default=str)
    return Event(seq=seq, at=at, type=type_, data=data, frame=f"id: {seq}\nevent: {type_}\ndata: {payload}\n\n")


Subscription = asyncio.Queue[Event | None]


class Fanout:
    """Bounded subscriber queues; a `None` sentinel ends a subscriber's stream."""

    def __init__(self) -> None:
        self._subscribers: set[Subscription] = set()

    @property
    def subscribed(self) -> bool:
        return bool(self._subscribers)

    @property
    def count(self) -> int:
        return len(self._subscribers)

    def subscribe(self) -> Subscription:
        """Registers a queue synchronously, with no `await`: a caller can snapshot or replay right
        after this with no gap in which an event published in between could be lost. A raw queue is
        handed back rather than an async generator, so a heartbeat timeout on `queue.get()` can
        never tear the subscription down."""
        queue: Subscription = asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE_LIMIT)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: Subscription) -> None:
        self._subscribers.discard(queue)

    def offer(self, event: Event) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                LOG.warning("Dropping a slow stream subscriber at seq=%s", event.seq)
                self._subscribers.discard(queue)
                self._end(queue)

    def close(self) -> None:
        for queue in list(self._subscribers):
            self._end(queue)
        self._subscribers.clear()

    @staticmethod
    def _end(queue: Subscription) -> None:
        """Makes room for the closing sentinel in a full queue, so its consumer still observes it."""
        while queue.full():
            queue.get_nowait()
        queue.put_nowait(None)


class EventLog(Fanout):
    """One session's append-only, replayable event log plus its live fan-out."""

    def __init__(self, limit: int | None = None) -> None:
        super().__init__()
        self._events: deque[Event] = deque(maxlen=limit or get_settings().event_log_limit)
        self._byte_limit = get_settings().event_log_bytes
        self._bytes = 0
        self._seq = 0

    def append(self, type_: str, data: dict[str, Any]) -> Event:
        self._seq += 1
        event = new_event(self._seq, type_, data)
        if len(self._events) == self._events.maxlen:
            self._bytes -= len(self._events[0].frame)
        self._events.append(event)
        self._bytes += len(event.frame)
        while self._bytes > self._byte_limit and self._events:
            self._bytes -= len(self._events.popleft().frame)
        self.offer(event)
        return event

    @property
    def last_seq(self) -> int:
        return self._seq

    @property
    def first_seq(self) -> int:
        return self._events[0].seq if self._events else self._seq + 1

    def replay(self, after: int) -> list[Event]:
        return [event for event in self._events if event.seq > after]


class Channels:
    """One live, non-retained channel per key (a player). Publishing to a key nobody listens to
    costs nothing: the event is not even encoded."""

    def __init__(self) -> None:
        self._fanouts: dict[Hashable, Fanout] = {}
        self._seq = 0

    def publish(self, key: Hashable, type_: str, data: dict[str, Any]) -> None:
        fanout = self._fanouts.get(key)
        if fanout is None or not fanout.subscribed:
            return
        self._seq += 1
        fanout.offer(new_event(self._seq, type_, data))

    def watched(self, key: Hashable) -> bool:
        """Someone listens to `key`: lets a publisher skip building a payload nobody would receive."""
        fanout = self._fanouts.get(key)
        return fanout is not None and fanout.subscribed

    def subscribers(self) -> dict[Hashable, int]:
        """How many streams listen to each watched key: presence, read from what already exists."""
        return {key: fanout.count for key, fanout in self._fanouts.items() if fanout.subscribed}

    def subscriber_count(self, key: Hashable) -> int:
        fanout = self._fanouts.get(key)
        return fanout.count if fanout is not None else 0

    def snapshot(self, type_: str, data: dict[str, Any]) -> Event:
        """An opening frame for one subscriber, ordered with the channel's live events."""
        self._seq += 1
        return new_event(self._seq, type_, data)

    def subscribe(self, key: Hashable) -> Subscription:
        return self._fanouts.setdefault(key, Fanout()).subscribe()

    def unsubscribe(self, key: Hashable, queue: Subscription) -> None:
        fanout = self._fanouts.get(key)
        if fanout is None:
            return
        fanout.unsubscribe(queue)
        if not fanout.subscribed:
            del self._fanouts[key]

    def close(self) -> None:
        for fanout in self._fanouts.values():
            fanout.close()
        self._fanouts.clear()


def event_stream(request: Request, queue: Subscription, opening: Iterable[Event], *, after: int,
                 authorize: Callable[[Request], Awaitable[Any]], close: Callable[[], None],
                 tick: Callable[[], None] | None = None) -> StreamingResponse:
    """The one SSE loop: the opening frames (a replay and/or a snapshot), then every queued event
    newer than the last one sent, heartbeats while idle and a periodic re-authorization of the caller.
    `tick` runs on every iteration while a viewer is connected: it must return at once (throttle and
    spawn its own work). `queue` must be subscribed before `opening` is computed; events already
    covered by the opening are skipped by their `seq`. `close` unsubscribes."""
    settings = get_settings()

    async def frames() -> AsyncIterator[str]:
        try:
            last_seq = after
            for event in opening:
                yield event.frame
                last_seq = max(last_seq, event.seq)
            next_auth_check = time.monotonic() + settings.introspection_cache_seconds
            while True:
                if time.monotonic() >= next_auth_check:
                    try:
                        await authorize(request)
                    except Exception:
                        LOG.debug("Event stream authorization ended", exc_info=True)
                        return
                    next_auth_check = time.monotonic() + settings.introspection_cache_seconds
                if await request.is_disconnected():
                    return
                if tick is not None:
                    tick()
                try:
                    event = await asyncio.wait_for(queue.get(), settings.sse_heartbeat_seconds)
                except TimeoutError:
                    yield _HEARTBEAT
                    continue
                if event is None:
                    return
                if event.seq > last_seq:
                    yield event.frame
                    last_seq = event.seq
        finally:
            close()

    return StreamingResponse(frames(), media_type="text/event-stream", headers=_STREAM_HEADERS)

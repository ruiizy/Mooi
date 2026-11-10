"""Transversal aspect: running a platform-stored bash script.

Deploy, backup, restore and delete scripts live only in the platform: each one is fed to `bash -se`
through stdin (never written to disk), runs in its own process group with an explicit environment,
and its output is redacted line by line and handed over in small batches. The script's own exit ends
the run: a process it left in the background may keep the output pipe open, so the remaining output
is drained only briefly before the pipe is closed. Every exit path — success, failure, timeout or
cancellation — terminates the whole process group while the script still runs.
"""

from __future__ import annotations

import asyncio
import os
import signal
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path

_BATCH_LINES = 50
_BATCH_SECONDS = 0.25
_LINE_LIMIT = 2000
_TERMINATE_GRACE_SECONDS = 5
_DRAIN_SECONDS = 2


async def _terminate(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    with suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), _TERMINATE_GRACE_SECONDS)
    except TimeoutError:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        await process.wait()


async def run_script(script: str, *, cwd: Path, environment: dict[str, str], timeout: float,
                     redact: Callable[[str], str], on_output: Callable[[list[str]], None]) -> int:
    """Runs `script` and answers its exit code; raises `TimeoutError` once `timeout` seconds pass.
    Output reaches `on_output` at most every 50 lines or 250 ms, and always before this returns."""
    # Our own pipe, not `PIPE`: its read end can be closed even while a background process holds the write end.
    output, sink = os.pipe()
    try:
        process = await asyncio.create_subprocess_exec(
            "bash", "-se", cwd=cwd, stdin=asyncio.subprocess.PIPE, env=environment,
            stdout=sink, stderr=asyncio.subprocess.STDOUT, start_new_session=True,
        )
    except BaseException:
        os.close(output)
        raise
    finally:
        os.close(sink)
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    transport, _ = await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader),
                                                os.fdopen(output, "rb", buffering=0))
    pending: list[str] = []
    last_flush = loop.time()

    def flush() -> None:
        nonlocal pending, last_flush
        if pending:
            on_output(pending)
            pending = []
        last_flush = loop.time()

    async def feed() -> None:
        assert process.stdin is not None
        process.stdin.write(script.encode())
        await process.stdin.drain()
        process.stdin.close()

    async def pump() -> None:
        while chunk := await reader.readline():
            line = redact(chunk.decode("utf-8", "replace")).rstrip()[:_LINE_LIMIT]
            if line.strip():
                pending.append(line)
            if len(pending) >= _BATCH_LINES or (pending and loop.time() - last_flush >= _BATCH_SECONDS):
                flush()

    writer = asyncio.create_task(feed())
    pumping = asyncio.create_task(pump())
    exiting = asyncio.create_task(process.wait())
    try:
        async with asyncio.timeout(timeout):
            await asyncio.wait((pumping, exiting), return_when=asyncio.FIRST_COMPLETED)
            if pumping.done():
                pumping.result()  # An unreadable output fails the run at once, as it always has.
            code = await exiting
            with suppress(TimeoutError):
                await asyncio.wait_for(asyncio.shield(pumping), _DRAIN_SECONDS)
            if pumping.done():
                pumping.result()
            # A script may exit before reading all of itself; its exit code is what counts.
            with suppress(BrokenPipeError, ConnectionResetError):
                await writer
        return code
    finally:
        for task in (pumping, exiting, writer):
            if not task.done():
                task.cancel()
        await asyncio.gather(pumping, exiting, writer, return_exceptions=True)
        transport.close()
        flush()
        await _terminate(process)

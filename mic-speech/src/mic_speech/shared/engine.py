"""Transversal aspect: the native speech engine (NVIDIA NeMo-Speech.cpp) as a supervised child process.

The production image includes the pinned, SHA-256-checked runtime. The container entrypoint
resolves and downloads the model through the runtime's pinned index before starting the service,
so the first download never races the service health check.

The service then starts the engine once at boot, bound to a free loopback port, keeps the model
resident for every dictation and stops it on shutdown (SIGTERM, then SIGKILL after 5 s). The
engine is stopped with the service on shutdown.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from mic_speech.shared.env import Settings, get_settings

LOG = logging.getLogger("speech.engine")

RUNTIME_VERSION = "0.1.0"
_RELEASE_URL = "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v{version}/nemo-speech-{version}-{asset}.tar.gz"
# (system, machine) -> (release asset, pinned SHA-256). Apple Silicon gets the Metal build.
_ARCHIVES: dict[tuple[str, str], tuple[str, str]] = {
    ("Darwin", "arm64"): ("macos-aarch64-metal", "f1dff4f9dd9c96214f8cb78b982812459132df8a4ad1a42409fd94de4a366244"),
    ("Darwin", "x86_64"): ("macos-x86_64-cpu", "042a4612e07460fab6a39b5d862aa1e39d0ac3eaedfdb979f3f5fc12de510c20"),
    ("Linux", "x86_64"): ("linux-x86_64-cpu", "0f74131d631ad2c694cf0ec53490866bb6461147959589a69fb6fc231944065b"),
    ("Linux", "aarch64"): ("linux-aarch64-cpu", "0e4112255d566de7bdd142f239e984995c4447103ba8feb41f2bb5c559d561d3"),
}
_STOP_GRACE_SECONDS = 5
_PROBE_INTERVAL_SECONDS = 0.1


def _provisioned_binary(settings: Settings) -> Path:
    return settings.speech_runtime_dir / f"nemo-speech-{RUNTIME_VERSION}" / "nemo-speech" / "bin" / "nemo-speech"


def resolve_binary(settings: Settings) -> Path | None:
    if settings.speech_runtime_path:
        explicit = Path(settings.speech_runtime_path).expanduser()
        return explicit if explicit.is_file() else None
    provisioned = _provisioned_binary(settings)
    if provisioned.is_file():
        return provisioned
    found = shutil.which("nemo-speech")
    return Path(found) if found else None


def _is_local_model(model: str) -> bool:
    return model.endswith(".gguf") or "/" in model


def model_name(settings: Settings) -> str:
    return Path(settings.speech_model).stem if _is_local_model(settings.speech_model) else settings.speech_model


def _device(settings: Settings) -> str:
    if settings.speech_device:
        return settings.speech_device
    return "metal" if (platform.system(), platform.machine()) == ("Darwin", "arm64") else "auto"


def _download_runtime(settings: Settings) -> Path:
    key = (platform.system(), platform.machine())
    if key not in _ARCHIVES:
        raise RuntimeError(f"No NeMo-Speech.cpp {RUNTIME_VERSION} build for {key[0]} {key[1]}; set SPEECH_RUNTIME_PATH")
    asset, checksum = _ARCHIVES[key]
    url = _RELEASE_URL.format(version=RUNTIME_VERSION, asset=asset)
    settings.speech_runtime_dir.mkdir(parents=True, exist_ok=True)
    target = settings.speech_runtime_dir / f"nemo-speech-{RUNTIME_VERSION}"
    with tempfile.TemporaryDirectory(dir=settings.speech_runtime_dir) as staging:
        archive = Path(staging) / "runtime.tar.gz"
        print(f"downloading NeMo-Speech.cpp {RUNTIME_VERSION} ({asset})", flush=True)
        digest = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=60) as response, archive.open("wb") as sink:
            while chunk := response.read(1 << 20):
                digest.update(chunk)
                sink.write(chunk)
        if digest.hexdigest() != checksum:
            raise RuntimeError(f"NeMo-Speech.cpp archive checksum mismatch for {asset}")
        extracted = Path(staging) / "extracted"
        with tarfile.open(archive) as bundle:
            bundle.extractall(extracted, filter="data")
        # Each archive wraps the runtime in one top-level directory named per platform
        # (`nemo-speech` on macOS, `nemo-speech-<version>-<asset>` on Linux): normalize it.
        roots = [entry for entry in extracted.iterdir() if entry.is_dir()]
        if len(roots) != 1:
            raise RuntimeError(f"Unexpected NeMo-Speech.cpp archive layout for {asset}")
        shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True)
        roots[0].rename(target / "nemo-speech")
    return _provisioned_binary(settings)


def provision(settings: Settings) -> None:
    """Idempotent: a present runtime and an already cached model cost no network round trip."""
    binary = resolve_binary(settings) or _download_runtime(settings)
    if _is_local_model(settings.speech_model):
        if not Path(settings.speech_model).expanduser().is_file():
            raise RuntimeError(f"SPEECH_MODEL file not found: {settings.speech_model}")
        return
    print(f"resolving model {settings.speech_model} (downloaded once, ~742 MB)", flush=True)
    subprocess.run([str(binary), "--quiet", "pull", settings.speech_model], check=True, stdout=subprocess.DEVNULL)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Engine:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._process: asyncio.subprocess.Process | None = None
        self._port = 0

    @property
    def alive(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def realtime_url(self) -> str:
        return f"ws://127.0.0.1:{self._port}/v1/audio/transcriptions/realtime"

    async def start(self) -> None:
        binary = resolve_binary(self._settings)
        if binary is None:
            raise RuntimeError("nemo-speech runtime not found: rebuild the mic-speech image or set SPEECH_RUNTIME_PATH")
        self._port = _free_port()
        self._process = await asyncio.create_subprocess_exec(
            str(binary), "serve", "--host", "127.0.0.1", "--port", str(self._port),
            "--asr-model", str(Path(self._settings.speech_model).expanduser()) if _is_local_model(self._settings.speech_model)
            else self._settings.speech_model,
            "--device", _device(self._settings), "--no-ui",
            stdin=asyncio.subprocess.DEVNULL,
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._settings.speech_startup_timeout_seconds
        while not await self._accepts_connections():
            if not self.alive or loop.time() >= deadline:
                await self.stop()
                raise RuntimeError("Speech engine failed to start")
            await asyncio.sleep(_PROBE_INTERVAL_SECONDS)
        LOG.info("Speech engine ready on port %d (model %s, device %s)", self._port,
                 model_name(self._settings), _device(self._settings))

    async def _accepts_connections(self) -> bool:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", self._port), 1)
        except (OSError, TimeoutError):
            return False
        writer.close()
        await writer.wait_closed()
        return True

    async def stop(self) -> None:
        process, self._process = self._process, None
        if process is None or process.returncode is not None:
            return
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), _STOP_GRACE_SECONDS)
        except ProcessLookupError:
            return
        except TimeoutError:
            process.kill()
            await process.wait()


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = Engine(get_settings())
    return _engine


if __name__ == "__main__":
    if sys.argv[1:] != ["provision"]:
        raise SystemExit("usage: python -m mic_speech.shared.engine provision")
    try:
        provision(get_settings())
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"speech engine provisioning failed: {error}") from None

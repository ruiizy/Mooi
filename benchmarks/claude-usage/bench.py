#!/usr/bin/env python3
"""Claude plan-usage benchmark: Claude Code (desktop) vs Mooi Claude CLI vs Mooi Claude SDK.

One file, stdlib only. Subcommands:
  meter                      probe the account's 5h/7d utilization every few seconds (detached, whole benchmark)
  prepare <run>              fresh clone of the fixture at the pinned commit on branch bench/<run> (desktop runs)
  mooi <run> <cli|sdk>       baseline, create a Mooi session with the prompt, wait, download its raw logs (detached)
  desktop <run> <cwd>        watch the desktop session's transcript for that cwd until its turn ends, copy it (detached)
  wait <run> [seconds]       block until a detached run reports done (foreground, keeps the orchestrator idle)
  analyze                    parse every raw transcript with ONE parser and write data/report.js for index.html

Every condition is parsed from its raw Claude transcript by the same code, so no adapter is measured differently.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RUNS = DATA / "runs"
WORK = ROOT / "work"
FIXTURE = ROOT / "fixture" / "leffi.bundle"
COMMIT = "a32151f3a4ddb167da7c8e5f5fb50d437f698250"
SECRET = Path(os.environ.get("BENCH_TOKEN_FILE", ""))  # setup token file, outside the repository
MOOI = os.environ.get("BENCH_MOOI", "http://localhost:52583")
PROJECT = "23226de4-184e-4aef-8f1d-eb713d9fae52"   # Mydherin/Leffi in local Mooi
CONNECTION = "564d22de-e113-4206-a483-74163144494a"  # "Benchmark" Claude account (same account as desktop)
MODEL, EFFORT = "sonnet", "high"
PROBE_SECONDS = 8
SETTLE_SECONDS = 75
PROMPT_FILE = ROOT / "prompt.md"
ORCHESTRATOR = "75f965fd-2b88-46ea-b272-c69fa85c561b"  # this benchmark's own orchestrating session

# Relative token weights of Anthropic pricing (input = 1): identical ratios for every model.
WEIGHTS = {"input": 1.0, "cache_write_5m": 1.25, "cache_write_1h": 2.0, "cache_read": 0.1, "output": 5.0}


def now() -> float:
    return time.time()


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def parse_ts(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=1))
    tmp.replace(path)


def status(run: str, **fields) -> None:
    path = RUNS / run / "status.json"
    current = json.loads(path.read_text()) if path.exists() else {}
    current.update(fields, updated=now())
    write_json(path, current)


# ---------------------------------------------------------------- meter
def probe() -> dict:
    """One 1-output-token Haiku request; the response headers carry the plan windows' utilization."""
    body = json.dumps({"model": "claude-haiku-5-5", "max_tokens": 1,
                       "system": "You are Claude Code, Anthropic's official CLI for Claude.",
                       "messages": [{"role": "user", "content": "hi"}]}).encode()
    request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST", headers={
        "Authorization": "Bearer " + SECRET.read_text().strip(), "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01", "content-type": "application/json", "User-Agent": "mooi-usage-bench/1"})
    started = now()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            headers, payload = response.headers, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return {"t": started, "error": error.code}
    h = lambda name: headers.get(f"anthropic-ratelimit-unified-{name}")
    usage = payload.get("usage") or {}
    return {"t": started, "t_end": now(), "u5": float(h("5h-utilization")), "u7": float(h("7d-utilization")),
            "reset5": int(h("5h-reset")), "status": h("status"),
            "in": usage.get("input_tokens", 0), "out": usage.get("output_tokens", 0)}


def cmd_meter() -> None:
    out = DATA / "meter.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    while not (DATA / "meter.stop").exists():
        reading = probe()
        with out.open("a") as handle:
            handle.write(json.dumps(reading) + "\n")
        time.sleep(max(0.5, PROBE_SECONDS - (now() - reading["t"])))


# ---------------------------------------------------------------- fixture
def cmd_prepare(run: str) -> None:
    target = WORK / run
    if target.exists():
        raise SystemExit(f"{target} exists: every run needs a fresh clone")
    subprocess.run(["git", "clone", "-q", str(FIXTURE), str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "checkout", "-q", "-b", f"bench/{run}", COMMIT], check=True)
    subprocess.run(["git", "-C", str(target), "remote", "remove", "origin"], check=True)
    print(target)


# ---------------------------------------------------------------- Mooi
def mooi(method: str, path: str, token: str | None = None, body=None, raw: bool = False):
    headers = {"Origin": MOOI, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(MOOI + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read()
        return (content, response.headers.get("Content-Type", "")) if raw else (json.loads(content) if content else None)


def login() -> str:
    return mooi("POST", "/api/mooi/auth/google", body={"idToken": "usage-benchmark"})["accessToken"]


def cmd_mooi(run: str, adapter: str) -> None:
    directory = RUNS / run
    prompt = PROMPT_FILE.read_text()
    status(run, condition=f"mooi-{adapter}", state="baseline", launched=now(), pid=os.getpid())
    time.sleep(45)  # baseline: the orchestrator's own launching turn ends well before the run
    token = login()
    others = [s["id"] for s in mooi("GET", "/api/sessions/sessions", token)["sessions"]]
    session = mooi("POST", "/api/sessions/sessions", token, {
        "projectId": PROJECT, "provider": "claude", "adapter": adapter, "connectionId": CONNECTION,
        "branch": f"bench/{run}", "model": MODEL, "effort": EFFORT, "initialMessage": prompt})
    sid = session["id"]
    status(run, state="running", session=sid, started=now(), other_mooi_sessions=others)
    seen_working, deadline = False, now() + 3600
    while now() < deadline:
        time.sleep(3)
        if now() % 600 < 3:
            token = login()
        info = mooi("GET", f"/api/sessions/sessions/{sid}", token)
        state = info["status"]
        seen_working |= state == "working"
        if state == "waiting":
            status(run, state="failed", error="the agent asked a question")
            return
        if state in ("failed", "closed"):
            status(run, state="failed", error=info.get("detail"))
            return
        if seen_working and state == "ready":
            break
    status(run, state="settling", finished=now())
    token = login()
    write_json(directory / "session.json", mooi("GET", f"/api/sessions/sessions/{sid}", token))
    write_json(directory / "mooi-trace.json", mooi("GET", f"/api/sessions/sessions/{sid}/trace", token))
    content, kind = mooi("GET", f"/api/sessions/sessions/{sid}/trace/logs", token, raw=True)
    raw = directory / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    if "zip" in kind:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for name in archive.namelist():
                (raw / name).parent.mkdir(parents=True, exist_ok=True)
                (raw / name).write_bytes(archive.read(name))
    else:
        (raw / "transcript.jsonl").write_bytes(content)
    changes = mooi("GET", f"/api/sessions/sessions/{sid}/changes", token)
    write_json(directory / "changes.json", changes)
    time.sleep(SETTLE_SECONDS)
    mooi("DELETE", f"/api/sessions/sessions/{sid}", login())
    status(run, state="done", done=now())


# ---------------------------------------------------------------- desktop
def project_folder(cwd: Path) -> Path:
    slug = "".join(c if c.isalnum() else "-" for c in str(cwd.resolve()))
    return Path.home() / ".claude" / "projects" / slug


def cmd_desktop(run: str, cwd: str) -> None:
    folder = project_folder(Path(cwd))
    path = RUNS / run / "status.json"
    launched = float(os.environ.get("BENCH_LAUNCHED") or now())
    status(run, condition="claude-code", state="running", launched=launched, cwd=cwd, folder=str(folder),
           pid=os.getpid())
    transcript, quiet_since, deadline = None, None, now() + 3600
    while now() < deadline:
        time.sleep(3)
        files = sorted((p for p in folder.glob("*.jsonl") if p.stat().st_birthtime >= launched - 5),
                       key=lambda p: p.stat().st_mtime) if folder.exists() else []
        if not files:
            continue
        transcript = files[-1]
        last = None
        for line in transcript.read_text().splitlines():
            entry = json.loads(line)
            if entry.get("type") == "assistant":
                last = entry
        idle = now() - transcript.stat().st_mtime
        ended = last is not None and last["message"].get("stop_reason") == "end_turn"
        if ended and idle > 20:
            break
    status(run, state="settling", finished=now(), session=transcript.stem if transcript else None)
    raw = RUNS / run / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (raw / transcript.name).write_bytes(transcript.read_bytes())
    sub = transcript.with_suffix("") / "subagents"
    if sub.exists():
        for path in sub.rglob("*.jsonl"):
            target = raw / "subagents" / path.relative_to(sub)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(path.read_bytes())
    diff = subprocess.run(["git", "-C", cwd, "status", "--porcelain"], capture_output=True, text=True).stdout
    write_json(RUNS / run / "changes.json", {"porcelain": diff})
    time.sleep(SETTLE_SECONDS)
    status(run, state="done", done=now())


def cmd_wait(run: str, seconds: str = "560") -> None:
    limit = now() + float(seconds)
    path = RUNS / run / "status.json"
    while now() < limit:
        if path.exists():
            current = json.loads(path.read_text())
            if current.get("state") in ("done", "failed"):
                print(path.read_text())
                return
            try:  # a runner that died without reporting must not leave the orchestrator waiting
                os.kill(int(current["pid"]), 0)
            except (KeyError, ProcessLookupError, ValueError):
                log = RUNS / f"{run}.log"
                print("runner died:", path.read_text(), log.read_text()[-1500:] if log.exists() else "")
                return
        time.sleep(5)
    print("still running:", path.read_text() if path.exists() else "no status yet")


# ---------------------------------------------------------------- one transcript parser for every condition
def llm_calls(paths: list[Path], source: str) -> list[dict]:
    """One record per API response (message id): usage from its final streamed entry, tools it requested."""
    calls: dict[str, dict] = {}
    for path in paths:
        sidechain_file = "subagents" in path.parts
        previous = None  # the request starts when the entry before the response was written
        for line in path.read_text().splitlines():
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") != "assistant":
                if entry.get("timestamp") and entry.get("type") in ("user", "system"):
                    previous = parse_ts(entry["timestamp"])
                continue
            message = entry.get("message") or {}
            if message.get("model") in (None, "<synthetic>") or not message.get("usage"):
                continue
            key = message.get("id") or entry.get("uuid")
            usage = message["usage"]
            cache = usage.get("cache_creation") or {}
            write_total = usage.get("cache_creation_input_tokens") or 0
            write_1h = cache.get("ephemeral_1h_input_tokens") or 0
            write_5m = cache.get("ephemeral_5m_input_tokens", write_total - write_1h) or 0
            record = calls.get(key)
            if record is None:
                record = calls[key] = {"id": key, "t": parse_ts(entry["timestamp"]), "model": message["model"],
                                       "source": source, "file": path.name,
                                       "agent": "sub" if sidechain_file or entry.get("isSidechain") else "main",
                                       "start": previous or parse_ts(entry["timestamp"]),
                                       "tools": [], "text": 0, "thinking": 0}
            record["t"] = max(record["t"], parse_ts(entry["timestamp"]))
            record.update(input=usage.get("input_tokens") or 0, cache_write_5m=write_5m, cache_write_1h=write_1h,
                          cache_read=usage.get("cache_read_input_tokens") or 0,
                          output=max(record.get("output", 0), usage.get("output_tokens") or 0),
                          stop=message.get("stop_reason") or record.get("stop"))
            for block in message.get("content") or []:
                kind = block.get("type")
                if kind == "tool_use":
                    record["tools"].append(block.get("name"))
                elif kind == "text":
                    record["text"] += len(block.get("text") or "")
                elif kind == "thinking":
                    record["thinking"] += len(block.get("thinking") or "")
    result = sorted(calls.values(), key=lambda c: c["t"])
    for call in result:
        call["context"] = call["input"] + call["cache_write_5m"] + call["cache_write_1h"] + call["cache_read"]
        call["units"] = sum(call[k] * w for k, w in WEIGHTS.items())
    return result


def first_user_text(paths: list[Path]) -> str:
    for path in paths:
        for line in path.read_text().splitlines():
            entry = json.loads(line)
            if entry.get("type") == "user" and not entry.get("isMeta"):
                content = (entry.get("message") or {}).get("content")
                if isinstance(content, str):
                    return content
                texts = [b.get("text", "") for b in content or [] if b.get("type") == "text"]
                if texts:
                    return "\n".join(texts)
    return ""


def foreign_calls(start: float, end: float, own: set[Path]) -> list[dict]:
    """Every other Claude Code transcript on this machine with a response inside [start, end]."""
    found = []
    for path in (Path.home() / ".claude" / "projects").rglob("*.jsonl"):
        if path in own or path.stat().st_mtime < start:
            continue
        source = "orchestrator" if ORCHESTRATOR in str(path) else "other:" + path.parent.name[-40:]
        found += [c for c in llm_calls([path], source) if start <= c["t"] <= end]
    return found


def cmd_analyze() -> None:
    meter = [json.loads(l) for l in (DATA / "meter.jsonl").read_text().splitlines() if l.strip()]
    meter = [m for m in meter if "u5" in m]
    runs = []
    for directory in sorted((d for d in RUNS.iterdir() if d.is_dir()), key=lambda d: json.loads((d / "status.json").read_text())["launched"]):
        state = json.loads((directory / "status.json").read_text())
        if state.get("state") != "done":
            continue
        paths = sorted((directory / "raw").rglob("*.jsonl"))
        calls = llm_calls(paths, directory.name)
        start, last = state["launched"], max(c["t"] for c in calls)
        end = last + SETTLE_SECONDS - 5
        own = {p for p in (Path.home() / ".claude" / "projects").rglob("*.jsonl")
               if state.get("session") and state["session"] in p.name}
        before = [m for m in meter if m["t"] <= min(start, calls[0]["t"] - 60) + 1] or meter[:1]
        after = [m for m in meter if m["t"] >= end - 10]
        window = [m for m in meter if start <= m["t"] <= end]
        ticks = [{"t": b["t"], "prev_t": a["t"], "u5": b["u5"]} for a, b in zip(window, window[1:]) if b["u5"] > a["u5"]]
        runs.append({
            "id": directory.name, "condition": state["condition"], "status": state, "calls": calls,
            "prompt": first_user_text(paths), "window": [start, end],
            "u5_before": before[-1]["u5"], "u5_after": after[0]["u5"] if after else None,
            "u7_before": before[-1]["u7"], "u7_after": after[0]["u7"] if after else None,
            "ticks": ticks, "foreign": foreign_calls(start, end, own),
            "changes": json.loads((directory / "changes.json").read_text()) if (directory / "changes.json").exists() else None,
            "mooi_trace_summary": summarize_mooi_trace(directory / "mooi-trace.json"),
        })
        runs[-1].update(estimate(runs[-1]))
    span = [min(r["window"][0] for r in runs) - 600, max(r["window"][1] for r in runs) + 600] if runs else [0, 0]
    background = foreign_calls(span[0], span[1], set())
    background = [c for c in background if not any(c["source"] == r["id"] for r in runs)]
    report = {"generated": iso(now()), "commit": COMMIT, "model": MODEL, "effort": EFFORT, "weights": WEIGHTS,
              "probe_seconds": PROBE_SECONDS, "meter": [m for m in meter if span[0] <= m["t"] <= span[1]],
              "runs": runs, "background": background}
    data = "window.BENCH = " + json.dumps(report).replace("</", "<\\/") + ";\n"
    (DATA / "report.js").write_text(data)
    # index.html is self-contained (data inlined), so it opens anywhere, even as a static file.
    page = (ROOT / "template.html").read_text().replace('<script src="data/report.js"></script>', f"<script>{data}</script>")
    (ROOT / "index.html").write_text(page)
    for r in runs:
        tot = {k: sum(c[k] for c in r["calls"]) for k in ("input", "cache_write_5m", "cache_write_1h", "cache_read", "output", "units")}
        print(r["id"], r["condition"], len(r["calls"]), "calls", {k: round(v) for k, v in tot.items()},
              "u5", r["u5_before"], "->", r["u5_after"], "ticks", len(r["ticks"]), "foreign", len(r["foreign"]))


def estimate(run: dict) -> dict:
    """Meter deltas for one run. Ticks (the whole-percent meter stepping up) are placed on the run's own
    cumulative weighted-token curve, so two ticks give the meter's %/unit slope with sub-percent precision."""
    calls = run["calls"]
    units = sum(c["units"] for c in calls)
    def cumulative(t: float) -> float:  # the meter charges a request when it starts
        return sum(c["units"] for c in calls if c["start"] <= t)
    points = [(cumulative((tick["t"] + tick["prev_t"]) / 2), tick["u5"] * 100) for tick in run["ticks"]]
    slope = None
    if len(points) >= 2:
        mx = sum(x for x, _ in points) / len(points)
        my = sum(y for _, y in points) / len(points)
        var = sum((x - mx) ** 2 for x, _ in points)
        slope = sum((x - mx) * (y - my) for x, y in points) / var if var else None
    foreign = {}
    for call in run["foreign"]:
        foreign[call["source"]] = foreign.get(call["source"], 0) + call["units"]
    delta = None if run["u5_after"] is None else round((run["u5_after"] - run["u5_before"]) * 100, 2)
    return {"units": units, "delta_pct": delta, "tick_slope": slope,
            "tick_pct": slope * units if slope else None, "foreign_units": foreign}


def summarize_mooi_trace(path: Path):
    if not path.exists():
        return None
    trace = json.loads(path.read_text())
    keys = {k: trace[k] for k in ("revision", "status", "usage", "totals", "summary") if k in trace}
    return keys or {"keys": sorted(trace)[:20]}


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"meter": cmd_meter, "prepare": cmd_prepare, "mooi": cmd_mooi, "desktop": cmd_desktop,
     "wait": cmd_wait, "analyze": cmd_analyze}[command](*args)

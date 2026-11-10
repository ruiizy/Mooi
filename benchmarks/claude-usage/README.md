# Claude plan-usage benchmark

Compares how much of the Claude **5-hour limit** the same task costs in Claude Code (desktop), Mooi with the
Claude CLI adapter and Mooi with the Claude SDK adapter. Open `index.html` (self-contained) for the report.

- `bench.py`: the whole harness (stdlib only): `meter`, `prepare`, `mooi`, `desktop`, `wait`, `analyze`.
- `prompt.md` / `task.md` / `background.md`: the identical task; `template.html`: report template.
- `data/runs/<id>/raw/`: raw Claude transcripts per run (one parser for all); `data/meter.jsonl`: meter readings.
- `fixture/leffi.bundle`: Leffi at the pinned commit; `work/`: per-run clones for the desktop runs.

Re-run: start the meter (`BENCH_TOKEN_FILE=<setup token file> python3 bench.py meter`, detached), then per run
`prepare` + start a desktop session in `work/<id>` with `desktop <id> <cwd>`, or `mooi <id> cli|sdk`, each followed
by a foreground `wait <id>`; finally `touch data/meter.stop` and `python3 bench.py analyze`.

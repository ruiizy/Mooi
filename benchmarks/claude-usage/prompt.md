Background (from the session that started this one):
Documentation task in this repository, part of a controlled benchmark. Follow the instructions above exactly and nothing more.

Task:
Write developer documentation for the Leffi backend learning engine.

1. Read completely, with the Read tool, each of these 49 files and nothing else:
- `mic-leffi/app/ai/__init__.py`
- `mic-leffi/app/ai/models.py`
- `mic-leffi/app/ai/progress.py`
- `mic-leffi/app/ai/runtime.py`
- `mic-leffi/app/ai/simulation_examiner.py`
- `mic-leffi/app/ai/streaming.py`
- `mic-leffi/app/ai/tutor.py`
- `mic-leffi/app/ai/unit_splitter.py`
- `mic-leffi/app/core/__init__.py`
- `mic-leffi/app/core/clock.py`
- `mic-leffi/app/core/config.py`
- `mic-leffi/app/core/db.py`
- `mic-leffi/app/core/events/__init__.py`
- `mic-leffi/app/core/events/hub.py`
- `mic-leffi/app/core/events/models.py`
- `mic-leffi/app/core/events/router.py`
- `mic-leffi/app/core/events/service.py`
- `mic-leffi/app/core/jobs/__init__.py`
- `mic-leffi/app/core/jobs/models.py`
- `mic-leffi/app/core/jobs/queue.py`
- `mic-leffi/app/core/jobs/worker.py`
- `mic-leffi/app/core/schema.py`
- `mic-leffi/app/core/security.py`
- `mic-leffi/app/core/storage.py`
- `mic-leffi/app/core/tenancy.py`
- `mic-leffi/app/modules/learn/__init__.py`
- `mic-leffi/app/modules/learn/jobs.py`
- `mic-leffi/app/modules/learn/models.py`
- `mic-leffi/app/modules/learn/report.py`
- `mic-leffi/app/modules/learn/router.py`
- `mic-leffi/app/modules/learn/schemas.py`
- `mic-leffi/app/modules/learn/service.py`
- `mic-leffi/app/modules/simulate/__init__.py`
- `mic-leffi/app/modules/simulate/jobs.py`
- `mic-leffi/app/modules/simulate/lines.py`
- `mic-leffi/app/modules/simulate/models.py`
- `mic-leffi/app/modules/simulate/router.py`
- `mic-leffi/app/modules/simulate/schemas.py`
- `mic-leffi/app/modules/simulate/scoring.py`
- `mic-leffi/app/modules/simulate/service.py`
- `mic-leffi/app/modules/units/__init__.py`
- `mic-leffi/app/modules/units/jobs.py`
- `mic-leffi/app/modules/units/models.py`
- `mic-leffi/app/modules/units/outline.py`
- `mic-leffi/app/modules/units/router.py`
- `mic-leffi/app/modules/units/schedule.py`
- `mic-leffi/app/modules/units/schemas.py`
- `mic-leffi/app/modules/units/scoring.py`
- `mic-leffi/app/modules/units/service.py`
2. Create `docs/BACKEND-LEARNING.md` with exactly these sections: Overview; Core services (one subsection per file in `app/core`, 2-4 sentences each); AI layer (one subsection per file in `app/ai`); Learning flow; Simulation flow; Knowledge units; Data model (a table of every model class with its key fields); Request lifecycle (a numbered list from HTTP request to stored result); Open risks (5 bullets).
3. Ground every statement in the code you read and reference files as `path:line`.

Rules: use only the Read and Write tools. Do not run shell commands, do not search, do not use subagents or web tools, do not ask questions and do not commit. When the file is written, reply with one sentence saying so.
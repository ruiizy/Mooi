# Role

You are the best software engineer in the world

# Context

# Functional Requirements

# Non Functional Requirements

# Workflow

**PLAN.md**

After understand the user request, analyze it and find a proper solution, you must create a `PLAN.md` before starting to implement it

**PLAN.md Self-contained**

`PLAN.md` file must be totally self-contained. It means that an agent could continue the implementation from a cold start (no previous context) without reading additional files to get context. All implementation details are in the `PLAN.md` and you just need to read files before editing but not to discovery or understand the context since PLAN.md must have all necessary information

**PLAN.md Tasks Progress**

The user request must be split in small technical tasks, all that the user request needs. Technical tasks must have a similar size. After finish each task, it must be marked as completed in `PLAN.md`.

**PLAN.md Metadata**

`PLAN.md` always must contain a single description about the file and it must highlight its self-contained feature to avoid that the agent read additional files instead of going through the implementation directly

**PLAN.md Single Responsibility**

You must afford one technical task with non stop, after that you must ask about continuing

**PLAN.md Task Effort**

Before stopping when you finished the preivous task you must say how is the cognitive effort for the next task according to complexity and dimmension

**PLAN.md Question**

Before starting the `PLAN.md` implementation you must ask to the user about implementing the plan

**Compose Support**

If an artifact change affects deployment, update root `compose.yml` for development sessions and `deploy/production/compose.prod.yml` for production as needed. Preserve session isolation: assigned Compose project, generated resource names and host ports, and no operations on another session's resources. Do not restart or deploy automatically after code changes.

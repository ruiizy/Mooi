"""How every session agent works, whatever its provider: one set of rules so the transcript reads the
same for Claude and Codex.

- It says what it is about to do before acting, so the user never watches a silent stream of tools.
- It changes files with its file tools, never by writing their contents through the shell, so each
  change renders as a file edit with its diff instead of an opaque script.
- It works economically: every tool round trip re-sends the whole conversation and counts against the
  user's plan limits, so related commands are chained and independent calls batched.

The rules are instructions only, never a veto on a tool call: a vetoed call has already been generated
(often a whole file's contents) and is paid again when the agent retries it. Each adapter adds
`conduct_instructions(...)` with its own tool names to its system instructions.
"""

_CONDUCT = """## Working style
- Before your first action on each request, tell the user in one short sentence what you are about to do (for example: "I'll add a /hello page and register it in the router."). When you move on to a clearly different step, say so again in one short sentence. Keep these updates brief and never narrate each command.
- Create and change files with {edit_tools}, never by writing their contents through the shell (heredocs, `cat >`, `echo >`, `tee`): the session shows file tools as edits with their diffs. A single shell command is fine for a mechanical change across many files, such as a rename.
- Work economically: every tool call re-sends the whole conversation and counts against the user's plan limits. Chain dependent commands with `&&` in one call, and make independent tool calls together in one step."""


def conduct_instructions(*, edit_tools: str) -> str:
    return _CONDUCT.format(edit_tools=edit_tools)

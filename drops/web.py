"""Going and looking something up, in two calls, because one does not work.

MEASURED 2026-09-16 against the installed CLI. `claude -p --json-schema <schema> --tools
"WebSearch,WebFetch"` comes back with `stop_reason: "tool_use"`, no `structured_output` at all,
and a bill for the turn. The same prompt with the same tools and NO schema answers normally
(`stop_reason: "end_turn"`). A constrained decoder and an agentic tool loop do not compose in
this CLI: the turn ends at the first tool call and the caller gets an envelope with nothing in
it. Everything that needs both is therefore two calls:

  research   tools, no schema. Comes back as prose, with the URLs it actually opened.
  structure  no tools, the schema, and the research as its ONLY input.

This is not a workaround dressed up as a design. It is also the safer shape, and it is the same
shape `drops/prompt.py` argues for elsewhere: the half that can reach the network cannot decide
the document, and the half that decides the document cannot reach anything.

WHAT THE STRUCTURING STEP MAY INVENT. Nothing. It is told, and the callers check, that every
value must come from the research text in front of it; `verify.py` then fetches whatever URL
survives, so a package name that made it through two models and was never real still dies
before it becomes a button.
"""

from __future__ import annotations

from analysis.run import AnalysisError, call_claude

RESEARCH_TIMEOUT_S = 300
STRUCTURE_TIMEOUT_S = 120
TOOLS = "WebSearch,WebFetch"
DEFAULT_MODEL = "sonnet"

STRUCTURE_SYSTEM = """You turn one piece of research into a JSON document.

The research is below. It is the ONLY thing you know. Every value you write must come from it.

If the research does not contain something the schema asks for, the answer is null or an empty
list. Do not fill a gap from your own knowledge: the whole point of the research step was that
this document is about what was actually found, and a field you completed from memory is
indistinguishable, to everybody downstream, from one that was found.

No dashes of any kind in any string. Use a comma or a full stop."""


def research(system: str, user: str, *, model: str = DEFAULT_MODEL) -> str | None:
    """Prose from a model that could search and fetch. None when the call failed."""
    try:
        out, envelope = call_claude(
            system, user, schema=None, model=model, tools=TOOLS, timeout_s=RESEARCH_TIMEOUT_S
        )
    except AnalysisError:
        return None
    text = out if isinstance(out, str) else str(envelope.get("result") or "")
    return text.strip() or None


def structure(schema: dict, research_text: str, *, ask: str, model: str = DEFAULT_MODEL) -> dict | None:
    """The research, as the document. No tools."""
    user = f"{ask}\n\nThe research:\n\n{research_text}\n\nAnswer with the JSON document."
    try:
        out, _ = call_claude(
            STRUCTURE_SYSTEM, user, schema, model, tools="", timeout_s=STRUCTURE_TIMEOUT_S
        )
    except AnalysisError:
        return None
    return out if isinstance(out, dict) else None

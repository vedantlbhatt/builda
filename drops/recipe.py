"""Go and find the ingredients, the quantities and the steps for a dish a video only named.

WHY THIS EXISTS. MEASURED on the corpus: most cooking Shorts publish a title and an empty
description, because the method is in the video and the video is the point. "EASY 20-minute
1-PAN Garlic Butter Pasta w Shrimp" is everything one of them published. The planner is right
not to invent a method from that, and the person still wants the recipe, so a `card` move on a
`recipe` drop runs this: a web search for the named dish, and a structured answer held to the
same `Recipe` shape the wire already defines (`drops/plan.subschema("Recipe")`).

WHAT IS AND IS NOT CLAIMED. What comes back is A recipe for that dish, not THAT creator's
recipe, and the card says which: `found_url` is the page it was taken from and the phone prints
it under the ingredients. Passing off a stranger's recipe as the one in the video would be the
same class of error as an invented package name, and it is the error every app in this space
makes.

SAME TWO CALL SPLIT AS THE REST, and a second split inside it for a measured reason: a schema
and a tool loop do not compose in this CLI (`drops/web.py`), so finding is one call with tools
and no schema and structuring is another with a schema and no tools. Neither is given anything
of the person's: not the caption, not the handle, not the machine.
"""

from __future__ import annotations

from analysis.run import dedash

from . import web
from .plan import DEFAULT_MODEL, subschema

SYSTEM = """You are given the name of a dish and you find a real, published recipe for it.

You have WebSearch and WebFetch. Find a page that actually publishes the recipe, fetch it, and
answer with the ingredients, their quantities and the steps AS THAT PAGE GIVES THEM.

Rules that matter more than completeness:

QUANTITIES ARE COPIED, NEVER COMPUTED. Write "1 1/2 cups" if the page says "1 1/2 cups". If the
page does not give a quantity for something, `quantity` is null. Never convert, never scale,
never round, and never fill a null in with a plausible amount: somebody is going to cook this.

STEPS ARE THE PAGE'S STEPS, in order, one action per step. `minutes` on a step only when the
page gives a time for that step.

`total_minutes` and `serves` only when the page states them.

Use ONE page. Do not blend two recipes into one: two good recipes averaged together is a recipe
nobody tested. If you cannot find a page that publishes the method, answer with an empty
ingredients list and an empty steps list rather than writing one from memory.

No dashes of any kind in any string. Use a comma or a full stop."""


def schema() -> dict:
    """`Recipe`, plus the one field this pass adds: where it came from."""
    s = subschema("Recipe")
    s["properties"]["found_url"] = {
        "anyOf": [{"type": "string", "maxLength": 500}, {"type": "null"}],
        "description": "The page you took this from. Null when you found none.",
    }
    s["required"] = list(s.get("required") or []) + ["found_url"]
    # The generated `Recipe` requires at least one ingredient and one step, which is right on
    # the wire and wrong here: an honest miss has to be representable or the model will fill
    # the list rather than fail the schema.
    for key in ("ingredients", "steps"):
        s["properties"][key].pop("minItems", None)
    return s


def find_recipe(dish: str, *, model: str = DEFAULT_MODEL) -> tuple[dict | None, str | None]:
    """(recipe, found_url). (None, None) on an honest miss or any failure.

    Two calls (drops/web.py): the first may search and fetch, the second turns what it found
    into the `Recipe` the wire already defines. Quantities are copied through both steps and
    the second is told, in as many words, that a gap is a null.
    """
    notes = web.research(
        SYSTEM,
        f"Dish: {dish}\n\nFind one published recipe for it. Quote the ingredient list and the "
        f"method as the page gives them, and say which page you took them from.",
        model=model,
    )
    if not notes:
        return None, None
    out = web.structure(
        schema(),
        notes,
        ask=(
            "Turn this into the recipe document. Copy every quantity exactly as the research "
            "gives it. A quantity the research does not give is null, never a guess."
        ),
        model=model,
    )
    if not isinstance(out, dict):
        return None, None
    url = out.pop("found_url", None)
    if not out.get("ingredients") or not out.get("steps"):
        return None, None
    out, _ = dedash(out)
    if not (isinstance(url, str) and url.startswith("https://") and len(url) <= 500):
        url = None
    return out, url

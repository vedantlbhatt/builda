"""Walk a document against a spec written in this repository's notation.

`spec/live.v1.json`, `spec/report.v1.json` and the contract's `objects` all use one notation
(`scripts/gen_analysis.py` emits Pydantic and TypeScript from it): a list of fields, each with
a `type` (`int`, `number`, `double`, `bool`, `string`, `enum`, `datetime`, `hex16`,
`sha256hex`, `object`, `list`), `nullable`, and for the containers an `item` and a
`max_items`. This walks a value against it: every key declared, every declared key present,
every enum value legal, every scalar its type, every list within its cap, every `double` a
share between 0 and 1.

Stdlib only, on purpose. CI runs the capture and analysis suites with nothing installed, so
this is the check that always runs; the generated Pydantic models are a second, stricter one
where `pydantic` imports (`pydantic_door` below). A check that only ran where a dependency
happened to be installed would pass on CI for the wrong reason.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
HEX16 = re.compile(r"^[0-9a-f]{16}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def errors(
    value,
    fields: list[dict],
    *,
    objects: dict,
    enums: dict,
    max_lengths: dict | None = None,
    where: str = "$",
) -> list[str]:
    """Every way `value` departs from `fields`, as `path: what` lines; [] when it conforms."""
    if not isinstance(value, dict):
        return [f"{where}: expected an object, got {type(value).__name__}"]
    out: list[str] = []
    declared = {f["name"] for f in fields}
    out += [f"{where}.{k}: undeclared key" for k in value if k not in declared]
    for f in fields:
        name = f["name"]
        if name not in value:
            out.append(f"{where}.{name}: missing")
            continue
        out += _one(value[name], f, objects, enums, max_lengths or {}, f"{where}.{name}")
    return out


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _one(v, f: dict, objects: dict, enums: dict, maxl: dict, where: str) -> list[str]:
    if v is None:
        return [] if f.get("nullable") else [f"{where}: null, and the spec does not allow null"]
    t = f["type"]
    if t == "object":
        return errors(v, objects[f["item"]], objects=objects, enums=enums, max_lengths=maxl, where=where)
    if t == "list":
        if not isinstance(v, list):
            return [f"{where}: expected a list"]
        out: list[str] = []
        if "max_items" in f and len(v) > f["max_items"]:
            out.append(f"{where}: {len(v)} items, the cap is {f['max_items']}")
        item = f["item"]
        for i, x in enumerate(v):
            if item in objects:
                out += errors(x, objects[item], objects=objects, enums=enums, max_lengths=maxl, where=f"{where}[{i}]")
            else:
                out += _one(x, {"type": item}, objects, enums, maxl, f"{where}[{i}]")
        return out
    ok = True
    if t == "int":
        ok = _is_int(v)
    elif t == "number":
        ok = _is_num(v)
    elif t == "double":
        ok = _is_num(v) and 0 <= v <= 1
    elif t == "bool":
        ok = isinstance(v, bool)
    elif t == "string":
        ok = isinstance(v, str) and ("max" not in f or len(v) <= maxl[f["max"]])
    elif t == "enum":
        ok = isinstance(v, str) and v in enums[f["values"]]
    elif t == "hex16":
        ok = isinstance(v, str) and bool(HEX16.match(v))
    elif t == "sha256hex":
        ok = isinstance(v, str) and bool(SHA256.match(v))
    elif t == "datetime":
        try:
            ok = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).tzinfo is not None
        except ValueError:
            ok = False
    else:
        return [f"{where}: the walker does not know type {t!r}"]
    return [] if ok else [f"{where}: {v!r} is not a valid {t}"]


def pydantic_door(module: str):
    """The generated server module `server/builder/<module>.py`, imported as the server
    imports it, or None when pydantic is not installed (CI's capture and analysis jobs)."""
    try:
        import pydantic  # noqa: F401
    except ImportError:
        return None
    server = str(ROOT / "server")
    if server not in sys.path:
        sys.path.insert(0, server)
    if importlib.util.find_spec("builder") is None:
        return None
    import warnings

    with warnings.catch_warnings():
        # The contract's `model_id` and `model_state` trip pydantic's protected namespace
        # warning; it is about field names, not about anything these tests check.
        warnings.simplefilter("ignore")
        return importlib.import_module(f"builder.{module}")

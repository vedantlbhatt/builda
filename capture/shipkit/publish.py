"""`python -m capture demo kit --publish`: the ship kit to your account, after it lists every file.

Nothing of a kit leaves the Mac until this runs and the person says yes (docs/ship-kit.md,
privacy/upload-contract.json `ship_kit`), the demo channel's rule (capture/demo_publish.py) and its
shape: the paired Mac's credentials only (never a capture key), every file listed with its size
first, each file presigned right before its own upload, every file committed, then the kit's
DOCUMENT, whose arrival is what makes this kit the one the phone shows (routes/shipkit.py).

WHAT IS CHECKED AGAIN HERE, because the kit was made from more than the demo was:

- every picture is read with Vision once more (`privacy.check`) with this project's names and
  the Mac's other repositories' names: a framed still carries a title we drew, a before and after
  carries an older demo's still, and a check that ran then is not a check of this file now;
- the changelog is commit subjects, as written, and a subject can name a repository or carry a
  key; a line that does (`privacy.label_leaks`) is left out of what is sent, and the listing says
  how many were;
- the document goes through the spec's own shape (`tables`) before it is sent, so a caption the
  server would refuse is refused here with the same sentence.

A commit hash, a file name, the project's name and the kit's inputs never travel: the document
has no field for any of them.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import secrets
import sys

from capture import client as cl
from capture.demo import paths, privacy
from capture.demo import project as pj
from capture.demo import transcripts as tx

from . import kit as kmod
from . import tables

CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".mp4": "video/mp4"}
FORMAT_SLOT = {f: f"video_{f}" for f in tables.ENUMS["kit_format"]}
APP_STORE_SLOT = {"iphone_69": "app_store_iphone", "ipad_13": "app_store_ipad"}


def files_of(kit: dict, kit_dir: pathlib.Path) -> list[dict]:
    """Every file the kit sends, as presign bodies without the publish id, in upload order: the
    videos, the loop, the stills, the framed stills, before and after, the App Store sets."""
    out: list[dict] = []

    def add(path: pathlib.Path, slot: str, pos: int, w: int, h: int, label: str | None = None, ms: int | None = None) -> None:
        out.append({"path": path, "slot": slot, "content_type": CONTENT_TYPES[path.suffix.lower()], "bytes": path.stat().st_size,
                    "width": w, "height": h, "duration_ms": ms, "position": pos, "label": label})  # fmt: skip

    for f in kit["formats"]:
        add(kit_dir / f["file"], FORMAT_SLOT[f["id"]], 0, f["width"], f["height"], ms=f["duration_ms"])
    if kit.get("loop"):
        lp = kit["loop"]
        add(kit_dir / lp["file"], "loop", 0, lp["width"], lp["height"])
    for i, s in enumerate(kit["stills"][: tables.CAPS["stills"]], 1):
        add((kit_dir / s["file"]).resolve(), "still", i, s["width"], s["height"], label=s["label"])
    for i, s in enumerate(kit["framed"][: tables.CAPS["framed_stills"]], 1):
        add(kit_dir / s["file"], "framed_still", i, s["width"], s["height"], label=s["label"])
    for i, s in enumerate(kit["before_after"][: tables.CAPS["before_after"]], 1):
        add(kit_dir / s["file"], "before_after", i, s["width"], s["height"], label=s["label"])
    for st in kit["app_store"]:
        slot = APP_STORE_SLOT.get(st["slot"])
        if slot is None:
            continue
        for i, s in enumerate(st["files"][: tables.CAPS["app_store_each"]], 1):
            add(kit_dir.parent / s["file"], slot, i, s["width"], s["height"], label=s["label"])
    return out


def document(kit: dict, kit_dir: pathlib.Path, publish_id: str, names=(), others=()) -> tuple[dict, int]:
    """The KitDocument (spec/shipkit.v1.json) and how many changelog lines were left out."""
    copydoc = json.loads((kit_dir / "share-copy.json").read_text())
    log = json.loads((kit_dir / "changelog.json").read_text())
    subjects = [c["subject"] for c in log.get("commits") or []]
    kept = [s for s in subjects if not privacy.label_leaks([s], tuple(names), tuple(others))]
    captions = [{"platform": c["platform"], "text": c["text"], "thread": c.get("thread") or [], "source": c["source"]} for c in copydoc["captions"]]
    refused = [{"what": r["what"][: tables.MAX_LENGTHS["name"]], "code": r["code"]} for r in kit["refused"] if r["code"] in tables.ENUMS["kit_refusal"]]
    doc = {
        "shipkit_version": tables.SHIPKIT_VERSION,
        "publish_id": publish_id,
        "device": (kit.get("device") or {}).get("id") or "terminal",
        "hue": kit["hue"],
        "captions": captions,
        "changelog": [s[: tables.MAX_LENGTHS["subject"]] for s in kept[:30]],
        "refused": refused[:20],
    }
    return doc, len(subjects) - len(kept)


def main(a: argparse.Namespace) -> int:
    server = (a.server or os.environ.get("BUILDER_API_URL") or cl.DEFAULT_SERVER).rstrip("/")
    project = pj.from_checkout(a.project or a.path or ".")
    key = project.key
    kit_dir = paths.out_dir(key) / kmod.KIT_DIR
    if not (kit_dir / "kit.json").is_file():
        print(f"No kit for this project at {kit_dir}: make one with `python -m capture demo kit`.", file=sys.stderr)
        return 2
    kit = json.loads((kit_dir / "kit.json").read_text())
    names = tuple(project.names) + tuple(privacy.machine_names())
    evidence = None if a.no_transcripts else tx.harvest(project.identity, pathlib.Path(a.root).expanduser(), progress=False)
    others = tuple(privacy.other_names(evidence.others if evidence else [], project.names))
    files = files_of(kit, kit_dir)
    pictures = [f["path"] for f in files if f["content_type"] in ("image/png", "image/jpeg")]
    print(f"Reading {len(pictures)} pictures once more for names and keys (Apple Vision)...", file=sys.stderr)
    refused, _ = privacy.check(pictures, None, names, other_names=others)
    if refused:
        print("Not publishing: the privacy check refused these, and nothing leaves with them in it:", file=sys.stderr)
        for r in refused[:12]:
            print(f"  {r['file']}: {r['reason']} {r['text']!r}", file=sys.stderr)
        return 3
    publish_id = secrets.token_hex(8)
    doc, dropped = document(kit, kit_dir, publish_id, names, others)
    total = sum(f["bytes"] for f in files)
    print(f"This sends the ship kit of {project.display_name} to {server}, owner only:")
    for f in files:
        print(f"  {f['slot']:<18} {f['path'].name:<26} {f['width']}x{f['height']}  {f['bytes'] / 1e6:6.2f} MB")
    print(f"  captions for {', '.join(c['platform'] for c in doc['captions'])}; {len(doc['changelog'])} changelog lines"
          + (f" ({dropped} left out: they named a repository or carried a key)" if dropped else ""))  # fmt: skip
    print(f"  {len(files)} files, {total / 1e6:.2f} MB. No commit hash, file name or project name is in any of it.")
    if a.dry_run:
        print("Dry run: nothing was sent.")
        return 0
    if not a.yes:
        if not sys.stdin.isatty():
            print("Not sent: pass --yes to publish without a terminal.", file=sys.stderr)
            return 1
        if input("Send it? [y/N] ").strip().lower() not in ("y", "yes"):
            print("Nothing was sent.")
            return 1
    if cl.load_credentials() is None:
        print("This Mac is not paired: `python -m capture pair` first (a capture key cannot publish).", file=sys.stderr)
        return 3
    c = cl.Client(server)
    step = ""
    try:
        for f in files:
            step = f"the presign of {f['path'].name}"
            body = {k: v for k, v in f.items() if k != "path"} | {"publish_id": publish_id}
            slot = c._authenticated("POST", f"/v1/projects/{key}/kit:presign", body)
            step = f["path"].name
            c.put_object(slot["upload_url"], f["path"].read_bytes(), slot["headers"])
            step = f"the commit of {f['path'].name}"
            c._authenticated("POST", f"/v1/projects/{key}/kit/{slot['media_id']}:commit", None)
        step = "the kit's document"
        done = c._authenticated("PUT", f"/v1/projects/{key}/kit", doc)
    except cl.HTTPFailure as e:
        print(f"The publish stopped at {step}: {e}. The kit on the server is the one that was there; run it again.", file=sys.stderr)
        return 4
    print(f"Published the kit: {done.get('files')} files" + (f", replacing {done['replaced']} of the last kit's." if done.get("replaced") else "."))
    return 0

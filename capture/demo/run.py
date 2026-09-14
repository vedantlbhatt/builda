"""The stages in order, and what a run prints: detect, workspace, drive and capture, compose,
the privacy check, the fallbacks, the manifest."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

from . import compose, detect, fallback, manifest, paths, privacy, storyboard, tools
from . import project as pj
from . import transcripts as tx
from .result import Capture, CaptureError
from .workspace import Workspace, WorkspaceError, prepare

OUR_FILES = ("manifest.json", "demo.mp4", "poster.jpg")


def say(msg: str = "") -> None:
    print(msg, file=sys.stderr, flush=True)


def find_storyboard(work: pathlib.Path, explicit: str | None) -> pathlib.Path | None:
    if explicit:
        p = pathlib.Path(explicit).expanduser()
        if not p.is_file():
            raise storyboard.StoryboardError(f"no storyboard at {p}")
        return p
    for n in ("storyboard.json", "storyboard.yaml", "storyboard.yml"):
        if (work / n).is_file():
            return work / n
    return None


def video_label(story: dict) -> str:
    """The video's label: the storyboard's, else its beats in order, cut at a word so it stays
    inside the label rule's 80 characters."""
    if story.get("video_label"):
        return str(story["video_label"])
    labels = [b["label"] for b in story["beats"] if b["video"]]
    text = "a pass through " + ", then ".join(labels)
    while len(text) > storyboard.LABEL_MAX:
        text = text.rsplit(" ", 1)[0].rstrip(",")
    return text


def image_cap() -> int:
    """The contract's per image byte cap, through the publish side (one number, one place)."""
    try:
        from ..demo_publish import CONTENT_TYPES

        return int(CONTENT_TYPES["image/png"][1])
    except (ImportError, KeyError):  # pragma: no cover - publish side not deployed here
        return 6 * 1024 * 1024


def place_image(src: pathlib.Path, staging: pathlib.Path, stem: str) -> pathlib.Path:
    """Copy one still into the demo, as a JPEG when the PNG is over the contract's cap (`sips`,
    which every Mac has), so a demo this writes is a demo `--publish` can send."""
    ext = ".png" if src.suffix.lower() == ".png" else ".jpg"
    dest = staging / f"{stem}{ext}"
    if src.stat().st_size <= image_cap():
        shutil.copyfile(src, dest)
        return dest
    dest = staging / f"{stem}.jpg"
    for q in (85, 75, 60):
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q), str(src), "--out", str(dest)], capture_output=True, timeout=120, check=False)
        if dest.exists() and dest.stat().st_size <= image_cap():
            return dest
    raise CaptureError(f"{src.name} is over {image_cap():,} bytes even as a JPEG")


def drop_same_pictures(staging: pathlib.Path, assets: list[dict], notes: list[str]) -> list[dict]:
    """Never keep one picture twice (`pictures`): a still that is the same picture as an earlier
    one is removed, and the rest are numbered again from 1."""
    from . import pictures

    stills = [a for a in assets if a["kind"] == "image"]
    try:
        prints = pictures.fingerprints([staging / a["file"] for a in stills])
    except CaptureError as e:
        notes.append(f"stills not compared for repeats: {e}")
        return assets
    same = pictures.distinct(prints)
    kept = []
    for a, dup in zip(stills, same):
        if dup is None:
            kept.append(a)
            continue
        (staging / a["file"]).unlink(missing_ok=True)
        notes.append(f"not kept: {a['file']} ({a['label']!r}) is the same picture as {stills[dup]['file']}")
    for i, a in enumerate(kept, 1):
        a["position"] = i
    return kept + [a for a in assets if a["kind"] != "image"]


def _clear_staging(d: pathlib.Path) -> pathlib.Path:
    if d.exists():
        shutil.rmtree(d)
    return paths.private_dir(d)


def _promote(staging: pathlib.Path, out: pathlib.Path) -> None:
    """Replace the demo in `out` with the one in `staging`: this package's files only, the
    manifest last, so a reader never sees a manifest naming files that are not there yet."""
    paths.private_dir(out)
    for p in out.iterdir():
        if p.is_file() and (p.name in OUR_FILES or p.name.startswith("still-")):
            p.unlink()
    for p in sorted(staging.iterdir(), key=lambda x: x.name == "manifest.json"):
        os.replace(p, out / p.name)
    staging.rmdir()


def check_app(app_arg: str, plan: detect.Plan, ws: Workspace) -> pathlib.Path:
    """An app built elsewhere, checked to be this project's. A Debug app is copied into the work
    dir and pinned away from other packagers (`ios.pin_packager`): the original is somebody's
    build and is never written to."""
    from . import ios

    app = pathlib.Path(app_arg).expanduser().resolve()
    if not (app.is_dir() and app.suffix == ".app" and (app / "Info.plist").exists()):
        raise CaptureError(f"--app {app} is not a built .app")
    info = ios.app_info(app)
    want = plan.expo.bundle_id if plan.expo else None
    if want and info["bundle_id"] != want:
        raise CaptureError(f"--app is {info['bundle_id']}, and this project's app is {want}")
    say(f"  filming the app built elsewhere: {app}")
    say(f"    bundle id {info['bundle_id']}, JavaScript {'embedded' if info['embedded_js'] else 'from Metro'}"
        + (f", calls {info['api_base']}" if info.get("api_base") else ""))
    if info["debug"]:
        copy = paths.private_dir(ws.build_dir / "external") / app.name
        if copy.exists():
            shutil.rmtree(copy)
        subprocess.run(["cp", "-cR", str(app), str(copy)], check=True, timeout=600)
        ios.pin_packager(copy)
        say(f"    a Debug app: filming a copy pinned to this run's Metro ({copy})")
        return copy
    return app


def main(a: argparse.Namespace) -> int:
    t0 = time.monotonic()
    try:
        project = pj.from_url(a.repo) if a.repo else pj.from_checkout(a.path)
    except pj.ProjectError as e:
        say(str(e))
        return 2
    say(f"Demo of {project.display_name} (key {project.key[:12]})")
    evidence = None
    if not a.no_transcripts:
        evidence = tx.harvest(project.identity, pathlib.Path(a.root).expanduser(), progress=False)
    ws: Workspace | None = None
    try:
        if project.url:
            say("  cloning the repository into the work dir to read it")
            ws = prepare(project, None)
            top, commit = ws.src, ws.commit
        else:
            top = project.checkout
            commit = pj.resolve_commit(top, a.ref)
            if not commit:
                say(f"no commit {a.ref!r} in {top}")
                return 2
        work = paths.work_dir(project.key)
        story_path = find_storyboard(work, a.storyboard)
        story = storyboard.load(story_path) if story_path else None
    except (WorkspaceError, storyboard.StoryboardError) as e:
        say(str(e))
        return 2
    configuration = a.configuration or ((story or {}).get("app") or {}).get("configuration") or "Release"
    plan = detect.detect(project, top, commit, evidence, kind=a.kind or (story or {}).get("kind"), configuration=configuration)

    if a.plan:
        print(detect.render(plan, work))
        print()
        if story is not None:
            print(f"  storyboard    {story_path} ({configuration}), {len(story['beats'])} beats:")
            for b in story["beats"]:
                print(f"                {b['label']}" + ("" if b["video"] else " (still only)"))
            for s in story["stills"]:
                print(f"                {s['label']} (still only)")
        else:
            print("  storyboard    none yet: the first run writes one from the plan to the work dir, to edit")
        return 0

    out = paths.out_dir(project.key)
    notes: list[str] = []
    reason = plan.refused
    allowed = {x.lower() for x in (a.allow_name or [])}
    names = tuple(n for n in project.names if n.lower() not in allowed)
    others = tuple(
        n for n in privacy.other_names(evidence.others if evidence else [], project.names) if n.lower() not in allowed
    )
    if story is not None:
        texts = [story.get("video_label") or ""] + [b["label"] for b in story["beats"]] + [b["caption"] or "" for b in story["beats"]] + [s["label"] for s in story["stills"]]
        leaks = privacy.label_leaks([t for t in texts if t], names, others)
        if leaks:
            say("Refused before running: a label or caption names a repository, and labels travel with the demo as text:")
            for x in leaks:
                say(f"  {x}")
            return 2
    cap: Capture | None = None
    composed: dict | None = None
    if reason is None:
        try:
            if ws is None:
                say(f"  the clone of {commit[:10]}, in {work / 'src'}")
                ws = prepare(project, commit, plan.app_dir)
            for s in ws.stripped:
                say(f"  made without: {s}")
            if plan.analytics:
                say(f"  made without: {', '.join(plan.analytics)} (never passed to the build or the run)")
            say(f"  {detect.sandbox_status()}")
            if story is None:
                story = storyboard.validate(storyboard.default(plan))
                ws.storyboard_path().write_text(json.dumps(story, indent=1) + "\n")
                say(f"  wrote a first storyboard to {ws.storyboard_path()}; edit its beats and run again")
            if a.until == "workspace":
                return 0
            run_dir = paths.private_dir(ws.root / "runs" / time.strftime("%Y%m%d-%H%M%S"))
            if plan.kind == "expo_ios":
                from . import ios

                app = check_app(a.app, plan, ws) if a.app else ios.build(plan, ws, story, configuration)
                if a.until == "build":
                    say(f"  built {app}")
                    return 0
                cap = ios.run(plan, ws, story, app, a.sim, run_dir)
            elif plan.kind == "web":
                from . import web

                cap = web.run(plan, ws, story, run_dir)
            else:
                from . import terminal

                cap = terminal.run(plan, ws, story, run_dir)
            notes.extend(cap.notes)
            (run_dir / "beats.json").write_text(json.dumps(
                [{"label": b.label, "caption": b.caption, "start": b.start, "end": b.end, "video": str(b.video) if b.video else None} for b in cap.beats],
                indent=1,
            ))  # fmt: skip
            if cap.video is not None and not a.no_video:
                say("  composing the video")
                composed = compose.compose(cap.video, cap.beats, run_dir)
        except (CaptureError, WorkspaceError, storyboard.StoryboardError, tools.ToolError) as e:
            reason = str(e)
            say(f"  the run did not finish: {reason}")
            if a.until:
                # A staged run is a person watching one stage; the fallbacks are for a demo.
                return 1

    staging = _clear_staging(paths.demos_dir() / f"{project.key}.staging")
    assets: list[dict] = []
    m_commit, m_when = commit, manifest.taken_at()
    kind = plan.kind or "library"
    if cap is not None and cap.stills:
        for i, st in enumerate(cap.stills[: storyboard.MAX_STILLS], 1):
            placed = place_image(st.path, staging, f"still-{i:02d}")
            w, h = manifest.image_size(placed)
            assets.append(manifest.image_asset(placed.name, w, h, i, st.label, "capture"))
        if composed is not None:
            shutil.copyfile(composed["video"], staging / "demo.mp4")
            shutil.copyfile(composed["poster"], staging / "poster.jpg")
            assets.append(
                manifest.video_asset("demo.mp4", composed["width"], composed["height"], composed["duration_ms"], video_label(story), "poster.jpg", "capture")
            )
            notes.append(f"{composed['freezes']} still stretches sped up; captions drawn with {composed['captions']}")
    else:
        prev = fallback.last_good(paths.work_dir(project.key))
        if prev is not None:
            data, d = prev
            say(f"  falling back to the last good capture ({data['taken_at']}, commit {data['commit'][:10]})")
            for a_ in data["assets"]:
                shutil.copyfile(d / a_["file"], staging / a_["file"])
                if a_["kind"] == "video":
                    shutil.copyfile(d / a_["poster"], staging / a_["poster"])
                assets.append({**a_, "source": "previous"})
            # What the pictures show is that run's: its commit, its time, its kind.
            m_commit, m_when, kind = data["commit"], data["taken_at"], data["kind"]
        else:
            picks = fallback.checkout_images(top, kind) if top else []
            source = "checkout"
            if not picks and evidence is not None:
                picks = fallback.transcript_images(evidence.images)
                source = "transcript"
            if picks:
                say(f"  falling back to {len(picks)} image(s) from the {'checkout' if source == 'checkout' else 'transcripts'}")
            for i, (p, label) in enumerate(picks, 1):
                try:
                    placed = place_image(p, staging, f"still-{i:02d}")
                except CaptureError as e:
                    notes.append(str(e))
                    continue
                w, h = manifest.image_size(placed)
                if privacy.label_leaks([label], names, others):
                    label = fallback.NEUTRAL_LABEL  # a file named after the repository says so
                assets.append(manifest.image_asset(placed.name, w, h, len([x for x in assets if x["kind"] == "image"]) + 1, label, source))
                notes.append(f"{placed.name} is {p.relative_to(top) if top and str(p).startswith(str(top)) else p}")

    assets = drop_same_pictures(staging, assets, notes)
    if not assets:
        shutil.rmtree(staging, ignore_errors=True)
        say(f"\nRefused: {reason or 'nothing to show'}. No demo was written, and nothing was invented in its place.")
        return 1

    stills = [staging / x["file"] for x in assets if x["kind"] == "image"]
    video = staging / "demo.mp4" if any(x["kind"] == "video" for x in assets) else None
    poster = staging / "poster.jpg" if video else None
    say(f"  privacy check: reading every still{' and the video' if video else ''} with Apple Vision")
    checked = True
    try:
        refused, read = privacy.check(stills, video, names, poster, other_names=others)
        say(f"    read {read} images; {len(refused)} refusal(s)")
    except (RuntimeError, tools.ToolError) as e:
        checked, refused = False, []
        say(f"    the check could not run ({e}); the demo is marked unchecked and cannot be published")
    m = manifest.build(project.key, kind, m_commit, m_when, assets, refused, checked)
    manifest.write(staging, m)
    _promote(staging, out)
    fallback.keep_last_good(paths.work_dir(project.key), out, m)
    _summary(project, out, m, reason, notes, a.allow_name, time.monotonic() - t0, len(others))
    return 0 if checked and not refused else 3


def _summary(project, out: pathlib.Path, m: dict, reason: str | None, notes: list[str], allowed, secs: float, n_others: int = 0) -> None:
    lines = ["", f"Demo written to {out}"]
    for a_ in sorted(m["assets"], key=lambda x: (x["kind"] != "video", x["position"])):
        size = (out / a_["file"]).stat().st_size
        extra = f", {a_['duration_ms'] / 1000:.1f} s" if a_["kind"] == "video" else ""
        lines.append(f"  {a_['file']:<14} {a_['width']}x{a_['height']}{extra}, {size / 1e6:.2f} MB, {a_['source']}: {a_['label']}")
    if reason:
        lines.append(f"  the run itself did not finish: {reason}")
    pv = m["privacy"]
    if not pv["checked"]:
        lines.append("  privacy: NOT checked, so this demo cannot be published")
    elif pv["refused"]:
        lines.append(f"  privacy: REFUSED, {len(pv['refused'])} finding(s); nothing here may be published until they are gone:")
        for r in pv["refused"][:12]:
            at = f" at {r['at_ms'] / 1000:.1f} s" if "at_ms" in r else ""
            b = r["box"]
            lines.append(f"    {r['file']}{at}: {r['reason']} {r['text']!r} in the box x {b['x']}, y {b['y']}, {b['width']} by {b['height']}")
    else:
        lines.append(
            f"  privacy: checked; no repository name ({', '.join(project.names)}"
            + (f", or the {n_others} names of this Mac's other repositories" if n_others else "")
            + "), key or email address on screen"
        )
    if allowed:
        lines.append(f"  allowed on screen because you said so: {', '.join(allowed)}")
    for n in notes:
        lines.append(f"  note: {n}")
    lines.append(f"  took {secs / 60:.1f} minutes; nothing left this Mac")
    print("\n".join(detect.no_dash(line) for line in lines))

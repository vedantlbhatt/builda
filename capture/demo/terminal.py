"""`cli` and `library`: a terminal, typed into by VHS, one tape per beat.

A CLI's demo is its README's usage run for real (readme2demo's rule: the README is what the
author says the tool is for); a library's is its tests, or an example, running. The project is
installed in the clone first (the plan's install step: `pip install -e .` into a venv in the work
dir, `npm ci --ignore-scripts`, `cargo build`), then each beat is a VHS tape: a clean screen in
the clone, the command typed at a readable speed, `Wait` until the prompt is back, a hold, and a
`Screenshot` for the still. One tape per beat keeps each clip's start and end exact without
guessing how long a command's output takes, and the composer joins them like any other beats.

The tape runs under the environment allowlist with the venv and `node_modules/.bin` first on
PATH, at the size of the device table's terminal canvas (spec/devices.v1.json `terminal`, the
vertical format: a CLI has no screen of its own, so it is filmed at the size its reel is posted
at), in a theme with enough contrast for the privacy check to read every character it shows.
"""

from __future__ import annotations

import os
import pathlib
import subprocess

from . import devices as table
from . import tools
from .compose import probe
from .detect import Plan
from .result import BeatWindow, Capture, CaptureError, Still
from .workspace import Sandbox, Workspace

WIDTH, HEIGHT = table.fmt(table.TERMINAL["format"])["size"]
THEME = "Catppuccin Mocha"


def quote(text: str) -> str:
    """A VHS string: double quotes, else backticks, else single quotes, whichever the text
    does not contain. A text with all three cannot be typed by VHS and is refused."""
    for q in ('"', "`", "'"):
        if q not in text:
            return f"{q}{text}{q}"
    raise CaptureError(f"VHS cannot type a command holding all three quote marks: {text[:60]}")


def tape(cwd: pathlib.Path, command: str, out: pathlib.Path, still: pathlib.Path | None, hold: float, font_size: int = 38) -> str:
    """One beat's tape (pure; `test_demo_storyboard` reads it)."""
    lines = [
        f"Output {quote(str(out))}",
        'Set Shell "bash"',
        f"Set FontSize {font_size}",
        f"Set Width {WIDTH}",
        f"Set Height {HEIGHT}",
        "Set Padding 56",
        f"Set Theme {quote(THEME)}",
        "Set TypingSpeed 45ms",
        "Set CursorBlink false",
        "Set WaitTimeout 90s",
        "Hide",
        f"Type {quote(f'cd {cwd} && clear')}",
        "Enter",
        "Sleep 400ms",
        "Show",
        "Sleep 300ms",
        f"Type {quote(command)}",
        "Sleep 500ms",
        "Enter",
        "Wait",
        f"Sleep {max(0.5, hold):.1f}s",
    ]
    if still is not None:
        lines.append(f"Screenshot {quote(str(still))}")
    lines.append("Sleep 200ms")
    return "\n".join(lines) + "\n"


def _venv(ws: Workspace) -> pathlib.Path:
    return ws.root / "venv"


def install(plan: Plan, ws: Workspace, sandbox: Sandbox) -> dict[str, str]:
    """Run the plan's install step in the clone (under the sandbox for an untrusted repository);
    returns the PATH the tapes run with. A `pip install` goes into a venv in the work dir."""
    extra_path = []
    step = plan.step("install")
    env = sandbox.env()
    domains = ["registry.npmjs.org"]
    if step is not None:
        cmd = step.command
        if cmd.startswith("pip install"):
            venv = _venv(ws)
            domains = ["pypi.org", "files.pythonhosted.org"]
            if not (venv / "bin" / "python").exists():
                argv, _ = sandbox.wrap(["python3", "-m", "venv", str(venv)])
                subprocess.run(argv, check=True, timeout=300, env=env)
            cmd = f"{venv}/bin/{cmd}"
            extra_path.append(str(venv / "bin"))
        log = ws.logs / "install.log"
        argv, how = sandbox.wrap(["/bin/sh", "-c", cmd], domains)
        with log.open("w") as f:
            f.write(f"== install ({how}): {cmd}\n")
            f.flush()
            r = subprocess.run(argv, cwd=str(ws.src / step.cwd), stdout=f, stderr=subprocess.STDOUT, timeout=1800, check=False, env=env)
        if r.returncode != 0:
            raise CaptureError(f"installing the project failed ({cmd.split()[0]} exited {r.returncode}; {log})")
    nm = ws.src / "node_modules" / ".bin"
    if nm.is_dir():
        extra_path.append(str(nm))
    return {"PATH": os.pathsep.join([*extra_path, env.get("PATH", "")])}


def run(plan: Plan, ws: Workspace, story: dict, run_dir: pathlib.Path, sandbox: Sandbox | None = None) -> Capture:
    sandbox = sandbox or Sandbox(work=ws.root, untrusted=False)
    vhs = tools.vhs()
    ttyd = tools.ttyd()
    path_env = install(plan, ws, sandbox)
    tool_path = os.pathsep.join([str(ttyd.parent), os.path.dirname(tools.ffmpeg()), path_env["PATH"]])
    env = sandbox.env({"PATH": tool_path})
    stills: list[Still] = []
    beats: list[BeatWindow] = []
    n = 0
    for k, b in enumerate(story["beats"], 1):
        cmds = [a["run"] for a in b["actions"] if "run" in a]
        if not cmds:
            continue
        clip = run_dir / f"beat-{k:02d}.mp4"
        still = None
        if b["still"]:
            n += 1
            still = run_dir / f"still-{n:02d}.png"
        tp = run_dir / f"beat-{k:02d}.tape"
        tp.write_text(tape(ws.src, " && ".join(cmds), clip, still, b["hold"]))
        # VHS types the repository's own command into a shell, so for an untrusted repository the
        # whole VHS invocation (and the command it runs) is under the sandbox.
        argv, _ = sandbox.wrap([str(vhs), str(tp)])
        r = subprocess.run(argv, cwd=str(ws.src), capture_output=True, text=True, timeout=600, check=False, env=env)
        if r.returncode != 0 or not clip.exists():
            raise CaptureError(f"VHS could not record beat {k}: {(r.stderr or r.stdout).strip()[-400:]}")
        if still is not None and still.exists():
            stills.append(Still(still, b["label"]))
        d = probe(clip)["duration"]
        beats.append(BeatWindow(b["label"], b["caption"], 0.0, d, video=clip))
    if not beats:
        raise CaptureError("no beat of the storyboard runs a command")
    return Capture(stills=stills, video=beats[0].video, beats=beats, notes=[f"recorded with VHS ({vhs}) and ttyd ({ttyd})"])

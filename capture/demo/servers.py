"""Long running processes a demo needs beside the app: a dev server, a local backend, Metro.

Each runs in the CLONE, under the environment allowlist plus the storyboard's own values, in a
process group of its own so stopping it stops everything it started, and under Anthropic's
sandbox runtime when it is installed (`workspace.sandboxed`). The run waits for a health URL
before it drives anything (demo-machine's rule: a demo of a server that is still starting is a
demo of a spinner), and gives up after `timeout` seconds with the log's last lines.

A storyboard can ask for files copied into the clone before a server starts (`copy`), which is
how a backend gets data its repository does not track. A `.env` file, a key or a certificate is
refused by name: that is exactly what the clone is made without.
"""

from __future__ import annotations

import os
import pathlib
import re
import shutil
import signal
import subprocess
import time
import urllib.error
import urllib.request

from analysis import digest

from .workspace import Sandbox, Workspace, is_secret_file


class ServerError(Exception):
    pass


def check_copy(src: pathlib.Path) -> None:
    # `secret` is not a file shape, but a `*-secret.json` a storyboard names to copy is worth
    # refusing by name too, so the one secret-file list plus that word.
    if is_secret_file(src.name) or re.search(r"(?i)secret", src.name):
        raise ServerError(f"refusing to copy {src.name} into the clone: env files, keys and credentials stay where they are")


def _clone_copy(src: pathlib.Path, dst: pathlib.Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    # APFS clone (`cp -c`): a 243 MB recording costs no space and no time. A plain copy
    # elsewhere. Either way the source is only read.
    r = subprocess.run(["cp", "-c", str(src), str(dst)], capture_output=True, timeout=600, check=False)
    if r.returncode != 0:
        shutil.copyfile(src, dst)


class Server:
    def __init__(self, spec: dict, ws: Workspace, log_dir: pathlib.Path, allowed_domains: list[str] | None = None, sandbox: Sandbox | None = None):
        self.name = str(spec.get("name") or "server")
        self.spec = spec
        self.ws = ws
        self.log = log_dir / f"server-{re.sub(r'[^A-Za-z0-9_.-]', '_', self.name)}.log"
        self.proc: subprocess.Popen | None = None
        self.allowed = allowed_domains or []
        # No sandbox given means the person's own project, run unsandboxed after their yes.
        self.sandbox = sandbox or Sandbox(work=ws.root, untrusted=False)
        self.how = ""

    def _sub(self, s: str) -> str:
        return s.replace("<work>", str(self.ws.root)).replace("<src>", str(self.ws.src))

    def prepare(self) -> None:
        for c in self.spec.get("copy") or []:
            src = pathlib.Path(self._sub(str(c["from"]))).expanduser()
            dst = self.ws.src / str(c["to"])
            check_copy(src)
            if not src.is_file():
                raise ServerError(f"{self.name}: nothing to copy at {src}")
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                _clone_copy(src, dst)
        install = self.spec.get("install")
        if install:
            stamp = self.ws.root / f".installed-{re.sub(r'[^A-Za-z0-9_.-]', '_', self.name)}"
            if not stamp.exists() or stamp.read_text() != install:
                cwd = self.ws.src / str(self.spec.get("cwd") or "")
                argv, how = self.sandbox.wrap(["/bin/sh", "-c", self._sub(install)], self.allowed)
                with self.log.open("a") as f:
                    f.write(f"\n== install ({how}): {install}\n")
                    f.flush()
                    r = subprocess.run(
                        argv,
                        cwd=str(cwd), stdout=f, stderr=subprocess.STDOUT, timeout=1800, check=False,
                        env=self.sandbox.env(self._env()),
                    )  # fmt: skip
                if r.returncode != 0:
                    raise ServerError(f"{self.name}: install failed:\n{tail(self.log)}")
                stamp.write_text(install)

    def _env(self) -> dict[str, str]:
        return {k: self._sub(str(v)) for k, v in (self.spec.get("env") or {}).items()}

    def start(self, timeout: float = 180.0) -> None:
        self.prepare()
        cwd = self.ws.src / str(self.spec.get("cwd") or "")
        argv, self.how = self.sandbox.wrap(["/bin/sh", "-c", "exec " + self._sub(self.spec["command"])], self.allowed)
        f = self.log.open("a")
        f.write(f"\n== start ({self.how}): {self.spec['command']}\n")
        f.flush()
        self.proc = subprocess.Popen(
            argv, cwd=str(cwd), stdout=f, stderr=subprocess.STDOUT, env=self.sandbox.env(self._env()),
            start_new_session=True,
        )  # fmt: skip
        health = self.spec.get("health")
        if health:
            self.wait(self._sub(str(health)), timeout, str(self.spec.get("expect") or ""))
        # Answering is not the same as ready: a backend that fills a cache from a poll loop
        # answers at once and has nothing to say for its first few ticks.
        time.sleep(float(self.spec.get("warmup") or 0))

    def wait(self, url: str, timeout: float, expect: str = "") -> None:
        deadline = time.monotonic() + timeout
        last = ""
        while time.monotonic() < deadline:
            if self.proc is not None and self.proc.poll() is not None:
                raise ServerError(f"{self.name} exited with {self.proc.returncode} before it answered:\n{tail(self.log)}")
            try:
                with urllib.request.urlopen(url, timeout=5) as r:
                    body = r.read(2000).decode("utf-8", "replace")
                    if r.status < 500 and (not expect or expect in body):
                        return
                    last = f"HTTP {r.status}"
            except (urllib.error.URLError, OSError) as e:
                last = str(e)
            time.sleep(1.0)
        raise ServerError(f"{self.name} did not answer {url} within {timeout:.0f} s ({last}):\n{tail(self.log)}")

    def stop(self) -> None:
        if self.proc is None or self.proc.poll() is not None:
            return
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(10)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def port_free(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def tail(log: pathlib.Path, n: int = 25) -> str:
    try:
        lines = log.read_text(errors="replace").splitlines()[-n:]
    except OSError:
        return "(no log)"
    # A log line can carry a token (a server printing its config): masked with the digest's
    # rules before it reaches a terminal. A compiler line runs to 6,000 characters of flags,
    # and the reason is at its end or on the line after, so each is cut to its last 240.
    return "\n".join("    " + digest.mask(x if len(x) <= 240 else "..." + x[-240:]) for x in lines)

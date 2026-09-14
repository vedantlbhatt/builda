"""`python -m capture demo`: stills and a short video of a project, RUNNING, made on the Mac.

The design is `docs/demos.md` (the generator section and the manifest) and the research it
follows is `docs/research/demo-capture.md` (section 3 the architecture, section 4 the risks).
No model is called anywhere in this package: a flow is written once as a storyboard file and
replayed deterministically.

The stages, one module each:

1. ``detect``     the project's kind (`expo_ios`, `web`, `cli`, `library`) and how to run it:
                  the commands that WORKED in the project's own Claude Code transcripts first
                  (``transcripts``, through capture's own reader and repository resolution),
                  then package.json scripts, app.json / app.config, Procfile, compose and
                  devcontainer, then Railpack's rules. ``--plan`` prints it and runs nothing.
2. ``workspace``  never the person's checkout: a ``git clone --local`` of the chosen commit (or
                  a GitHub URL) into ``~/.builder/demos/work/<key>/``, no ``.env*`` file, no
                  analytics key, every child process under an environment ALLOWLIST, and dev
                  servers under Anthropic's sandbox runtime where it is installed.
3. ``simulator`` / ``ios`` / ``web`` / ``terminal``   drive and capture, per kind.
4. ``compose``    ffmpeg only: duplicate frames dropped, holds sped up, a crossfade and a
                  caption per beat, a portrait H.264 MP4 with faststart and a poster frame.
5. ``privacy``    Apple Vision text recognition over every still and sampled video frames; a
                  frame showing the repository's name, a token or key shaped string, or an
                  email address is refused with the file and the box it was found in.
6. ``fallback``   when the project will not run: the last good capture, then images already in
                  the checkout, then images the transcripts read, each labelled with its source.
                  Never a generated picture of the product.
7. ``manifest``   ``~/.builder/demos/<key>/manifest.json``, the shape the publish side reads.

Standard library only, like the rest of capture; the tools it drives (Xcode, ffmpeg, Maestro,
Playwright, VHS) are found or installed into ``~/.builder/tools`` by ``tools``.
"""

from __future__ import annotations

KINDS = ("expo_ios", "web", "cli", "library")

#: The asset sources a manifest may name (`docs/demos.md`, "each labelled with where it came
#: from"): a run of the project, a file already in the checkout, an image a Claude Code
#: transcript read, and the last good capture carried forward.
SOURCES = ("capture", "checkout", "transcript", "previous")

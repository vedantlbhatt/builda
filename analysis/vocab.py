"""Vocabulary: the words for what happened, attached to your own sessions.

Strava never taught anyone to run. It attached the words athletes use (splits, cadence,
threshold) to people's own runs until they started using them. This module does the same
for building with an agent, three ways (docs/approved-roadmap.md 1.5, docs/overnight-engine.md 4):

  * `glossary(sessions)`: a term unlocks the first time it HAPPENS in one of your
    sessions. Your agent ran a migration, so *migration* is now in your glossary with one
    line of what it means. Nothing is taught; everything is encountered.
  * `session_title(session)`: one line in engineer voice ("Wired two database
    migrations"), chosen by the first rule the session's own events satisfy.
  * `stack(sessions, dependencies=...)`: the gear list. What the project is made of, from
    its own manifests and from what the agent actually ran, read and wrote.

THE RULE THAT SHAPES ALL THREE: every word is EARNED BY AN EVENT, never inferred from a
project's shape. A glossary entry names the first event that matched it; a stack item
says which kind of evidence put it there; a title is the first rule the counts satisfy.
A term that unlocks on something that did not happen is the vocabulary version of a
plausible wrong number. Running the design's detectors on the real corpus found several
that did exactly that, and a few that could not see what the corpus plainly did; each
change carries its count beside it below, and the "Deviations (vocab)" section of
docs/overnight-engine.md lists them together.

WHAT IS READ, AND WHAT IS NOT:

  * A shell command is read ONE COMMAND LINE AT A TIME with every heredoc body skipped,
    through `digest._command_lines`, the one function that knows what a heredoc body is.
    A body is data (CLAUDE.md, "A heredoc body is DATA"): a `git commit -F - <<'EOF'`
    message or a `python3 - <<'PY'` script is not a command the agent ran. MEASURED on
    the corpus (2026-09-13, 154 sessions): 1,734 of 9,085 shell calls contain a heredoc
    opener. Each command line is then split into its simple commands at unquoted `;`,
    `&&`, `||`, `|` and `&`; a simple command that only asks whether a program exists
    (`which`, `command -v`, `--version`, `--help`) is dropped, an `echo` is read only for
    its `$(...)`: its words are a label, and a label naming a tool is not the tool
    running. A search (`grep`, `rg`, `find`) is read as its program's name alone: its
    pattern is data too.
  * Paths are matched lowercased, as posix paths, with a leading `/` added to a relative
    one so a `*/dockerfile` glob matches a `Dockerfile` written from the working
    directory by a heredoc. A path under Claude Code's own state (`~/.claude/`, the
    `/tmp/claude-<uid>/` scratchpad) is the harness's, never the project's.
  * Each event is read once: a resumed session's transcript carries a copy of the old
    one's records, and the sessionizer pools both (`_distinct`).
  * Nothing here reads a thinking block, a tool RESULT body (only a failing result's
    text, for the stack trace term), or prompt wording.

PRIVACY. Every string this module emits comes from the catalog or from the title
templates, and the title templates are filled with spoken numbers and catalog nouns.
The one LOCAL string is the directory name `session_title(names=True)` appends. `wire()`
drops it with the rest of every rendered string: definitions and titles stay on the
machine and the phone renders its own words from the ids (docs/overnight-engine.md 0,
rules 4 and 5). Manifest dependency names are MATCHED and DROPPED: only catalog ids and
catalog names ever leave `stack`.
"""

from __future__ import annotations

import collections
import dataclasses
import fnmatch
import posixpath
import re
from collections.abc import Mapping, Sequence

from . import burn, digest, feedback, languages, patterns, plain, quality

# ----------------------------------------------------------------------------- the terms


@dataclasses.dataclass(frozen=True)
class Term:
    """One word that can unlock, the one line that explains it, and what unlocks it.

    Detectors, any of which matching one event unlocks the term:
      paths     lowercase globs, `fnmatch.fnmatchcase` on the event's lowercased posix
                path (tool events only)
      commands  regexes searched case insensitively on each simple command of a shell
                call (`_command_segments`: heredoc bodies skipped, split at separators,
                existence probes dropped, echo labels dropped); a precompiled pattern is
                used as it is, so a rule that already exists elsewhere is imported
      tools     globs on the tool name (tool events only), case sensitive
      roles     `plain.role_of(path)` of a tool event's path
      kinds     `Ev.kind`
      errors    regexes searched on a failing tool result's text
    """

    id: str
    word: str
    definition: str
    paths: tuple = ()
    commands: tuple = ()
    tools: tuple = ()
    roles: tuple = ()
    kinds: tuple = ()
    errors: tuple = ()


def _t(id: str, definition: str, word: str | None = None, **detectors) -> Term:
    """The word is the id with `_` as a space unless the table says otherwise."""
    return Term(id=id, word=word or id.replace("_", " "), definition=definition, **detectors)


#: `lockfile` unlocks on any file this codebase already refuses to count as written work,
#: by the same exact names (`languages.GENERATED_NAMES`), lowercased for the path glob.
_LOCKFILE_GLOBS = tuple(sorted(f"*/{n.lower()}" for n in languages.GENERATED_NAMES))

#: `[redacted]` where the digest's mask began a word, or began after a run of letters
#: that itself begins a word (`PG[redacted]`, `TRANSLOC_[redacted]`), never mid way
#: through a hyphen, slash or dot joined word (`worktrees-ta[redacted]`). See `secret`.
_SECRET_MASK = r"(?:(?<![A-Za-z0-9])|(?<![-/.A-Za-z0-9])[A-Za-z0-9]+)\[redacted\]"

#: Where a program's name stands in a simple command: after any `NAME=value`
#: assignments, and after a package runner (`npx`, `bunx`) or `timeout N` with their
#: flags. A detector anchored here reads the program being RUN, never a file named after
#: it (`cat vercel.json`), a URL on its domain (`https://app.vercel.app`) or a word in
#: another program's arguments (`git add vercel.json`).
_AT_START = r"^(?:\w+=\S*\s+)*(?:(?:npx|bunx|timeout\s+\S+)\s+(?:-\S+\s+)*)*"

CATALOG: tuple[Term, ...] = (
    # --- git
    _t(
        "commit",
        "A saved snapshot of your code with a note saying what changed.",
        # `patterns._COMMIT_CMD` and `digest.COMMIT_TOOLS`: the one definition of a commit
        # every other count here uses (`patterns._committed`).
        commands=(patterns._COMMIT_CMD,),
        tools=tuple(sorted(digest.COMMIT_TOOLS)),
    ),
    _t(
        "branch",
        "A separate line of work you can merge back later.",
        commands=(r"\bgit (checkout -b|switch -c|branch)\b",),
    ),
    _t(
        "merge",
        "Combining the changes from one branch into another.",
        # `(?!-)`: `git merge-base` asks where two branches split and merges nothing.
        # MEASURED on the corpus: the design's `\bgit merge\b` matches 25 shell calls in
        # 14 sessions, and 10 of those calls are `git merge-base`; 15 in 12 merge.
        commands=(r"\bgit merge\b(?!-)",),
    ),
    _t(
        "rebase",
        "Replaying your commits on top of newer work so history stays straight.",
        commands=(r"\bgit rebase\b",),
    ),
    _t("diff", "The exact lines that changed between two versions.", commands=(r"\bgit diff\b",)),
    _t(
        "stash",
        "Setting unfinished changes aside without committing them.",
        commands=(r"\bgit stash\b",),
    ),
    _t("revert", "A new commit that undoes an earlier one.", commands=(r"\bgit revert\b",)),
    _t(
        "cherry_pick",
        "Copying one commit from another branch onto yours.",
        # git's own spelling: a hyphen inside a word is not a dash (`plain.DASH`).
        word="cherry-pick",
        commands=(r"\bgit cherry-pick\b",),
    ),
    _t(
        "worktree",
        "A second checkout of the same repository in another folder.",
        commands=(r"\bgit worktree\b",),
        paths=("*/worktrees/*",),
    ),
    _t(
        "pull_request",
        "A proposed change others can review before it lands.",
        commands=(r"\bgh pr\b",),
    ),
    _t(
        "force_push",
        "Replacing the shared history with yours.",
        commands=(r"git push.*(--force|\s-f\b)",),
    ),
    _t(
        "git_hook",
        "A script git runs by itself before a commit or push.",
        paths=("*/.husky/*", "*.pre-commit-config.yaml"),
        commands=(r"--no-verify",),
    ),
    # --- testing
    _t(
        "test_suite",
        "The whole collection of automated checks for your code.",
        # `quality.TEST_CMD`, THE ONE DEFINITION of running the tests, used as compiled.
        commands=(quality.TEST_CMD,),
    ),
    _t("unit_test", "A small automated check of one piece of code.", roles=("test",)),
    _t(
        "fixture",
        "Saved sample data a test runs against.",
        word="test fixture",
        paths=("*fixtures*", "*/conftest.py"),
    ),
    _t(
        "snapshot_test",
        "A test that compares output with a saved copy.",
        paths=("*__snapshots__*", "*.snap"),
    ),
    _t(
        "end_to_end_test",
        "A test that drives the whole app the way a person would.",
        word="end-to-end test",
        paths=("*e2e*", "*.maestro/*"),
        commands=(r"\b(playwright|cypress|detox|maestro)\b",),
    ),
    _t("mock", "A stand-in for a real dependency while a test runs.", paths=("*mock*",)),
    _t(
        "coverage",
        "How much of your code the tests actually run.",
        word="test coverage",
        # `(?-i:c8)`: the tool is lowercase. MEASURED on the corpus: the design's
        # case insensitive `\bc8\b` matched exactly one shell call, and it was the label
        # in `echo "=== C8: tracksViewChanges ..."`, which would have unlocked coverage
        # for a corpus that never measured any.
        commands=(r"(--cov\b|\bcoverage\b|(?-i:\bc8\b)|\bnyc\b)",),
    ),
    _t(
        "type_check",
        "A pass that proves values have the shapes the code expects.",
        commands=(r"\b(tsc|mypy|pyright)\b",),
    ),
    _t(
        "linter",
        "A tool that flags suspicious or messy code.",
        commands=(r"\b(ruff check|eslint|flake8|pylint|swiftlint)\b",),
    ),
    _t(
        "formatter",
        "A tool that rewrites code into one consistent style.",
        commands=(r"\b(prettier|black|ruff format|gofmt|swift-format)\b",),
    ),
    _t(
        "ci",
        "Checks that run on a server every time you push.",
        word="continuous integration",
        paths=("*/.github/workflows/*", "*.gitlab-ci.yml"),
        commands=(r"\bgh (run|workflow)\b",),
    ),
    # --- dependencies and build
    _t("dependency", "Someone else's code your project pulls in.", roles=("dependency",)),
    _t("lockfile", "A file pinning the exact version of every dependency.", paths=_LOCKFILE_GLOBS),
    _t(
        "package_manager",
        "The tool that installs and updates dependencies.",
        commands=(r"\b(npm|pnpm|yarn|bun|pip3?|uv|poetry|cargo)\s+(install|add|i)\b",),
    ),
    _t(
        "build",
        "Turning source code into something that runs.",
        commands=(
            r"\b(run build|swift build|cargo build|go build|xcodebuild|vite build|next build)\b",
            # `eas build` only as the subcommand itself: `eas build:list`, `build:view`
            # and `build:version:get` read the build history and build nothing. MEASURED
            # on the corpus: 34 of the design's 42 matching `eas build` calls were those,
            # and with them and the probes and searches out (`_simple_commands`), `build`
            # went from 19 sessions to 9.
            r"\beas(?:-cli)?(?:@\S+)?\s+build(?=\s|$)",
        ),
    ),
    _t(
        "bundler",
        "A tool that packs many source files into a few for shipping.",
        paths=("*/vite.config.*", "*/webpack.config.*", "*/metro.config.*"),
        commands=(r"\b(webpack|esbuild|rollup)\b",),
    ),
    _t(
        "monorepo",
        "One repository holding several projects side by side.",
        paths=("*/pnpm-workspace.yaml", "*/turbo.json", "*/lerna.json", "*/nx.json"),
    ),
    _t(
        "virtualenv",
        "A private folder of Python packages for one project.",
        word="virtual environment",
        paths=("*/.venv/*",),
        commands=(r"\b(python3? -m venv|uv venv)\b",),
    ),
    _t(
        "env_var",
        "A setting handed to a program from outside its code.",
        word="environment variable",
        paths=("*/.env*",),
        commands=(r"\bexport [a-z_]+=",),
    ),
    _t(
        "secret",
        "A password or key that must never be committed.",
        # The digest's `mask` fired on this command: it held something key shaped. NOT
        # when the mask began in the middle of a hyphen, slash or dot joined word: its
        # `sk-` rule also fires on the tail of `task-research-how-much-cheaper-...`, a
        # worktree directory name, which comes out as `...worktrees-ta[redacted]/...`.
        # A key named inside a variable (`TRANSLOC_[redacted]`, `PG[redacted]`) or a URL
        # query (`GetStops?[redacted]`) still counts. MEASURED on the corpus (157
        # sessions): the bare `\[redacted\]` matched 226 shell calls in 40 sessions, 80 of
        # them only that path, in 13 sessions; 9 of the 40 sessions had no other match.
        commands=(_SECRET_MASK,),
    ),
    _t(
        "module",
        "One file or folder of code with a single job.",
        paths=("*/__init__.py", "*/index.ts", "*/mod.rs"),
    ),
    # --- backend and data
    _t(
        "api",
        "The doorway other programs use to talk to yours.",
        word="API",
        paths=("*/api/*", "*openapi*"),
    ),
    _t(
        "endpoint",
        "One address in an API that answers one kind of request.",
        # `*/routers/*` beside the design's `*/routes/*`: FastAPI's own name for the
        # directory. MEASURED on the corpus: `*/routes/*` matches 5 path events in 1
        # session (this repository's server); with `routers/` it is 42 in 12, RideGT's.
        paths=("*/routes/*", "*/routers/*"),
        commands=(r"\bcurl\b.*https?://",),
    ),
    _t(
        "schema",
        "The agreed shape of your data.",
        paths=("*schema*", "*.prisma", "*.graphql", "*.proto"),
    ),
    _t(
        "migration",
        "A script that changes the database's shape one step at a time.",
        roles=("migration",),
        commands=(r"\b(alembic|prisma migrate|supabase migration)\b",),
    ),
    _t(
        "database",
        "Where your app keeps data between runs.",
        commands=(r"\b(psql|sqlite3|mysql|mongosh|redis-cli)\b",),
        paths=("*.sqlite", "*.db"),
    ),
    _t(
        "query",
        "A question you ask the database.",
        paths=("*.sql",),
        commands=(r"\bselect\b.+\bfrom\b",),
    ),
    _t(
        "rls",
        "Database rules that decide which rows each person can see.",
        word="row-level security",
        # `*[/_.-]rls*` and `*/polic*.sql` narrow the design's `*rls*` and `*polic*`:
        # `*rls*` matches every Django `urls.py` and `*polic*` every privacy policy page,
        # and neither of those is a database rule.
        commands=(r"(row level security|create policy)",),
        paths=("*[/_.-]rls*", "*/polic*.sql", "*/policies/*.sql"),
    ),
    _t(
        "orm",
        "A library that lets code treat database rows as objects.",
        word="ORM",
        paths=("*/models.py", "*prisma*", "*drizzle*"),
    ),
    _t("cache", "A fast copy of data kept close so you do not fetch it twice.", paths=("*cache*",)),
    _t(
        "queue",
        "A line of jobs waiting for a worker to pick them up.",
        paths=("*queue*", "*worker*", "*/jobs/*"),
    ),
    _t(
        "webhook",
        "A message another service sends your app when something happens.",
        paths=("*webhook*",),
    ),
    _t(
        "cron_job",
        "A task that runs on a schedule.",
        paths=("*cron*",),
        commands=(r"\bcrontab\b",),
    ),
    _t(
        "auth",
        "Proving who someone is before letting them in.",
        word="authentication",
        paths=("*auth*", "*login*", "*signin*", "*oauth*"),
    ),
    _t(
        "jwt",
        "A signed token that proves who is making a request.",
        word="JWT",
        paths=("*jwt*",),
        commands=(r"\bjwt\b",),
    ),
    _t(
        "cors",
        "Browser rules for which sites may call your server.",
        word="CORS",
        paths=("*cors*",),
        commands=(r"\bcors\b",),
    ),
    _t(
        "rate_limit",
        "A cap on how often something may be called.",
        paths=("*rate*limit*", "*throttl*"),
    ),
    # --- running things
    _t(
        "container",
        "A packaged copy of your app and everything it needs to run.",
        paths=("*/dockerfile", "*docker-compose*"),
        commands=(r"\b(docker|podman)\b",),
    ),
    _t(
        "deploy",
        "Putting a new version where people can reach it.",
        # The design's `\b(railway up|vercel|fly deploy|wrangler deploy|eas submit|eas
        # update)\b`, with each program read where it RUNS (`_AT_START`) and each
        # subcommand whole. The bare `vercel` also matched `cat vercel.json`,
        # `git checkout --theirs vercel.json`, a `curl` of a `*.vercel.app` page, and
        # `vercel ls`, `vercel env pull` and `vercel whoami`, none of which ships
        # anything; `eas update` matched `eas update:list`, which reads the history.
        # `vercel` deploys when it is followed by nothing, by a flag, or by `deploy`.
        # MEASURED on the corpus: the design's regex matched 60 shell calls in 22
        # sessions; 28 calls in 17 sessions deploy.
        commands=(
            _AT_START + r"railway\s+up(?=\s|$)",
            _AT_START + r"vercel(?:@\S+)?(?=\s*$|\s+-|\s+(?:deploy|redeploy|promote)(?=\s|$))",
            _AT_START + r"fly(?:ctl)?\s+deploy(?=\s|$)",
            _AT_START + r"wrangler\s+(?:deploy|publish)(?=\s|$)",
            _AT_START + r"eas(?:-cli)?(?:@\S+)?\s+(?:submit|update)(?=\s|$)",
        ),
    ),
    _t(
        "server",
        "A program that waits for requests and answers them.",
        commands=(r"\b(uvicorn|gunicorn|flask run|npm run dev|bun run dev|npm start)\b",),
    ),
    _t(
        "port",
        "A numbered door on a machine that a server listens on.",
        commands=(r"(localhost:\d+|--port\b|lsof -i)",),
    ),
    _t(
        "process",
        "One running program, with its own number.",
        commands=(r"\b(ps aux|pkill|kill -9)\b",),
    ),
    _t(
        "log",
        "A running record of what a program did.",
        paths=("*.log",),
        # The design's `tail -f|journalctl|log stream` beside four ways this corpus
        # actually reads logs. MEASURED on the corpus: the design's three match 0 calls;
        # `railway logs` and its kind 47 calls in 18 sessions, `tail` of a `.log` file 90
        # in 33, `adb logcat` 13 in 4, `log show` 3 in 2.
        commands=(
            r"\b(tail -f|journalctl|log stream)\b",
            r"\b(railway|docker|kubectl|heroku|fly|flyctl|vercel|eas) logs?\b",
            r"\btail\b.*\.log\b",
            r"\badb logcat\b",
            r"\blog show\b",
        ),
    ),
    _t(
        "stack_trace",
        "The chain of function calls that led to an error.",
        # `(?m)`: a JavaScript trace's `    at fn (file:1:2)` lines follow the message
        # line, so without multiline the `^` could only ever match the first line.
        # MEASURED on the corpus: 93 failing results in 45 sessions without it, 96 in 46.
        errors=(r"(?m)(Traceback \(most recent call last\)|^\s+at \S+ \()",),
    ),
    _t(
        "ssh",
        "A secure way to run commands on another machine.",
        word="SSH",
        commands=(r"\bssh\b",),
    ),
    _t("shell_script", "A file of terminal commands run in order.", paths=("*.sh",)),
    _t(
        "makefile",
        "A file of named build steps.",
        word="Makefile",
        paths=("*/makefile",),
        commands=(r"^\s*make \w",),
    ),
    _t(
        "simulator",
        "A pretend phone on your computer for trying an app.",
        commands=(r"\b(xcrun simctl|emulator -avd|adb)\b",),
    ),
    # --- the agent itself
    _t(
        "subagent",
        "A helper agent your agent hands a piece of work to.",
        tools=tuple(sorted(burn.TASK_TOOLS)),
    ),
    _t("mcp", "A plugin that gives your agent new tools.", word="MCP server", tools=("mcp__*",)),
    _t(
        "web_search",
        "Looking something up on the web in the middle of work.",
        tools=("WebSearch", "WebFetch", "google_web_search", "web_fetch"),
    ),
    _t(
        "regex",
        "A pattern for matching text.",
        tools=("Grep", "grep_search"),
        commands=(r"^\s*(grep|rg)\b",),
    ),
    _t("glob", "A wildcard pattern for matching file names.", tools=("Glob", "glob")),
    _t(
        "compaction",
        "Summarising a long conversation so it still fits in the agent's working memory.",
        kinds=("compaction",),
    ),
    _t(
        "heredoc",
        "Writing a whole file straight from the terminal.",
        # `digest._HEREDOC`, the opener the digest credits as a shell FILE write
        # (`cat > path <<'EOF'`), so the definition is true of every unlock. The
        # design's `<<\s*-?['"]?\w+` also matches `python3 - <<'PY'`, which writes no
        # file, and the `<<<` here string CLAUDE.md warns about. MEASURED on the corpus:
        # the design's opener is in 1,734 calls across 107 sessions; 292 calls in 63
        # sessions write a file.
        commands=(digest._HEREDOC,),
    ),
    _t(
        "patch",
        "A set of line changes applied to files in one go.",
        tools=("apply_patch",),
        commands=(r"\bgit apply\b",),
    ),
    _t("symlink", "A file that points at another file.", commands=(r"\bln -s\b",)),
    _t(
        "permissions",
        "Who may read, change or run a file.",
        word="file permissions",
        commands=(r"\bchmod\b",),
    ),
    _t(
        "feature_flag",
        "A switch that turns a feature on or off without shipping code.",
        paths=("*feature*flag*", "*/flags.*"),
    ),
    _t(
        "type_definitions",
        "A file describing the shapes values can take.",
        paths=("*.d.ts", "*.pyi", "*/types.ts"),
    ),
    # --- found on the corpus: two concepts it kept meeting that the design had no word for
    _t(
        "monitoring",
        "Watching a running app's numbers so you notice when something breaks.",
        # MEASURED on the corpus: 130 shell calls in 14 sessions stand up, query or
        # read the logs of RideGT's Prometheus and Grafana; 7 path events in 4.
        paths=("*/prometheus*", "*/grafana*"),
        commands=(r"\b(prometheus|grafana)\b",),
    ),
    _t(
        "routing_engine",
        "A service that works out the path from one place to another.",
        # MEASURED on the corpus: 126 shell calls in 17 sessions run, deploy or query
        # Valhalla, the routing engine behind RideGT's walking directions.
        paths=("*valhalla*", "*osrm*", "*graphhopper*"),
        commands=(r"\b(valhalla|osrm|graphhopper)\b",),
    ),
)


# ----------------------------------------------------------------------------- the stack


CATEGORIES = ("language", "framework", "database", "infra", "testing", "tooling", "service")
EVIDENCE = ("manifest", "language", "command", "path", "tool")


@dataclasses.dataclass(frozen=True)
class StackItem:
    """One thing a project can be made of, and what counts as evidence for it.

    manifests  lowercased dependency names; a trailing `*` makes it a prefix
    language   the `languages.EXTENSIONS` name this item stands for, when it is one
    commands, paths, tools   as `Term`
    """

    id: str
    name: str
    category: str
    manifests: tuple = ()
    commands: tuple = ()
    paths: tuple = ()
    tools: tuple = ()
    language: str | None = None


def _lang(id: str, name: str) -> StackItem:
    return StackItem(id=id, name=name, category="language", language=name)


def _s(id: str, name: str, category: str, m=None, c=(), p=(), t=()) -> StackItem:
    """A bare id means `m:` of that id (docs/overnight-engine.md 4.3)."""
    return StackItem(
        id=id,
        name=name,
        category=category,
        manifests=tuple(m) if m is not None else (id,),
        commands=tuple(c),
        paths=tuple(p),
        tools=tuple(t),
    )


STACK: tuple[StackItem, ...] = (
    # --- language: `languages.split` names, the one place a file's language is decided
    _lang("python", "Python"),
    _lang("typescript", "TypeScript"),
    _lang("javascript", "JavaScript"),
    _lang("swift", "Swift"),
    _lang("kotlin", "Kotlin"),
    _lang("go", "Go"),
    _lang("rust", "Rust"),
    _lang("ruby", "Ruby"),
    _lang("java", "Java"),
    _lang("sql", "SQL"),
    _lang("shell", "Shell"),
    _lang("dart", "Dart"),
    _lang("cpp", "C++"),
    _lang("csharp", "C#"),
    _lang("php", "PHP"),
    # HTML and CSS beside the design's fifteen: MEASURED on the corpus, HTML is the fourth
    # language `languages.split` names (3,721 agent lines, 5.8%), RideGT's public pages
    # and dashboards. Markdown, Text, YAML and JSON are split names too and stay off: a
    # document format is not something a project is built with.
    _lang("html", "HTML"),
    _lang("css", "CSS"),
    # --- framework
    _s("react", "React", "framework", m=("react",)),
    _s("react_native", "React Native", "framework", m=("react-native",)),
    _s(
        "expo",
        "Expo",
        "framework",
        m=("expo", "expo-*"),
        # The CLI as it is invoked. MEASURED on the corpus: 25 calls in 15 sessions
        # (`npx expo run:ios`, `prebuild`, `start`); a bare `\bexpo\b` also matched
        # echo labels and grep patterns.
        c=(r"\b(npx|bunx) expo\b",),
    ),
    _s("nextjs", "Next.js", "framework", m=("next",)),
    _s("fastapi", "FastAPI", "framework", m=("fastapi",)),
    _s("django", "Django", "framework"),
    _s("flask", "Flask", "framework"),
    _s("express", "Express", "framework"),
    _s("tailwind", "Tailwind CSS", "framework", m=("tailwindcss", "nativewind")),
    _s("vue", "Vue", "framework"),
    _s("svelte", "Svelte", "framework"),
    _s("reanimated", "Reanimated", "framework", m=("react-native-reanimated",)),
    _s("swiftui", "SwiftUI", "framework", m=(), p=("*view.swift",)),
    _s("sqlalchemy", "SQLAlchemy", "framework"),
    _s("react_native_maps", "React Native Maps", "framework", m=("react-native-maps",)),
    # --- database
    _s(
        "postgres",
        "Postgres",
        "database",
        m=("psycopg", "psycopg2*", "asyncpg", "pg", "postgres"),
        c=(r"\b(psql|pg_isready|pg_dump)\b",),
    ),
    _s("sqlite", "SQLite", "database", m=("better-sqlite3", "expo-sqlite"), c=(r"\bsqlite3\b",)),
    _s("redis", "Redis", "database", m=("redis", "ioredis"), c=(r"redis-cli",)),
    _s("mongodb", "MongoDB", "database", m=("mongodb", "mongoose"), c=(r"mongosh",)),
    _s("mysql", "MySQL", "database", m=("mysql2", "pymysql")),
    # --- infra
    _s(
        "docker",
        "Docker",
        "infra",
        m=(),
        # `*/dockerfile.*`: RideGT keeps `Dockerfile.frontend`, `Dockerfile.grafana` and
        # `Dockerfile.prometheus` beside `backend/Dockerfile`.
        p=("*/dockerfile", "*/dockerfile.*", "*docker-compose*"),
        c=(r"\bdocker\b",),
    ),
    _s("railway", "Railway", "infra", m=(), p=("*/railway.*",), c=(r"\brailway\b",)),
    _s(
        "vercel",
        "Vercel",
        "infra",
        m=("vercel", "@vercel/*"),
        p=("*/vercel.json",),
        c=(r"\bvercel\b",),
    ),
    _s(
        "cloudflare",
        "Cloudflare",
        "infra",
        m=("wrangler",),
        p=("*/wrangler.*",),
        c=(r"\bwrangler\b",),
    ),
    _s("aws", "AWS", "infra", m=("boto3", "@aws-sdk/*"), c=(r"\baws\s",)),
    _s("github_actions", "GitHub Actions", "infra", m=(), p=("*/.github/workflows/*",)),
    _s(
        "eas",
        "EAS",
        "infra",
        m=(),
        p=("*/eas.json",),
        # `eas-cli`: the design's `\beas\s` cannot see `npx eas-cli ...` because of the
        # hyphen. MEASURED on the corpus: 97 calls in 22 sessions without it, 135 in 32.
        c=(r"\beas(-cli)?(@\S+)?\s",),
    ),
    _s("fly", "Fly.io", "infra", m=(), p=("*/fly.toml",), c=(r"\bfly(ctl)?\s",)),
    _s(
        "prometheus",
        "Prometheus",
        "infra",
        m=("prometheus-client", "prometheus-fastapi-instrumentator", "prom-client"),
        p=("*/prometheus*",),
        c=(r"\bprometheus\b",),
    ),
    _s("grafana", "Grafana", "infra", m=(), p=("*/grafana*",), c=(r"\bgrafana\b",)),
    _s(
        "google_cloud",
        "Google Cloud",
        "infra",
        m=("google-cloud-*", "@google-cloud/*"),
        c=(r"\bgcloud\s",),
    ),
    # --- testing
    _s("pytest", "pytest", "testing", m=("pytest",), c=(r"\bpytest\b",)),
    _s(
        "jest",
        "Jest",
        "testing",
        # `jest-*`: RideGT's mobile app depends on `jest-expo`, a Jest preset, not `jest`.
        m=("jest", "jest-*"),
        c=(r"\bjest\b",),
    ),
    _s("vitest", "Vitest", "testing", c=(r"\bvitest\b",)),
    _s("bun_test", "bun test", "testing", m=(), c=(r"\bbun test\b",)),
    _s("playwright", "Playwright", "testing", m=("playwright", "@playwright/test")),
    _s("xctest", "XCTest", "testing", m=(), c=(r"\bswift test\b",), p=("*tests.swift",)),
    _s("cypress", "Cypress", "testing"),
    _s("maestro", "Maestro", "testing", m=(), p=("*.maestro/*",), c=(r"\bmaestro\b",)),
    _s("locust", "Locust", "testing", m=("locust",), p=("*/locustfile.py",), c=(r"\blocust\b",)),
    # --- tooling
    _s("git", "Git", "tooling", m=(), c=(r"\bgit\s",)),
    _s("bun", "Bun", "tooling", m=("bun-types", "@types/bun"), p=("*/bun.lock",), c=(r"\bbun\s",)),
    _s("npm", "npm", "tooling", m=(), p=("*/package-lock.json",), c=(r"\bnpm\s", r"\bnpx\s")),
    _s("uv", "uv", "tooling", m=(), p=("*/uv.lock",), c=(r"\buv\s",)),
    _s("ruff", "Ruff", "tooling", m=("ruff",), c=(r"\bruff\b",)),
    _s("eslint", "ESLint", "tooling", m=("eslint", "eslint-config-*"), c=(r"\beslint\b",)),
    _s("prettier", "Prettier", "tooling", c=(r"\bprettier\b",)),
    _s("make", "Make", "tooling", m=(), p=("*/makefile",)),
    _s(
        "xcode",
        "Xcode",
        "tooling",
        m=(),
        # `xcrun`: MEASURED on the corpus, 151 shell calls in 32 sessions drive the
        # simulator through `xcrun simctl`, against 3 `xcodebuild` calls in 3.
        c=(r"\bxcodebuild\b", r"\bxcrun\b"),
        p=("*.xcodeproj*", "*.xcworkspace*"),
    ),
    _s(
        "android_sdk",
        "Android SDK",
        "tooling",
        m=(),
        # MEASURED on the corpus: 68 `adb` calls in 5 sessions of the Android port.
        c=(r"\badb\b", r"\bgradlew\b", r"\bemulator -avd\b"),
        p=("*/androidmanifest.xml", "*.gradle", "*.gradle.kts"),
    ),
    _s(
        "cocoapods",
        "CocoaPods",
        "tooling",
        m=(),
        c=(r"\bpod (install|update)\b",),
        p=("*/podfile",),
    ),
    _s("alembic", "Alembic", "tooling", m=("alembic",), c=(r"\balembic\b",), p=("*/alembic/*",)),
    # --- service
    # Never by an MCP tool name (`mcp__*posthog*` used to put it here): which MCP servers a
    # person runs is never on the wire (privacy/upload-contract.json lists MCP server names
    # as never present), and a stack item a tool name alone put there carried the server's
    # identity in its id and its `sessions` (FOUND IN REVIEW, 2026-09-13).
    _s("posthog", "PostHog", "service", m=("posthog*", "@posthog/*")),
    _s("stripe", "Stripe", "service"),
    _s("sentry", "Sentry", "service", m=("@sentry/*", "sentry-sdk")),
    _s("openai", "OpenAI", "service"),
    _s("anthropic", "Anthropic", "service", m=("anthropic", "@anthropic-ai/sdk")),
    _s(
        "supabase",
        "Supabase",
        "service",
        m=("@supabase/*",),
        c=(r"\bsupabase\s",),
        p=("*/supabase/*",),
    ),
    _s(
        "firebase",
        "Firebase",
        "service",
        m=("firebase*", "@react-native-firebase/*"),
        # `google-services.json` is the Firebase console's Android config. MEASURED:
        # RideGT has no firebase dependency in any manifest and does have that file, and
        # one sitting ran 11 `firebase` commands against its project.
        c=(r"\bfirebase\s",),
        p=(
            "*/google-services.json",
            "*/googleservice-info.plist",
            "*/firebase.json",
            "*/.firebaserc",
        ),
    ),
    _s("mapbox", "Mapbox", "service", m=("@rnmapbox/maps", "mapbox-gl")),
    _s(
        "google_maps",
        "Google Maps Platform",
        "service",
        m=("@googlemaps/*", "googlemaps"),
        # By host, never by the words: MEASURED on the corpus, 0 calls. RideGT calls
        # these APIs from its code, and every shell mention of "google maps" was an echo
        # label or a grep pattern, which a looser regex would have counted as use.
        c=(r"\b(maps|routes|places)\.googleapis\.com\b",),
    ),
    _s(
        "valhalla",
        "Valhalla",
        "service",
        m=(),
        # MEASURED on the corpus: 126 shell calls in 17 sessions.
        c=(r"\bvalhalla\b",),
        p=("*valhalla*",),
    ),
    _s(
        "transloc",
        "TransLoc",
        "service",
        m=(),
        # MEASURED on the corpus: 41 shell calls in 19 sessions read the transit feed
        # RideGT is built on.
        c=(r"\btransloc\b",),
        p=("*transloc*",),
    ),
    # `app_store_connect` was detected only by its MCP server's tool names, and is gone for
    # the reason above `posthog`.
)


# ----------------------------------------------------------------------------- matching


#: Lowercased posix path, rooted (`patterns.rooted_path`), so `*/name` globs also match a
#: top level file.
_norm_path = patterns.rooted_path

#: Claude Code's own files are never the project's. The rule and its measurements live in
#: `patterns` beside `_wrote`, where every count of project work reads them
#: (`patterns.harness_path`, `patterns.harness_event`); these names are the same functions.
_harness = patterns.harness_path
_harness_event = patterns.harness_event

#: Each event once (`patterns.distinct_events`): a resumed session's transcript carries a
#: copy of the old one's records, and the sessionizer pools both.
_distinct = patterns.distinct_events


#: The tail `digest._trunc` leaves on a command it cut at `digest.COMMAND_MAX` characters
#: (`…[+N]`, N the characters dropped; `digest.is_cut`). Every loader cuts shell commands
#: there, so what a command ran after the cut is not in `Ev.text` and no detector here can
#: see it, which makes every command count a LOWER BOUND. MEASURED on the corpus: 6,581 of
#: 8,981 shell calls (73%), in 154 of 157 sessions, are cut. Recomputed from the raw JSONL,
#: `git commit` ran in 320 calls in 96 sessions and the cut text shows 147 calls in 71;
#: read whole, `test_suite` is 809 calls in 90 sessions against 381 in 79, four locked
#: terms unlock, and 45 of 157 titles change (21 "Debugged" become 45). It cannot be
#: repaired here, because the command is gone before this module sees it (the fix belongs
#: where `Ev.text` is made), so every result carries `shell_calls` and `shell_calls_cut`
#: beside its counts: coverage, measured, and no verdict.


def _shell_coverage(events: Sequence) -> tuple[int, int]:
    """(shell calls, how many of them the digest cut) among `events`."""
    shell = [e for e in events if e.kind == "tool" and e.tool in digest.SHELL_TOOLS]
    return len(shell), sum(1 for e in shell if digest.is_cut(e.text))


def _command_lines(text: str) -> tuple[str, ...]:
    """Every command line of a shell call, heredoc bodies skipped (`digest.shell_lines`)."""
    return tuple(digest.shell_lines(text))


#: A simple command that only asks whether a program EXISTS, or a comment. Neither runs
#: anything. MEASURED on the corpus: without this, `which maestro idb xcodebuild` and
#: `command -v vercel npx` credit Maestro, npm and the build and end to end test terms with
#: one session each in which none of them ran.
_PROBE = re.compile(r"^(#|(which|whereis|type|command\s+-[vV])\b)")

#: A simple command that only asks a program for its version or its help text: the same
#: question as `which`, asked of the program itself. MEASURED on the corpus:
#: `npx --no-install prettier --version` was one of the three sessions that unlocked
#: `formatter`, and `xcodebuild -version` two of the 35 that put Xcode on the stack.
_VERSION_PROBE = re.compile(r"(?:^|\s)(?:--version|-version|--help)(?=\s|$)")

#: A search: its arguments are a PATTERN and the places to look, data like an echo's
#: words, so only the program's own name is kept (the `regex` term reads it) and what it
#: runs inside `$(...)`. MEASURED on the corpus: `grep -n "jwt" builder/settings.py` was
#: the only `jwt` unlock; `grep -vE '^npm install|^Proceeding'`, a filter on eas output,
#: 4 of the 16 `package_manager` sessions; `grep -i "uvicorn"` 5 of the 43 `server`
#: sessions; and `find . -name "vercel.json"` counted as a deploy.
_SEARCH = re.compile(r"^(?:xargs\s+(?:-\S+\s+)*)?(grep|egrep|fgrep|rg|ag|ack|find|fd)\b")

#: `echo` and `printf` print their words, which are a label: data, like a heredoc body.
#: What they RUN is inside `$(...)` (`echo "pid: $(adb shell pidof ...)"`), and only that
#: is read. MEASURED on the corpus: labels such as `echo "=== transloc sig ==="` credited
#: TransLoc with 4 of its 23 sessions and Docker with 2 of 13, and Valhalla, EAS, Maestro
#: and four terms with one session each, in which none of them ran.
_PRINTS = re.compile(r"^(echo|printf)\b")
_SUBSTITUTION = re.compile(r"\$\(([^()]*)\)")


#: One command line split at unquoted separators: `digest.split_simple`, the one splitter
#: `vocab` and `live` read.
_split_simple = digest.split_simple


def _probe(seg: str) -> bool:
    """Runs nothing: an existence probe, a comment, or a version or help request."""
    return bool(_PROBE.match(seg) or _VERSION_PROBE.search(seg))


def _simple_commands(line: str) -> list[str]:
    out: list[str] = []
    for seg in _split_simple(line):
        if _probe(seg):
            continue
        search = _SEARCH.match(seg)
        if search or _PRINTS.match(seg):
            if search:
                out.append(search.group(1))
            # What runs inside `$(...)` is read by these same rules. `_SUBSTITUTION`
            # only matches a `$(...)` with no parenthesis inside, so this recursion
            # goes one level deep and stops.
            for inner in _SUBSTITUTION.findall(seg):
                out.extend(_simple_commands(inner))
            continue
        out.append(seg)
    return out


def _command_segments(text: str) -> tuple[str, ...]:
    """Every simple command a shell call ran: heredoc bodies skipped, each line split at
    its separators, probes and comments dropped, a search reduced to its program's name,
    and an `echo` or `printf` read only for the `$(...)` it runs. What a command detector
    reads."""
    return tuple(seg for line in _command_lines(text) for seg in _simple_commands(line))


def _compile_cmd(rx) -> re.Pattern:
    return rx if isinstance(rx, re.Pattern) else re.compile(rx, re.I)


def _compile_err(rx) -> re.Pattern:
    return rx if isinstance(rx, re.Pattern) else re.compile(rx)


@dataclasses.dataclass(frozen=True)
class _Facets:
    """What one event offers the detectors, computed once per event."""

    ts: float
    kind: str
    tool: str | None
    path: str | None  # `_norm_path`, project tool events only
    raw_path: str | None
    lines: tuple[str, ...]  # `_command_segments`, shell calls only
    error: str | None  # failing result text


def _facets(e) -> _Facets:
    is_tool = e.kind == "tool"
    norm = _norm_path(e.path) if is_tool and e.path else None
    if norm is not None and _harness_event(e):
        norm = None
    return _Facets(
        ts=e.ts,
        kind=e.kind,
        tool=e.tool if is_tool else None,
        path=norm,
        raw_path=e.path if norm is not None else None,
        lines=_command_segments(e.text) if is_tool and e.tool in digest.SHELL_TOOLS else (),
        error=(e.text or "") if e.kind == "result_error" else None,
    )


class _Detectors:
    """One detector set, compiled once. Shared by `Term` and `StackItem` so a glob or a
    command regex means the same thing in the glossary and on the stack page."""

    def __init__(self, *, paths=(), commands=(), tools=(), roles=(), kinds=(), errors=()):
        self.paths = tuple(paths)
        self.commands = tuple(_compile_cmd(c) for c in commands)
        self.tools = tuple(tools)
        self.roles = frozenset(roles)
        self.kinds = frozenset(kinds)
        self.errors = tuple(_compile_err(x) for x in errors)

    def fired(self, f: _Facets, role: str | None) -> frozenset[str]:
        """Which detector types matched this event: command, path, tool, role, kind, error."""
        out = set()
        if (
            self.commands
            and f.lines
            and any(rx.search(ln) for rx in self.commands for ln in f.lines)
        ):
            out.add("command")
        if self.paths and f.path and any(fnmatch.fnmatchcase(f.path, g) for g in self.paths):
            out.add("path")
        if self.tools and f.tool and any(fnmatch.fnmatchcase(f.tool, g) for g in self.tools):
            out.add("tool")
        if self.roles and role is not None and role in self.roles:
            out.add("role")
        if self.kinds and f.kind in self.kinds:
            out.add("kind")
        if self.errors and f.error is not None and any(rx.search(f.error) for rx in self.errors):
            out.add("error")
        return frozenset(out)


_TERM_DETECTORS: dict[str, _Detectors] = {
    t.id: _Detectors(
        paths=t.paths,
        commands=t.commands,
        tools=t.tools,
        roles=t.roles,
        kinds=t.kinds,
        errors=t.errors,
    )
    for t in CATALOG
}
_NEEDS_ROLE = any(t.roles for t in CATALOG)

_STACK_DETECTORS: dict[str, _Detectors] = {
    s.id: _Detectors(paths=s.paths, commands=s.commands, tools=s.tools) for s in STACK
}


def _events(sessions: Sequence) -> list[tuple[int, list[_Facets], list]]:
    """(session index, facets, the events) for every session that has events, each event
    once (`_distinct`)."""
    out = []
    for i, s in enumerate(sessions):
        if not s.events:
            continue
        evs = _distinct(s.events)
        out.append((i, [_facets(e) for e in evs], evs))
    return out


# ----------------------------------------------------------------------------- glossary


def glossary(sessions: Sequence[patterns.SessionEvents]) -> dict:
    """Every catalog term your own sessions have encountered, in the order you met them.

    Returns `{"terms": [{id, word, definition, first_seen_ts, sessions, count}],
    "locked_count", "catalog_size", "basis", "n", "shell_calls", "shell_calls_cut",
    "reason"}`. `count` is events that matched (an event matching two detectors of one
    term counts once); `sessions` is how many sittings had at least one; `n` is the
    sittings that had any event to read. `shell_calls_cut` of `shell_calls` were cut by
    the digest (`digest.is_cut`), so a command term's `count` and `sessions` are lower bounds and a
    locked term may have happened after a cut.

    Nothing read is a refusal, not an empty glossary: `locked_count` is None and `reason`
    says why, because "74 more to find" over zero sessions is a claim about a person the
    data never saw. Sessions that were read and matched nothing are a measured zero:
    `terms` is empty and `locked_count` is the catalog size.
    """
    read = _events(sessions)
    shell = _shell_coverage([e for _, _, evs in read for e in evs])
    base = {
        "catalog_size": len(CATALOG),
        "basis": "catalog_detectors_over_session_events",
        "n": len(read),
        "shell_calls": shell[0],
        "shell_calls_cut": shell[1],
    }
    if not read:
        return {
            "terms": [],
            "locked_count": None,
            **base,
            "reason": "no session had any events to read",
        }

    first: dict[str, float] = {}
    count: collections.Counter[str] = collections.Counter()
    seen_in: dict[str, set[int]] = collections.defaultdict(set)
    for idx, facets, _ in read:
        for f in facets:
            role = plain.role_of(f.raw_path) if _NEEDS_ROLE and f.raw_path else None
            for term in CATALOG:
                if not _TERM_DETECTORS[term.id].fired(f, role):
                    continue
                count[term.id] += 1
                seen_in[term.id].add(idx)
                if term.id not in first or f.ts < first[term.id]:
                    first[term.id] = f.ts

    order = {t.id: i for i, t in enumerate(CATALOG)}
    unlocked = sorted(first, key=lambda tid: (first[tid], order[tid]))
    by_id = {t.id: t for t in CATALOG}
    terms = [
        {
            "id": tid,
            "word": by_id[tid].word,
            "definition": by_id[tid].definition,
            "first_seen_ts": first[tid],
            "sessions": len(seen_in[tid]),
            "count": count[tid],
        }
        for tid in unlocked
    ]
    return {"terms": terms, "locked_count": len(CATALOG) - len(terms), **base, "reason": None}


# ----------------------------------------------------------------------------- titles

#: Every verb a title can lead with, in the order the rules are tried.
VERBS = (
    "debugged",
    "wired",
    "refactored",
    "shipped",
    "committed",
    "tested",
    "built",
    "explored",
    "worked_through",
    "edited",
    "looked_around",
)

#: What a title is about: a file role, or one of four things that are not files.
OBJECTS = (*plain.ROLES, "test_suite", "commit", "failure", "codebase")

#: Why a sitting has no title, as the code the wire carries (contract v4 `title_refusal`,
#: `title_ids.reason`) beside the prose `reason` this module writes for a person on the
#: machine. FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): a refusal went on the wire as null,
#: which also means "not computed", so the server could not tell a refused final cut from
#: a client that computes no titles and kept the live cut's title forever. In the order
#: `session_title` tries them; server/tests/test_contract.py reads every `_refused` call.
TITLE_REFUSALS = (
    "no_tool_calls",
    "writes_name_no_file",
    "harness_files_only",
    "below_checkpoint_density",
)

#: A refactor touches this many files. UNMEASURED JUDGEMENT CALL (the design's).
REFACTOR_MIN_FILES = 5

#: And adds at least this many lines, so a rename across five files is not a refactor.
#: UNMEASURED JUDGEMENT CALL (the design's).
REFACTOR_MIN_ADDED = 20

#: Test runs before a session reads as building out tests. UNMEASURED JUDGEMENT CALL.
TESTED_MIN_RUNS = 3

#: Lines added before a session reads as building something. UNMEASURED JUDGEMENT CALL.
BUILT_MIN_LINES = 100

#: Reads with nothing written before a session reads as exploring: the floor of the
#: `investigated` cause in `burn.Segment.causes`, read from burn rather than restated.
EXPLORED_MIN_READS = burn.INVESTIGATED_MIN_READS


def _noun(role: str, n: int) -> str:
    """`plain.ROLE_NOUN`, with the count spoken: "a test file", "three test files"."""
    one, many, _ = plain.ROLE_NOUN[role]
    return one if n == 1 else many.format(n=plain.spoken(n))


def _top_role(lines: Mapping[str, int], files: Mapping[str, Mapping]) -> str:
    """The role with the most lines, then the most files; ties to `plain.ROLES` order.

    Lines first because a title names what most of the work was; files second because a
    session whose writes only deleted lines (an Edit that adds none) still has a role.
    The tie break is an UNMEASURED JUDGEMENT CALL and only has to be deterministic.
    """
    rank = {r: i for i, r in enumerate(plain.ROLES)}
    return min(files, key=lambda r: (-lines.get(r, 0), -len(files[r]), rank.get(r, len(rank))))


def _common_dir(paths) -> str | None:
    """Basename of the most common parent directory over distinct paths, ties to the first."""
    tally: collections.Counter[str] = collections.Counter()
    for p in dict.fromkeys(paths):
        d = posixpath.basename(posixpath.dirname(p.replace("\\", "/")))
        if d:
            tally[d] += 1
    return tally.most_common(1)[0][0] if tally else None


def _refused(n: int, reason: str, shell: tuple[int, int] = (0, 0), *, code: str) -> dict:
    assert code in TITLE_REFUSALS, code
    return {
        "title": None,
        "verb": None,
        "object": None,
        "count": None,
        "modules": None,
        "basis": None,
        "n": n,
        "shell_calls": shell[0],
        "shell_calls_cut": shell[1],
        "reason": reason,
        "code": code,
    }


def session_title(session: patterns.SessionEvents, *, names: bool = False) -> dict:
    """One line in engineer voice for one session, from the first rule its events satisfy.

    Returns `{title, verb, object, count, modules, basis, n, shell_calls,
    shell_calls_cut, reason}`. `verb` is one of `VERBS`, `object` one of `OBJECTS`,
    `count` the number behind the title (files of the named role, migrations, commits,
    recoveries, or failures in a row; None for `looked_around`), `modules` the distinct
    parent directories of written files (the refactor title's second number), `n` the
    tool calls read, and `shell_calls_cut` how many of its `shell_calls` the digest cut
    (`digest.is_cut`): commits, test runs and recoveries after a cut are not seen. The phone can
    render every title from those fields alone.

    FOUR REFUSALS. Two are of a title that would describe the parser rather than the
    work, two of a session whose writes cannot be titled (writes that name no file, and
    writes that only reached Claude Code's own scratch or notes):

      * no tool calls at all: "Looked around the codebase" is a claim about work, and
        there was none to read;
      * a sitting of at least `feedback.MIN_TOOL_CALLS` calls whose checkpoints (a
        visible write, test or commit) fall below `patterns.MIN_CHECKPOINT_DENSITY`,
        when the only titles left are the two that mean "changed nothing" (`explored`,
        `looked_around`). The same bar and the same reason as the session note that
        refuses "went nowhere" (feedback.py): an edit made by a script the agent wrote
        (`python3 - <<'PY'`) is a shell call with no line count anywhere in it. MEASURED
        on the corpus: 1,183 simple commands in 88 sessions are `python3 -`, and 9 of the
        47 sittings the design's rules called "Looked around the codebase" had committed.

    A sitting that committed with no line count the parser can see is titled by its
    commits (`committed`, "Landed three commits") rather than falling through to a
    title that says it only read: the commit is visible even when the edits are not.

    WHAT A TITLE COUNTS is the project's work: a file under Claude Code's own state
    (`patterns.harness_event`: the scratchpad, memory notes) is neither counted nor named, though
    the call that wrote it still counts toward `n` and the checkpoint bar, because the
    parser did see it; and a tool call copied into a resumed transcript is one call
    (`_distinct`). `modules` is None when no project file was written: zero directories
    is a claim the events cannot make when the edits were invisible.

    `names=True` is LOCAL: it appends the most common parent directory's name.
    """
    session = dataclasses.replace(session, events=_distinct(session.events))
    events = list(session.events)
    calls = [e for e in events if e.kind == "tool"]
    if not calls:
        return _refused(
            0, "no tool calls in this session, so there is no work to title", code="no_tool_calls"
        )

    writes = [e for e in calls if patterns._wrote(e) and not _harness_event(e)]
    scratch = {e.path for e in calls if patterns._wrote(e) and _harness_event(e)}
    added = sum(e.added or 0 for e in writes)
    removed = sum(e.removed or 0 for e in writes)
    # Files per role as insertion ordered dicts, never sets: `names=True` breaks a tie
    # between directories by first appearance, and a set's order changes between runs.
    w_lines: collections.Counter[str] = collections.Counter()
    w_files: dict[str, dict[str, None]] = collections.defaultdict(dict)
    written: list[str] = []
    for e in writes:
        if not e.path:
            continue
        role = plain.role_of(e.path)
        w_lines[role] += e.added or 0
        w_files[role][e.path] = None
        written.append(e.path)
    modules = {posixpath.dirname(p.replace("\\", "/")) for p in written}
    n_files = len(set(written))

    reads = [e for e in calls if e.tool in digest.READ_TOOLS and not _harness_event(e)]
    r_count: collections.Counter[str] = collections.Counter()
    r_files: dict[str, dict[str, None]] = collections.defaultdict(dict)
    for e in reads:
        if e.path:
            role = plain.role_of(e.path)
            r_count[role] += 1
            r_files[role][e.path] = None

    commits = sum(1 for e in calls if patterns._committed(e))
    tests = sum(1 for e in calls if patterns._tested(e))
    recovered = len(quality.recoveries([session]))
    fail_run = feedback._worst_failure_run(session)[0]
    checkpoints = sum(1 for e in calls if patterns._checkpoint(e))
    blind = (
        len(calls) >= feedback.MIN_TOOL_CALLS
        and checkpoints / len(calls) < patterns.MIN_CHECKPOINT_DENSITY
    )
    # Commits, test runs and recoveries are read off shell text the digest may have cut
    # (`digest.is_cut`): the title says how many of its shell calls it could only partly read.
    shell = _shell_coverage(calls)

    def answer(title, verb, obj, count, basis, about=()):
        if names:
            where = _common_dir(about)
            if where:
                title = f"{title} in {where}"
        return {
            "title": title,
            "verb": verb,
            "object": obj,
            "count": count,
            "modules": len(modules) if modules else None,
            "basis": basis,
            "n": len(calls),
            "shell_calls": shell[0],
            "shell_calls_cut": shell[1],
            "reason": None,
            "code": None,
        }

    if recovered >= 1:
        return answer(
            "Debugged a failing test suite",
            "debugged",
            "test_suite",
            recovered,
            "failing_test_run_then_passing",
            written,
        )
    if w_files.get("migration"):
        k = len(w_files["migration"])
        return answer(
            f"Wired {_noun('migration', k)}",
            "wired",
            "migration",
            k,
            "writes_to_migration_role_files",
            w_files["migration"],
        )
    if n_files >= REFACTOR_MIN_FILES and added >= REFACTOR_MIN_ADDED and 2 * removed >= added:
        top = _top_role(w_lines, w_files)
        where = (
            f"across {plain.spoken(len(modules))} modules" if len(modules) != 1 else "in one module"
        )
        return answer(
            f"Refactored {plain.spoken(n_files)} files {where}",
            "refactored",
            top,
            n_files,
            "files_modules_and_lines_removed_against_added",
            written,
        )
    if commits >= 1 and added > 0 and w_files:
        top = _top_role(w_lines, w_files)
        k = len(w_files[top])
        lead = "Shipped a change to" if k == 1 else "Shipped changes to"
        return answer(
            f"{lead} {_noun(top, k)}",
            "shipped",
            top,
            k,
            "commits_and_lines_by_file_role",
            w_files[top],
        )
    if commits >= 1:
        return answer(
            "Landed a commit" if commits == 1 else f"Landed {plain.spoken(commits)} commits",
            "committed",
            "commit",
            commits,
            "commits_with_no_visible_line_count",
            written,
        )
    test_lines = w_lines.get("test", 0)
    if tests >= TESTED_MIN_RUNS and test_lines > 0 and 2 * test_lines >= added:
        k = len(w_files["test"])
        return answer(
            f"Built out {_noun('test', k)}",
            "tested",
            "test",
            k,
            "test_runs_and_test_role_lines",
            w_files["test"],
        )
    if added >= BUILT_MIN_LINES and w_files:
        top = _top_role(w_lines, w_files)
        k = len(w_files[top])
        return answer(
            f"Built out {_noun(top, k)}", "built", top, k, "lines_by_file_role", w_files[top]
        )
    if not writes and not blind and len(reads) >= EXPLORED_MIN_READS and r_files:
        top = _top_role(r_count, r_files)
        k = len(r_files[top])
        return answer(
            f"Read through {_noun(top, k)}", "explored", top, k, "reads_by_file_role", r_files[top]
        )
    if fail_run >= patterns.STUCK_FAILURES:
        return answer(
            "Worked through a stubborn failure",
            "worked_through",
            "failure",
            fail_run,
            "consecutive_failed_tool_results",
            written,
        )
    if writes and w_files:
        top = _top_role(w_lines, w_files)
        k = len(w_files[top])
        return answer(
            f"Edited {_noun(top, k)}", "edited", top, k, "writes_by_file_role", w_files[top]
        )
    if writes:
        # Every write lacked a path (a harness that does not say which file a patch
        # touched). Something was written, so "looked around" would be false, and there
        # is no file to count or role to name.
        k = len(writes)
        return _refused(
            len(calls),
            ("the one write names no file" if k == 1 else f"none of the {k} writes names a file")
            + ", so there is no role to title the work by",
            shell,
            code="writes_name_no_file",
        )
    if scratch:
        # Every file written was Claude Code's own (a scratch script, a memory note).
        # Something was written, so "looked around the codebase" would say the sitting
        # only read, and nothing it wrote is the project's to count.
        k = len(scratch)
        return _refused(
            len(calls),
            (
                "the one file written was"
                if k == 1
                else "both files written were"
                if k == 2
                else f"all {k} files written were"
            )
            + " Claude Code's own scratch or notes, so there is no project work to title",
            shell,
            code="harness_files_only",
        )
    if blind:
        return _refused(
            len(calls),
            f"{checkpoints} of {len(calls)} tool calls were a write, test or commit the "
            f"transcript shows, one in {plain.rounded(1 / patterns.MIN_CHECKPOINT_DENSITY)} needed: a "
            "title would describe what the transcript hides, not the work",
            shell,
            code="below_checkpoint_density",
        )
    return answer(
        "Looked around the codebase",
        "looked_around",
        "codebase",
        None,
        "no_title_rule_fired",
        [e.path for e in reads if e.path],
    )


# ----------------------------------------------------------------------------- stack


def _manifest_hit(item: StackItem, deps: frozenset[str]) -> bool:
    for m in item.manifests:
        if m.endswith("*"):
            if any(d.startswith(m[:-1]) for d in deps):
                return True
        elif m in deps:
            return True
    return False


def stack(sessions: Sequence[patterns.SessionEvents], *, dependencies: Sequence[str] = ()) -> dict:
    """What the project is made of: catalog items with the evidence that put them there.

    Returns `{"items": [{id, name, category, first_seen_ts, sessions, evidence}], "basis",
    "n", "manifest_names", "shell_calls", "shell_calls_cut", "reason",
    "language_reason"}`. `evidence` is the first kind
    that fired in `EVIDENCE` order; `first_seen_ts` and `sessions` come from EVENTS only,
    so an item only a manifest names has `first_seen_ts` None and `sessions` 0: the
    project depends on it, and no session was seen touching it.

    `dependencies` are `shipped.stack_evidence(root)` strings. They are matched and
    dropped: a dependency the catalog does not know is not reported, and no manifest
    string appears anywhere in the result.
    """
    deps = frozenset(str(d).strip().lower() for d in dependencies if str(d).strip())
    read = _events(sessions)
    shell = _shell_coverage([e for _, _, evs in read for e in evs])
    base = {
        "basis": "catalog_detectors_over_manifests_and_session_events",
        "n": len(read),
        "manifest_names": len(deps),
        "shell_calls": shell[0],
        "shell_calls_cut": shell[1],
    }
    if not read and not deps:
        return {
            "items": [],
            **base,
            "reason": "no session events and no manifest names to read",
            "language_reason": None,
        }

    # The split runs over the project's own writes: each event once, and nothing written
    # under Claude Code's state (`patterns.harness_event`), where an agent's scratch scripts and
    # the HTML pages it renders for itself are not what the project is made of.
    project = [
        dataclasses.replace(
            sessions[idx], events=[e for e in evs if not (e.kind == "tool" and _harness_event(e))]
        )
        for idx, _, evs in read
    ]
    split = languages.split(project) if read else None
    named = {row["name"] for row in (split or {}).get("languages") or []}
    language_reason = None if split is None else split.get("reason")

    fired: dict[str, set[str]] = collections.defaultdict(set)
    first: dict[str, float] = {}
    seen_in: dict[str, set[int]] = collections.defaultdict(set)

    def hit(item_id: str, kinds, ts: float, idx: int) -> None:
        fired[item_id].update(kinds)
        seen_in[item_id].add(idx)
        if item_id not in first or ts < first[item_id]:
            first[item_id] = ts

    by_language = {s.language: s for s in STACK if s.language and s.language in named}
    for idx, facets, evs in read:
        for f, e in zip(facets, evs, strict=True):
            # Language evidence is exactly the set the split above sums: a project write
            # with a path and a line count, in a language that is not generated.
            if by_language and patterns._wrote(e) and e.path and e.added and not _harness_event(e):
                lang = languages.language_of(e.path)
                if lang in by_language:
                    hit(by_language[lang].id, ("language",), f.ts, idx)
            for item in STACK:
                kinds = _STACK_DETECTORS[item.id].fired(f, None)
                if kinds:
                    hit(item.id, kinds, f.ts, idx)

    order = {s.id: i for i, s in enumerate(STACK)}
    cat_rank = {c: i for i, c in enumerate(CATEGORIES)}
    items = []
    for item in STACK:
        kinds = set(fired.get(item.id, ()))
        if _manifest_hit(item, deps):
            kinds.add("manifest")
        if not kinds:
            continue
        items.append(
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "first_seen_ts": first.get(item.id),
                "sessions": len(seen_in.get(item.id, ())),
                "evidence": next(k for k in EVIDENCE if k in kinds),
            }
        )
    items.sort(key=lambda r: (cat_rank[r["category"]], -r["sessions"], order[r["id"]]))
    return {"items": items, **base, "reason": None, "language_reason": language_reason}


# ----------------------------------------------------------------------------- wire

_GLOSSARY_TERM_WIRE = ("id", "word", "first_seen_ts", "sessions", "count")
_GLOSSARY_WIRE = (
    "locked_count",
    "catalog_size",
    "basis",
    "n",
    "shell_calls",
    "shell_calls_cut",
    "reason",
)
_STACK_ITEM_WIRE = ("id", "name", "category", "first_seen_ts", "sessions", "evidence")
_STACK_WIRE = (
    "basis",
    "n",
    "manifest_names",
    "shell_calls",
    "shell_calls_cut",
    "reason",
    "language_reason",
)
_TITLE_WIRE = (
    "verb",
    "object",
    "count",
    "modules",
    "basis",
    "n",
    "shell_calls",
    "shell_calls_cut",
    "reason",
)


def wire(result: Mapping) -> dict:
    """The uploadable form of anything this module returns, or of a bundle of them
    (`{"glossary": ..., "stack": ..., "titles": [...]}`).

    Kept: ids, catalog words and names, enums, counts, timestamps and reasons. Dropped:
    every definition and every title, which are rendered strings (the phone renders its
    own words from the ids, docs/overnight-engine.md 0 rule 5), and with the title the one
    LOCAL string this module can produce, the directory name `names=True` appends.

    An unrecognised shape raises instead of passing through: a result this function does
    not know is a result nobody checked for what it carries.
    """
    if "terms" in result:
        return {
            "terms": [{k: t[k] for k in _GLOSSARY_TERM_WIRE} for t in result["terms"]],
            **{k: result.get(k) for k in _GLOSSARY_WIRE},
        }
    if "items" in result:
        return {
            "items": [{k: i[k] for k in _STACK_ITEM_WIRE} for i in result["items"]],
            **{k: result.get(k) for k in _STACK_WIRE},
        }
    if "verb" in result:
        return {k: result.get(k) for k in _TITLE_WIRE}
    bundle_keys = {"glossary", "stack", "titles"}
    if result and set(result) <= bundle_keys:
        out: dict = {}
        if "glossary" in result:
            out["glossary"] = wire(result["glossary"])
        if "stack" in result:
            out["stack"] = wire(result["stack"])
        if "titles" in result:
            out["titles"] = [wire(t) for t in result["titles"]]
        return out
    raise ValueError(f"vocab.wire: unrecognised result keys {sorted(result)}")


__all__ = [
    "BUILT_MIN_LINES",
    "CATALOG",
    "CATEGORIES",
    "EVIDENCE",
    "EXPLORED_MIN_READS",
    "OBJECTS",
    "REFACTOR_MIN_ADDED",
    "REFACTOR_MIN_FILES",
    "STACK",
    "StackItem",
    "TESTED_MIN_RUNS",
    "TITLE_REFUSALS",
    "Term",
    "VERBS",
    "glossary",
    "session_title",
    "stack",
    "wire",
]

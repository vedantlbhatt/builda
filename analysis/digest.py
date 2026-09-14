"""Turn a Claude Code transcript into a digest small enough to analyse and honest enough
to trust.

The digest is the ONLY thing the analysis model sees. Three rules shape it:

1. Every human prompt is included, verbatim (bounded per prompt). Prompts are the
   steering signal and there are few of them — MEASURED 1,456 typed prompts against
   23,838 tool calls in the reference corpus — so they are never sampled out.
2. Every error is included. Friction is what a person most wants explained.
3. Everything else degrades gracefully under a character budget: assistant text is
   truncated, then runs of tool calls collapse into one line, then the middle of the
   session is thinned. `coverage` reports how much survived, and the model is told.

Nothing here reads thinking blocks. They are the model's scratch space, they are the
bulk of the bytes, and a person reading their own recap does not want them quoted back.

Secrets are masked before anything is written: the digest is local, but the analysis it
produces can be uploaded, and a model will happily copy a token into a "friction" note.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import hashlib
import itertools
import json
import pathlib
import re
from collections import Counter

INTERRUPT_PREFIX = "[Request interrupted by user"

PROMPT_MAX = 1_400
ASSISTANT_MAX = 320
ASSISTANT_MAX_TIGHT = 120
COMMAND_MAX = 160
ERROR_MAX = 240
DEFAULT_BUDGET = 60_000  # characters; ~15k tokens

# Tool names that mean "ran a shell command" / "edited a file" per harness. Claude Code's
# names come first; the Codex names are documented in analysis/codex.py, the Gemini names
# in analysis/gemini.py, the Cline names (`execute_command` / `write_to_file` /
# `replace_in_file`, plus the SDK-era `run_commands` / `editor`) in analysis/cline.py, the
# opencode names (`bash` — the shell tool keeps that id for compatibility — `edit`, `write`,
# `apply_patch`) in analysis/opencode.py, the Aider names (`run` for `/run` / `/test` /
# `!` / an LLM-suggested command Aider ran, `apply_edit` for an `Applied edit to` line —
# Aider has no tool protocol, so these are the loader's names) in analysis/aider.py.
# Membership here is what `stats` keys commits, test runs and files-edited on, so a harness
# whose shell tool is missing from this set reports zero commits on a session that ran
# twenty.
SHELL_TOOLS = frozenset(
    {
        "Bash",
        "shell",
        "exec_command",
        "local_shell",
        "shell_command",
        "run_shell_command",
        "execute_command",
        "run_commands",
        "bash",
        "run",
    }
)
EDIT_TOOLS = frozenset(
    {
        "Edit",
        "Write",
        "MultiEdit",
        "NotebookEdit",
        "apply_patch",
        "write_file",
        "replace",
        "write_to_file",
        "replace_in_file",
        "editor",
        "edit",
        "write",
        "apply_edit",
    }
)

# Tools that ARE a git commit, not a shell line that may contain one. Aider commits through
# GitPython and writes `Commit <sha> <message>` (analysis/aider.py `commit`); the `git commit`
# regex over shell text cannot see it, and auto-commits are the point of that harness.
COMMIT_TOOLS = frozenset({"commit"})

# A shell line that commits: `git commit`, and `git` with its OWN options before the
# subcommand (`git -c user.name=x commit`, `git -C repo commit`, `git --no-pager commit`).
# THE one definition: `stats` below, `patterns._committed` (burn, feedback, live, vocab,
# shipped) and `BuilderAnalysis.Digest.gitCommit` in Swift all read this pattern.
# FOUND IN THE DEFECTS PASS (2026-09-14): `\bgit commit\b` missed every `git -c ... commit`,
# 23 of the 172 commit calls in the overnight corpus's 160 counted sittings and 4 of 7 in
# one RideGT sitting (60256e3a), whose card then said three stretches had "nothing written,
# tested or committed" across a stretch that held three of those commits.
# `commit` must end the word: `git -c commit.gpgsign=false log` is not a commit.
COMMIT_CMD = re.compile(r"\bgit(?:\s+(?:-[Cc]\s+\S+|-{1,2}[A-Za-z][\w-]*(?:=\S+)?))*\s+commit(?![\w.=-])")

# Tools that mean "read a file". FOUND BY A TEST: `files_read` keyed on Claude Code's `Read`
# alone, so every Gemini, Cline and opencode session reported zero files read — the same
# silent zero the shell/edit sets exist to prevent. Codex has no read tool (it reads through
# the shell), so a Codex session's files_read is 0 by construction, not by omission.
READ_TOOLS = frozenset({"Read", "read_file", "read_many_files", "read"})

_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['\"]?[^\s'\"]{6,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),  # JWT
    # FOUND IN REVIEW (2026-09-13): shapes the list above let through unchanged, each
    # checked on a sample string. A private key whose END line is gone (a cut paste, and
    # any PEM longer than the text kept around it) keeps its body: the rest is the key.
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*"),
    re.compile(r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}"),  # Stripe
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),  # Google API key
    re.compile(r"\bglpat-[A-Za-z0-9_\-]{16,}"),  # GitLab
    re.compile(r"\bhf_[A-Za-z0-9]{20,}"),  # Hugging Face
    re.compile(r"\bnpm_[A-Za-z0-9]{30,}"),  # npm
    re.compile(r"\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}"),  # SendGrid
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/\-]{10,}=*"),
    re.compile(r"(?i)\b(password|passwd|passcode)\s+is\s+['\"]?[^\s'\"]{4,}"),
    # Credentials in a URL (`postgres://user:pass@host`): the userinfo, scheme and host kept.
    re.compile(r"(?<=://)[^/\s:@]+:[^/\s@]+@"),
]
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def mask(text: str) -> str:
    for pat in _SECRET_PATTERNS:
        text = pat.sub("[redacted]", text)
    return _EMAIL.sub("[email]", text)


def clip(text: str, n: int) -> str:
    """`mask` THEN `_trunc`: every text a loader keeps goes through this.

    The other order is how a key leaked: a pasted PEM longer than `PROMPT_MAX` lost its END
    line to the cut, the private key rule never matched, and 1,335 characters of the key
    body stayed in the prompt the analysis model reads and in burn's segment prompts
    (FOUND IN REVIEW, 2026-09-13). Masking the whole text first sees every secret whole."""
    return _trunc(mask(text), n)


def _trunc(s: str, n: int) -> str:
    s = s.strip()
    if len(s) <= n:
        return s
    return s[: n - 12].rstrip() + f"…[+{len(s) - n + 12}]"


def _ts(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _looks_like_error(s: str) -> bool:
    """Only shapes that mean the COMMAND failed, not output that mentions failure.

    MEASURED on a 45-minute transcript: a loose keyword match ("no such file", "failed")
    flagged 20 results as errors; 17 were successful commands whose output quoted an
    error string (a `ls` of an absent optional file, a test name containing "failed").
    The harness's own `is_error` flag is authoritative when present; this is the fallback.
    """
    head = s[:400]
    return bool(
        re.search(
            r"(?m)^(Traceback \(most recent call last\)|Error:|error:|fatal:|FAILED|"
            r"npm ERR!|Exit code [1-9]\d*|Command failed|Killed|Segmentation fault)",
            head,
        )
        or re.search(r"(?m)^\w+(Error|Exception): ", head)
    )


_HEREDOC = re.compile(
    r"(?:cat|tee)\s*(?:>>?|-a\s+)?\s*(?P<path>[\w./~\-]+)\s*<<\s*-?['\"]?(?P<delim>\w+)['\"]?"
)
#: ANY heredoc opener, not only the ones that write a file. Used to SKIP bodies: see
#: `_bash_file_effect`. `<<<` is a here-STRING and takes no body, so it is excluded.
_ANY_HEREDOC = re.compile(r"(?<!<)<<(?!<)\s*-?\s*['\"]?(?P<delim>\w+)['\"]?")
_SED_I = re.compile(r"\bsed\s+-i\S*\s+.*?\s(?P<path>[\w./~\-]+\.\w+)(?:\s|$)")


def _command_lines(command: str):
    """Every line of `command` that is a COMMAND, with the heredoc bodies skipped.

    Yields `(index, line)`. A heredoc body is data: it can contain anything, including
    text that looks exactly like another shell command, and scanning it is how this parser
    read a piece of DOCUMENTATION as a file write.

    FOUND BY RUNNING IT on this repository's own corpus. CLAUDE.md contains the sentence
    "`analysis/digest.py` has read `cat > path <<'EOF'` writes since it was written", and
    that file is edited through `python3 - <<'PY' … PY`. The outer opener is not a `cat`
    or `tee` so the old scan skipped past it, found the `cat > path <<'EOF'` INSIDE the
    prose, and attributed 134 lines to a file literally named `path` — a file that has
    never existed, on a corpus of 10,487 attributable lines.
    """
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        yield i, line
        opener = _ANY_HEREDOC.search(line)
        if opener is None:
            i += 1
            continue
        # Skip the body: everything up to and including the terminator, or the rest of
        # the command when there is none (a truncated call).
        delim = opener.group("delim")
        j = i + 1
        while j < len(lines) and lines[j].strip() != delim:
            j += 1
        i = j + 1


#: `_tool_line` writes a multi line shell command on one line with this between the lines.
LINE_MARK = " ⏎ "

#: The tail `_trunc` leaves on a text it cut (`…[+N]`, N the characters dropped).
_CUT_TAIL = re.compile("…" + r"\[\+\d+\]$")


def is_cut(text: str | None) -> bool:
    """Did `_trunc` cut this text? Then its tail is gone, and no rule may read the tail's
    absence as a fact (`burn._shell_reads_only`, `live`, `vocab`'s coverage). The one
    definition of the marker, beside the function that writes it."""
    return bool(text) and _CUT_TAIL.search(text) is not None


def shell_text(text: str | None) -> str:
    """A digest shell event's text with its lines put back (`LINE_MARK` to newlines)."""
    return (text or "").replace(LINE_MARK, "\n")


def shell_lines(text: str | None) -> list[str]:
    """The command lines of a digest shell event, heredoc bodies skipped
    (`_command_lines`: a body is data)."""
    return [line for _, line in _command_lines(shell_text(text))]


def split_simple(line: str) -> list[str]:
    """One command line split at unquoted `;`, `&&`, `||`, `|` and `&`.

    Quote aware, because a separator inside quotes is data (`grep -E "a|b"`,
    `git commit -m "fix; rm x next time"`), and `&` next to a redirection (`2>&1`, `&>`)
    is not a separator. A leading `(` or `{` is dropped so an anchored rule sees the
    program first. The one splitter `vocab` (its detectors) and `live` (its decisions and
    its command word) read; `burn._split_commands` answers a different question (does the
    line write a file through a redirection) and keeps its own walk.

    FOUND IN REVIEW (2026-09-13): `live` split on a quote blind regex, so
    `git commit -m "docs: never git push --force to main"` was a force push and
    `echo "next: npm install redis"` added a dependency. MEASURED prevalence on the corpus:
    0 of 9,139 shell calls; the rule is here so the first one is not a decision card.
    """
    out: list[str] = []
    buf: list[str] = []
    quote = None
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        if quote:
            buf.append(c)
            if c == "\\" and quote == '"' and i + 1 < n:
                buf.append(line[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c == "\\" and i + 1 < n:
            buf.append(line[i : i + 2])
            i += 2
            continue
        if c in "'\"":
            quote = c
            buf.append(c)
            i += 1
            continue
        redirect = c == "&" and ((buf and buf[-1] in "<>") or (i + 1 < n and line[i + 1] == ">"))
        if c in ";|" or (c == "&" and not redirect):
            out.append("".join(buf))
            buf = []
            i += 2 if (i + 1 < n and line[i + 1] == c and c in "|&") else 1
            continue
        buf.append(c)
        i += 1
    out.append("".join(buf))
    segs = (s.strip().lstrip("({").strip() for s in out)
    return [s for s in segs if s]


# ------------------------------------------------------------------- read only commands
#
# Whether a shell command can have changed a file, decided ONCE, here, on the FULL command, by
# the loader that has it (`Ev.reads_only`). The digest keeps `COMMAND_MAX` characters of a
# command, and a rule that read the kept text had to refuse every cut one: FOUND IN REVIEW
# (2026-09-14), 10,313 of the 14,100 shell calls under ~/.claude/projects are longer than 160
# characters, so a read only `cd … && grep -rn … | head -40 && git log …` with an absolute path
# (184 characters) counted as a possible write, and "stretches with nothing written, tested or
# committed" fired on 0 of 368 sittings. `burn` (unreadable stretches) and `patterns` (the
# note) both read the flag. The Swift twin is `BuilderParse.ShellFileEffect.readsOnly`, held to
# this one by `spec/fixtures/digest/reads_only.json`.

#: Programs that cannot change a file when nothing is redirected into one. An ALLOWLIST,
#: for the reason CLAUDE.md gives for sidecar discovery: a denylist of writers waves
#: through the next one (`make`, a formatter, a build, a script nobody listed). A program
#: missing from here only makes a segment unreadable, never barren, which is the safe way
#: to be wrong. UNMEASURED JUDGEMENT CALL on the membership; the effect is measured in
#: `burn.py`, above its import of these names.
_READ_ONLY_PROGRAMS = frozenset(
    {
        "[", "[[", "ack", "ag", "awk", "base64", "basename", "cat", "cd", "cmp", "column",
        "comm", "cut", "date", "df", "diff", "dig", "dirname", "du", "echo", "egrep", "exit",
        "export", "false", "fd", "fgrep", "file", "find", "fold", "git", "grep", "head",
        "hexdump", "host", "hostname", "id", "ifconfig", "jq", "kill", "less", "ls", "lsof",
        "md5", "md5sum", "more", "netstat", "nl", "nslookup", "od", "pgrep", "ping", "pkill",
        "printenv", "printf", "ps", "pwd", "read", "readlink", "realpath", "rev", "rg", "sed",
        "seq", "sha256sum", "shasum", "sleep", "sort", "stat", "strings", "sw_vers", "tail",
        "test", "tr", "tree", "true", "type", "uname", "uniq", "unset", "uptime", "vm_stat",
        "wait", "wc", "which", "whereis", "whoami", "xxd", "curl",
    }
)

#: git subcommands that only read, and the listing forms of the ones that can also write
#: (`git branch` lists; `git branch -D x` does not). `git commit` is work the digest sees.
_READ_ONLY_GIT = frozenset(
    {
        "blame", "cat-file", "check-ignore", "count-objects", "describe", "diff", "fetch",
        "for-each-ref", "grep", "help", "log", "ls-files", "ls-remote", "ls-tree",
        "merge-base", "name-rev", "rev-list", "rev-parse", "shortlog", "show", "status",
        "version",
    }
)
_GIT_LISTING = {
    "branch": frozenset({"-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "--show-current"}),
    "remote": frozenset({"-v", "show", "get-url"}),
    "stash": frozenset({"list", "show"}),
    "tag": frozenset({"-l", "--list"}),
    "worktree": frozenset({"list"}),
    "config": frozenset({"--get", "--get-all", "--get-regexp", "--list", "-l"}),
}
#: The ones that only list when run bare. A bare `git stash` PUSHES: it rewrites the
#: working tree.
_GIT_LISTS_BARE = frozenset({"branch", "remote", "tag"})

#: Flags that turn a reading program into a writing one.
_WRITING_FLAGS = {
    "sed": re.compile(r"^(-i|--in-place)"),
    "find": re.compile(r"^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$"),
    "curl": re.compile(r"^(-\w*[oO]|--output|--remote-name\S*|-J)$"),
    "sort": re.compile(r"^(-o|--output)"),
}

#: Writes a program can make from INSIDE its own script: awk's `print > "f"`, a pipe out
#: or `system()`, and sed's `w file` command.
_WRITES_INSIDE = {
    "awk": re.compile(r">|system\s*\(|\|\s*[\"']"),
    "sed": re.compile(r"(^|[\s;{}/'\"])[wW]\s+\S"),
}

#: Shell words that are not the program: a keyword before it, an assignment, a wrapper.
_SHELL_KEYWORDS = frozenset({"do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "}"})
_SHELL_NOOPS = frozenset({"done", "fi", "for"})
_ASSIGNMENT = re.compile(r"^[A-Za-z_]\w*=")

#: Redirections that write no file: into /dev/null, one descriptor onto another, and the
#: here string and heredoc openers (the body is skipped by `digest._command_lines`).
_HARMLESS_REDIRECT = re.compile(r"[&\d]?>{1,2}\s*/dev/null\b|\d?>&\d|&>\s*/dev/null\b|<<<|<<-?\s*['\"]?\w+['\"]?")

def _split_commands(line: str) -> list[str] | None:
    """One command line cut into the simple commands it RUNS, or None when it writes a
    file through a redirection.

    Quote aware: a separator or a `>` inside quotes is data. A command substitution (`$(`,
    a backtick) runs even inside double quotes, so it is cut out there too; what follows
    its close is the outer command's argument (`cat $(ls)/x`, `"a $(b) c"`), which is data
    and not a program, up to the next separator.
    """
    line = _HARMLESS_REDIRECT.sub(" ", line)
    out: list[str] = []
    buf: list[str] = []
    data = False  # the buffer continues an argument after a substitution closed
    quote: str | None = None
    tick = False  # inside a backtick substitution
    i, n = 0, len(line)

    def cut(next_is_data: bool) -> None:
        nonlocal buf, data
        if not data:
            out.append("".join(buf))
        buf, data = [], next_is_data

    while i < n:
        c = line[i]
        if quote == "'":
            # Kept in the command, so a flag or a program text (`awk '{print > "f"}'`) can
            # still be read; never a separator.
            quote = None if c == "'" else quote
            buf.append(c)
            i += 1
            continue
        if c == "\\" and i + 1 < n:
            buf.append(line[i : i + 2])
            i += 2
            continue
        if c == "$" and i + 1 < n and line[i + 1] == "(":
            cut(False)
            i += 2
            continue
        if c == "`":
            tick = not tick
            cut(not tick)
            i += 1
            continue
        if c == ")":
            cut(True)
            i += 1
            continue
        if quote == '"':
            quote = None if c == '"' else quote
            buf.append(c)
            i += 1
            continue
        if c in "'\"":
            quote = c
            buf.append(c)
            i += 1
            continue
        if c == ">":
            return None  # a file is written: the harmless forms were removed above
        if c in ";|&(":
            cut(False)
            i += 2 if (i + 1 < n and line[i + 1] == c and c in "|&") else 1
            continue
        buf.append(c)
        i += 1
    cut(False)
    return [s.strip() for s in out if s.strip()]


def _simple_reads(command: str) -> bool:
    """Whether one simple command can only read."""
    words = command.split()
    while words and (words[0] in _SHELL_KEYWORDS or _ASSIGNMENT.match(words[0])):
        words = words[1:]
    if words and words[0] == "env":
        words = [w for w in words[1:] if not _ASSIGNMENT.match(w)]
    if words and words[0] == "timeout":
        words = words[2:]
    if not words or words[0] in _SHELL_NOOPS or words[0].startswith("#"):
        return True
    prog = words[0].rsplit("/", 1)[-1]
    if prog not in _READ_ONLY_PROGRAMS:
        return False
    flags = _WRITING_FLAGS.get(prog)
    if flags is not None and any(flags.match(w.strip("'\"")) for w in words[1:]):
        return False
    inside = _WRITES_INSIDE.get(prog)
    if inside is not None and inside.search(" ".join(words[1:])):
        return False
    if prog != "git":
        return True
    rest = words[1:]
    while rest and rest[0].startswith("-"):
        rest = rest[2:] if rest[0] in ("-C", "-c") else rest[1:]
    if not rest:
        return True
    sub, args = rest[0], rest[1:]
    if sub in _READ_ONLY_GIT:
        return True
    listing = _GIT_LISTING.get(sub)
    if listing is None or (not args and sub not in _GIT_LISTS_BARE):
        return False
    return all(a in listing for a in args)



def shell_reads_only(command: str | None) -> bool:
    """Whether a shell command, WHOLE, can only read: every line that is a command
    (heredoc bodies skipped, `_command_lines`: a body is data) splits into simple commands
    that a read only program runs with no writing flag, and nothing is redirected into a
    file. Empty is not read only: nothing ran that could be proven to."""
    if not command or not command.strip():
        return False
    for _, line in _command_lines(command):
        commands = _split_commands(line)
        if commands is None or not all(_simple_reads(c) for c in commands):
            return False
    return True


def _bash_file_effect(command: str) -> tuple[str | None, int | None]:
    """(path, approx lines written) for shell-driven file writes.

    Agents in permission modes that prefer the shell write files with heredocs instead of
    the Write tool. MEASURED on such a session: 100 Bash calls, 0 Edit/Write calls, and
    every source file in the commit was created by `cat > path <<'EOF'`. Ignoring that
    reports "agent lines +0" on a session that added a thousand. The count is the
    heredoc body length — approximate, labelled so, and better than zero.

    ONLY COMMAND LINES ARE READ, never heredoc bodies (`_command_lines`). A body is data,
    and this parser once read a shell command quoted inside a documentation file as a
    write to a file called `path`.

    The body is the lines strictly between the opener and the terminator. FOUND ON A REAL
    SESSION (Claude Code 2.1.261, `claude -p`, 2026-09-05): the Bash input
    `mkdir -p tests && cat > tests/test_fail.py <<'EOF'\ndef test_fail():\n    assert 1 ==
    2\nEOF\ngit add -A && git commit -m 'add failing test'` scored +3 under the older
    `newlines - 1` rule while git's own result said `2 insertions(+)` — the terminator
    line and the commands after it were being counted as file content.
    """
    lines = command.split("\n")
    for i, line in _command_lines(command):
        m = _HEREDOC.search(line)
        if m is None:
            continue
        delim = m.group("delim")
        body = lines[i + 1 :]
        n = 0
        for ln in body:
            if ln.strip() == delim:
                break
            n += 1
        else:
            # No terminator (truncated command): don't count a trailing empty line.
            if body and body[-1] == "":
                n -= 1
        return m.group("path"), max(0, n)
    for _i, line in _command_lines(command):
        m = _SED_I.search(line)
        if m:
            return m.group("path"), None
    return None, None


@dataclasses.dataclass
class Ev:
    n: int  # ordinal in the digest
    ts: float
    kind: str  # prompt | interrupt | assistant | tool | result_error | human_edit | compaction
    text: str = ""
    tool: str | None = None
    path: str | None = None
    added: int | None = None
    removed: int | None = None
    ok: bool = True
    tool_id: str | None = None
    model: str | None = None
    tok_out: int | None = None
    #: On a tool Ev: when its `tool_result` arrived, ok or error. On assistant and tool Evs:
    #: the record's `message.stop_reason` (MEASURED on the live transcript, 2026-09-13: all
    #: 221 assistant records carry it, 202 `tool_use` and 19 `end_turn`). Set ONLY by
    #: `load_claude_code_events`; every other loader leaves both None, meaning "cannot
    #: tell", and `live.py` falls back to timing. Neither is read by `stats` or `render`,
    #: so the digest text is byte identical with or without them (`test_plain`).
    result_ts: float | None = None
    stop_reason: str | None = None
    #: On a shell tool Ev: whether the WHOLE command can only read (`shell_reads_only`),
    #: decided by the loader from the full command, since `text` keeps `COMMAND_MAX`
    #: characters of it. None where no loader decided (not a shell call, an Ev built by
    #: hand): the rules then read the kept text and refuse a cut one. Not read by `stats`
    #: or `render`, so the digest text is byte identical with or without it.
    reads_only: bool | None = None


def _tool_line(b: dict) -> tuple[str, str | None, str]:
    """(tool name, file path, one-line description of the input)."""
    name = b.get("name") or "tool"
    inp = b.get("input") or {}
    if not isinstance(inp, dict):
        return name, None, ""
    path = inp.get("file_path") or inp.get("path") or inp.get("notebook_path")
    if name == "Bash":
        cmd = str(inp.get("command", ""))
        path, _ = _bash_file_effect(cmd)
        return name, path, clip(cmd.replace("\n", " ⏎ "), COMMAND_MAX)
    if name in ("Read", "Write", "Edit", "MultiEdit", "NotebookEdit"):
        return name, path, str(path or "")
    if name in ("Glob", "Grep"):
        return name, None, clip(str(inp.get("pattern", "")), 80)
    if name in ("Agent", "Task"):
        return name, None, clip(str(inp.get("description") or inp.get("prompt", "")), 100)
    if name in ("WebSearch", "WebFetch"):
        return name, None, clip(str(inp.get("query") or inp.get("url", "")), 100)
    if name == "TodoWrite" or name.startswith("Task"):
        return name, None, ""
    # MCP and everything else: name only. Inputs may be anything.
    return name, None, clip(json.dumps(inp, separators=(",", ":"))[:200], 100) if inp else ""


def _is_gemini_record(r: dict) -> bool:
    # Gemini's metadata line carries `sessionId` + `projectHash` and never `uuid` /
    # `parentUuid`; a Claude Code record carries `sessionId` too, so order matters.
    return (
        isinstance(r.get("sessionId"), str)
        and isinstance(r.get("projectHash"), str)
        and "uuid" not in r
        and "parentUuid" not in r
    )


_CLINE_FILES = frozenset({"ui_messages.json", "api_conversation_history.json"})


def _is_opencode(path: pathlib.Path) -> bool:
    # Decided on the path shape first (a virtual `<db>/<session id>` does not exist on
    # disk; a session file sits under `storage/session/`), then on the SQLite header and
    # table names — Cursor's `state.vscdb` and Codex's `state_N.sqlite` are SQLite too.
    # Cheap rejections first so every `.jsonl` in a Claude Code tree is not opened twice.
    if path.suffix in (".jsonl", ".md", ".txt", ".sqlite", ".vscdb"):
        return False
    from . import opencode

    return opencode.detect(path) is not None


def _is_aider(path: pathlib.Path) -> bool:
    # Aider keeps `.aider.chat.history.md` (+ `.aider.input.history`) IN THE REPO; a session
    # is `<chat file>/<YYYYMMDD-HHMMSS>` (virtual last component). Decided on the names
    # first; a `.md` under another name is opened only for its first line, which must be
    # `# aider chat started at …` (analysis/aider.py).
    if path.suffix in (".jsonl", ".json", ".sqlite", ".vscdb", ".db"):
        return False
    from . import aider

    return aider.detect(path) is not None


def _is_cline_task(path: pathlib.Path) -> bool:
    # A Cline task is a DIRECTORY holding `ui_messages.json` (and usually
    # `api_conversation_history.json`); either file names the task too. Decided on the
    # path shape, not the content: the ui file is a bare JSON array of `{ts, type, say}`
    # rows with nothing that names the harness (analysis/cline.py).
    if path.is_dir():
        return any((path / n).is_file() for n in _CLINE_FILES)
    return path.name in _CLINE_FILES


def detect_harness(path: pathlib.Path) -> str:
    """ "claude_code", "codex", "gemini", "cline", "opencode" or "aider", from the first
    complete non-empty line (or the path shape).

    A Codex rollout's first record is `{"type": "session_meta", "payload": …}` (the
    recorder writes it before anything else); a Gemini CLI recording's first line is
    `{"sessionId", "projectHash", "startTime", …}` (or, for a legacy `.json` file, the
    whole conversation as one object); a Claude Code transcript's records carry
    `sessionId` / `parentUuid` / `uuid`; a Cline task is a directory (or a
    `ui_messages.json` / `api_conversation_history.json` inside one); an opencode session
    is `<opencode.db>/<session id>` (a SQLite file with `session`/`message`/`part`
    tables, plus a virtual last component), a `storage/session/<project>/<id>.json`
    file, or an `opencode export` file (analysis/opencode.py); an Aider session is a repo
    directory holding `.aider.chat.history.md`, that file, its `.aider.input.history`, or
    `<chat file>/<session id>` (analysis/aider.py). Anything unrecognised is treated as
    Claude Code, which is the loader with the measured ground truth behind it.
    """
    path = pathlib.Path(path)
    if _is_cline_task(path):
        return "cline"
    if _is_aider(path):
        return "aider"
    if _is_opencode(path):
        return "opencode"
    try:
        if path.suffix == ".json":
            try:
                whole = json.loads(path.read_bytes())
            except json.JSONDecodeError:
                whole = None
            if isinstance(whole, dict) and _is_gemini_record(whole):
                return "gemini"
        with path.open("rb") as f:
            for line in f:
                if not line.endswith(b"\n"):
                    break
                if not line.strip():
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    return "claude_code"
                if not isinstance(r, dict):
                    return "claude_code"
                if _is_gemini_record(r):
                    return "gemini"
                if "sessionId" in r or "parentUuid" in r or "uuid" in r:
                    return "claude_code"
                if r.get("type") == "session_meta" or (
                    "payload" in r and "timestamp" in r and isinstance(r.get("type"), str)
                ):
                    return "codex"
                return "claude_code"
    except OSError:
        pass
    return "claude_code"


def load_events(
    path: pathlib.Path, start: float | None = None, end: float | None = None
) -> list[Ev]:
    """Read one transcript into digest events, dispatching on the harness that wrote it."""
    harness = detect_harness(path)
    if harness == "codex":
        from . import codex

        return codex.load_events(path, start, end)
    if harness == "gemini":
        from . import gemini

        return gemini.load_events(path, start, end)
    if harness == "cline":
        from . import cline

        return cline.load_events(path, start, end)
    if harness == "opencode":
        from . import opencode

        return opencode.load_events(path, start, end)
    if harness == "aider":
        from . import aider

        return aider.load_events(path, start, end)
    return load_claude_code_events(path, start, end)


def load_claude_code_events(
    path: pathlib.Path, start: float | None = None, end: float | None = None
) -> list[Ev]:
    """Read one Claude Code transcript into digest events, in time order, within [start, end]."""
    raw: list[tuple[float, int, dict]] = []
    with path.open("rb") as f:
        for i, line in enumerate(f):
            if not line.endswith(b"\n"):
                break  # partial trailing line is never consumed
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            # A valid JSON line that is not an object crashed every command that reads a
            # transcript (FOUND IN REVIEW; 0 of 165,452 local lines, a crash and not a wrong
            # number, and CLAUDE.md: type check at every nesting level).
            if not isinstance(r, dict):
                continue
            ts = _ts(r.get("timestamp")) if isinstance(r.get("timestamp"), str) else None
            if ts is None:
                continue
            if start is not None and ts < start:
                continue
            if end is not None and ts > end:
                continue
            raw.append((ts, i, r))
    raw.sort(key=lambda t: (t[0], t[1]))

    tool_names: dict[str, tuple[str, str | None]] = {}  # tool_use_id -> (name, path)
    tool_evs: dict[str, Ev] = {}  # tool_use_id -> the tool Ev, for `result_ts`
    out: list[Ev] = []
    seen_msg: set[str] = set()

    for ts, _, r in raw:
        t = r.get("type")
        if t == "user":
            msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            content = msg.get("content")
            ps = r.get("promptSource")
            origin = r.get("origin").get("kind") if isinstance(r.get("origin"), dict) else None
            is_meta = bool(r.get("isMeta"))
            text = _text_of(content)
            if (
                not is_meta
                and (ps == "typed" or (ps == "sdk" and origin == "human"))
                and text.strip()
            ):
                out.append(Ev(0, ts, "prompt", clip(text, PROMPT_MAX)))
            elif text.startswith(INTERRUPT_PREFIX):
                out.append(Ev(0, ts, "interrupt", ""))
            if isinstance(content, list):
                tur = r.get("toolUseResult")
                for b in content:
                    if not isinstance(b, dict) or b.get("type") != "tool_result":
                        continue
                    tid = b.get("tool_use_id")
                    name, path = tool_names.get(tid, ("tool", None))
                    # When the result arrived, ok or error, stamped on the call itself: a
                    # successful result writes no event of its own, and without this a
                    # finished five minute build reads as one still running.
                    origin_ev = tool_evs.get(tid) if isinstance(tid, str) else None
                    if origin_ev is not None and origin_ev.result_ts is None:
                        origin_ev.result_ts = ts
                    body = (
                        _text_of(b.get("content"))
                        if not isinstance(b.get("content"), str)
                        else b["content"]
                    )
                    is_err = bool(b.get("is_error")) or _looks_like_error(body or "")
                    added = removed = None
                    if isinstance(tur, dict):
                        patch = tur.get("structuredPatch")
                        if isinstance(patch, list) and patch:
                            hunks = [
                                h.get("lines") if isinstance(h.get("lines"), list) else []
                                for h in patch
                                if isinstance(h, dict)
                            ]
                            added = sum(1 for h in hunks for ln in h if str(ln).startswith("+"))
                            removed = sum(1 for h in hunks for ln in h if str(ln).startswith("-"))
                        elif tur.get("type") == "create" and isinstance(tur.get("content"), str):
                            # Lines = newlines, plus one only for an unterminated last
                            # line. FOUND ON A REAL SESSION (Claude Code 2.1.261, `claude
                            # -p`, 2026-09-05): `toolUseResult: {"type": "create",
                            # "filePath": ".../hello.py", "content": "#!/usr/bin/env
                            # python3\n\ndef main():\n    print('hi')\n\nif __name__ ==
                            # '__main__': main()\n"}` is a 6-line file (`wc -l` 6, git
                            # `6 insertions(+)`); `newlines + 1` reported 7.
                            c = tur["content"]
                            added = c.count("\n") + (1 if c and not c.endswith("\n") else 0)
                            removed = 0
                        path = (
                            path or tur.get("filePath") or (tur.get("file") or {}).get("filePath")
                            if isinstance(tur.get("file"), dict)
                            else path or tur.get("filePath")
                        )
                    if is_err:
                        out.append(
                            Ev(
                                0,
                                ts,
                                "result_error",
                                clip(body or "(error)", ERROR_MAX),
                                tool=name,
                                path=path,
                                ok=False,
                                tool_id=tid,
                            )
                        )
                    elif added is not None:
                        # attach the line delta to the originating tool event
                        for e in reversed(out):
                            if e.kind == "tool" and e.tool_id == tid:
                                e.added, e.removed, e.path = added, removed, path or e.path
                                break
        elif t == "assistant":
            msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            mid = msg.get("id") or r.get("requestId")
            model = msg.get("model")
            usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else {}
            stop = msg.get("stop_reason") if isinstance(msg.get("stop_reason"), str) else None
            first = mid not in seen_msg
            if mid:
                seen_msg.add(mid)
            content = msg.get("content")
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict):
                    continue
                bt = b.get("type")
                if bt == "text" and b.get("text", "").strip():
                    out.append(
                        Ev(
                            0,
                            ts,
                            "assistant",
                            clip(b["text"], ASSISTANT_MAX),
                            model=model,
                            tok_out=usage.get("output_tokens") if first else None,
                            stop_reason=stop,
                        )
                    )
                    first = False
                elif bt == "tool_use":
                    name, path, desc = _tool_line(b)
                    tool_names[b.get("id")] = (name, path)
                    ev = Ev(
                        0,
                        ts,
                        "tool",
                        mask(desc),
                        tool=name,
                        path=path,
                        tool_id=b.get("id"),
                        model=model,
                        stop_reason=stop,
                    )
                    if isinstance(b.get("id"), str):
                        tool_evs[b["id"]] = ev
                    if name == "Bash":
                        full = str((b.get("input") or {}).get("command", ""))
                        _, approx = _bash_file_effect(full)
                        if approx is not None:
                            ev.added, ev.removed = approx, 0
                        ev.reads_only = shell_reads_only(full)
                    out.append(ev)
        elif (
            t == "attachment"
            and isinstance(r.get("attachment"), dict)
            and r["attachment"].get("type") == "edited_text_file"
        ):
            out.append(Ev(0, ts, "human_edit", "", path=r["attachment"].get("filename")))
        elif t == "system" and r.get("subtype") == "compact_boundary":
            out.append(Ev(0, ts, "compaction", ""))

    for i, e in enumerate(out):
        e.n = i
    return out


# ----------------------------------------------------------------------------- stats


def stats(events: list[Ev]) -> dict:
    """Deterministic numbers. These go on the card; the model never invents them."""
    if not events:
        return {"events": 0}
    t0, t1 = events[0].ts, events[-1].ts
    prompts = [e for e in events if e.kind == "prompt"]
    tools = [e for e in events if e.kind == "tool"]
    errors = [e for e in events if e.kind == "result_error"]
    words = [len(p.text.split()) for p in prompts]
    added = sum(e.added or 0 for e in tools)
    removed = sum(e.removed or 0 for e in tools)
    files = {
        e.path
        for e in tools
        if e.path and (e.tool in EDIT_TOOLS or (e.tool in SHELL_TOOLS and e.added is not None))
    }
    shell_written = sum(1 for e in tools if e.tool in SHELL_TOOLS and e.added is not None)
    reads = {e.path for e in tools if e.path and e.tool in READ_TOOLS}
    commits = sum(
        1
        for e in tools
        if e.tool in COMMIT_TOOLS
        or (e.tool in SHELL_TOOLS and COMMIT_CMD.search(e.text))
    )
    tests = sum(
        1
        for e in tools
        if e.tool in SHELL_TOOLS
        and re.search(
            r"\b(pytest|bun test|npm test|swift test|jest|cargo test|go test|make test)\b", e.text
        )
    )
    models = Counter(e.model for e in events if e.kind == "assistant" and e.model)
    # prompts received = assistant turns that produced text for the human
    replies = sum(1 for e in events if e.kind == "assistant")
    return {
        "events": len(events),
        "wall_seconds": round(t1 - t0),
        "prompts_sent": len(prompts),
        "replies_received": replies,
        "interrupts": sum(1 for e in events if e.kind == "interrupt"),
        "human_edits": sum(1 for e in events if e.kind == "human_edit"),
        "compactions": sum(1 for e in events if e.kind == "compaction"),
        "prompt_words_avg": round(sum(words) / len(words), 1) if words else 0,
        "prompt_words_median": sorted(words)[len(words) // 2] if words else 0,
        "prompt_words_max": max(words) if words else 0,
        "tool_calls": len(tools),
        "tool_mix": dict(Counter(e.tool for e in tools).most_common()),
        "errors": len(errors),
        "lines_added_agent": added,
        "lines_removed_agent": removed,
        "files_edited": len(files),
        "files_written_via_shell": shell_written,
        "files_read": len(reads),
        "git_commits_run": commits,
        "test_runs": tests,
        "models": dict(models.most_common()),
        "longest_silence_seconds": round(
            max((b.ts - a.ts for a, b in itertools.pairwise(events)), default=0)
        ),
    }


# ----------------------------------------------------------------------------- render


def _fmt_t(t0: float, ts: float) -> str:
    m = (ts - t0) / 60
    return f"+{m:5.1f}m"


def _render_event(e: Ev, t0: float, tight: bool) -> str:
    t = _fmt_t(t0, e.ts)
    if e.kind == "prompt":
        return f"[{e.n}] {t} PROMPT: {json.dumps(e.text, ensure_ascii=False)}"
    if e.kind == "interrupt":
        return f"[{e.n}] {t} INTERRUPT (human stopped the agent)"
    if e.kind == "human_edit":
        return f"[{e.n}] {t} HUMAN EDITED FILE {e.path or ''}".rstrip()
    if e.kind == "compaction":
        return f"[{e.n}] {t} CONTEXT COMPACTED"
    if e.kind == "assistant":
        txt = _trunc(e.text, ASSISTANT_MAX_TIGHT if tight else ASSISTANT_MAX)
        return f"[{e.n}] {t} ASSISTANT: {json.dumps(txt, ensure_ascii=False)}"
    if e.kind == "tool":
        delta = f" +{e.added}/-{e.removed}" if e.added is not None else ""
        body = e.text if e.tool in SHELL_TOOLS else (e.path or e.text)
        return f"[{e.n}] {t} {e.tool}{delta}: {body}".rstrip(": ")
    if e.kind == "result_error":
        return f"[{e.n}] {t} ERROR from {e.tool}: {json.dumps(e.text, ensure_ascii=False)}"
    return f"[{e.n}] {t} {e.kind}"


def _collapse_tool_runs(events: list[Ev], t0: float, min_run: int = 4) -> list[str]:
    """Consecutive tool calls (no prompt/assistant/error between) become one summary line."""
    lines: list[str] = []
    i = 0
    while i < len(events):
        e = events[i]
        if e.kind != "tool":
            lines.append(_render_event(e, t0, tight=True))
            i += 1
            continue
        j = i
        while j < len(events) and events[j].kind == "tool":
            j += 1
        run = events[i:j]
        if len(run) < min_run:
            lines.extend(_render_event(x, t0, tight=True) for x in run)
        else:
            mix = Counter(x.tool for x in run)
            edited = [
                f"{x.path.rsplit('/', 1)[-1]} +{x.added}/-{x.removed}"
                for x in run
                if x.added is not None and x.path
            ][:6]
            cmds = [x.text.split(" ⏎ ")[0][:40] for x in run if x.tool in SHELL_TOOLS][:4]
            span = (run[-1].ts - run[0].ts) / 60
            parts = [f"{k}×{v}" for k, v in mix.most_common()]
            detail = ""
            if edited:
                detail += " edits: " + ", ".join(edited)
            if cmds:
                detail += " bash: " + " | ".join(cmds)
            lines.append(
                f"[{run[0].n}-{run[-1].n}] {_fmt_t(t0, run[0].ts)} TOOLS ×{len(run)} over {span:.1f}m: {', '.join(parts)}.{detail}"
            )
        i = j
    return lines


def render(events: list[Ev], meta: dict, budget: int = DEFAULT_BUDGET) -> tuple[str, float]:
    """Render the digest under a character budget. Returns (text, coverage)."""
    if not events:
        return "# SESSION DIGEST\n(no events)\n", 1.0
    t0 = events[0].ts
    st = stats(events)

    head = ["# SESSION DIGEST"]
    for k in (
        "repo",
        "harness",
        "started_at_local",
        "end_reason",
        "attended_seconds",
        "autonomous_seconds",
    ):
        if meta.get(k) is not None:
            head.append(f"{k}: {meta[k]}")
    head.append(
        f"wall: {st['wall_seconds'] // 60}m  prompts sent: {st['prompts_sent']}  replies: {st['replies_received']}  "
        f"tool calls: {st['tool_calls']}  errors: {st['errors']}  interrupts: {st['interrupts']}  "
        f"agent lines +{st['lines_added_agent']}/-{st['lines_removed_agent']}  files edited: {st['files_edited']}  "
        f"git commits run: {st['git_commits_run']}  test runs: {st['test_runs']}"
    )
    head.append("tool mix: " + ", ".join(f"{k} {v}" for k, v in st["tool_mix"].items()))
    if st["models"]:
        head.append("models: " + ", ".join(f"{k} ({v} turns)" for k, v in st["models"].items()))
    head.append("")
    head.append("# TIMELINE  ([n] = event ordinal, +m = minutes from start)")
    header = "\n".join(head) + "\n"

    # Level 0: everything, generous truncation.
    body = "\n".join(_render_event(e, t0, tight=False) for e in events)
    if len(header) + len(body) <= budget:
        return header + body + "\n", 1.0

    # Level 1: tight assistant text, collapse tool runs.
    lines = _collapse_tool_runs(events, t0)
    body = "\n".join(lines)
    if len(header) + len(body) <= budget:
        return header + body + "\n", 1.0

    # Level 2: keep every prompt/error/interrupt/human-edit line and the first/last 12
    # lines; thin the rest evenly until it fits. Coverage reports the loss.
    must = [
        ln
        for ln in lines
        if any(
            k in ln
            for k in (
                " PROMPT: ",
                " ERROR from ",
                " INTERRUPT",
                " HUMAN EDITED",
                " CONTEXT COMPACTED",
            )
        )
    ]
    rest = [ln for ln in lines if ln not in set(must)]
    keep_edges = rest[:12] + rest[-12:] if len(rest) > 24 else rest
    middle = rest[12:-12] if len(rest) > 24 else []
    budget_left = (
        budget - len(header) - sum(len(x) + 1 for x in must) - sum(len(x) + 1 for x in keep_edges)
    )
    kept_middle: list[str] = []
    if middle and budget_left > 0:
        avg = max(1, sum(len(x) + 1 for x in middle) // len(middle))
        n_keep = max(0, min(len(middle), budget_left // avg))
        if n_keep:
            step = len(middle) / n_keep
            kept_middle = [middle[int(i * step)] for i in range(n_keep)]
    chosen = set(must) | set(keep_edges) | set(kept_middle)
    body_lines = [ln for ln in lines if ln in chosen]
    dropped = len(lines) - len(body_lines)
    coverage = len(body_lines) / max(1, len(lines))
    note = f"\n(… {dropped} of {len(lines)} timeline lines omitted to fit; every prompt and error is present. coverage={coverage:.2f})\n"
    return header + "\n".join(body_lines) + note, round(coverage, 3)


def digest_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build(
    path: pathlib.Path,
    start: float | None = None,
    end: float | None = None,
    meta: dict | None = None,
    budget: int = DEFAULT_BUDGET,
) -> dict:
    harness = detect_harness(path)
    meta = dict(meta or {})
    meta.setdefault("harness", harness)
    if harness == "codex":
        from . import codex

        events = codex.load_events(path, start, end)
    elif harness == "gemini":
        from . import gemini

        events = gemini.load_events(path, start, end)
    elif harness == "cline":
        from . import cline

        events = cline.load_events(path, start, end)
    elif harness == "opencode":
        from . import opencode

        events = opencode.load_events(path, start, end)
    elif harness == "aider":
        from . import aider

        events = aider.load_events(path, start, end)
    else:
        events = load_claude_code_events(path, start, end)
    text, coverage = render(events, meta, budget)
    return {
        "text": text,
        "coverage": coverage,
        "hash": digest_hash(text),
        "stats": stats(events),
        "events": len(events),
    }

"""Shell commands and whether each, WHOLE, can only read: the one answer Python and Swift give.

`digest.shell_reads_only` decides it on the full command, at parse time, and stores it on the
event (`Ev.reads_only`); `BuilderParse.ShellFileEffect.readsOnly` is the Swift twin. Two
counters for one number is the same bug as a wrong number (CLAUDE.md), so both are held to
this list: `scripts/gen_copy.py` writes it, with Python's answers, to
`spec/fixtures/digest/reads_only.json`; `test_digest_reads_only` holds Python to the expected
answers here, and the Swift `ShellReadsOnlyTests` hold Swift to the file.

Every command is a full command, newlines and all, the way a transcript has it. The long ones
are the point: FOUND IN REVIEW (2026-09-14), 10,313 of the 14,100 shell calls under
~/.claude/projects are longer than the 160 characters the digest keeps.
"""

from __future__ import annotations

from analysis import digest as dg

#: A read only command the length of most of the corpus's (184 characters).
LONG_READ = (
    "cd /Users/someone/Downloads/projects/tramline/backend && grep -rn \"shadow_walk\" --include=*.py "
    "services/ routes/ | head -40 && git log --oneline -20 -- services/route_service.py"
)

#: (command, can it only read)
CASES: list[tuple[str, bool]] = [
    # --- only read
    ("ls -la", True),
    ("cd /repo\nsed -n '1254,1275p' mobile/src/screens/HomeScreen.js", True),
    ('grep -rn "rank_limit" mobile/src | head -12', True),
    ('grep -rn "a|b" src/ 2>/dev/null | head -20', True),
    ('git status --short && echo "---" && git diff --stat', True),
    ("git -C /repo log --oneline -8 && git stash list", True),
    ("git branch -a | head -20", True),
    ("df -h / 2>/dev/null | awk 'NR==1 {print}'", True),
    ('for c in a1b2c3d 4e5f6a7; do echo "== $c"; git show --stat --oneline $c | head -8; done', True),
    ("echo \"clean=$(git status --porcelain | wc -l | tr -d ' ')\"", True),
    ("curl -s http://localhost:5001/api/health > /dev/null 2>&1", True),
    ("X=1 timeout 5 cat a.txt", True),
    ("awk -F: '{print $1}' /etc/passwd", True),
    ("git log --format='%h %s' -5", True),
    ("grep -c x <<< 'hello'", True),
    ("cat <<'EOF'\nprint('not run, only printed')\nEOF", True),
    ("env A=1 B=2 git -c color.ui=never log -3", True),
    ("git remote -v && git config --list && git tag", True),
    ("[ -f a.txt ] && wc -l a.txt || echo missing", True),
    (LONG_READ, True),
    (LONG_READ + "\n" + LONG_READ.replace("shadow_walk", "route_table"), True),
    # --- could write
    ("python3 - <<'PY'\nopen('a.py', 'w').write(s)\nPY", False),
    ("cd ~/projects && git clone https://github.com/x/y.git && ls -la y", False),
    ("npx expo start --ios 2>&1", False),
    ("echo done > status.txt", False),
    ("grep -n x a.py 2> errors.log", False),
    ('echo "$(rm -rf build)"', False),
    ("ls `rm -rf build`", False),
    ("git checkout -- mobile/src/utils/routeOrdering.js", False),
    ("git stash", False),
    ("git branch -D old", False),
    ("find . -name '*.pyc' -delete", False),
    ("curl -s -o page.html https://example.com", False),
    ("sed -i 's/a/b/' notes", False),
    ("make build", False),
    ("./scripts/fix.sh", False),
    ("cd /repo && cat a.py && python3 -c 'print(1)'", False),
    ("awk '{print > \"out.txt\"}' a.log", False),
    ("sed -n 's/a/b/w out.txt' a.txt", False),
    ("sort -o sorted.txt a.txt", False),
    ("git commit -m 'fix; rm x next time'", False),
    # Conservative on purpose: a listing subcommand's words must all be listing flags, so a
    # key after `--get` is not proven to be one (an allowlist, never a guess).
    ("git config --get remote.origin.url", False),
    ("cat > notes.md <<'EOF'\n# notes\nEOF", False),
    (LONG_READ + " && ./scripts/regen_routes.sh > services/route_table.py", False),
    (LONG_READ + "\npython3 scripts/regen_routes.py", False),
    ("", False),
    ("   ", False),
]


def entries() -> list[dict]:
    """The fixture: each command beside Python's answer."""
    return [{"command": c, "reads_only": dg.shell_reads_only(c)} for c, _ in CASES]

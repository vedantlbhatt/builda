"""Vocabulary: glossary terms that unlock by encounter, engineer voice titles, the stack.

Every word here is earned by an event. The tests below are mostly about the events that
must NOT earn one: a heredoc body, a `which` probe, `git merge-base`, a C8 label in an
echo, a Django `urls.py`, Claude Code's own `~/.claude/jobs/` directory. Each of those was
found by running the design's detectors on the real corpus, and each is a word a person
would have been handed for something that did not happen.

Every session is built by hand so each count can be checked on paper. No transcript is
checked in (docs/overnight-engine.md 6): the one test that goes through the real parser
writes its JSONL into a temp dir.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import tempfile
import unittest

from analysis import burn, digest, feedback, languages, patterns, plain, quality, vocab
from analysis.digest import Ev

T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC).timestamp()

# ------------------------------------------------------------------ event builders


def ev(ts, kind, text="", tool=None, path=None, added=None, removed=None):
    return Ev(0, T0 + ts, kind, text, tool=tool, path=path, added=added, removed=removed)


def sh(ts, command, path=None, added=None):
    """A shell call as every loader writes it: newlines as ` ⏎ `, cut at COMMAND_MAX."""
    text = digest._trunc(command.replace("\n", " ⏎ "), digest.COMMAND_MAX)
    return ev(
        ts,
        "tool",
        text,
        tool="Bash",
        path=path,
        added=added,
        removed=0 if added is not None else None,
    )


def read(ts, path):
    return ev(ts, "tool", path, tool="Read", path=path)


def edit(ts, path, added, removed=0):
    return ev(ts, "tool", path, tool="Edit", path=path, added=added, removed=removed)


def write(ts, path, added):
    return ev(ts, "tool", path, tool="Write", path=path, added=added, removed=0)


def call(ts, name, text=""):
    return ev(ts, "tool", text, tool=name)


def fail(ts, text="Error: boom", tool="Bash"):
    return ev(ts, "result_error", text, tool=tool)


def prompt(ts, text):
    return ev(ts, "prompt", text)


def sess(events, sid="s"):
    events = list(events)
    for i, e in enumerate(events):
        e.n = i
    return patterns.SessionEvents(
        session_id=sid,
        started_at=T0,
        ended_at=T0 + 3600,
        active_seconds=3600.0,
        attended_seconds=3600.0,
        tz_offset_minutes=0,
        events=events,
    )


def unlocked(*sessions) -> dict:
    return {t["id"]: t for t in vocab.glossary(list(sessions))["terms"]}


def one(*events) -> dict:
    return unlocked(sess(events))


def title(*events, names=False) -> dict:
    return vocab.session_title(sess(events), names=names)


def items(result) -> dict:
    return {r["id"]: r for r in result["items"]}


# ------------------------------------------------------------------ 4.1 the catalog

#: The design's 72 ids (docs/overnight-engine.md 4.1), so none can be dropped quietly.
DESIGN_IDS = """commit branch merge rebase diff stash revert cherry_pick worktree pull_request
force_push git_hook test_suite unit_test fixture snapshot_test end_to_end_test mock coverage
type_check linter formatter ci dependency lockfile package_manager build bundler monorepo
virtualenv env_var secret module api endpoint schema migration database query rls orm cache
queue webhook cron_job auth jwt cors rate_limit container deploy server port process log
stack_trace ssh shell_script makefile simulator subagent mcp web_search regex glob compaction
heredoc patch symlink permissions feature_flag type_definitions""".split()

#: Where the table says the word is not the id with spaces.
DESIGN_WORDS = {
    "fixture": "test fixture",
    "coverage": "test coverage",
    "ci": "continuous integration",
    "virtualenv": "virtual environment",
    "env_var": "environment variable",
    "api": "API",
    # A hyphen inside a word is not a dash (`plain.DASH`), so compounds keep theirs
    # (FOUND IN REVIEW: "cherry pick" is not git's word, "end to end test" misreads).
    "rls": "row-level security",
    "cherry_pick": "cherry-pick",
    "end_to_end_test": "end-to-end test",
    "orm": "ORM",
    "auth": "authentication",
    "jwt": "JWT",
    "cors": "CORS",
    "ssh": "SSH",
    "makefile": "Makefile",
    "mcp": "MCP server",
    "permissions": "file permissions",
}


class TheCatalog(unittest.TestCase):
    def test_the_design_has_seventy_two_ids_and_every_one_is_here(self):
        self.assertEqual(len(DESIGN_IDS), 72)
        self.assertEqual(set(DESIGN_IDS) - {t.id for t in vocab.CATALOG}, set())

    def test_ids_are_unique_and_there_are_at_least_sixty(self):
        ids = [t.id for t in vocab.CATALOG]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 60)

    def test_the_two_additions_are_the_only_ids_beyond_the_design(self):
        self.assertEqual(
            {t.id for t in vocab.CATALOG} - set(DESIGN_IDS), {"monitoring", "routing_engine"}
        )

    def test_definitions_are_one_line_one_sentence_ending_in_a_full_stop(self):
        for t in vocab.CATALOG:
            with self.subTest(t.id):
                self.assertNotIn("\n", t.definition)
                self.assertTrue(t.definition.endswith("."))
                self.assertNotIn(". ", t.definition)
                self.assertTrue(t.definition[0].isupper())

    def test_no_dash_in_any_word_definition_or_stack_name(self):
        for t in vocab.CATALOG:
            self.assertFalse(plain.has_dash(t.word), t.id)
            self.assertFalse(plain.has_dash(t.definition), t.id)
        for s in vocab.STACK:
            self.assertFalse(plain.has_dash(s.name), s.id)

    def test_words_are_the_id_with_spaces_unless_the_table_says_otherwise(self):
        for t in vocab.CATALOG:
            with self.subTest(t.id):
                self.assertEqual(t.word, DESIGN_WORDS.get(t.id, t.id.replace("_", " ")))

    def test_every_regex_compiles(self):
        for t in vocab.CATALOG:
            for rx in (*t.commands, *t.errors):
                if isinstance(rx, str):
                    re.compile(rx)
        for s in vocab.STACK:
            for rx in s.commands:
                re.compile(rx)

    def test_every_path_glob_and_manifest_name_is_lowercase(self):
        for t in vocab.CATALOG:
            for g in t.paths:
                self.assertEqual(g, g.lower(), t.id)
        for s in vocab.STACK:
            for g in (*s.paths, *s.manifests):
                self.assertEqual(g, g.lower(), s.id)

    def test_rules_that_exist_elsewhere_are_imported_not_retyped(self):
        by = {t.id: t for t in vocab.CATALOG}
        self.assertIn(patterns._COMMIT_CMD, by["commit"].commands)
        self.assertEqual(set(by["commit"].tools), set(digest.COMMIT_TOOLS))
        self.assertEqual(by["test_suite"].commands, (quality.TEST_CMD,))
        self.assertEqual(by["heredoc"].commands, (digest._HEREDOC,))
        self.assertEqual(set(by["subagent"].tools), set(burn.TASK_TOOLS))
        self.assertEqual(
            set(by["lockfile"].paths), {f"*/{n.lower()}" for n in languages.GENERATED_NAMES}
        )

    def test_language_items_are_names_the_language_table_can_produce(self):
        produced = set(languages.EXTENSIONS.values()) | set(languages.BY_NAME.values())
        for s in vocab.STACK:
            if s.category == "language":
                self.assertIn(s.language, produced, s.id)
                self.assertEqual(s.manifests, (), s.id)

    def test_stack_ids_unique_and_categories_from_the_enum(self):
        ids = [s.id for s in vocab.STACK]
        self.assertEqual(len(ids), len(set(ids)))
        for s in vocab.STACK:
            self.assertIn(s.category, vocab.CATEGORIES)


# ------------------------------------------------------------------ detectors


class EachDetectorKind(unittest.TestCase):
    def test_a_command(self):
        self.assertIn("rebase", one(sh(1, "git rebase main")))

    def test_a_path(self):
        self.assertIn("ci", one(read(1, "/repo/.github/workflows/ci.yml")))

    def test_a_tool(self):
        self.assertIn("mcp", one(call(1, "mcp__plugin_posthog_posthog__exec")))

    def test_a_role(self):
        self.assertIn("unit_test", one(read(1, "/repo/tests/test_api.py")))

    def test_a_kind(self):
        self.assertIn("compaction", one(ev(1, "compaction")))

    def test_an_error_python(self):
        got = one(sh(1, "python3 x.py"), fail(2, "Traceback (most recent call last):\n  File x"))
        self.assertIn("stack_trace", got)

    def test_an_error_javascript_trace_on_a_later_line(self):
        got = one(sh(1, "node x.js"), fail(2, "Error: boom\n    at run (/r/x.js:1:2)"))
        self.assertIn("stack_trace", got)

    def test_a_plain_error_is_not_a_stack_trace(self):
        self.assertNotIn("stack_trace", one(sh(1, "ls nope"), fail(2, "ls: nope: No such file")))

    def test_a_command_is_only_read_from_shell_calls(self):
        # A Grep tool whose PATTERN looks like a command is not the agent running git.
        self.assertNotIn("rebase", one(call(1, "Grep", "git rebase")))

    def test_windows_paths_are_normalised(self):
        self.assertIn("ci", one(read(1, "C:\\repo\\.github\\workflows\\ci.yml")))

    def test_a_relative_path_matches_a_rooted_glob(self):
        # `cat > Dockerfile <<'EOF'` from the working directory: no leading slash.
        got = one(sh(1, "cat > Dockerfile <<'EOF'\nFROM python\nEOF", path="Dockerfile", added=1))
        self.assertIn("container", got)


class WhatIsNotAnEncounter(unittest.TestCase):
    """Each case here was a false unlock the design's detectors produced on the corpus,
    or the exact trap CLAUDE.md records. The positive twin sits beside each one, so the
    negative cannot pass because the detector never fires at all."""

    def test_a_heredoc_body_is_data_not_a_command(self):
        body = "cat > notes.md <<'EOF'\ngit rebase main\nEOF"
        got = one(sh(1, body, path="notes.md", added=1))
        self.assertNotIn("rebase", got)
        self.assertIn("heredoc", got)

    def test_a_heredoc_that_writes_no_file_is_not_the_heredoc_term(self):
        got = one(sh(1, "python3 - <<'PY'\nprint(1)\nPY"))
        self.assertNotIn("heredoc", got)
        self.assertIn("heredoc", one(sh(1, "cat > a.txt <<'EOF'\nx\nEOF", path="a.txt", added=1)))

    def test_a_here_string_is_not_a_heredoc(self):
        self.assertNotIn("heredoc", one(sh(1, "grep x <<< 'hello'")))

    def test_commands_after_a_heredoc_are_still_read(self):
        got = one(sh(1, "cat > a.py <<'EOF'\nx = 1\nEOF\ngit rebase main", path="a.py", added=1))
        self.assertIn("rebase", got)

    def test_an_existence_probe_runs_nothing(self):
        self.assertNotIn("database", one(sh(1, "which psql sqlite3 2>/dev/null")))
        self.assertNotIn("container", one(sh(1, "command -v docker")))
        self.assertIn("database", one(sh(1, "psql app -c 'select 1'")))
        self.assertIn("container", one(sh(1, "docker ps")))

    def test_a_comment_runs_nothing(self):
        self.assertNotIn("rebase", one(sh(1, "# git rebase main later\nls")))

    def test_an_echo_label_is_data_but_what_it_runs_is_a_command(self):
        self.assertNotIn("container", one(sh(1, 'echo "=== docker and compose ==="')))
        self.assertNotIn("container", one(sh(1, "printf '%s\\n' 'docker ps'")))
        self.assertIn("simulator", one(sh(1, 'echo "pid: $(adb shell pidof com.app | tr -d x)"')))
        self.assertIn("container", one(sh(1, 'echo "=== ps ===" && docker ps')))
        self.assertEqual(
            vocab._command_segments('echo "b: $(git branch --show-current)"; ls'),
            ("git branch --show-current", "ls"),
        )

    def test_merge_base_is_not_a_merge(self):
        self.assertNotIn("merge", one(sh(1, "git merge-base --is-ancestor a b")))
        self.assertIn("merge", one(sh(1, "git merge feature")))

    def test_an_uppercase_c8_label_is_not_the_c8_tool(self):
        self.assertNotIn("coverage", one(sh(1, 'echo "=== C8: tracksViewChanges ==="')))
        self.assertIn("coverage", one(sh(1, "npx c8 npm test")))

    def test_urls_py_and_a_privacy_policy_are_not_row_level_security(self):
        self.assertNotIn("rls", one(read(1, "/app/site/urls.py")))
        self.assertNotIn("rls", one(read(1, "/app/public/privacy-policy.html")))
        self.assertIn("rls", one(read(1, "/app/server/alembic/versions/0003_rls.py")))
        self.assertIn("rls", one(read(1, "/app/db/policies/users.sql")))

    def test_the_harness_state_directory_is_not_the_project(self):
        harness = read(1, "/Users/me/.claude/jobs/9f8e7d6c/tmp/screen.py")
        self.assertNotIn("queue", one(harness))
        # A repository's OWN .claude/worktrees is the project.
        project = read(1, "/Users/me/code/app/.claude/worktrees/w1/app/jobs/send.py")
        got = one(project)
        self.assertIn("queue", got)
        self.assertIn("worktree", got)

    def test_the_harness_state_directory_has_no_role_either(self):
        self.assertNotIn("unit_test", one(read(1, "/home/me/.claude/jobs/1/tmp/test_x.py")))
        self.assertIn("unit_test", one(read(1, "/home/me/app/tests/test_x.py")))


class SimpleCommands(unittest.TestCase):
    def test_an_anchored_detector_sees_every_command_in_a_chain(self):
        self.assertIn("makefile", one(sh(1, "cd repo && make test")))
        self.assertIn("regex", one(sh(1, "cat log.txt | grep -n boom")))

    def test_a_separator_inside_quotes_is_data(self):
        self.assertNotIn("makefile", one(sh(1, 'grep -E "a|make b" notes.txt')))

    def test_a_redirection_is_not_a_separator(self):
        self.assertEqual(
            vocab._split_simple("pytest -q 2>&1 | tail -3"), ["pytest -q 2>&1", "tail -3"]
        )
        self.assertEqual(vocab._split_simple("make gen &> out.log"), ["make gen &> out.log"])

    def test_every_separator_splits(self):
        self.assertEqual(
            vocab._split_simple("a; b && c || d | e & f"), ["a", "b", "c", "d", "e", "f"]
        )

    def test_a_leading_subshell_paren_is_dropped(self):
        self.assertEqual(vocab._split_simple("(cd x && make test)"), ["cd x", "make test)"])

    def test_the_truncated_text_the_loaders_write_is_read(self):
        long = "git rebase main && " + "echo x && " * 40
        e = sh(1, long)
        self.assertTrue(e.text.endswith("]"))  # digest._trunc's "…[+N]" tail
        self.assertIn("rebase", one(e))


# ------------------------------------------------------------------ the glossary


class TheGlossary(unittest.TestCase):
    def test_counts_sessions_and_first_seen_by_hand(self):
        a = sess([sh(10, "git commit -m a"), sh(20, "git commit -m b")], "a")
        b = sess([sh(5, "git commit -m c")], "b")
        got = vocab.glossary([a, b])
        row = {t["id"]: t for t in got["terms"]}["commit"]
        self.assertEqual((row["count"], row["sessions"], row["first_seen_ts"]), (3, 2, T0 + 5))
        self.assertEqual(row["word"], "commit")
        self.assertEqual(
            row["definition"], "A saved snapshot of your code with a note saying what changed."
        )
        self.assertEqual(got["n"], 2)

    def test_the_commit_tool_counts_as_a_commit(self):
        self.assertIn("commit", one(call(1, "commit", "Commit abc123 add thing")))

    def test_an_event_matching_two_detectors_of_one_term_counts_once(self):
        e = sh(
            1,
            "git worktree list && cat > /r/worktrees/a/x.py <<'EOF'\nx\nEOF",
            path="/r/worktrees/a/x.py",
            added=1,
        )
        self.assertEqual(one(e)["worktree"]["count"], 1)

    def test_terms_are_ordered_by_first_seen_then_catalog_order(self):
        got = vocab.glossary([sess([sh(3, "docker ps"), sh(1, "git stash && git diff")])])
        self.assertEqual([t["id"] for t in got["terms"]], ["diff", "stash", "container"])

    def test_locked_count_and_catalog_size(self):
        got = vocab.glossary([sess([sh(1, "git diff")])])
        self.assertEqual(got["catalog_size"], len(vocab.CATALOG))
        self.assertEqual(got["locked_count"], len(vocab.CATALOG) - 1)
        self.assertIsNone(got["reason"])
        self.assertEqual(got["basis"], "catalog_detectors_over_session_events")

    def test_nothing_matched_is_a_measured_zero(self):
        got = vocab.glossary([sess([prompt(1, "hello"), ev(2, "assistant", "hi")])])
        self.assertEqual(got["terms"], [])
        self.assertEqual(got["locked_count"], len(vocab.CATALOG))
        self.assertIsNone(got["reason"])

    def test_no_events_is_a_refusal_not_an_empty_glossary(self):
        for sessions in ([], [sess([])]):
            got = vocab.glossary(sessions)
            self.assertEqual(got["terms"], [])
            self.assertIsNone(got["locked_count"])
            self.assertEqual(got["n"], 0)
            self.assertIsInstance(got["reason"], str)
            self.assertFalse(plain.has_dash(got["reason"]))

    def test_the_new_terms_unlock_on_what_the_corpus_did(self):
        got = one(
            sh(1, "railway logs --service grafana"),
            sh(2, "curl -s http://localhost:8003/route?json=x"),
        )
        self.assertIn("monitoring", got)
        self.assertIn("log", got)
        self.assertIn(
            "routing_engine", one(sh(1, "docker pull ghcr.io/valhalla/valhalla-scripted:latest"))
        )

    def test_the_log_term_sees_how_logs_are_actually_read(self):
        for cmd in (
            "railway logs -s api",
            "tail -20 /tmp/metro.log",
            "adb logcat -d",
            "xcrun simctl spawn booted log show --last 5m",
        ):
            with self.subTest(cmd):
                self.assertIn("log", one(sh(1, cmd)))


# ------------------------------------------------------------------ titles

REPO = "/repo"

#: Claude Code's per session scratchpad, spelled the way macOS writes it.
SCRATCH = "/private/tmp/claude-501/-Users-me-app/0a1b2c3d-0000-4000-8000-000000000000/scratchpad"


def src(i, d="src"):
    return f"{REPO}/{d}/m{i}.py"


def tpath(i):
    return f"{REPO}/tests/test_m{i}.py"


def passing_tests(n, start=500):
    return [sh(start + i, "python3 -m pytest -q") for i in range(n)]


class TitleRules(unittest.TestCase):
    def test_debugged(self):
        got = title(sh(1, "pytest -q"), fail(2, "FAILED tests/test_a.py"), sh(3, "pytest -q"))
        self.assertEqual(got["title"], "Debugged a failing test suite")
        self.assertEqual((got["verb"], got["object"], got["count"]), ("debugged", "test_suite", 1))
        self.assertEqual(got["basis"], "failing_test_run_then_passing")

    def test_wired_one_and_two(self):
        one_mig = title(edit(1, f"{REPO}/alembic/versions/0002_add.py", 10))
        self.assertEqual(one_mig["title"], "Wired a database migration")
        two = title(
            edit(1, f"{REPO}/alembic/versions/0002_add.py", 10),
            edit(2, f"{REPO}/migrations/0003_more.sql", 5),
        )
        self.assertEqual(two["title"], "Wired two database migrations")
        self.assertEqual((two["verb"], two["object"], two["count"]), ("wired", "migration", 2))

    def test_debugged_comes_before_wired(self):
        got = title(
            edit(1, f"{REPO}/alembic/versions/0002_add.py", 10),
            sh(2, "pytest"),
            fail(3),
            sh(4, "pytest"),
        )
        self.assertEqual(got["verb"], "debugged")

    def test_refactored_across_modules_and_in_one(self):
        files = [edit(i, src(i, d), 8, 6) for i, d in enumerate(("a", "a", "b", "c", "c"))]
        got = title(*files)
        self.assertEqual(got["title"], "Refactored five files across three modules")
        self.assertEqual((got["verb"], got["count"], got["modules"]), ("refactored", 5, 3))
        same = title(*[edit(i, src(i), 8, 6) for i in range(5)])
        self.assertEqual(same["title"], "Refactored five files in one module")

    def test_refactored_needs_all_three_bars(self):
        four_files = title(*[edit(i, src(i), 8, 6) for i in range(4)])
        self.assertNotEqual(four_files["verb"], "refactored")
        little_removed = title(*[edit(i, src(i), 8, 3) for i in range(5)])  # 15 < 40 / 2
        self.assertNotEqual(little_removed["verb"], "refactored")
        too_small = title(*[edit(i, src(i), 3, 3) for i in range(5)])  # 15 added < 20
        self.assertNotEqual(too_small["verb"], "refactored")

    def test_shipped_one_file_and_many(self):
        got = title(edit(1, src(1), 5), sh(2, "git commit -m x"))
        self.assertEqual(got["title"], "Shipped a change to a source file")
        many = title(
            edit(1, src(1), 30),
            edit(2, src(2), 30),
            edit(3, src(3), 30),
            edit(4, tpath(1), 10),
            sh(5, "git commit -m x"),
        )
        self.assertEqual(many["title"], "Shipped changes to three source files")
        self.assertEqual((many["verb"], many["object"], many["count"]), ("shipped", "source", 3))

    def test_committed_with_no_line_count_is_titled_by_its_commits(self):
        self.assertEqual(title(sh(1, "git commit -m x"))["title"], "Landed a commit")
        got = title(*[sh(i, f"git commit -m c{i}") for i in range(3)])
        self.assertEqual(got["title"], "Landed three commits")
        self.assertEqual((got["verb"], got["object"], got["count"]), ("committed", "commit", 3))

    def test_tested(self):
        got = title(
            edit(1, tpath(1), 30),
            edit(2, tpath(2), 30),
            edit(3, src(1), 10),
            *passing_tests(3),
        )
        self.assertEqual(got["title"], "Built out two test files")
        self.assertEqual((got["verb"], got["object"], got["count"]), ("tested", "test", 2))

    def test_tested_needs_three_runs_and_half_the_lines(self):
        two_runs = title(edit(1, tpath(1), 30), *passing_tests(2))
        self.assertNotEqual(two_runs["verb"], "tested")
        mostly_source = title(edit(1, tpath(1), 10), edit(2, src(1), 30), *passing_tests(3))
        self.assertNotEqual(mostly_source["verb"], "tested")

    def test_built(self):
        got = title(write(1, src(1), 70), write(2, src(2), 30))
        self.assertEqual(got["title"], "Built out two source files")
        self.assertEqual(title(write(1, src(1), 99))["verb"], "edited")

    def test_explored_at_the_investigated_floor(self):
        eight = [read(i, src(i % 3)) for i in range(vocab.EXPLORED_MIN_READS)]
        got = title(*eight)
        self.assertEqual(got["title"], "Read through three source files")
        self.assertEqual(title(*eight[:-1])["verb"], "looked_around")

    def test_the_explored_floor_is_the_investigated_cause_floor(self):
        def causes(n):
            evs = [read(i, src(i)) for i in range(n)]
            seg = burn.Segment(index=0, start_ts=T0, end_ts=T0 + n, prompt="", events=evs)
            return {c["cause"] for c in seg.causes()}

        self.assertIn("investigated", causes(vocab.EXPLORED_MIN_READS))
        self.assertNotIn("investigated", causes(vocab.EXPLORED_MIN_READS - 1))

    def test_worked_through(self):
        evs = []
        for i in range(patterns.STUCK_FAILURES):
            evs += [sh(2 * i, "npm run build"), fail(2 * i + 1)]
        got = title(*evs)
        self.assertEqual(got["title"], "Worked through a stubborn failure")
        self.assertEqual(
            (got["verb"], got["object"], got["count"]), ("worked_through", "failure", 4)
        )

    def test_edited(self):
        got = title(edit(1, f"{REPO}/config/app.yaml", 2))
        self.assertEqual(got["title"], "Edited a config file")
        self.assertEqual(got["basis"], "writes_by_file_role")

    def test_a_pure_deletion_still_names_its_role(self):
        # No lines added anywhere, so the role with the most FILES names it.
        got = title(edit(1, src(1), 0, 12), edit(2, tpath(1), 0, 3), edit(3, src(2), 0, 1))
        self.assertEqual(got["title"], "Edited two source files")

    def test_a_sed_touch_is_not_a_write(self):
        # `patterns._wrote`: `sed -i` names a path and no count, a touch and not a magnitude.
        got = title(sh(1, "sed -i 's/a/b/' src/app.py", path="src/app.py"))
        self.assertEqual(got["verb"], "looked_around")

    def test_looked_around(self):
        got = title(sh(1, "ls"), sh(2, "grep -rn x ."))
        self.assertEqual(got["title"], "Looked around the codebase")
        self.assertEqual(
            (got["verb"], got["object"], got["count"]), ("looked_around", "codebase", None)
        )

    def test_numbers_above_twenty_are_digits(self):
        got = title(*[write(i, src(i), 10) for i in range(21)])
        self.assertEqual(got["title"], "Built out 21 source files")

    def test_role_nouns_come_from_the_one_noun_table(self):
        self.assertEqual(title(edit(1, f"{REPO}/Makefile", 2))["title"], "Edited the build setup")
        self.assertEqual(
            title(edit(1, f"{REPO}/docs/a.md", 2), edit(2, f"{REPO}/docs/b.md", 2))["title"],
            "Edited two docs",
        )

    def test_the_role_with_the_most_lines_names_the_title(self):
        got = title(
            edit(1, tpath(1), 5),
            edit(2, tpath(2), 5),
            edit(3, src(1), 50),
            sh(4, "git commit -m x"),
        )
        self.assertEqual(got["title"], "Shipped a change to a source file")

    def test_every_answer_uses_the_enums(self):
        for got in (
            title(sh(1, "ls")),
            title(edit(1, src(1), 2)),
            title(sh(1, "git commit -m x")),
            title(sh(1, "pytest"), fail(2), sh(3, "pytest")),
        ):
            self.assertIn(got["verb"], vocab.VERBS)
            self.assertIn(got["object"], vocab.OBJECTS)
            self.assertIsNone(got["reason"])
            self.assertGreater(got["n"], 0)


class TitleRefusals(unittest.TestCase):
    def test_no_tool_calls_is_refused_not_called_looking_around(self):
        got = title(prompt(1, "hello"), ev(2, "assistant", "hi"))
        self.assertIsNone(got["title"])
        self.assertIsNone(got["verb"])
        self.assertEqual(got["n"], 0)
        self.assertIsInstance(got["reason"], str)

    def test_a_sitting_the_parser_cannot_see_is_refused(self):
        calls = [
            sh(i, f"python3 - <<'PY'\np='src/a.py'\nPY  # {i}")
            for i in range(feedback.MIN_TOOL_CALLS)
        ]
        got = title(*calls)
        self.assertIsNone(got["title"])
        self.assertEqual(got["n"], feedback.MIN_TOOL_CALLS)
        self.assertIn(f"0 of {feedback.MIN_TOOL_CALLS} tool calls", got["reason"])
        self.assertFalse(plain.has_dash(got["reason"]))

    def test_below_the_call_floor_it_is_only_looking_around(self):
        calls = [sh(i, "python3 - <<'PY'\nx\nPY") for i in range(feedback.MIN_TOOL_CALLS - 1)]
        self.assertEqual(title(*calls)["verb"], "looked_around")

    def test_the_blind_guard_also_stops_explored(self):
        reads = [read(i, src(i)) for i in range(8)]
        shells = [sh(100 + i, "python3 - <<'PY'\nx\nPY") for i in range(12)]
        self.assertIsNone(title(*reads, *shells)["title"])

    def test_one_checkpoint_in_twenty_is_enough_to_see(self):
        calls = [sh(i, "ls") for i in range(19)] + [sh(99, "pytest -q")]
        self.assertEqual(title(*calls)["verb"], "looked_around")

    def test_a_blind_sitting_that_committed_is_titled_by_its_commits(self):
        calls = [sh(i, "python3 - <<'PY'\nx\nPY") for i in range(30)] + [sh(99, "git commit -m x")]
        self.assertEqual(title(*calls)["verb"], "committed")

    def test_writes_that_name_no_file_are_refused_not_called_looking_around(self):
        patch = ev(1, "tool", "*** Begin Patch", tool="apply_patch", added=12, removed=0)
        got = title(patch)
        self.assertIsNone(got["title"])
        self.assertEqual(
            got["reason"], "the one write names no file, so there is no role to title the work by"
        )
        two = title(patch, ev(2, "tool", "*** Begin Patch", tool="apply_patch", added=3, removed=0))
        self.assertTrue(two["reason"].startswith("none of the 2 writes names a file"))
        self.assertFalse(plain.has_dash(got["reason"]))

    def test_a_commit_beside_pathless_writes_is_titled_by_the_commit(self):
        patch = ev(1, "tool", "*** Begin Patch", tool="apply_patch", added=12, removed=0)
        self.assertEqual(title(patch, sh(2, "git commit -m x"))["title"], "Landed a commit")


class TitleNames(unittest.TestCase):
    def test_names_appends_the_most_common_parent_directory(self):
        evs = (
            edit(1, src(1, "zqxdir"), 5),
            edit(2, src(2, "zqxdir"), 5),
            edit(3, src(3, "other"), 5),
        )
        self.assertEqual(title(*evs)["title"], "Edited three source files")
        self.assertEqual(title(*evs, names=True)["title"], "Edited three source files in zqxdir")

    def test_names_false_never_carries_a_path_word(self):
        got = title(write(1, "/Users/zqxuser/zqxproj/zqxdir/zqxfile.py", 150))
        self.assertNotIn("zqx", json.dumps(got))

    def test_a_file_at_the_root_appends_nothing(self):
        self.assertEqual(title(edit(1, "/a.py", 2), names=True)["title"], "Edited a source file")

    def test_a_tie_between_directories_goes_to_the_first_one_written(self):
        got = title(edit(1, src(1, "second_seen"), 5), edit(0, src(2, "first_seen"), 5), names=True)
        # Event order, not timestamp order and not set order: the session's events are
        # already in time order when the sessionizer hands them over.
        self.assertEqual(got["title"], "Edited two source files in second_seen")


# ------------------------------------------------------------------ stack


def python_lines(n, path="/repo/app.py"):
    return write(1, path, n)


class TheStack(unittest.TestCase):
    def test_a_manifest_only_item_has_no_timestamp_and_zero_sessions(self):
        got = items(vocab.stack([sess([sh(1, "ls")])], dependencies=["FastAPI"]))
        self.assertEqual(got["fastapi"]["evidence"], "manifest")
        self.assertIsNone(got["fastapi"]["first_seen_ts"])
        self.assertEqual(got["fastapi"]["sessions"], 0)
        self.assertEqual(got["fastapi"]["name"], "FastAPI")
        self.assertEqual(got["fastapi"]["category"], "framework")

    def test_manifest_prefixes(self):
        deps = [
            "expo-router",
            "@aws-sdk/client-s3",
            "psycopg2-binary",
            "jest-expo",
            "@sentry/react-native",
        ]
        got = items(vocab.stack([], dependencies=deps))
        self.assertTrue({"expo", "aws", "postgres", "jest", "sentry"} <= set(got))

    def test_an_exact_name_is_not_a_prefix(self):
        got = items(vocab.stack([], dependencies=["reactive", "nextra", "pgadmin"]))
        self.assertNotIn("react", got)
        self.assertNotIn("nextjs", got)
        self.assertNotIn("postgres", got)

    def test_manifest_beats_command_but_the_events_still_date_it(self):
        s = sess([sh(7, "python3 -m pytest -q")])
        got = items(vocab.stack([s], dependencies=["pytest"]))["pytest"]
        self.assertEqual(
            (got["evidence"], got["sessions"], got["first_seen_ts"]), ("manifest", 1, T0 + 7)
        )

    def test_command_and_path_evidence(self):
        s = sess(
            [
                sh(1, "docker ps"),
                read(2, "/repo/mobile/eas.json"),
            ]
        )
        got = items(vocab.stack([s]))
        self.assertEqual(got["docker"]["evidence"], "command")
        self.assertEqual(got["eas"]["evidence"], "path")

    def test_an_mcp_servers_name_is_never_stack_evidence(self):
        """privacy/upload-contract.json: MCP server names are never present. A stack item an
        MCP tool name put there carried the server's identity to the wire: FOUND IN REVIEW,
        `mcp__app-store-connect__list_builds` gave the wire item `app_store_connect`,
        evidence `tool`. A sentinel server name reaches nothing either."""
        s = sess(
            [
                call(1, "mcp__plugin_posthog_posthog__exec"),
                call(2, "mcp__app-store-connect__list_builds"),
                call(3, "mcp__zqxsentinel__do_thing"),
            ]
        )
        res = {"glossary": vocab.glossary([s]), "stack": vocab.stack([s]), "titles": [vocab.session_title(s)]}
        self.assertEqual(items(res["stack"]), {})
        blob = json.dumps(vocab.wire(res)).lower()
        for name in ("zqx", "posthog", "app-store", "app_store"):
            self.assertNotIn(name, blob)
        # The glossary still says an MCP server ran, without naming it.
        self.assertIn("mcp", {t["id"] for t in res["glossary"]["terms"]})
        # With the manifest, PostHog is on the stack, and no session is counted for it.
        got = items(vocab.stack([s], dependencies=["posthog-js"]))["posthog"]
        self.assertEqual((got["evidence"], got["sessions"]), ("manifest", 0))

    def test_command_comes_before_path_in_the_evidence_order(self):
        s = sess([read(1, "/repo/Dockerfile"), sh(2, "docker build .")])
        got = items(vocab.stack([s]))["docker"]
        self.assertEqual((got["evidence"], got["first_seen_ts"]), ("command", T0 + 1))

    def test_an_existence_probe_is_not_evidence(self):
        self.assertNotIn("docker", items(vocab.stack([sess([sh(1, "which docker psql")])])))

    def test_language_evidence_comes_from_the_language_split(self):
        s = sess([python_lines(languages.MIN_LINES), edit(2, "/repo/README.md", 40)])
        got = items(vocab.stack([s]))
        self.assertEqual((got["python"]["evidence"], got["python"]["sessions"]), ("language", 1))
        self.assertNotIn("markdown", got)  # a split name the catalog does not map

    def test_below_the_line_floor_languages_are_refused_with_the_splits_reason(self):
        res = vocab.stack([sess([python_lines(languages.MIN_LINES - 1)])])
        self.assertNotIn("python", items(res))
        self.assertEqual(
            res["language_reason"],
            languages.split([sess([python_lines(languages.MIN_LINES - 1)])])["reason"],
        )

    def test_only_catalog_ids_and_enums_come_out(self):
        s = sess([python_lines(300), sh(1, "docker ps && git status"), read(2, "/r/eas.json")])
        res = vocab.stack([s], dependencies=["react", "zqxunknown", "expo"])
        ids = {x.id for x in vocab.STACK}
        for r in res["items"]:
            self.assertIn(r["id"], ids)
            self.assertIn(r["category"], vocab.CATEGORIES)
            self.assertIn(r["evidence"], vocab.EVIDENCE)

    def test_no_manifest_string_reaches_the_output(self):
        res = vocab.stack(
            [sess([sh(1, "ls")])], dependencies=["zqxdep-private", "@zqxcorp/internal", "react"]
        )
        self.assertNotIn("zqx", json.dumps(res))
        self.assertIn("react", items(res))
        self.assertEqual(res["manifest_names"], 3)

    def test_items_are_grouped_by_category_then_sessions(self):
        a = sess([sh(1, "git status"), sh(2, "docker ps")], "a")
        b = sess([sh(1, "git status")], "b")
        res = vocab.stack([a, b], dependencies=["react"])
        order = [r["id"] for r in res["items"]]
        self.assertLess(order.index("react"), order.index("docker"))  # framework before infra
        self.assertLess(order.index("docker"), order.index("git"))  # infra before tooling
        self.assertEqual(items(res)["git"]["sessions"], 2)

    def test_nothing_to_read_is_a_refusal(self):
        res = vocab.stack([], dependencies=())
        self.assertEqual(res["items"], [])
        self.assertIsInstance(res["reason"], str)
        self.assertFalse(plain.has_dash(res["reason"]))

    def test_manifests_alone_answer(self):
        res = vocab.stack([], dependencies=["react"])
        self.assertIsNone(res["reason"])
        self.assertEqual(res["n"], 0)
        self.assertIsNone(res["language_reason"])

    def test_the_corpus_stack_items(self):
        # One command each for what RideGT is built on, as the corpus ran it.
        s = sess(
            [
                sh(1, "curl -s https://gatech.transloc.com/Services/JSONPRelay.svc/GetStops"),
                sh(2, "railway logs --service valhalla"),
                sh(3, "npx eas-cli channel:list --json"),
                sh(4, "xcrun simctl list devices booted"),
                sh(5, "adb logcat -d"),
                sh(6, "firebase projects:list"),
                sh(7, "gcloud auth list"),
                sh(8, "curl -s https://maps.googleapis.com/maps/api/geocode/json"),
            ]
        )
        got = items(vocab.stack([s]))
        for iid in (
            "transloc",
            "valhalla",
            "railway",
            "eas",
            "xcode",
            "android_sdk",
            "firebase",
            "google_cloud",
            "google_maps",
        ):
            self.assertIn(iid, got)

    def test_firebase_from_its_config_file(self):
        got = items(vocab.stack([sess([read(1, "/repo/mobile/google-services.json")])]))
        self.assertEqual(got["firebase"]["evidence"], "path")


# ------------------------------------------------------------------ wire and privacy

SENTINELS = ("zqxprompt", "zqxpath", "zqxsubject", "zqxdep", "zqxdir")


def sentinel_corpus():
    s = sess(
        [
            prompt(0, "please fix zqxprompt now"),
            write(1, "/Users/me/zqxpath/zqxdir/app.py", 150),
            read(2, "/Users/me/zqxpath/zqxdir/tests/test_app.py"),
            sh(3, 'git commit -m "zqxsubject landed"'),
            sh(4, "python3 -m pytest -q"),
            fail(5, "Traceback (most recent call last):\n  File zqxpath"),
        ]
    )
    return [s]


class TheWire(unittest.TestCase):
    def test_no_sentinel_reaches_any_wire(self):
        sessions = sentinel_corpus()
        g = vocab.glossary(sessions)
        st = vocab.stack(sessions, dependencies=["zqxdep", "react"])
        t = vocab.session_title(sessions[0], names=True)
        self.assertIn("zqxdir", t["title"])  # the LOCAL string exists locally
        for out in (
            vocab.wire(g),
            vocab.wire(st),
            vocab.wire(t),
            vocab.wire({"glossary": g, "stack": st, "titles": [t]}),
        ):
            blob = json.dumps(out)
            for word in SENTINELS:
                self.assertNotIn(word, blob)

    def test_the_unwired_glossary_and_stack_carry_no_sentinel_either(self):
        sessions = sentinel_corpus()
        blob = json.dumps(
            [vocab.glossary(sessions), vocab.stack(sessions, dependencies=["zqxdep"])]
        )
        for word in SENTINELS:
            self.assertNotIn(word, blob)

    def test_rendered_strings_stay_home(self):
        sessions = sentinel_corpus()
        g = vocab.wire(vocab.glossary(sessions))
        self.assertTrue(g["terms"])
        for row in g["terms"]:
            self.assertEqual(set(row), {"id", "word", "first_seen_ts", "sessions", "count"})
        t = vocab.wire(vocab.session_title(sessions[0]))
        self.assertNotIn("title", t)
        self.assertEqual(
            set(t),
            {
                "verb",
                "object",
                "count",
                "modules",
                "basis",
                "n",
                "shell_calls",
                "shell_calls_cut",
                "reason",
            },
        )
        s = vocab.wire(vocab.stack(sessions))
        for row in s["items"]:
            self.assertEqual(
                set(row), {"id", "name", "category", "first_seen_ts", "sessions", "evidence"}
            )

    def test_a_bundle_wires_each_part(self):
        sessions = sentinel_corpus()
        g, st = vocab.glossary(sessions), vocab.stack(sessions)
        t = vocab.session_title(sessions[0])
        got = vocab.wire({"glossary": g, "stack": st, "titles": [t]})
        self.assertEqual(
            got, {"glossary": vocab.wire(g), "stack": vocab.wire(st), "titles": [vocab.wire(t)]}
        )

    def test_refusals_survive_the_wire(self):
        self.assertIsNone(vocab.wire(vocab.glossary([]))["locked_count"])
        self.assertIsNone(vocab.wire(vocab.session_title(sess([prompt(1, "x")])))["verb"])

    def test_an_unknown_shape_raises(self):
        with self.assertRaises(ValueError):
            vocab.wire({"cards": []})
        with self.assertRaises(ValueError):
            vocab.wire({})


# ------------------------------------------------------------------ no dashes, anywhere

#: One path per role, so every noun a title can use is rendered.
ROLE_PATHS = {
    "test": lambda i: f"{REPO}/tests/test_m{i}.py",
    "source": lambda i: f"{REPO}/src/m{i}.py",
    "config": lambda i: f"{REPO}/conf/c{i}.yaml",
    "docs": lambda i: f"{REPO}/docs/d{i}.md",
    "style": lambda i: f"{REPO}/web/s{i}.css",
    "build": lambda i: f"{REPO}/.github/workflows/w{i}.yml",
    "dependency": lambda i: f"{REPO}/p{i}/package.json",
    "unknown": lambda i: f"{REPO}/x/f{i}.zzz",
    "migration": lambda i: f"{REPO}/migrations/000{i}_m.sql",
}


class NoDashes(unittest.TestCase):
    def test_the_role_paths_have_the_roles_they_claim(self):
        for role, make in ROLE_PATHS.items():
            self.assertEqual(plain.role_of(make(1)), role)
        self.assertEqual(set(ROLE_PATHS), set(plain.ROLES))

    def test_every_title_over_every_role_and_count(self):
        seen = set()
        for make in ROLE_PATHS.values():
            for k in (1, 2, 3, 20, 21):
                for extra in ((), (sh(900, "git commit -m x"),)):
                    small = title(*[edit(i, make(i), 1) for i in range(k)], *extra)
                    big = title(*[write(i, make(i), 120) for i in range(k)], *extra)
                    tested = title(
                        *[edit(i, make(i), 40) for i in range(k)], *passing_tests(3), *extra
                    )
                    for got in (
                        small,
                        big,
                        tested,
                        title(*[read(i, make(i)) for i in range(8 + k)]),
                    ):
                        if got["title"] is not None:
                            seen.add(got["title"])
        for got in (
            title(sh(1, "pytest"), fail(2), sh(3, "pytest")),
            title(*[edit(i, src(i, d), 8, 6) for i, d in enumerate("aabcc")]),
            title(*[edit(i, src(i), 8, 6) for i in range(5)]),
            title(*[sh(i, f"git commit -m {i}") for i in range(1, 4)]),
            title(sh(1, "git commit -m x")),
            title(*[x for i in range(4) for x in (sh(2 * i, "make"), fail(2 * i + 1))]),
            title(sh(1, "ls")),
        ):
            seen.add(got["title"])
        self.assertGreater(len(seen), 40)
        for t in seen:
            self.assertFalse(plain.has_dash(t), t)
            self.assertTrue(t[0].isupper(), t)

    def test_every_reason_this_module_can_give(self):
        reasons = [
            vocab.glossary([])["reason"],
            vocab.stack([])["reason"],
            vocab.stack([sess([python_lines(10)])])["language_reason"],
            vocab.session_title(sess([prompt(1, "x")]))["reason"],
            vocab.session_title(sess([sh(i, "python3 - <<'PY'\nx\nPY") for i in range(40)]))[
                "reason"
            ],
            *(
                vocab.session_title(sess([write(i, f"{SCRATCH}/s{i}.py", 5) for i in range(k)]))[
                    "reason"
                ]
                for k in (1, 2, 3)
            ),
        ]
        for r in reasons:
            self.assertIsInstance(r, str)
            self.assertFalse(plain.has_dash(r), r)


# ------------------------------------------------------------------ through the real parser


def _record(kind, ts, **body):
    base = {
        "type": kind,
        "timestamp": dt.datetime.fromtimestamp(T0 + ts, dt.UTC).isoformat().replace("+00:00", "Z"),
        "uuid": f"u{ts}",
        "parentUuid": None,
        "sessionId": "sid",
    }
    base.update(body)
    return base


class ThroughTheParser(unittest.TestCase):
    """The detectors read `Ev` as `digest.load_claude_code_events` writes it: a Bash
    call's newlines as ` ⏎ `, a heredoc write's path and count, a Read's path."""

    def test_a_claude_code_transcript(self):
        records = [
            _record("user", 0, promptSource="typed", message={"role": "user", "content": "go"}),
            _record(
                "assistant",
                1,
                message={
                    "id": "m1",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "t1",
                            "name": "Bash",
                            "input": {
                                "command": "cat > notes.md <<'EOF'\ngit rebase main\nEOF\ngit merge feature"
                            },
                        },
                        {
                            "type": "tool_use",
                            "id": "t2",
                            "name": "Read",
                            "input": {"file_path": "/repo/tests/test_a.py"},
                        },
                    ],
                },
            ),
        ]
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "t.jsonl"
            path.write_text("".join(json.dumps(r) + "\n" for r in records))
            events = digest.load_claude_code_events(path)
        got = unlocked(sess(events))
        self.assertIn("heredoc", got)
        self.assertIn("merge", got)
        self.assertIn("unit_test", got)
        self.assertNotIn("rebase", got)  # it was in the body
        self.assertEqual(vocab.session_title(sess(events))["title"], "Edited a doc")


# ------------------------------------------------------------------ ground truth regressions
#
# Each test below is one wrong number the module printed on the real corpus
# (`~/.builder-overnight/corpus`, 57 root transcripts, 157 counted sessions, 2026-09-13),
# found by recomputing its outputs from the raw JSONL. The docstring carries the measured
# numbers; the positive twin sits beside every negative so neither passes by the detector
# never firing.


def tool(ts, name, text, tool_id, path=None, added=None, removed=None):
    """A tool call carrying its call id, as every real loader stamps it."""
    return Ev(
        0,
        T0 + ts,
        "tool",
        text,
        tool=name,
        path=path,
        added=added,
        removed=removed,
        tool_id=tool_id,
    )


def _asst(uuid, sid, ts, mid, blocks):
    return {
        "type": "assistant",
        "uuid": uuid,
        "parentUuid": None,
        "sessionId": sid,
        "timestamp": dt.datetime.fromtimestamp(T0 + ts, dt.UTC).isoformat().replace("+00:00", "Z"),
        "message": {"id": mid, "role": "assistant", "content": blocks},
    }


def _bash(tid, command):
    return {"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": command}}


class GroundTruthRegressions(unittest.TestCase):
    def test_a_task_worktree_path_masked_as_a_key_is_not_a_secret(self):
        """`digest.mask`'s `sk-` rule fires on the tail of `task-research-how-much-...`, a
        worktree directory name, and leaves `...worktrees-ta[redacted]/...`. MEASURED: the
        bare `\\[redacted\\]` detector matched 226 shell calls in 40 sessions; 80 of those
        calls, in 13 sessions, were only that path, and 9 of the 40 sessions had no other
        match. After: 146 calls in 31 sessions. A key in a variable or a URL still counts."""
        path = (
            "/private/tmp/claude-501/"
            "-Users-me-app--worktrees-task-research-how-much-cheaper-it-would-be-1627c0"
        )
        masked = digest.mask(f"cat {path}/0a1b/notes.txt")
        self.assertIn("ta[redacted]", masked)  # the real mask, not a hand written string
        self.assertNotIn("secret", one(sh(1, masked)))
        for real in (
            "TRANSLOC_API_KEY=abcdef123456 python3 tools/record.py",
            "PGPASSWORD=hunter2hunter psql -h localhost app",
            'curl -s "https://bus.example.edu/Services/JSONPRelay.svc/GetStops?apiKey=0000000000"',
            "TOKEN=$(gcloud auth print-access-token)",
        ):
            with self.subTest(real):
                self.assertIn("[redacted]", digest.mask(real))
                self.assertIn("secret", one(sh(1, digest.mask(real))))

    def test_a_tool_call_copied_into_a_resumed_transcript_is_read_once(self):
        """A resumed session's new transcript begins with a copy of the old one's records
        (same uuid and timestamp, new sessionId), and the sessionizer pools both files.
        MEASURED: 153 tool_use ids sit in two root transcripts and every one reached a counted
        session twice, in 5 of 157 sessions: one title said 254 tool calls where there were
        140, two said 34 where there were 17, the glossary counted 41 `ssh` calls where there
        were 33 and 12 compactions where there were 11."""
        first = [
            _asst("a1", "old", 1, "m1", [_bash("toolu_A", "git commit -m one")]),
            _asst("a2", "old", 2, "m2", [_bash("toolu_B", "ls")]),
        ]
        copied = [dict(r, sessionId="new") for r in first]
        later = [_asst("a3", "new", 3, "m3", [_bash("toolu_C", "git commit -m two")])]
        with tempfile.TemporaryDirectory() as d:
            old, new = pathlib.Path(d) / "old.jsonl", pathlib.Path(d) / "new.jsonl"
            old.write_text("".join(json.dumps(r) + "\n" for r in first))
            new.write_text("".join(json.dumps(r) + "\n" for r in copied + later))
            # Pooled exactly as `capture.sessions.sessionize_sources` pools a lineage.
            events = sorted(
                digest.load_claude_code_events(old) + digest.load_claude_code_events(new),
                key=lambda e: e.ts,
            )
        self.assertEqual(sum(1 for e in events if e.kind == "tool"), 5)  # the copy is there
        s = sess(events)
        got = vocab.session_title(s)
        self.assertEqual((got["title"], got["count"], got["n"]), ("Landed two commits", 2, 3))
        self.assertEqual(unlocked(s)["commit"]["count"], 2)
        # Events with no call id are copies when everything they carry is the same.
        compacted = sess([ev(5, "compaction"), ev(5, "compaction"), ev(9, "compaction")])
        self.assertEqual(unlocked(compacted)["compaction"]["count"], 2)

    def test_a_call_with_no_id_is_never_merged(self):
        """Aider stamps every call in one turn with the turn's time and writes no call id,
        so two identical test runs in one turn are identical events: two runs, not a copy."""
        runs = [ev(5, "tool", "pytest -q", tool="Bash"), ev(5, "tool", "pytest -q", tool="Bash")]
        s = sess(runs)
        self.assertEqual(unlocked(s)["test_suite"]["count"], 2)
        self.assertEqual(vocab.session_title(s)["n"], 2)

    def test_two_different_calls_are_never_merged(self):
        """The positive twin: the same command twice under two call ids is two calls."""
        s = sess(
            [tool(1, "Bash", "git commit -m a", "t1"), tool(2, "Bash", "git commit -m a", "t2")]
        )
        self.assertEqual(vocab.session_title(s)["count"], 2)
        self.assertEqual(unlocked(s)["commit"]["count"], 2)

    def test_a_search_pattern_is_data_not_the_thing_it_names(self):
        """A `grep`, `rg` or `find` pattern names what the agent LOOKED FOR. MEASURED:
        `grep -n "jwt" builder/settings.py` was the only `jwt` unlock; `grep -vE '^npm
        install|^Proceeding'` (a filter on eas output) was 4 of the 16 `package_manager`
        sessions; `grep -i "uvicorn"` 5 of the 43 `server` sessions; `find -name
        "vercel.json"` counted as a deploy; on the stack TransLoc lost 5 of its 21 sessions,
        Valhalla 2 of 17, Docker 2 of 12."""
        for cmd, term in (
            ('grep -n "jwt" builder/settings.py', "jwt"),
            ("npx eas update:list 2>&1 | grep -vE '^npm install|^Proceeding'", "package_manager"),
            ('ps aux | grep -i "uvicorn"', "server"),
            ('find . -name "vercel.json" -not -path "*/node_modules/*"', "deploy"),
            ("git ls-files | xargs grep -l docker", "container"),
        ):
            with self.subTest(cmd):
                self.assertNotIn(term, one(sh(1, cmd)))
        self.assertIn("regex", one(sh(1, 'grep -n "jwt" builder/settings.py')))
        self.assertEqual(vocab._command_segments('rg -n "docker|valhalla" backend'), ("rg",))
        # What a search RUNS inside `$(...)` is still read, by the same rules.
        self.assertEqual(
            vocab._command_segments('grep -c docker "$(git ls-files)"'), ("grep", "git ls-files")
        )
        for cmd, term in (
            ("npm install axios", "package_manager"),
            ("python3 -m uvicorn main:app --port 5001", "server"),
            ("docker ps", "container"),
        ):
            with self.subTest(cmd):
                self.assertIn(term, one(sh(1, cmd)))
        st = items(vocab.stack([sess([sh(1, 'grep -rn "transloc" config.py')])]))
        self.assertNotIn("transloc", st)
        self.assertIn(
            "transloc", items(vocab.stack([sess([sh(1, "curl -s https://x.transloc.com/a")])]))
        )

    def test_a_version_or_help_request_runs_nothing(self):
        """The same question as `which`, asked of the program. MEASURED:
        `npx --no-install prettier --version` was one of the 3 sessions that unlocked
        `formatter` (1 is left), and `xcodebuild -version` 2 of the 35 that put Xcode on
        the stack."""
        self.assertNotIn("formatter", one(sh(1, "npx --no-install prettier --version 2>/dev/null")))
        self.assertIn("formatter", one(sh(1, "npx --yes prettier --check src")))
        self.assertNotIn("build", one(sh(1, "xcodebuild -version 2>/dev/null")))
        self.assertNotIn("xcode", items(vocab.stack([sess([sh(1, "xcodebuild -version")])])))
        self.assertIn("xcode", items(vocab.stack([sess([sh(1, "xcrun simctl list devices")])])))
        self.assertNotIn("deploy", one(sh(1, "npx eas update --help 2>&1")))

    def test_deploy_is_the_program_shipping_not_a_file_named_after_it(self):
        """MEASURED: the design's `\\b(railway up|vercel|...|eas update)\\b` matched 60
        shell calls in 22 sessions, among them `cat vercel.json`, `git checkout --theirs
        vercel.json`, a `curl` of a `.vercel.app` URL, `vercel ls`, `vercel env pull`,
        `vercel whoami` and `eas update:list`. 28 calls in 17 sessions deploy."""
        for cmd in (
            "cat vercel.json",
            "cat .vercel/project.json 2>/dev/null",
            "git checkout --theirs vercel.json",
            "git add public/privacy.html vercel.json",
            "curl -s https://example-ads.vercel.app/ads",
            "vercel ls 2>&1",
            "vercel env pull .env.local",
            "vercel whoami",
            "vercel projects ls",
            "npx eas update:list --branch production --non-interactive",
            "grep -v -i 'railway up' out.txt",
        ):
            with self.subTest(cmd):
                self.assertNotIn("deploy", one(sh(1, cmd)))
        for cmd in (
            "vercel",
            "npx vercel --prod 2>&1",
            "vercel deploy --prebuilt",
            "railway up --service grafana --detach 2>&1",
            'npx eas update --branch production --platform ios --message "x"',
            "npx eas-cli update --branch production --environment production",
            "eas submit --platform ios",
            "CI=1 npx wrangler deploy",
            "flyctl deploy",
            "timeout 90 railway up",
        ):
            with self.subTest(cmd):
                self.assertIn("deploy", one(sh(1, cmd)))

    def test_eas_build_list_reads_history_and_builds_nothing(self):
        """MEASURED: 34 of the 42 corpus calls the design's `\\beas build\\b` matched were
        `eas build:list`, `build:view` or `build:version:get`; `build` went from 19
        sessions to 9 with them, the probes and the searches out."""
        for cmd in (
            "npx eas build:list --limit 6 --json",
            "eas build:view d7406848",
            "npx eas build:version:get -p ios",
        ):
            with self.subTest(cmd):
                self.assertNotIn("build", one(sh(1, cmd)))
        self.assertIn("build", one(sh(1, "npx eas build --platform ios --profile production")))
        self.assertIn("build", one(sh(1, "swift build 2>&1")))

    def test_scratch_files_are_not_the_projects_work(self):
        """Titles counted files under Claude Code's own state as the session's work.
        MEASURED: 25 of 157 titles change without them. "Shipped changes to twelve source
        files" had four scratchpad scripts among its twelve; "Shipped changes to seven source
        files" six scripts under `~/.claude/jobs/`; "Refactored seven files across five
        modules" three memory notes among its seven (four project files are no refactor)."""
        project = [edit(i, src(i), 20) for i in range(3)]
        scratch = [write(10 + i, f"{SCRATCH}/probe{i}.py", 40) for i in range(4)]
        jobs = [write(20, "/Users/me/.claude/jobs/9f8e7d6c/tmp/harness.py", 300)]
        got = title(*project, *scratch, *jobs, sh(30, "git commit -m x"))
        self.assertEqual(got["title"], "Shipped changes to three source files")
        self.assertEqual((got["count"], got["modules"], got["n"]), (3, 1, 9))
        # Linux spells it /tmp/claude-<uid>/ with no /private in front.
        linux = title(*project, write(10, "/tmp/claude-0/-home-u/1234/scratchpad/a.py", 500))
        self.assertEqual(linux["title"], "Edited three source files")

    def test_memory_notes_do_not_make_a_refactor(self):
        """The corpus's one refactor title: four project files and three memory notes."""
        files = [edit(i, src(i, d), 8, 6) for i, d in enumerate("abcd")]
        notes = [
            edit(10 + i, f"/Users/me/.claude/projects/-Users-me-app/memory/n{i}.md", 10, 8)
            for i in range(3)
        ]
        got = title(*files, *notes)
        self.assertNotEqual(got["verb"], "refactored")
        self.assertEqual(got["title"], "Edited four source files")
        self.assertEqual(title(*files, edit(9, src(9, "e"), 8, 6))["verb"], "refactored")

    def test_only_scratch_written_is_refused_not_titled_as_the_project(self):
        """MEASURED: "Edited eleven docs" was eleven scratchpad `.txt` files, and "Built out
        two source files" two scratch backtest scripts of 280 and 134 lines; both are now
        refused, with the count of files and no path."""
        got = title(*[write(i, f"{SCRATCH}/{c}.txt", 5) for i, c in enumerate("bcdefghijkl")])
        self.assertIsNone(got["title"])
        self.assertEqual(
            got["reason"],
            "all 11 files written were Claude Code's own scratch or notes, so there is no "
            "project work to title",
        )
        two = title(write(1, f"{SCRATCH}/backtest_speed.py", 280), write(2, f"{SCRATCH}/m.py", 134))
        self.assertTrue(two["reason"].startswith("both files written were"))
        self.assertNotIn("scratchpad", json.dumps(two))
        # A session that read its way around AND left a scratch note still explored.
        reads = [read(i, src(i % 3)) for i in range(8)]
        self.assertEqual(title(*reads, write(99, f"{SCRATCH}/n.md", 3))["verb"], "explored")

    def test_a_relative_write_after_a_cd_into_the_scratchpad_is_scratch(self):
        """A heredoc from the working directory records a RELATIVE path. MEASURED: of 303
        relative shell writes, 142 were in commands whose only `cd`s went into Claude Code's
        state, 128 in commands whose `cd`s went only elsewhere, none into both, 33 had no
        `cd`. The 142 changed 17 titles, e.g. "Built out seven source files" (seven parts of
        a page assembled in the scratchpad; the project gained one test file) and "Shipped
        changes to eight source files" where `git log` shows seven committed."""
        parts = [
            sh(
                i,
                f"cd {SCRATCH} && cat > part{i}.html <<'EOF'\n<p>x</p>\nEOF",
                path=f"part{i}.html",
                added=150,
            )
            for i in range(7)
        ]
        test_file = edit(20, tpath(1), 46)
        got = title(*parts, test_file)
        self.assertEqual(got["title"], "Edited a test file")
        # The positive twins: a cd into the project, and no cd at all, stay the project's.
        into_repo = sh(
            1, "cd /repo && cat > src/a.py <<'EOF'\nx = 1\nEOF", path="src/a.py", added=120
        )
        self.assertEqual(title(into_repo)["title"], "Built out a source file")
        no_cd = sh(1, "cat > b.py <<'EOF'\nx = 1\nEOF", path="b.py", added=120)
        self.assertEqual(title(no_cd)["title"], "Built out a source file")
        # A command that also cds somewhere that is not Claude Code's own is not scratch.
        both = sh(
            1, f"cd {SCRATCH} && ls; cd /repo && cat > c.py <<'EOF'\nx\nEOF", path="c.py", added=120
        )
        self.assertFalse(vocab._harness_event(both))
        self.assertTrue(vocab._harness_event(parts[0]))
        self.assertFalse(vocab._harness_event(read(1, "rel/notes.md")))  # only shell writes
        # The glossary reads its path facets the same way: a scratch `.sh` is not a script
        # of the project's (`shell_script` went from 10 sessions to 5).
        sh_file = sh(1, f"cd {SCRATCH} && cat > run.sh <<'EOF'\necho\nEOF", path="run.sh", added=2)
        self.assertNotIn("shell_script", one(sh_file))
        self.assertIn(
            "shell_script",
            one(sh(1, "cd /repo && cat > run.sh <<'EOF'\necho\nEOF", path="run.sh", added=2)),
        )

    def test_scratch_paths_unlock_no_path_term_and_no_language(self):
        """MEASURED: both `mock` unlocks were scratchpad files (one a screenshot called
        `80-mock.png`), and HTML was on the stack for 21 sessions where 10 had only written
        HTML into the scratchpad, the pages an agent renders for itself (11 after, and 7
        once the relative writes made from the scratchpad are out too)."""
        self.assertNotIn("mock", one(read(1, f"{SCRATCH}/shots/80-mock.png")))
        self.assertIn("mock", one(read(1, "/repo/tests/mock_api.py")))
        # A heredoc INTO the scratchpad is still a heredoc: the command is the agent's.
        self.assertIn(
            "heredoc",
            one(sh(1, f"cat > {SCRATCH}/a.py <<'EOF'\nx\nEOF", path=f"{SCRATCH}/a.py", added=1)),
        )
        s = sess([write(1, "/repo/app.py", 300), write(2, f"{SCRATCH}/report.html", 900)])
        got = items(vocab.stack([s]))
        self.assertIn("python", got)
        self.assertNotIn("html", got)
        s2 = sess([write(1, "/repo/app.py", 300), write(2, "/repo/public/index.html", 900)])
        self.assertIn("html", items(vocab.stack([s2])))
        # Scratch lines cannot lift a project over the split's line floor either.
        below = sess([write(1, "/repo/app.py", 150), write(2, f"{SCRATCH}/probe.py", 300)])
        res = vocab.stack([below])
        self.assertNotIn("python", items(res))
        self.assertEqual(res["language_reason"], "150 attributable line(s), 200 needed")

    def test_every_result_says_how_many_shell_calls_the_digest_cut(self):
        """Every loader cuts a shell command at `digest.COMMAND_MAX` (160) characters, and a
        command after the cut is invisible to every detector here. MEASURED on the corpus:
        6,581 of 8,981 shell calls (73%) in 154 of 157 sessions are cut; from the raw JSONL
        `git commit` ran in 320 calls in 96 sessions and the cut text shows 147 in 71, and
        45 of 157 titles change when commands are read whole. Not repairable in this module
        (the text is gone before it arrives), so the counts are labelled lower bounds by
        carrying the coverage beside them, with no verdict."""
        long = "cd /repo && git add " + " ".join(f"src/module_{i}.py" for i in range(12))
        long += " && git commit -m 'land it'"
        e = sh(1, long)
        self.assertTrue(e.text.endswith("]"))  # cut, and the commit is past the cut
        self.assertNotIn("git commit", e.text)
        s = sess([e, sh(2, "git status")])
        g = vocab.glossary([s])
        self.assertNotIn("commit", {t["id"] for t in g["terms"]})  # the limitation, pinned
        self.assertEqual((g["shell_calls"], g["shell_calls_cut"]), (2, 1))
        st = vocab.stack([s])
        self.assertEqual((st["shell_calls"], st["shell_calls_cut"]), (2, 1))
        t = vocab.session_title(s)
        self.assertEqual((t["shell_calls"], t["shell_calls_cut"]), (2, 1))
        for out in (vocab.wire(g), vocab.wire(st), vocab.wire(t)):
            self.assertEqual(out["shell_calls_cut"], 1)
        # A measured zero when nothing was cut, and zero shell calls when there were none.
        short = vocab.glossary([sess([sh(1, "git commit -m x")])])
        self.assertEqual((short["shell_calls"], short["shell_calls_cut"]), (1, 0))
        none = vocab.session_title(sess([read(1, src(1))]))
        self.assertEqual((none["shell_calls"], none["shell_calls_cut"]), (0, 0))
        refused = vocab.session_title(sess([prompt(1, "hi")]))
        self.assertEqual((refused["shell_calls"], refused["shell_calls_cut"]), (0, 0))

    def test_modules_is_none_when_no_project_file_was_written(self):
        """Absent is not zero. MEASURED: 37 titles carried `modules: 0`, among them every
        "Landed a commit" whose edits were `python3 - <<'PY'` scripts the parser cannot see
        into; zero directories changed is a claim those events cannot make."""
        self.assertIsNone(title(sh(1, "git commit -m x"))["modules"])
        self.assertIsNone(title(sh(1, "ls"), sh(2, "git status"))["modules"])
        self.assertEqual(title(edit(1, src(1), 2))["modules"], 1)
        refactor = title(*[edit(i, src(i, d), 8, 6) for i, d in enumerate("aabcc")])
        self.assertEqual(refactor["modules"], 3)


if __name__ == "__main__":
    unittest.main()

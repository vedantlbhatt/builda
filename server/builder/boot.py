import logging

from sqlalchemy import text

from .db import engine
from .settings import settings

log = logging.getLogger("builder.boot")


class UnsafeDatabaseRole(SystemExit):
    pass


def assert_rls_enforced() -> None:
    """Refuse to start if the API's connection can bypass row level security.

    This check exists because the failure it catches is invisible. Railway hands you a
    superuser DATABASE_URL; superusers bypass RLS unconditionally; every policy becomes a
    no-op; and an isolation test connecting as that same superuser passes. The guarantee
    fails OPEN, with a green test suite and no error anywhere.

    A crash on boot is the only failure mode loud enough to be safe.
    """
    with engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT current_user AS who,
                       current_setting('is_superuser') AS su,
                       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS brls
                """
            )
        ).one()

    if row.su == "on" or row.brls:
        raise UnsafeDatabaseRole(
            f"FATAL: the API is connected as '{row.who}', which bypasses row level "
            "security (superuser or BYPASSRLS). Every policy is a silent no-op and user "
            "isolation is not enforced. Set APP_DATABASE_URL to the builder_app role. "
            "Refusing to start."
        )

    log.info("RLS enforced: connected as %s (nosuperuser, nobypassrls)", row.who)


def assert_policies_present() -> None:
    """A role that cannot bypass RLS is not enough — the tables must actually have it on.

    A table with RLS disabled is readable by everyone regardless of role, so this catches
    a migration that was written but never run.
    """
    required = {
        "sessions",
        "session_strips",
        "session_stats",
        # 0006. The one table that stores prose; a deployment where that migration never
        # ran must not serve analyses with RLS off.
        "session_analysis",
        "repo_visibility",
        "devices",
        "push_tokens",
        "identities",
        # 0007. The social tables: a post's visibility IS its policy, so a deployment
        # where the migration never ran would serve every post to everyone.
        "posts",
        "post_media",
        "kudos",
        "comments",
        "follows",
        "factions",
        "faction_members",
        # 0008. Owner-only: a record that a session's completion was announced. Without
        # RLS one viewer could read when another's sessions finished.
        "session_notifications",
        # 0011. A key's hash is not a secret once it is a row another viewer can read and
        # offline-match; owner-only like devices.
        "capture_keys",
        # 0014. Raw transcript bytes from the hook channel — the conversation itself,
        # held until the session is final. Owner-only.
        "transcript_chunks",
        # 0016. Prose about the PERSON, not about a session. Owner-only with no public
        # policy at all, so a deployment where the migration never ran must not serve it.
        "builder_narrative",
        # 0018. Numbers about the PERSON, from transcripts the server never sees. Same
        # shape as 0016 and for the same reason: sharing a session shares a session.
        "builder_report",
        # 0020. A running session's live state (and, opt in, its file basenames), and the
        # two privacy switches with the salt the hook channel hashes paths under. Owner
        # only: a deployment without the migration must not serve another person's live
        # map, or hand out a salt.
        "session_live",
        "privacy_prefs",
        # 0021. Prompts, VERBATIM, for the Wrapped cards: the second opt-in exception.
        # With RLS off every quote would be readable by every viewer.
        "builder_quotes",
        # 0022. Where a Live Activity's pushes go. Another viewer's token is another
        # person's Lock Screen.
        "live_activity_tokens",
        # 0026. A project's published demo: images of a person's own app, which may show a
        # private repository's name. Owner only whatever else is shared.
        "project_media",
        # 0030. The phone's requests for a demo, and published ship kits: the same pictures
        # in more shapes, and captions written from commit subjects. Owner only.
        "demo_requests",
        "ship_kits",
        "ship_kit_media",
        # 0031 and 0032. Where a drop's and a demo's Live Activity pushes go: another viewer's
        # token is another person's Lock Screen, as for 0022.
        "drop_activity_tokens",
        "demo_activity_tokens",
    }
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT relname, relrowsecurity, relforcerowsecurity
                FROM pg_class WHERE relname = ANY(:names)
                """
            ),
            {"names": list(required)},
        ).all()

    found = {r.relname for r in rows}
    missing = required - found
    if missing:
        raise UnsafeDatabaseRole(
            f"FATAL: tables missing entirely: {sorted(missing)}. Run migrations."
        )

    unprotected = [r.relname for r in rows if not (r.relrowsecurity and r.relforcerowsecurity)]
    if unprotected:
        raise UnsafeDatabaseRole(
            f"FATAL: row level security is not enabled+forced on {sorted(unprotected)}. "
            "Refusing to start."
        )


def assert_object_store_safe() -> None:
    """Refuse to start with an object store configuration that would expose project demos.

    `objectstore.store_config_problem` is the rule: the demos bucket must be its own and
    private (not the posts bucket, not reached by the posts' public base, no public base of
    its own, all four settings or none), and a file:// store is the local stack's, never
    production's. FOUND IN THE SECURITY REVIEW (2026-09-14): demos sharing the posts bucket
    were one cut query string from a permanent public link. Every environment, test
    included: a wrong store configuration is wrong wherever it is set."""
    from . import objectstore

    problem = objectstore.store_config_problem()
    if problem:
        raise UnsafeDatabaseRole(f"FATAL: {problem} Refusing to start.")


def run_startup_checks() -> None:
    assert_object_store_safe()
    if settings().environment == "test":
        return
    assert_rls_enforced()
    assert_policies_present()

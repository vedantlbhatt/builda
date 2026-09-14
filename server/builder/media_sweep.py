"""`python -m builder.media_sweep [--dry-run]`: the periodic sweep of the demos store.

docs/demos.md, "Storage". Every request that deletes a demo sweeps that person's prefix
(`project_media.sweep`): a delete, a replacing commit, a commit whose row is gone, an
exclusion, an account deletion. What none of them can catch is an upload that lands AFTER
the last of them: a presigned PUT stays good at the bucket for up to
`project_media.upload_seconds` after its row is gone, and nothing at the bucket checks the
row (FOUND IN THE SECURITY REVIEW, 2026-09-14). So this runs the same rule
(`project_media.kept_keys`) over every prefix under `project-media/`, and first deletes the
rows of publishes abandoned longer than `PENDING_GRACE_SECONDS`, whose objects then go with
the rest. Run it on a schedule (hourly is plenty: a stray upload is unreadable, since every
read goes through a row, and this is about keeping the promise that a deleted demo is gone).

IT MUST SEE EVERY ROW, OR IT DELETES EVERYTHING. Under the owner policy a connection with no
viewer reads no rows, keeps nothing and would empty the bucket. So it connects as
WORKER_DATABASE_URL (builder_worker, BYPASSRLS by definition, 0003) or DATABASE_URL (the
migration owner), never the API's builder_app, and refuses to delete anything unless the
connection is superuser or BYPASSRLS. No default URL either: the settings' fallback names a
database this machine may hold for something else.

Order matters for a publish running while it sweeps: the store is listed BEFORE the rows are
read. A presign writes its row before it hands out a URL, so any object in the listing whose
row still exists had that row before the listing, and the read that follows sees it.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text

from . import objectstore
from .project_media import PENDING_GRACE_SECONDS, delete_objects, kept_keys

PREFIX = "project-media/"


class CannotSeeEveryRow(SystemExit):
    pass


def sweep_all(engine, *, now: datetime | None = None, dry_run: bool = False) -> dict:
    """Sweep the whole demos store. Returns what it found and did (keys included, so a dry
    run can be read); raises `CannotSeeEveryRow` before touching anything when the connection
    is subject to row level security."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(seconds=PENDING_GRACE_SECONDS)
    with engine.begin() as c:
        role = c.execute(
            text(
                "SELECT current_user AS who, current_setting('is_superuser') AS su, "
                "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS brls"
            )
        ).one()
        if not (role.su == "on" or role.brls):
            raise CannotSeeEveryRow(
                f"media_sweep: connected as {role.who}, which row level security limits to "
                "one viewer's rows (none without one): every object would look unkept. "
                "Use WORKER_DATABASE_URL (builder_worker) or DATABASE_URL (the owner)."
            )
        stale_sql = "FROM project_media WHERE NOT committed AND created_at < :cutoff"
        stale = c.execute(
            text(
                f"SELECT object_key, poster_object_key {stale_sql}"
                if dry_run
                else f"DELETE {stale_sql} RETURNING object_key, poster_object_key"
            ),
            {"cutoff": cutoff},
        ).all()
    listed = objectstore.media_list(PREFIX)
    with engine.connect() as c:
        rows = c.execute(
            text("SELECT object_key, poster_object_key, committed, created_at FROM project_media")
        ).all()
    keep = kept_keys(rows, now)
    orphans = [k for k in listed if k not in keep]
    return {
        "role": role.who,
        "listed": len(listed),
        "kept": len(listed) - len(orphans),
        "orphans": orphans,
        "deleted": 0 if dry_run else delete_objects(orphans),
        "abandoned_rows": len(stale),
        "dry_run": dry_run,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m builder.media_sweep",
        description="Delete every object in the demos store that no row keeps, and the rows "
        "of publishes abandoned for longer than half an hour.",
    )
    ap.add_argument("--dry-run", action="store_true", help="say what would go; delete nothing")
    ap.add_argument(
        "--database-url",
        help="a connection that sees every row (default WORKER_DATABASE_URL, then DATABASE_URL)",
    )
    a = ap.parse_args(argv)
    url = a.database_url or os.environ.get("WORKER_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        print(
            "media_sweep: set WORKER_DATABASE_URL (or DATABASE_URL, or --database-url) to a "
            "connection that sees every row",
            file=sys.stderr,
        )
        return 2
    if objectstore.media_backend() is None:
        print("media_sweep: the demos store is not configured (MEDIA_STORE_*)", file=sys.stderr)
        return 2
    r = sweep_all(create_engine(url, future=True), dry_run=a.dry_run)
    unkept = len(r["orphans"])
    went = f"would delete {unkept}" if r["dry_run"] else f"deleted {r['deleted']}"
    rows = "found" if r["dry_run"] else "deleted"
    print(
        f"media_sweep as {r['role']}: {r['listed']} objects under {PREFIX}, {r['kept']} kept "
        f"by a row, {unkept} kept by none ({went}); {r['abandoned_rows']} abandoned rows {rows}"
    )
    for key in r["orphans"][:50]:
        print(f"  {key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

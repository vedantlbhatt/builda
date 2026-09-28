"""releases: two more reasons a draft is written, `tagged` and `merged`.

Revision ID: 0038_release_triggers

The owner asked for drafts "after a certain number of commits or a feature in development is
working or being finished". 0037 had the count (`commits`), a session that shipped (`shipped`), a
schedule (`cadence`) and the phone's ask (`asked`). What says a feature is finished is in git
itself, and the Mac already reads git (capture/releases/draft.py):

  * `tagged`  a new tag in the checkout's history (`v1.2.0`): the owner named a version;
  * `merged`  a branch merged into the checkout's history (`feature/leave-now`, a pull request):
              a feature landed.

The CHECK is dropped and added again with the whole list, appended at its END so every older code
keeps its place. THE LIST IS THE MODULE'S: server/tests/test_releases.py reads this file with `ast`
and holds `RELEASE_TRIGGER` to `builder/releases.py TRIGGERS` and `OLD_RELEASE_TRIGGER` to 0037's.

DOWNGRADE rewrites a draft or release of either new trigger as `shipped`, the nearest older reason
(a tag and a merge are both a thing that shipped), before 0037's CHECK comes back.
"""

from alembic import op

revision = "0038_release_triggers"
down_revision = "0037_stars_releases"
branch_labels = None
depends_on = None

RELEASE_TRIGGER = "'commits', 'shipped', 'cadence', 'asked', 'tagged', 'merged'"
OLD_RELEASE_TRIGGER = "'commits', 'shipped', 'cadence', 'asked'"


def upgrade() -> None:
    op.execute("ALTER TABLE releases DROP CONSTRAINT releases_trigger_check")
    op.execute(
        "ALTER TABLE releases ADD CONSTRAINT releases_trigger_check "
        f"CHECK (trigger IN ({RELEASE_TRIGGER}))"
    )


def downgrade() -> None:
    op.execute("UPDATE releases SET trigger = 'shipped' WHERE trigger IN ('tagged', 'merged')")
    op.execute("ALTER TABLE releases DROP CONSTRAINT releases_trigger_check")
    op.execute(
        "ALTER TABLE releases ADD CONSTRAINT releases_trigger_check "
        f"CHECK (trigger IN ({OLD_RELEASE_TRIGGER}))"
    )

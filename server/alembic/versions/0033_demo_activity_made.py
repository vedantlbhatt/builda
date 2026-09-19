"""demo_activity_tokens.shown_phase: a demo the Mac made and kept is `made`.

Revision ID: 0033_demo_activity_made

docs/demo-island.md, "Done is not the same as up". `capture demo watch` without
`--publish-requests` (the default) finishes a phone's request `done` with the kit still on the
Mac, and the demo card used to say "the kit is up" with a Share for it. The card now has a phase
for that, `made`, between filming and ready (`demo_push.RANK`), so a kit published later can
still move the card on. This widens the CHECK on what a card was last told to include it.

THE LIST COPIES `demo_push.PHASES`, and `test_demo_island.py` reads it out of this file, both
ways, as it read 0032's before.

The constraint is 0032's inline column CHECK, which Postgres names
`demo_activity_tokens_shown_phase_check`; it is dropped and made again under the same name, so a
later migration finds it where this one did. Downgrade puts a card at `made` back to `filming`,
the phase before it: under the old rule a done request is `ready`, so the next move the old code
decides for that card is forward, never a step back.
"""

from alembic import op

revision = "0033_demo_activity_made"
down_revision = "0032_demo_activity_tokens"
branch_labels = None
depends_on = None

CONSTRAINT = "demo_activity_tokens_shown_phase_check"

# Copied from demo_push.PHASES by hand; test_demo_island.py fails when they differ.
DEMO_PHASE = "'asked', 'filming', 'made', 'ready', 'failed'"
# 0032's list, for the way back.
OLD_PHASE = "'asked', 'filming', 'ready', 'failed'"


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE demo_activity_tokens DROP CONSTRAINT IF EXISTS {CONSTRAINT};
        ALTER TABLE demo_activity_tokens ADD CONSTRAINT {CONSTRAINT}
          CHECK (shown_phase IN ({DEMO_PHASE}));
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        UPDATE demo_activity_tokens SET shown_phase = 'filming' WHERE shown_phase = 'made';
        ALTER TABLE demo_activity_tokens DROP CONSTRAINT IF EXISTS {CONSTRAINT};
        ALTER TABLE demo_activity_tokens ADD CONSTRAINT {CONSTRAINT}
          CHECK (shown_phase IN ({OLD_PHASE}));
        """
    )

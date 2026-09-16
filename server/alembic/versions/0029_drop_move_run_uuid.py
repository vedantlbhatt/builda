"""drop_moves.run_uuid: the Claude Code run a move became, before Builda has a session for it.

Revision ID: 0029_drop_move_run_uuid

FOUND RUNNING THE REAL LOOP. `drop_moves.session_id` references `sessions(id)`, and the runner
mints a session id for the `claude` it launches and reported it when the move finished. Those are
not the same kind of identifier and, more to the point, that row does not exist yet: a Claude Code
run becomes a Builda session only once capture has read the transcript and uploaded it, which is
minutes later and may be never (an excluded repository never uploads). So the first successful run
of a real move ended in a foreign key violation and a 500 the runner could do nothing about, with
the work already done.

TWO COLUMNS, BECAUSE THEY ARE TWO FACTS. `run_uuid` is what the Mac launched, known the moment it
launches, and it is not a foreign key to anything: it is the id of a file on somebody's machine.
`session_id` stays a real foreign key and is filled in later, by whatever resolves a transcript to
an uploaded session, or never. A card can say "it ran" from the first and "open the session" only
from the second, which is exactly the difference a person cares about.

Idempotent and reversible.
"""

from alembic import op

revision = "0029_drop_move_run_uuid"
down_revision = "0028_drops"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE drop_moves ADD COLUMN IF NOT EXISTS run_uuid uuid;

        COMMENT ON COLUMN drop_moves.run_uuid IS
          'The Claude Code session id the runner launched with. NOT a foreign key: the Builda '
          'session for it may not exist yet, and may never (an excluded repository never '
          'uploads). session_id is the resolved one.';

        -- The runner writes it when a move finishes, so it joins the column grant.
        GRANT UPDATE (run_uuid) ON drop_moves TO builder_app, builder_worker;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE drop_moves DROP COLUMN IF EXISTS run_uuid;")

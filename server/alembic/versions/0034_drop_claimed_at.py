"""drops.claimed_at: a claim goes stale from when it was TAKEN, not from when the drop was shared.

Revision ID: 0034_drop_claimed_at

FOUND IN REVIEW (2026-09-19). `claim_waiting` took back a `resolving` drop once its `created_at`
was ten minutes old, which is the age of the SHARE. A reel shared while the Mac was asleep is
older than that before any Mac sees it, so the moment one Mac claimed it, a second Mac on the
account (or the same one's next poll, were it to poll while working) could claim it again,
seconds later, and pay for a second resolve and plan of one link. The clock belongs to the claim.

A drop claimed before this migration has no `claimed_at`; the claim reads
`COALESCE(claimed_at, created_at)`, so such a row keeps the old rule once and gets a real
`claimed_at` the next time it is taken.
"""

from alembic import op

revision = "0034_drop_claimed_at"
down_revision = "0033_demo_activity_made"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE drops ADD COLUMN IF NOT EXISTS claimed_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE drops DROP COLUMN IF EXISTS claimed_at")

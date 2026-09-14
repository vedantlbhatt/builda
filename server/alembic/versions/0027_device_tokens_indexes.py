"""device_tokens: indexes on device_id and prev_id, for reuse detection and the retry grace.

Revision ID: 0027_device_tokens_indexes

FOUND BY AN ADVERSARIAL REVIEW (2026-09-14) of the lost answer retry (auth.py,
REFRESH_RETRY_GRACE_SECONDS). Reuse detection revokes a device's whole chain with
`UPDATE device_tokens SET revoked_at = now() WHERE device_id = :d`, the retry revokes the
unused successor `WHERE prev_id = :i`, and the grace check looks the successor up the same
way. Neither column had an index and no token row is ever deleted, so each of those scanned
the whole table, and the scan's length was the window in which a concurrent refresh's new
successor could land unseen by the revoke all. `redeem_refresh_token` now serialises the
refreshes of one device with an advisory lock, which closes that window outright; these
indexes keep the statements under it short.
"""

from alembic import op

revision = "0027_device_tokens_indexes"
down_revision = "0026_project_media"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS device_tokens_device_id_idx ON device_tokens (device_id);
        CREATE INDEX IF NOT EXISTS device_tokens_prev_id_idx ON device_tokens (prev_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS device_tokens_prev_id_idx;
        DROP INDEX IF EXISTS device_tokens_device_id_idx;
        """
    )

"""devices.grant_flow: how a device's tokens were granted. A machine cannot flip a switch.

Revision ID: 0024_device_grant_flow

FOUND IN THE ADVERSARIAL REVIEW (2026-09-13). `PUT /v1/privacy/prefs` depended on
`current_device`, which accepts every device token, and `python -m capture pair` mints one
through the device flow. So a paired machine could turn Quote my prompts and File names on
for its own account, the machine alone opting in, while routes/privacy.py said "only the
phone flips a switch" and docs/overnight-integration.md 2.4 designed it that way. Nothing
on a device row said which grant minted its tokens, so nothing could enforce it.

`grant_flow` is that fact, written by `auth.register_device` (the one writer) every time a
grant lands on a row:

  sign_in      Sign in with Apple or Google: the phone. The only flow that flips a switch.
  device_flow  RFC 8628 pairing, approved from the phone: the Mac app and `capture pair`.
  capture_key  the device a capture key uploads as (0011); it never reaches a device route.

BACKFILL, from the only evidence an existing row carries. A capture key's device is known
exactly (`capture_keys.device_id`). The phone is the only client that sends platform `ios`
or `android` (`mobile/src/data/api.ts`, through both sign in routes); the device flow's own
clients send `macos` (`BuilderSync/SyncClient.swift`) and `linux` (`capture/client.py`), and
`/device/start` defaults to `macos`. So: a capture key's device, else `ios` or `android`
is sign_in, else device_flow. A device flow client that claimed `ios` is read as the phone,
which is what every such row could already do; nothing is widened, and every paired Mac and
container loses the switch.

DEFAULT 'device_flow': an INSERT that does not say how it was granted gets the narrowest
rights (no switch), never the phone's. NOT NULL after the backfill, so a migration role that
could not see the rows under FORCE ROW LEVEL SECURITY (its UPDATE would touch none) fails
here, loudly, instead of leaving every device unclassified. The CHECK list is pinned to
`auth.GRANT_FLOWS` by server/tests/test_contract.py, which reads this file.

Idempotent (IF NOT EXISTS and IF EXISTS throughout, and the backfill only fills NULLs) and
reversible (the downgrade drops the CHECK and the column, and every route that reads it
reads it through `register_device` and `_device_from_bearer`, which ship with it).
"""

from alembic import op

revision = "0024_device_grant_flow"
down_revision = "0023_session_burn_title"
branch_labels = None
depends_on = None

GRANT_FLOWS = ("sign_in", "device_flow", "capture_key")


def _check() -> str:
    return "CHECK (grant_flow IN (" + ", ".join(f"'{v}'" for v in GRANT_FLOWS) + "))"


def upgrade() -> None:
    op.execute("ALTER TABLE devices ADD COLUMN IF NOT EXISTS grant_flow text")
    op.execute(
        """
        UPDATE devices SET grant_flow = CASE
            WHEN id IN (SELECT device_id FROM capture_keys) THEN 'capture_key'
            WHEN platform IN ('ios', 'android') THEN 'sign_in'
            ELSE 'device_flow'
          END
        WHERE grant_flow IS NULL
        """
    )
    op.execute("ALTER TABLE devices ALTER COLUMN grant_flow SET DEFAULT 'device_flow'")
    op.execute("ALTER TABLE devices ALTER COLUMN grant_flow SET NOT NULL")
    op.execute("ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_grant_flow_check")
    op.execute(f"ALTER TABLE devices ADD CONSTRAINT devices_grant_flow_check {_check()}")
    op.execute(
        """
        COMMENT ON COLUMN devices.grant_flow IS
          'how this device''s tokens were granted: sign_in (the phone, the only device that '
          'flips a privacy switch), device_flow (a paired Mac or capture pair), capture_key. '
          'Written by auth.register_device.'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_grant_flow_check")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS grant_flow")

"""live_activity_tokens: where to send a running session's Live Activity updates.

Revision ID: 0022_live_activity_tokens

ActivityKit hands the phone one push token per started Live Activity (`kind =
'activity'`, tied to a session and an activity id) and, from iOS 17.2, one push to start
token per app (`kind = 'push_to_start'`, no session). The phone posts each one to `POST
/v1/push/live-activity` and deletes it when the activity ends; `live_push.plan` decides,
inside the upload transaction, which of them a changed live row owes an update, and the
row is deleted after the final `end` push (docs/overnight-integration.md 3.6).

WHY THE CREATURE IS HERE. The Live Activity's ContentState requires a creature and the
server stores none anywhere else; the phone knows which one the person picked, so it rides
on the token it registers.

CHECK LISTS COPY ENUMS. `creature`, `last_phase` and `last_trajectory` are the live
spec's `creature`, `phase` and `trajectory` (spec/live.v1.json), which the Swift bridge
types define. A contract enum value is always also a migration (CLAUDE.md), so
server/tests/test_contract.py reads these lists out of this file and pins each one to its
spec enum; a creature added to the spec and not here is a failing test, not a 500 on the
first registration carrying it.

The last CHECK is the kind's shape: an activity token names its session and activity, a
push to start token names neither. Written out per kind rather than as the design doc's
`(kind = 'activity') = (session_id IS NOT NULL AND activity_id IS NOT NULL)`, which lets a
push to start token carry a session id with no activity id: a row nothing reads that would
still be deleted with, and scoped to, a session it has nothing to do with.

RLS ENABLE + FORCE, owner only, and, as session_live (0020), a token can only be tied to
a session the viewer owns, so nobody can register a token against another person's
session and receive its updates.
"""

from alembic import op

revision = "0022_live_activity_tokens"
down_revision = "0021_builder_quotes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE live_activity_tokens (
          id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind            text NOT NULL CHECK (kind IN ('activity','push_to_start')),
          session_id      uuid REFERENCES sessions(id) ON DELETE CASCADE,
          activity_id     text,
          token           text NOT NULL,
          environment     text NOT NULL CHECK (environment IN ('sandbox','production')),
          creature        text NOT NULL CHECK (creature IN (
                            'crab','octopus','dog','cat','owl','fox','whale','bee','bit')),
          last_phase      text CHECK (last_phase IN ('working','needsYou','done','stalled')),
          last_trajectory text CHECK (last_trajectory IN ('converging','circling','lost','none')),
          last_pushed_at  timestamptz,
          created_at      timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, token),
          CONSTRAINT live_activity_tokens_kind_ck CHECK (
            (kind = 'activity' AND session_id IS NOT NULL AND activity_id IS NOT NULL)
            OR (kind = 'push_to_start' AND session_id IS NULL AND activity_id IS NULL))
        );

        CREATE INDEX live_activity_tokens_session_idx
          ON live_activity_tokens (session_id) WHERE session_id IS NOT NULL;

        GRANT SELECT, INSERT, UPDATE, DELETE ON live_activity_tokens
          TO builder_app, builder_worker;

        ALTER TABLE live_activity_tokens ENABLE ROW LEVEL SECURITY;
        ALTER TABLE live_activity_tokens FORCE  ROW LEVEL SECURITY;

        CREATE POLICY live_activity_tokens_owner ON live_activity_tokens
          USING (user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid)
          WITH CHECK (
            user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid
            AND (session_id IS NULL OR EXISTS (
              SELECT 1 FROM sessions s WHERE s.id = session_id
                AND s.user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid)));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS live_activity_tokens_owner ON live_activity_tokens;
        DROP TABLE IF EXISTS live_activity_tokens;
        """
    )

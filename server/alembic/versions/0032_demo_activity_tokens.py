"""demo_activity_tokens: where to move a demo request's Live Activity.

Revision ID: 0032_demo_activity_tokens

docs/demo-island.md. The phone starts a card for a demo it asked for, in front, at the tap, and
ActivityKit hands it the card's update token; the server moves the card with it when the Mac
claims the request (filming) and when it finishes (ready or failed).

A TABLE OF ITS OWN, NOT A KIND IN `drop_activity_tokens` (0031). That table's rows name a
`drops` row and its CHECKs are the drop card's phases, both held by test_drop_island.py; a demo
card names a `demo_requests` row and has four other phases. A kind column there would make
`drop_id` nullable for a third reason, turn one foreign key into two optional ones with a CHECK
choosing between them, and widen a phase list the drop tests read both ways. Same shape, same
routes' style, one table per thing a token points at, as 0031 itself argued against sharing
`live_activity_tokens`. No push-to-start kind: a demo card is only ever started by the app.

`shown_phase` is what the card was last told (or what the phone said it was showing when it
registered), so `demo_push.plan_updates` sends only a move FORWARD and never repeats one. Not
`last_phase`: test_contract.py reads every CHECK on a column of that name as the live spec's.

THE CHECK LIST COPIES `demo_push.PHASES` (and so BuilderDemoAttributes' phases), and
`test_demo_island.py` reads the list out of this file, both ways.

RLS ENABLE + FORCE, owner only. The WITH CHECK reads `demo_requests`, which is itself
RLS-protected, so the EXISTS sees it through the viewer's own eyes (CLAUDE.md): that fails CLOSED
here, the direction wanted (a request the viewer cannot see makes the EXISTS false and the row is
refused). Registering a token against somebody else's request, and so receiving their pushes, is
refused by the route (404) and by this policy. Account deletion cascades from `users`, a request's
delete (exclusion, the account) from `demo_requests`.
"""

from alembic import op

revision = "0032_demo_activity_tokens"
down_revision = "0031_drop_activity_tokens"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"

# Copied from demo_push.PHASES by hand; test_demo_island.py fails when they differ.
DEMO_PHASE = "'asked', 'filming', 'ready', 'failed'"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS demo_activity_tokens (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_id     uuid NOT NULL REFERENCES demo_requests(id) ON DELETE CASCADE,
          activity_id    text NOT NULL CHECK (char_length(activity_id) <= 128),
          token          text NOT NULL CHECK (char_length(token) BETWEEN 16 AND 512),
          environment    text NOT NULL CHECK (environment IN ('sandbox', 'production')),
          shown_phase    text NOT NULL DEFAULT 'asked' CHECK (shown_phase IN ({DEMO_PHASE})),
          last_pushed_at timestamptz,
          created_at     timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, token)
        );

        CREATE INDEX IF NOT EXISTS demo_activity_tokens_request_idx
          ON demo_activity_tokens (request_id);

        GRANT SELECT, INSERT, UPDATE, DELETE ON demo_activity_tokens
          TO builder_app, builder_worker;

        ALTER TABLE demo_activity_tokens ENABLE ROW LEVEL SECURITY;
        ALTER TABLE demo_activity_tokens FORCE  ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS demo_activity_tokens_owner ON demo_activity_tokens;
        CREATE POLICY demo_activity_tokens_owner ON demo_activity_tokens
          USING (user_id = {VIEWER})
          WITH CHECK (
            user_id = {VIEWER}
            AND EXISTS (
              SELECT 1 FROM demo_requests r WHERE r.id = request_id AND r.user_id = {VIEWER}));

        COMMENT ON TABLE demo_activity_tokens IS
          'ActivityKit update tokens for a demo request''s Live Activity (docs/demo-island.md). '
          'Owner only.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS demo_activity_tokens_owner ON demo_activity_tokens;
        DROP TABLE IF EXISTS demo_activity_tokens;
        """
    )

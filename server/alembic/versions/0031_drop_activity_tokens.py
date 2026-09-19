"""drop_activity_tokens: where to start and move a shared reel's Live Activity.

Revision ID: 0031_drop_activity_tokens

docs/drop-island.md. ActivityKit hands the phone one push-to-start token per ActivityAttributes
TYPE (iOS 17.2+) and one update token per started card. The session cards' tokens live in
`live_activity_tokens` (0022), and these cannot: a push-to-start token for
`BuilderDropAttributes` is a different token from the one for `BuilderSessionAttributes`, and a
drop card is tied to a drop, not a session. So: one table, the same shape, owner only.

`kind = 'push_to_start'`: the app's token for starting a drop card; no drop, no activity.
`kind = 'activity'`: one card's update token, naming its drop and ActivityKit's own id.
`last_phase` is what the card was last told (or what the phone said it was showing when it
registered), so `drop_push.plan_updates` sends only a move FORWARD and never repeats one.

NUMBERED 0031, NOT 0030. `0030_ship_kits` is taken on claude/motion-shipkit, which branched from
the same 0029. Whichever lands second sets its `down_revision` to the other; until then each
branch has one head.

THE CHECK LISTS COPY `drop_push.PHASES` (and so BuilderDropAttributes' phases), and
`test_drop_island.py` reads the list out of this file, both ways, as test_drops.py does for 0028.

RLS ENABLE + FORCE, owner only. The WITH CHECK reads `drops` for the token's drop, and `drops` is
itself RLS-protected, so the EXISTS sees it through the viewer's own eyes (CLAUDE.md): that
fails CLOSED here, which is the direction wanted (a drop the viewer cannot see makes the EXISTS
false and the row is refused), where the NOT EXISTS that note records failed open. Registering a
token against somebody else's drop, and so receiving their pushes, is refused by the route (404)
and by this policy. Account deletion cascades from `users`, a drop's delete from `drops`.
"""

from alembic import op

revision = "0031_drop_activity_tokens"
down_revision = "0029_drop_move_run_uuid"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"

# Copied from drop_push.PHASES by hand; test_drop_island.py fails when they differ.
DROP_PHASE = "'sent', 'reading', 'planned', 'refused', 'started'"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS drop_activity_tokens (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind           text NOT NULL CHECK (kind IN ('activity', 'push_to_start')),
          drop_id        uuid REFERENCES drops(id) ON DELETE CASCADE,
          activity_id    text CHECK (char_length(activity_id) <= 128),
          token          text NOT NULL CHECK (char_length(token) BETWEEN 16 AND 512),
          environment    text NOT NULL CHECK (environment IN ('sandbox', 'production')),
          last_phase     text CHECK (last_phase IN ({DROP_PHASE})),
          last_pushed_at timestamptz,
          created_at     timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, token),
          CONSTRAINT drop_activity_tokens_kind_ck CHECK (
            (kind = 'activity' AND drop_id IS NOT NULL AND activity_id IS NOT NULL)
            OR (kind = 'push_to_start' AND drop_id IS NULL AND activity_id IS NULL))
        );

        CREATE INDEX IF NOT EXISTS drop_activity_tokens_drop_idx
          ON drop_activity_tokens (drop_id) WHERE drop_id IS NOT NULL;

        GRANT SELECT, INSERT, UPDATE, DELETE ON drop_activity_tokens
          TO builder_app, builder_worker;

        ALTER TABLE drop_activity_tokens ENABLE ROW LEVEL SECURITY;
        ALTER TABLE drop_activity_tokens FORCE  ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS drop_activity_tokens_owner ON drop_activity_tokens;
        CREATE POLICY drop_activity_tokens_owner ON drop_activity_tokens
          USING (user_id = {VIEWER})
          WITH CHECK (
            user_id = {VIEWER}
            AND (drop_id IS NULL OR EXISTS (
              SELECT 1 FROM drops d WHERE d.id = drop_id AND d.user_id = {VIEWER})));

        COMMENT ON TABLE drop_activity_tokens IS
          'ActivityKit tokens for a shared reel''s Live Activity (docs/drop-island.md): the '
          'app''s push-to-start token and each card''s update token. Owner only.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS drop_activity_tokens_owner ON drop_activity_tokens;
        DROP TABLE IF EXISTS drop_activity_tokens;
        """
    )

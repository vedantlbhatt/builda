"""drops: a reel somebody shared, the moves proposed for it, and which ones they started.

Revision ID: 0028_drops

docs/drops.md. A drop arrives from the phone's share sheet as a URL and nothing else. The Mac
resolves it, plans it and uploads a `DropResolution` (spec/drops.v1.json); the phone reads the
board and taps the moves it wants. Owner only, four policies, no public policy at all and no
social query that reaches this table: a drop is a thing you were going to do, and there is no
version of the feature where somebody else's board is visible.

WHAT IS STORED AND WHAT IS DELIBERATELY NOT. `drops.url` is the link, normalised
(drops/urls.py), and it is the natural key: sharing the same reel twice lands on the card that
is already there rather than making a second one. The RESOLVED CAPTION IS NOT STORED ANYWHERE.
A stranger's caption is read on the Mac, handed to the planner there, and never uploaded; the
wire carries `caption_chars` and `transcript_chars` so a card can say how much there was to
read. What lands here is what the planner WROTE about it, and that is bounded by the contract.

`shared_text` is the one exception and it is temporary. iOS hands a share extension whatever
the source app put in the item, which for TikTok is sometimes the caption; the Mac needs it
when it resolves, and the Mac is not awake at the moment of the share. So it is stored, capped
at 1000 characters, and SET TO NULL by the resolution route as soon as it has been used. A
column that holds a stranger's words for as long as the feature needs them and not one request
longer is the honest version of this; a column that keeps them forever is not.

ONE ROW PER MOVE, AND THE STATUS IS THE PRODUCT. A move is `offered` until a person taps it.
Nothing in this schema can move a move out of `offered` on its own: no default, no trigger, no
worker route that queues in bulk. `queued_at` is written by the tap, and `drops/runner.py` is
the only thing that reads the queue. `session_id` is where the loop closes: the run is a Claude
Code session, so the move points at the session row Builda already made for it.

`adjustment` is what the person typed before starting the move. It is theirs, so it is stored
and it is bounded, and the runner passes it as part of the task rather than as a caption.

THE CHECK LISTS ARE SPEC ENUMS (`spec/drops.v1.json`), so a value added there is also a
migration: server/tests/test_drops.py reads this file and holds each list to the spec both ways,
the way test_contract.py does for the harness enum. Account deletion cascades from `users`.
Idempotent (IF NOT EXISTS) and reversible.
"""

from alembic import op

revision = "0028_drops"
down_revision = "0027_device_tokens_indexes"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"

# Copied from spec/drops.v1.json by hand, as every other migration copies a contract enum by
# hand; the test reads both and fails when they differ. A generated migration would be a
# migration nobody reviewed.
DROP_STATUS = "'waiting', 'resolving', 'planned', 'refused', 'archived'"
DROP_KIND = "'skill', 'technique', 'project', 'tool', 'recipe', 'unknown'"
DROP_REFUSAL = (
    "'url_unsupported', 'no_text', 'private_or_gone', 'not_about_building', "
    "'planner_unavailable', 'planner_refused'"
)
PLATFORM = "'instagram', 'tiktok', 'youtube', 'x', 'reddit', 'threads', 'web'"
MOVE_KIND = "'install', 'apply', 'scaffold', 'evaluate', 'card', 'keep'"
MOVE_STATUS = "'offered', 'queued', 'running', 'done', 'failed', 'declined'"
MOVE_TARGET = "'new_project', 'existing_repo', 'this_machine', 'none'"
EFFORT = "'minutes', 'an_hour', 'a_session'"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS drops (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          -- Normalised by drops/urls.py before it is sent. The cap is the spec's `url`.
          url            text NOT NULL CHECK (char_length(url) BETWEEN 8 AND 500
                                              AND url LIKE 'https://%'),
          platform       text NOT NULL CHECK (platform IN ({PLATFORM})),
          status         text NOT NULL DEFAULT 'waiting' CHECK (status IN ({DROP_STATUS})),
          -- Null until the Mac has planned it. `kind` is denormalised out of the resolution
          -- so the board can be filtered and sorted without opening a jsonb on every row.
          kind           text CHECK (kind IN ({DROP_KIND})),
          title          text CHECK (char_length(title) <= 80),
          summary        text CHECK (char_length(summary) <= 200),
          thumbnail_url  text CHECK (char_length(thumbnail_url) <= 500),
          refusal        text CHECK (refusal IN ({DROP_REFUSAL})),
          -- The whole `DropResolution`, validated by drops_spec.py at the door.
          resolution     jsonb,
          -- The share sheet's own text, until the resolution has used it. See the docstring.
          shared_text    text CHECK (char_length(shared_text) <= 1000),
          created_at     timestamptz NOT NULL DEFAULT now(),
          resolved_at    timestamptz,
          archived_at    timestamptz,
          -- A planned drop has a resolution and one of a kind or a refusal; a waiting one has
          -- neither. Without this a row can say `planned` and draw an empty card.
          CONSTRAINT drops_planned_ck CHECK (
            (status = 'planned' AND resolution IS NOT NULL AND kind IS NOT NULL
               AND refusal IS NULL)
            OR (status = 'refused' AND refusal IS NOT NULL)
            OR (status IN ('waiting', 'resolving', 'archived'))
          ),
          CONSTRAINT drops_archived_ck CHECK ((status = 'archived') = (archived_at IS NOT NULL))
        );

        -- The same reel shared twice is one card. This index is what makes the share sheet
        -- idempotent, so a person who taps share on the reel they already saved gets the
        -- board they already have rather than a duplicate.
        CREATE UNIQUE INDEX IF NOT EXISTS drops_user_url_idx ON drops (user_id, url);
        -- The board: newest first, archived ones out.
        CREATE INDEX IF NOT EXISTS drops_board_idx
          ON drops (user_id, created_at DESC) WHERE archived_at IS NULL;
        -- The Mac's queue: what has not been read yet, oldest first, so a backlog drains in
        -- the order it arrived.
        CREATE INDEX IF NOT EXISTS drops_waiting_idx
          ON drops (user_id, created_at) WHERE status IN ('waiting', 'resolving');

        CREATE TABLE IF NOT EXISTS drop_moves (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          drop_id      uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          position     smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
          move_kind    text NOT NULL CHECK (move_kind IN ({MOVE_KIND})),
          status       text NOT NULL DEFAULT 'offered' CHECK (status IN ({MOVE_STATUS})),
          title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
          intent       text NOT NULL CHECK (char_length(intent) BETWEEN 1 AND 200),
          evidence     text NOT NULL CHECK (char_length(evidence) BETWEEN 1 AND 300),
          target       text NOT NULL CHECK (target IN ({MOVE_TARGET})),
          effort       text NOT NULL CHECK (effort IN ({EFFORT})),
          source       jsonb,
          verification jsonb,
          -- What the person typed before starting it. Theirs, so it is kept.
          adjustment   text CHECK (char_length(adjustment) <= 500),
          -- Which repository they pointed an `existing_repo` move at: the salted key the
          -- report already uses, never a path and never a name.
          repo_key     text CHECK (repo_key ~ '^[0-9a-f]{{64}}$'),
          -- The Claude Code session this move became. This is where the loop closes.
          session_id   uuid REFERENCES sessions(id) ON DELETE SET NULL,
          outcome      text CHECK (char_length(outcome) <= 300),
          queued_at    timestamptz,
          started_at   timestamptz,
          finished_at  timestamptz,
          created_at   timestamptz NOT NULL DEFAULT now(),
          -- One move per slot on one drop: a re upload of a resolution replaces, never stacks.
          CONSTRAINT drop_moves_slot_uq UNIQUE (drop_id, position),
          -- A move nobody tapped has no clocks. The tap writes `queued_at`, and nothing else
          -- can: there is no DEFAULT here on purpose.
          CONSTRAINT drop_moves_clocks_ck CHECK (
            (status = 'offered' AND queued_at IS NULL AND started_at IS NULL)
            OR (status = 'declined')
            OR (status = 'queued' AND queued_at IS NOT NULL AND started_at IS NULL)
            OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL)
            OR (status IN ('done', 'failed') AND finished_at IS NOT NULL)
          )
        );

        CREATE INDEX IF NOT EXISTS drop_moves_drop_idx ON drop_moves (drop_id, position);
        -- The runner's queue, across every drop.
        CREATE INDEX IF NOT EXISTS drop_moves_queue_idx
          ON drop_moves (user_id, status, queued_at) WHERE status IN ('queued', 'running');

        GRANT SELECT, INSERT, UPDATE, DELETE ON drops, drop_moves
          TO builder_app, builder_worker;

        ALTER TABLE drops      ENABLE ROW LEVEL SECURITY;
        ALTER TABLE drops      FORCE  ROW LEVEL SECURITY;
        ALTER TABLE drop_moves ENABLE ROW LEVEL SECURITY;
        ALTER TABLE drop_moves FORCE  ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS drops_select ON drops;
        DROP POLICY IF EXISTS drops_insert ON drops;
        DROP POLICY IF EXISTS drops_update ON drops;
        DROP POLICY IF EXISTS drops_delete ON drops;
        CREATE POLICY drops_select ON drops FOR SELECT USING (user_id = {VIEWER});
        CREATE POLICY drops_insert ON drops FOR INSERT WITH CHECK (user_id = {VIEWER});
        CREATE POLICY drops_update ON drops FOR UPDATE
          USING (user_id = {VIEWER}) WITH CHECK (user_id = {VIEWER});
        CREATE POLICY drops_delete ON drops FOR DELETE USING (user_id = {VIEWER});

        -- The move policies read `user_id` on the move's OWN row, never a join to `drops`.
        -- CLAUDE.md, "a policy predicate that reads another RLS protected table sees it
        -- through the viewer's own eyes": a NOT EXISTS against `drops` here would have been a
        -- policy that reads as though it enforces ownership and enforces nothing. The column
        -- is denormalised and the route sets it from the drop it just read as the owner.
        DROP POLICY IF EXISTS drop_moves_select ON drop_moves;
        DROP POLICY IF EXISTS drop_moves_insert ON drop_moves;
        DROP POLICY IF EXISTS drop_moves_update ON drop_moves;
        DROP POLICY IF EXISTS drop_moves_delete ON drop_moves;
        CREATE POLICY drop_moves_select ON drop_moves FOR SELECT USING (user_id = {VIEWER});
        CREATE POLICY drop_moves_insert ON drop_moves FOR INSERT WITH CHECK (user_id = {VIEWER});
        CREATE POLICY drop_moves_update ON drop_moves FOR UPDATE
          USING (user_id = {VIEWER}) WITH CHECK (user_id = {VIEWER});
        CREATE POLICY drop_moves_delete ON drop_moves FOR DELETE USING (user_id = {VIEWER});

        COMMENT ON TABLE drops IS
          'A reel or a TikTok shared into Builda (docs/drops.md). Owner only; no public '
          'policy. The resolved caption is never stored: the wire carries its length.';
        COMMENT ON TABLE drop_moves IS
          'One proposed move on a drop. `offered` until a person taps it; nothing in this '
          'schema can start one on its own.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS drop_moves;
        DROP TABLE IF EXISTS drops;
        """
    )

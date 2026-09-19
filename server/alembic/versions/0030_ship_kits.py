"""demo_requests, ship_kits, ship_kit_media: the phone asks for a demo, and reads the kit.

Revision ID: 0030_ship_kits

docs/ship-kit.md. Three tables, owner only, each with four policies on its OWN `user_id` (no
predicate reads another table, so none needs a SECURITY DEFINER helper; CLAUDE.md's trap is a
policy that reads another RLS table through the viewer's eyes).

DEMO_REQUESTS. "Make a demo of this" from the phone, for the Mac to pick up the way it picks up a
drop (`python -m capture demo watch` claims them, drops/runner.py's shape). A request is QUEUED
until a Mac claims it, CLAIMED while it films, and ends DONE or FAILED with a code from
spec/shipkit.v1.json `request_refusal`; the phone may CANCEL one that has not ended. One live
request per project: a second tap while one is queued or claimed is the same request (the
partial unique index), not a second simulator on a Mac that already runs out of memory with two.

SHIP_KITS and SHIP_KIT_MEDIA. A published kit is a SET, like a published demo (0026): the Mac mints
`publish_id`, presigns each file right before its upload, commits each, then PUTs the kit's
document (the captions, the changelog as commit subjects, what could not be made), and the
document's arrival with nothing of its set left uncommitted is what makes the kit the one shown;
older kits of the project are deleted in that transaction, their objects after it. The files live
in the demos' private store (objectstore.media_store) under `ship-kit/<user>/<project>/`, a prefix
of their own, so neither the demo sweep nor this one can mistake the other's objects for orphans.

THE CHECK LISTS ARE SPEC ENUMS (spec/shipkit.v1.json), restated by hand as every migration restates
a contract enum, and server/tests/test_shipkit.py reads this file with `ast` and holds each list to
the spec both ways.

Account deletion cascades from `users`; the kit's objects are deleted by the route that deletes
the account, which reads their keys first (routes/privacy.py), as it does for demos. Excluding a
repository deletes its requests, kits and objects. Idempotent (IF NOT EXISTS) and reversible.
"""

from alembic import op

revision = "0030_ship_kits"
down_revision = "0029_drop_move_run_uuid"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"

# spec/shipkit.v1.json, by hand; test_shipkit.py holds these to the spec.
REQUEST_STATUS = "'queued', 'claimed', 'done', 'failed', 'cancelled'"
REQUEST_REFUSAL = (
    "'not_runnable', 'capture_failed', 'privacy_refused', 'kit_failed', 'no_checkout', "
    "'excluded', 'cancelled_on_mac'"
)
HUE = "'tide', 'ember', 'iris', 'brass', 'orchid', 'cobalt', 'coral', 'heather', 'amber'"
KIT_SLOT = (
    "'video_vertical', 'video_feed', 'video_landscape', 'video_square', 'loop', 'still', "
    "'framed_still', 'before_after', 'app_store_iphone', 'app_store_ipad'"
)
KIT_CONTENT_TYPE = "'image/png', 'image/jpeg', 'image/gif', 'video/mp4'"


def _policies(table: str) -> str:
    return "\n".join(
        [
            f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;",
            f"ALTER TABLE {table} FORCE  ROW LEVEL SECURITY;",
            f"DROP POLICY IF EXISTS {table}_select ON {table};",
            f"DROP POLICY IF EXISTS {table}_insert ON {table};",
            f"DROP POLICY IF EXISTS {table}_update ON {table};",
            f"DROP POLICY IF EXISTS {table}_delete ON {table};",
            f"CREATE POLICY {table}_select ON {table} FOR SELECT USING (user_id = {VIEWER});",
            f"CREATE POLICY {table}_insert ON {table} FOR INSERT WITH CHECK (user_id = {VIEWER});",
            f"CREATE POLICY {table}_update ON {table} FOR UPDATE "
            f"USING (user_id = {VIEWER}) WITH CHECK (user_id = {VIEWER});",
            f"CREATE POLICY {table}_delete ON {table} FOR DELETE USING (user_id = {VIEWER});",
        ]
    )


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS demo_requests (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key  text NOT NULL CHECK (project_key ~ '^[0-9a-f]{{64}}$'),
          status       text NOT NULL DEFAULT 'queued' CHECK (status IN ({REQUEST_STATUS})),
          refusal      text CHECK (refusal IN ({REQUEST_REFUSAL})),
          -- The hue the phone draws the project in, so the kit's band is the same colour.
          hue          text CHECK (hue IN ({HUE})),
          -- Which of the person's devices claimed it: a paired Mac, never a capture key.
          claimed_by   uuid,
          created_at   timestamptz NOT NULL DEFAULT now(),
          claimed_at   timestamptz,
          finished_at  timestamptz,
          -- A request's clocks follow its status, and a refusal belongs to a failure only.
          CONSTRAINT demo_requests_clocks_ck CHECK (
            (status = 'queued' AND claimed_at IS NULL AND finished_at IS NULL)
            OR (status = 'claimed' AND claimed_at IS NOT NULL AND finished_at IS NULL)
            OR (status IN ('done', 'failed', 'cancelled') AND finished_at IS NOT NULL)
          ),
          CONSTRAINT demo_requests_refusal_ck CHECK ((refusal IS NOT NULL) = (status = 'failed'))
        );
        -- One live request a project: a second tap is the same request.
        CREATE UNIQUE INDEX IF NOT EXISTS demo_requests_live_idx
          ON demo_requests (user_id, project_key) WHERE status IN ('queued', 'claimed');
        -- The Mac's queue, oldest first; and the phone's list, newest first.
        CREATE INDEX IF NOT EXISTS demo_requests_queue_idx
          ON demo_requests (user_id, created_at) WHERE status = 'queued';
        CREATE INDEX IF NOT EXISTS demo_requests_list_idx
          ON demo_requests (user_id, project_key, created_at DESC);

        CREATE TABLE IF NOT EXISTS ship_kits (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key  text NOT NULL CHECK (project_key ~ '^[0-9a-f]{{64}}$'),
          publish_id   text NOT NULL CHECK (publish_id ~ '^[0-9a-f]{{16}}$'),
          -- The KitDocument, validated by shipkit_spec.py at the door (captions, changelog as
          -- commit subjects, refusals). Never a commit hash, a file name or a project name.
          document     jsonb NOT NULL,
          created_at   timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT ship_kits_publish_uq UNIQUE (user_id, project_key, publish_id)
        );
        CREATE INDEX IF NOT EXISTS ship_kits_list_idx
          ON ship_kits (user_id, project_key, created_at DESC);

        CREATE TABLE IF NOT EXISTS ship_kit_media (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key   text NOT NULL CHECK (project_key ~ '^[0-9a-f]{{64}}$'),
          publish_id    text NOT NULL CHECK (publish_id ~ '^[0-9a-f]{{16}}$'),
          slot          text NOT NULL CHECK (slot IN ({KIT_SLOT})),
          object_key    text NOT NULL UNIQUE CHECK (char_length(object_key) <= 200),
          content_type  text NOT NULL CHECK (content_type IN ({KIT_CONTENT_TYPE})),
          width         integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
          height        integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
          duration_ms   integer CHECK (duration_ms BETWEEN 1 AND 31000),
          bytes         bigint NOT NULL CHECK (bytes BETWEEN 1 AND 41943040),
          position      smallint NOT NULL CHECK (position BETWEEN 0 AND 63),
          label         text CHECK (label ~ '^[A-Za-z0-9 ,.''():?!&]{{1,80}}$'),
          committed     boolean NOT NULL DEFAULT false,
          committed_at  timestamptz,
          created_at    timestamptz NOT NULL DEFAULT now(),
          -- A video is an MP4 with a length; nothing else has one.
          CONSTRAINT ship_kit_media_shape_ck CHECK (
            (content_type = 'video/mp4') = (duration_ms IS NOT NULL)
            AND (content_type <> 'video/mp4' OR slot LIKE 'video_%')
            AND (content_type <> 'image/gif' OR slot = 'loop')
          ),
          CONSTRAINT ship_kit_media_committed_ck CHECK (committed = (committed_at IS NOT NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ship_kit_media_slot_idx
          ON ship_kit_media (user_id, project_key, publish_id, slot, position);
        CREATE INDEX IF NOT EXISTS ship_kit_media_list_idx
          ON ship_kit_media (user_id, project_key, publish_id);

        GRANT SELECT, INSERT, UPDATE, DELETE ON demo_requests, ship_kits, ship_kit_media
          TO builder_app, builder_worker;
        -- What builder_app may change after insert: a request's life, a file's commit. Who
        -- owns a row, which project it is and which object it names are fixed at insert.
        REVOKE UPDATE ON demo_requests, ship_kit_media, ship_kits FROM builder_app;
        GRANT UPDATE (status, refusal, claimed_by, claimed_at, finished_at)
          ON demo_requests TO builder_app;
        GRANT UPDATE (committed, committed_at) ON ship_kit_media TO builder_app;

        {_policies("demo_requests")}
        {_policies("ship_kits")}
        {_policies("ship_kit_media")}

        COMMENT ON TABLE demo_requests IS
          'The phone asking the Mac for a demo (docs/ship-kit.md). Owner only; a Mac claims it.';
        COMMENT ON TABLE ship_kits IS
          'A published ship kit''s document: captions, changelog subjects, refusals. Owner only.';
        COMMENT ON TABLE ship_kit_media IS
          'One file of a published ship kit, in the demos'' private store under '
          'ship-kit/. Owner only.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS ship_kit_media;
        DROP TABLE IF EXISTS ship_kits;
        DROP TABLE IF EXISTS demo_requests;
        """
    )

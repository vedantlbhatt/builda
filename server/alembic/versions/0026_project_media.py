"""project_media: a project's demo, the stills and the one short video, owner only.

Revision ID: 0026_project_media

docs/demos.md ("What leaves the Mac", "Storage", "The API"). A demo is made on the Mac by
`python -m capture demo` and stays in `~/.builder/demos/<key>/` until the person publishes it
(`python -m capture demo --publish`), which is the only way a row here is written. The
bytes live in the object store (`objectstore.py`: S3 in production, a directory on the
local stack); this table holds where they are, how big, and the label and numbers the
contract's `project_media` section declares. Nothing else from the Mac's manifest (the
commit it was taken at, the file names, the project's kind) has a column to land in.

ONE ROW PER FILE THE PHONE SHOWS. A video carries its poster frame on the same row
(`poster_*`), because a poster without its video, or a video with two posters, means
nothing. `publish_id` is the random id the Mac mints for one `--publish` run: the server
tells the new set from the set it replaces by it, and deletes the old one when the new one
has fully committed (routes/media.py). `committed` is false from the presign until the
commit route has seen the object in the store at the declared size; the list routes read
committed rows only, so an upload that never finished is never on the phone.

OWNER ONLY, WHATEVER THE SESSION SHARING SETTINGS. Four policies, one per command, each
`user_id = the viewer`, and no public policy at all: a shared session, a public post and an
accepted follow reach none of it, and no social query joins this table. The predicate reads
no other table, so no SECURITY DEFINER helper is needed (the CLAUDE.md rule is about a
policy that reads ANOTHER RLS table through the viewer's eyes; this one reads its own row).
The route's "is this project yours" check reads `sessions` under the owner policy, which is
honest (only the viewer's own sessions can make a key theirs), and asks about exclusion
through `session_repo_excluded`, which is already SECURITY DEFINER (0004).

`builder_app` may UPDATE only `committed` and `committed_at` (column grants, as 0007 does
for posts): who owns a row, which project it is in and which object it names are fixed at
insert, against the API's own role rather than against its habits.

THE CHECK LISTS ARE CONTRACT ENUMS (`project_media.enums` in privacy/upload-contract.json),
so a value added there is also a migration: server/tests/test_contract.py reads this file
and holds each list to the contract both ways. The caps are the contract's too: 8192 pixels,
31,000 ms, the label's 80 characters and its character set (ASCII, which Postgres reads the
same in every locale; the door in `project_media.py` adds the word length and the letter).

Account deletion cascades from `users`; the objects are deleted by the route, which reads
their keys before the rows go (routes/privacy.py). Excluding a repository deletes its rows
and objects in the same request. Idempotent (IF NOT EXISTS, IF EXISTS) and reversible.
"""

from alembic import op

revision = "0026_project_media"
down_revision = "0025_session_call_tokens"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS project_media (
          id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          -- The repository's salted hash, whole: the report's `projects[].key`.
          project_key         text NOT NULL CHECK (project_key ~ '^[0-9a-f]{{64}}$'),
          publish_id          text NOT NULL CHECK (publish_id ~ '^[0-9a-f]{{16}}$'),
          kind                text NOT NULL CHECK (kind IN ('image', 'video')),
          object_key          text NOT NULL UNIQUE CHECK (char_length(object_key) <= 200),
          content_type        text NOT NULL
                              CHECK (content_type IN ('image/png', 'image/jpeg', 'video/mp4')),
          width               integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
          height              integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
          duration_ms         integer CHECK (duration_ms BETWEEN 1 AND 31000),
          bytes               bigint NOT NULL CHECK (bytes BETWEEN 1 AND 41943040),
          position            smallint NOT NULL CHECK (position BETWEEN 0 AND 63),
          label               text NOT NULL CHECK (label ~ '^[A-Za-z0-9 ,.''():?!&]{{1,80}}$'),
          source              text NOT NULL
                              CHECK (source IN ('capture', 'checkout', 'transcript', 'previous')),
          poster_object_key   text UNIQUE CHECK (char_length(poster_object_key) <= 200),
          poster_content_type text CHECK (poster_content_type IN ('image/jpeg', 'image/png')),
          poster_bytes        integer CHECK (poster_bytes BETWEEN 1 AND 6291456),
          committed           boolean NOT NULL DEFAULT false,
          committed_at        timestamptz,
          created_at          timestamptz NOT NULL DEFAULT now(),
          -- An image is a still: no duration, no poster, at most 6 MiB. A video is an MP4
          -- with a duration, and its poster is all three columns or none of them.
          CONSTRAINT project_media_shape_ck CHECK (
            (kind = 'image' AND content_type IN ('image/png', 'image/jpeg')
               AND duration_ms IS NULL AND bytes <= 6291456
               AND poster_object_key IS NULL AND poster_content_type IS NULL
               AND poster_bytes IS NULL)
            OR (kind = 'video' AND content_type = 'video/mp4' AND duration_ms IS NOT NULL
               AND ((poster_object_key IS NULL) = (poster_content_type IS NULL))
               AND ((poster_object_key IS NULL) = (poster_bytes IS NULL)))
          ),
          CONSTRAINT project_media_committed_ck CHECK (committed = (committed_at IS NOT NULL))
        );

        -- One file per slot in one publish: a duplicate position is a 409, not two stills
        -- stacked in one place. At most one video per publish is the index's to keep, not
        -- a count a racing presign could step past.
        CREATE UNIQUE INDEX IF NOT EXISTS project_media_slot_idx
          ON project_media (user_id, project_key, publish_id, kind, position);
        CREATE UNIQUE INDEX IF NOT EXISTS project_media_one_video_idx
          ON project_media (user_id, project_key, publish_id) WHERE kind = 'video';
        -- The list and the preview: a person's committed files for a project, in order.
        CREATE INDEX IF NOT EXISTS project_media_list_idx
          ON project_media (user_id, project_key, committed, kind, position);

        GRANT SELECT, INSERT, UPDATE, DELETE ON project_media TO builder_app, builder_worker;
        REVOKE UPDATE ON project_media FROM builder_app;
        GRANT UPDATE (committed, committed_at) ON project_media TO builder_app;

        ALTER TABLE project_media ENABLE ROW LEVEL SECURITY;
        ALTER TABLE project_media FORCE  ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS project_media_select ON project_media;
        DROP POLICY IF EXISTS project_media_insert ON project_media;
        DROP POLICY IF EXISTS project_media_update ON project_media;
        DROP POLICY IF EXISTS project_media_delete ON project_media;
        CREATE POLICY project_media_select ON project_media FOR SELECT
          USING (user_id = {VIEWER});
        CREATE POLICY project_media_insert ON project_media FOR INSERT
          WITH CHECK (user_id = {VIEWER});
        CREATE POLICY project_media_update ON project_media FOR UPDATE
          USING (user_id = {VIEWER})
          WITH CHECK (user_id = {VIEWER});
        CREATE POLICY project_media_delete ON project_media FOR DELETE
          USING (user_id = {VIEWER});

        COMMENT ON TABLE project_media IS
          'A project''s published demo (docs/demos.md): one row per still or video, the bytes '
          'in the object store. Owner only; no public policy. Written only by an explicit '
          'publish; contract section project_media.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS project_media_delete ON project_media;
        DROP POLICY IF EXISTS project_media_update ON project_media;
        DROP POLICY IF EXISTS project_media_insert ON project_media;
        DROP POLICY IF EXISTS project_media_select ON project_media;
        DROP TABLE IF EXISTS project_media;
        """
    )

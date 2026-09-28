"""release_trailer: the one kit file a release's reader may see, the trailer it went out with.

Revision ID: 0040_release_trailer

A release that carries a trailer (`releases.has_trailer`, `trailer_version`) says so to its
readers; until now they could only read "a trailer", because every kit file is its owner's alone
(0030's policies, `read_kit_media`). Publishing a release with its trailer is the owner showing it
to the release's readers, so this function answers, for ONE release and the viewer asking:

  * nothing unless the viewer may read the release (`can_view_release`, 0037's rule, unchanged:
    published, and public on a public project, or a follower, or a stargazer, or the owner);
  * nothing unless the release carries a trailer and the owner's CURRENT kit carries that very
    version (its document's `trailer.version`): a film the owner has since replaced is not served
    under a release that went out with another, and a kit taken down takes the film with it;
  * else the one file: the square first (it crops least in a feed), then 4:5, 9:16, 16:9.

Every other kit file stays its owner's alone. SECURITY DEFINER with a fixed search_path, owned by
builder_worker, executable by the app and the worker only, as 0037's functions are.
"""

from alembic import op

revision = "0040_release_trailer"
down_revision = "0039_badge_release_at"
branch_labels = None
depends_on = None

FUNCTION = "release_trailer(uuid)"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION release_trailer(p_release uuid)
        RETURNS TABLE (media_id uuid, object_key text, content_type text, slot text,
                       width integer, height integer)
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH r AS (
            SELECT r.owner_id, r.project_key, r.trailer_version FROM releases r
            WHERE r.id = p_release AND r.has_trailer AND r.trailer_version IS NOT NULL
              AND can_view_release(r.id)
          ), k AS (
            SELECT k.publish_id FROM ship_kits k, r
            WHERE k.user_id = r.owner_id AND k.project_key = r.project_key
              AND (k.document -> 'trailer' ->> 'version')::int = r.trailer_version
              AND k.created_at = (SELECT max(k2.created_at) FROM ship_kits k2
                                  WHERE k2.user_id = r.owner_id AND k2.project_key = r.project_key)
          )
          SELECT m.id, m.object_key, m.content_type, m.slot, m.width, m.height
          FROM ship_kit_media m, r, k
          WHERE m.user_id = r.owner_id AND m.project_key = r.project_key
            AND m.publish_id = k.publish_id AND m.committed
            AND m.slot IN ('trailer_square', 'trailer_feed', 'trailer_vertical',
                           'trailer_landscape')
          ORDER BY array_position(
            ARRAY['trailer_square', 'trailer_feed', 'trailer_vertical', 'trailer_landscape'],
            m.slot)
          LIMIT 1
        $$;
        ALTER FUNCTION {FUNCTION} OWNER TO builder_worker;
        REVOKE ALL ON FUNCTION {FUNCTION} FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION {FUNCTION} TO builder_app, builder_worker;
        """
    )


def downgrade() -> None:
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCTION};")

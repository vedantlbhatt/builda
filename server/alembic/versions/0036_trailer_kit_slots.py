"""ship_kit_media: the trailer's slots. A kit carries the project's trailer beside its demo.

Revision ID: 0036_trailer_kit_slots

spec/shipkit.v1.json `kit_slot` grew five values at its END: `trailer_vertical`, `trailer_feed`,
`trailer_landscape`, `trailer_square` (video/mp4, one per format) and `trailer_loop` (image/gif). A
contract enum value is always also a migration (CLAUDE.md): the generated models accept the new
slots the moment `make gen` runs and 0030's CHECK does not, so the first trailer a Mac published
would be a constraint violation and a 500 after its bytes were already in the store.

Three constraints move, each dropped and added again:

  * the slot list, now the spec's whole enum;
  * a video's length: a trailer runs up to spec `caps.trailer_ms` (41 s: the trailer spec's
    longest cut, 40 s, and a second of slack), where a demo's video stays at `caps.video_ms`;
  * the shape: an MP4 lives in a demo video slot or a trailer video slot, and a GIF in `loop` or
    `trailer_loop`.

DOWNGRADE deletes the rows in the trailer's slots first, because 0030's constraints cannot hold
them; their objects are then kept by no row, and `python -m builder.media_sweep` (or the next
publish's sweep of that project) deletes them. It also takes the `trailer` key out of every kit's
document, which 0030's shape does not have. THE LISTS ARE THE SPEC'S: server/tests/test_shipkit.py
reads this file with `ast` and holds `KIT_SLOT` to the spec's enum and `OLD_KIT_SLOT` to 0030's.
"""

from alembic import op

revision = "0036_trailer_kit_slots"
down_revision = "0035_trailer_notes"
branch_labels = None
depends_on = None

# spec/shipkit.v1.json `kit_slot`, by hand; test_shipkit.py holds it to the spec.
KIT_SLOT = (
    "'video_vertical', 'video_feed', 'video_landscape', 'video_square', 'loop', 'still', "
    "'framed_still', 'before_after', 'app_store_iphone', 'app_store_ipad', "
    "'trailer_vertical', 'trailer_feed', 'trailer_landscape', 'trailer_square', 'trailer_loop'"
)
# 0030's list, which the downgrade restores; test_shipkit.py holds it to 0030's own constant.
OLD_KIT_SLOT = (
    "'video_vertical', 'video_feed', 'video_landscape', 'video_square', 'loop', 'still', "
    "'framed_still', 'before_after', 'app_store_iphone', 'app_store_ipad'"
)
TRAILER_VIDEO_SLOTS = "'trailer_vertical', 'trailer_feed', 'trailer_landscape', 'trailer_square'"
TRAILER_SLOTS = (
    "'trailer_vertical', 'trailer_feed', 'trailer_landscape', 'trailer_square', 'trailer_loop'"
)
# spec/shipkit.v1.json `caps.video_ms` and `caps.trailer_ms`.
VIDEO_MS = 31000
TRAILER_MS = 41000


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE ship_kit_media DROP CONSTRAINT IF EXISTS ship_kit_media_slot_check;
        ALTER TABLE ship_kit_media ADD CONSTRAINT ship_kit_media_slot_check
          CHECK (slot IN ({KIT_SLOT}));

        ALTER TABLE ship_kit_media DROP CONSTRAINT IF EXISTS ship_kit_media_duration_ms_check;
        ALTER TABLE ship_kit_media ADD CONSTRAINT ship_kit_media_duration_ms_check
          CHECK (duration_ms BETWEEN 1 AND {TRAILER_MS}
                 AND (duration_ms <= {VIDEO_MS} OR slot IN ({TRAILER_VIDEO_SLOTS})));

        ALTER TABLE ship_kit_media DROP CONSTRAINT IF EXISTS ship_kit_media_shape_ck;
        ALTER TABLE ship_kit_media ADD CONSTRAINT ship_kit_media_shape_ck CHECK (
          (content_type = 'video/mp4') = (duration_ms IS NOT NULL)
          AND (content_type <> 'video/mp4' OR slot LIKE 'video_%'
               OR slot IN ({TRAILER_VIDEO_SLOTS}))
          AND (content_type <> 'image/gif' OR slot IN ('loop', 'trailer_loop'))
        );
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DELETE FROM ship_kit_media WHERE slot IN ({TRAILER_SLOTS});
        UPDATE ship_kits SET document = document - 'trailer';

        ALTER TABLE ship_kit_media DROP CONSTRAINT IF EXISTS ship_kit_media_shape_ck;
        ALTER TABLE ship_kit_media ADD CONSTRAINT ship_kit_media_shape_ck CHECK (
          (content_type = 'video/mp4') = (duration_ms IS NOT NULL)
          AND (content_type <> 'video/mp4' OR slot LIKE 'video_%')
          AND (content_type <> 'image/gif' OR slot = 'loop')
        );

        ALTER TABLE ship_kit_media DROP CONSTRAINT IF EXISTS ship_kit_media_duration_ms_check;
        ALTER TABLE ship_kit_media ADD CONSTRAINT ship_kit_media_duration_ms_check
          CHECK (duration_ms BETWEEN 1 AND {VIDEO_MS});

        ALTER TABLE ship_kit_media DROP CONSTRAINT IF EXISTS ship_kit_media_slot_check;
        ALTER TABLE ship_kit_media ADD CONSTRAINT ship_kit_media_slot_check
          CHECK (slot IN ({OLD_KIT_SLOT}));
        """
    )

"""trailer_notes: the director. The owner's words about a trailer, from the phone to the Mac.

Revision ID: 0035_trailer_notes

spec/trailer.v1.json. The phone sends a note in the owner's own words ("make it shorter and
orange"); the owner's paired Mac claims it, reads it (rules first, claude only when the rules
understood nothing), cuts a new version, renders it, and finishes the note with the new version and
what changed, as codes the phone words from the spec. A note that cannot be done fails with a
refusal code from the same spec. demo_requests' life (0030), row for row: QUEUED until a Mac claims
it, CLAIMED while it works, DONE or FAILED; the phone may CANCEL one nobody has claimed.

A claim goes stale from when it was TAKEN (0034's lesson, applied from the start): a Mac that closed
its lid mid note must not strand it, so `:claim` takes a note back once `claimed_at` is ten minutes
old. Owner only, four policies on the row's OWN `user_id`, no predicate reading another table, so no
SECURITY DEFINER helper is needed.

THE CHECK LISTS ARE SPEC ENUMS (spec/trailer.v1.json `note_status`, `note_refusal`, `note_source`),
restated by hand as every migration restates one; server/tests/test_trailer_notes.py reads this file
with `ast` and holds each list to the spec both ways.

Account deletion cascades from `users`. Excluding the repository deletes its notes
(routes/privacy.py, through `trailer_notes.forget_project`). Idempotent and reversible.
"""

from alembic import op

revision = "0035_trailer_notes"
down_revision = "0034_drop_claimed_at"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"

# spec/trailer.v1.json, by hand; test_trailer_notes.py holds these to the spec.
NOTE_STATUS = "'queued', 'claimed', 'done', 'failed', 'cancelled'"
NOTE_REFUSAL = (
    "'not_understood', 'no_model', 'invented_number', 'names_a_repository', "
    "'needs_new_capture', 'over_limit', 'nothing_to_change', 'no_such_version', "
    "'render_failed', 'no_trailer', 'no_node', 'no_demo'"
)
NOTE_SOURCE = "'rules', 'model'"
# spec/trailer.v1.json `max_lengths.note`, `CutEdit.changes` max_items, and `Cut.version`'s bounds.
NOTE_MAX = 500
CHANGES_MAX = 12
VERSION_MAX = 1000


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
        CREATE TABLE IF NOT EXISTS trailer_notes (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key  text NOT NULL CHECK (project_key ~ '^[0-9a-f]{{64}}$'),
          -- The owner's words, as typed. Never read by anyone but the owner and their own Mac.
          body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND {NOTE_MAX}),
          status       text NOT NULL DEFAULT 'queued' CHECK (status IN ({NOTE_STATUS})),
          -- Which of the person's devices claimed it: a paired Mac, never a capture key.
          claimed_by   uuid,
          claimed_at   timestamptz,
          finished_at  timestamptz,
          from_version integer CHECK (from_version BETWEEN 1 AND {VERSION_MAX}),
          to_version   integer CHECK (to_version BETWEEN 1 AND {VERSION_MAX}),
          -- spec Change objects, validated by trailer_spec.NoteFinish at the door: codes and short
          -- values, never prose.
          changes      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
                         jsonb_typeof(changes) = 'array'
                         AND jsonb_array_length(changes) <= {CHANGES_MAX}),
          refusal      text CHECK (refusal IN ({NOTE_REFUSAL})),
          source       text CHECK (source IN ({NOTE_SOURCE})),
          created_at   timestamptz NOT NULL DEFAULT now(),
          -- A note's clocks follow its status.
          CONSTRAINT trailer_notes_clocks_ck CHECK (
            (status = 'queued' AND claimed_at IS NULL AND finished_at IS NULL)
            OR (status = 'claimed' AND claimed_at IS NOT NULL AND finished_at IS NULL)
            OR (status IN ('done', 'failed', 'cancelled') AND finished_at IS NOT NULL)
          ),
          -- Done made a version and refused nothing; failed says why and made nothing; nothing
          -- else carries an outcome.
          CONSTRAINT trailer_notes_outcome_ck CHECK (
            (status = 'done' AND to_version IS NOT NULL AND refusal IS NULL)
            OR (status = 'failed' AND refusal IS NOT NULL AND to_version IS NULL
                AND jsonb_array_length(changes) = 0)
            OR (status IN ('queued', 'claimed', 'cancelled') AND refusal IS NULL
                AND to_version IS NULL AND jsonb_array_length(changes) = 0)
          )
        );
        -- The phone's chat, newest first; and the Mac's queue, oldest first.
        CREATE INDEX IF NOT EXISTS trailer_notes_list_idx
          ON trailer_notes (user_id, project_key, created_at DESC);
        CREATE INDEX IF NOT EXISTS trailer_notes_queue_idx
          ON trailer_notes (user_id, created_at) WHERE status IN ('queued', 'claimed');

        GRANT SELECT, INSERT, UPDATE, DELETE ON trailer_notes TO builder_app, builder_worker;
        -- What builder_app may change after insert: a note's life and its answer. Whose it is,
        -- which project and the owner's words are fixed at insert.
        REVOKE UPDATE ON trailer_notes FROM builder_app;
        GRANT UPDATE (status, claimed_by, claimed_at, finished_at, from_version, to_version,
                      changes, refusal, source)
          ON trailer_notes TO builder_app;

        {_policies("trailer_notes")}

        COMMENT ON TABLE trailer_notes IS
          'A note on a project''s trailer, from the owner''s phone to their Mac '
          '(spec/trailer.v1.json). Owner only.';
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS trailer_notes;")

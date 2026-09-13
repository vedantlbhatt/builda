"""builder_quotes: up to three of a person's prompts, verbatim, for the Wrapped cards.

Revision ID: 0021_builder_quotes

THE SECOND OPT-IN EXCEPTION of contract v4 (`quotes`, docs/overnight-integration.md 2.4).
Prompt text never leaves the machine except here and in the analysis's
`decision_patterns[].prompt_excerpt`. It arrives only when BOTH switches say yes: the
phone's Settings row, stored in `privacy_prefs.quotes` (0020), and `python -m capture
report --quotes` on the machine, which is never persisted. The document is validated
against quotes_spec.py (generated, `extra="forbid"`, each quote capped at 160) and
re-checked by `quotes.quotes_gate` before it is stored.

This is 0018's table with `quotes_version` for `report_version` and no `window_days`: one
row per person, upserted, no history, because the cards quote the corpus as it stands.
Turning the switch off deletes the row in the same transaction; account deletion
cascades from `users`.

RLS ENABLE + FORCE, owner only, and no public policy at all. No social query joins it: a
quote is never in a post, a feed, a share, a push or an activity.
"""

from alembic import op

revision = "0021_builder_quotes"
down_revision = "0020_session_live"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE builder_quotes (
          user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          -- == the quotes document's own version (contract v4 `quotes.quotes_version`).
          quotes_version integer NOT NULL,
          generated_at   timestamptz NOT NULL,
          body           jsonb NOT NULL,
          created_at     timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now()
        );

        GRANT SELECT, INSERT, UPDATE, DELETE ON builder_quotes TO builder_app, builder_worker;

        ALTER TABLE builder_quotes ENABLE ROW LEVEL SECURITY;
        ALTER TABLE builder_quotes FORCE  ROW LEVEL SECURITY;

        CREATE POLICY builder_quotes_owner ON builder_quotes
          USING (user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid)
          WITH CHECK (user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS builder_quotes_owner ON builder_quotes;
        DROP TABLE IF EXISTS builder_quotes;
        """
    )

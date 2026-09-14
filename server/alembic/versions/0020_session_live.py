"""session_live and privacy_prefs: what a RUNNING session is doing, and two owner switches.

Revision ID: 0020_session_live

Contract v4 adds `live` (spec/live.v1.json, validated by live_spec.py at the door) and the
opt-in `live_names`. This is where they land (docs/overnight-integration.md 3.3).

session_live. ONE ROW PER LIVE SESSION, and only while it is live: `routes/sync.py
store_payloads`, the one path the batch route and the hook channel share, upserts it
beside the session and deletes it the moment the same session arrives final. A session
that is excluded, revoked or deleted takes its row with it through the FK cascade. The
row is a cache of the latest computation, not history: nothing reads an old live state.

  body   the LiveState document. JSONB for the reason 0006 and 0018 give: the phone renders
         it whole and the spec version, not the table, defines its shape. `live_version`
         is lifted out so a reader can find old shapes with a WHERE clause.
  names  LiveNames, the opt-in basenames. NULL unless the account has File names on;
         `store_payloads` refuses a payload carrying them while the switch is off, and
         turning the switch off nulls every stored row in the same transaction.
  alerted_phase  the phase a needs-you banner was last sent for (live_push), so a banner
         fires once per entry into needsYou rather than once per upload.

privacy_prefs. One row per person, created on first use by `live_store.prefs`. Both
switches default OFF: quotes (the second opt-in exception) and live_names (the third).
`map_salt` is what the hook channel hashes file paths under, 32 hex from
gen_random_uuid, which is exactly `analysis.live.SALT_MIN_CHARS`; it is never returned by
any route, because a salt a viewer holds makes every file id a dictionary lookup away from
its path.

RLS. ENABLE + FORCE on both; owner only; no public policy, because a running session is
nobody else's business and sharing a session shares a FINAL session. session_live's WITH
CHECK is 0008's shape (the session must be the viewer's own), so one viewer cannot squat
another person's session id and block their row. That EXISTS reads `sessions` through the
viewer's own policies, which fails CLOSED here: a session the viewer cannot see, or can
see only because it is shared, does not satisfy `s.user_id = viewer`.
"""

from alembic import op

revision = "0020_session_live"
down_revision = "0019_session_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE privacy_prefs (
          user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          quotes     boolean NOT NULL DEFAULT false,
          live_names boolean NOT NULL DEFAULT false,
          map_salt   text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
          updated_at timestamptz NOT NULL DEFAULT now(),
          -- analysis.live.SALT_MIN_CHARS. A shorter salt raises in live_state, so a row
          -- that could never be used is refused here instead of at the first hook post.
          CONSTRAINT privacy_prefs_salt_ck CHECK (length(map_salt) >= 32)
        );

        CREATE TABLE session_live (
          session_id    uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
          user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          live_version  integer NOT NULL,
          -- 'hook' when the server computed it from a hook-delivered transcript
          -- (client_version == hook_ingest.HOOK_CLIENT_VERSION), else 'capture'.
          source        text NOT NULL CHECK (source IN ('hook','capture')),
          computed_at   timestamptz NOT NULL,
          body          jsonb NOT NULL,
          names         jsonb,
          alerted_phase text CHECK (alerted_phase IN ('working','needsYou','done','stalled')),
          updated_at    timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX session_live_user_idx ON session_live (user_id);

        GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_prefs, session_live
          TO builder_app, builder_worker;

        ALTER TABLE privacy_prefs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE privacy_prefs FORCE  ROW LEVEL SECURITY;
        ALTER TABLE session_live  ENABLE ROW LEVEL SECURITY;
        ALTER TABLE session_live  FORCE  ROW LEVEL SECURITY;

        CREATE POLICY privacy_prefs_owner ON privacy_prefs
          USING (user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid)
          WITH CHECK (user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid);

        CREATE POLICY session_live_owner ON session_live
          USING (user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid)
          WITH CHECK (
            user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid
            AND EXISTS (
              SELECT 1 FROM sessions s WHERE s.id = session_id
                AND s.user_id = NULLIF(current_setting('app.viewer_id', true), '')::uuid));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP POLICY IF EXISTS session_live_owner ON session_live;
        DROP POLICY IF EXISTS privacy_prefs_owner ON privacy_prefs;
        DROP TABLE IF EXISTS session_live;
        DROP TABLE IF EXISTS privacy_prefs;
        """
    )

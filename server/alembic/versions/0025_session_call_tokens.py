"""session_stats.call_tokens: what every call to the model sent and got back, in one sitting.

Revision ID: 0025_session_call_tokens

Contract v4 grows one more optional session object, numbers and enums only, computed on the
machine or by the hook channel from the transcript (analysis/calls.py over the session window):

  call_tokens  SessionCallTokens: at most 240 points of five token counts (re-read from the
               cache, written to it, fresh input, written back), the calls that came back to
               an expired cache and wrote the conversation into it again, and what each kind
               of token would cost at API list prices. The session screen draws one bar per
               point and writes every sentence; no word is stored because none is uploaded.

WHERE, and who can read it: on `session_stats` beside `burn` (0023), for burn's reason. It is
per sitting numbers the client measured, upserted with the rest of them and read by the session
detail and nothing else, and the table already carries the owner and shared session policies
(0003): a stranger reading a shared session reads exactly what burn lets them read, and an
unshared one is not there for them at all. Declared in the public AND anonymous modes: no name,
path, command or model name can be in it, and the door (contract.py, `extra="forbid"` at every
level, both enums checked) is what guarantees that.

NO CHECK LIST AND NO TYPE. Its two enums (`call_tokens_refusal`, `call_price_refusal`) live
inside the JSONB, validated at the door and pinned to their Python tables by
server/tests/test_contract.py, as burn's are (0023). A new value is a contract edit and
`make gen`, never a migration; the only Postgres TYPE a contract enum grows is `harness`.

COALESCE ON UPDATE, as `burn`. A client that does not compute the block (the Mac today, a
container without `analysis/`, a server still running the code from before this revision)
sends none, and nothing must not mean "delete what another client measured". A refusal is a
document with `reason` set and its numbers null, and it replaces what was stored.

Idempotent (IF NOT EXISTS, IF EXISTS) and reversible.
"""

from alembic import op

revision = "0025_session_call_tokens"
down_revision = "0024_device_grant_flow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE session_stats ADD COLUMN IF NOT EXISTS call_tokens jsonb;

        COMMENT ON COLUMN session_stats.call_tokens IS
          'contract v4 SessionCallTokens: up to 240 points of five token counts, the calls '
          'that rewrote an expired cache, list price dollars per kind of token. No prose, '
          'prompt, path, command or model name. NULL means the producer did not compute it; '
          'a refusal is call_tokens.reason inside the document.';
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE session_stats DROP COLUMN IF EXISTS call_tokens;")

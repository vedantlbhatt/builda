"""session_stats.burn and sessions.title_ids: where one sitting's tokens went, and its title.

Revision ID: 0023_session_burn_title

Contract v4 adds two optional session objects (the integration addendum), numbers and
enums only, both computed on the machine or by the hook channel from the transcript:

  burn       SessionBurn: the sitting's tokens, the shares served from cache, spent in
             stretches that provably changed nothing and spent where the transcript cannot
             tell, and at most three costly stretches with their causes (analysis/burn.py
             over the session window). The session screen writes its plain English summary
             from it; the words are not stored because they are not uploaded.
  title_ids  SessionTitleIds: an engineer voice title as a verb and an object from fixed
             tables plus the numbers it says (analysis/vocab.py session_title). The phone
             renders "Debugged a failing test suite" from the ids.

WHERE. `burn` sits on `session_stats` beside `feedback` (0019) and for 0019's reason: it is
per sitting numbers the client measured, upserted with the rest of them, read by the
session detail and nothing else. `title_ids` sits on `sessions` beside `title`, because a
title belongs to every place a session is listed, not only to its detail: the list, the
live rows and the feed all read `sessions`, so every row can carry its title without a
second join. Both tables already carry the owner and shared session policies (0003), and
both objects are declared in the public AND anonymous modes: no name, path or command can
be in either, and the door (contract.py, `extra="forbid"` at every level, every enum
checked) is what guarantees it.

NO CHECK LISTS. The enums (`burn_cause`, `burn_refusal`, `burn_repeat`, `title_verb`,
`title_object`) live inside JSONB, validated at the door and pinned to their Python tables
by server/tests/test_contract.py. A new value is a contract edit and `make gen`, never a
migration, exactly as the report's enums are (0018).

COALESCE ON UPDATE, as `feedback` and `analysis`. A client that does not compute these
(the Mac today, or a container where `analysis/` is not deployed) sends neither, and
nothing must not mean "delete what another client measured". Null on the wire means the
producer did not compute it; a refusal is `burn.reason` with its numbers null, which is a
document and is stored.
"""

from alembic import op

revision = "0023_session_burn_title"
down_revision = "0022_live_activity_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE session_stats ADD COLUMN burn jsonb;
        ALTER TABLE sessions      ADD COLUMN title_ids jsonb;

        COMMENT ON COLUMN session_stats.burn IS
          'contract v4 SessionBurn: counts, shares, enums and at most three spikes. No '
          'prose, prompt, path, command or tool name. NULL means the producer did not '
          'compute it; a refusal is burn.reason inside the document.';
        COMMENT ON COLUMN sessions.title_ids IS
          'contract v4 SessionTitleIds: {verb, object, n, modules} from fixed tables. The '
          'phone renders the words. NULL when no title rule fired or the producer did not '
          'compute it.';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE sessions      DROP COLUMN IF EXISTS title_ids;
        ALTER TABLE session_stats DROP COLUMN IF EXISTS burn;
        """
    )

"""badge_release_at: the one thing the README badge may say about a release, to anyone.

Revision ID: 0039_badge_release_at

The badge (builder/badge.py, routes/badge.py) is read by nobody in particular: a README's viewers
and GitHub's image proxy. 0037's `can_view_release` shows no release to a reader who is not signed
in (`{VIEWER} IS NOT NULL`), on purpose, and that stays. This function answers only the DATE of the
newest release that went out to everyone, and only on a project a stranger may already see: the
owner's profile shows projects (`can_see_projects`), the project is public (`project_is_public`),
and its repository is not excluded. No title, no words, no id; null for anything else.

SECURITY DEFINER with a fixed search_path, owned by builder_worker, executable by the app and the
worker only, as 0037's functions are.
"""

from alembic import op

revision = "0039_badge_release_at"
down_revision = "0038_release_triggers"
branch_labels = None
depends_on = None

FUNCTION = "badge_release_at(uuid, text)"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION badge_release_at(p_owner uuid, p_key text)
        RETURNS timestamptz
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT max(r.published_at) FROM releases r
          WHERE r.owner_id = p_owner AND r.project_key = p_key
            AND r.status = 'published' AND r.visibility = 'public'
            AND can_see_projects(p_owner) AND project_is_public(p_owner, p_key)
            AND NOT EXISTS (SELECT 1 FROM repos rp WHERE rp.repo_hash = p_key
                            AND session_repo_excluded(p_owner, rp.id))
        $$;
        ALTER FUNCTION {FUNCTION} OWNER TO builder_worker;
        REVOKE ALL ON FUNCTION {FUNCTION} FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION {FUNCTION} TO builder_app, builder_worker;
        """
    )


def downgrade() -> None:
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCTION};")

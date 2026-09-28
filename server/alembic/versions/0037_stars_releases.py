"""project_stars, releases, release_settings: following a PROJECT, and what its owner says about it.

Revision ID: 0037_stars_releases

Other people STAR a public project to follow it; its owner publishes RELEASES (a title, notes, up to
five highlights, how many commits, whether a trailer came with it); stargazers and the owner's
followers read them. The owner's Mac may DRAFT a release by itself (after N commits, a shipped
session or a cadence, `release_settings`), and only the owner's phone publishes one.

WHAT "PUBLIC" MEANS, ONCE. A project is public when its owner marked the repository public on the
server (`repo_visibility`, the phone's switch) AND the profile's name rule gives it a name: a
`repos.public_name` (which only an upload in public mode sets and `anonymous` clears), for a
repository the owner has a session in and has not excluded. Both halves, because `repos` is shared:
the same repository uploaded in public mode by SOMEBODY ELSE sets its name for everyone who works in
it, and a project must never become starrable, or named to strangers, on a third party's say. So:

  * `project_public_name(owner, key)`: the name rule, answered to the owner themselves (the profile
    and the project page read names through it, builder_profile.project_names) and to anyone else
    only while the project is public. One rule, one function (CLAUDE.md).
  * `project_is_public(owner, key)`: the owner's mark and a name.

Every function here that reads another RLS table is SECURITY DEFINER with a fixed search_path and
OWNED BY `builder_worker` (BYPASSRLS), for the reason 0004 and 0007 give: a policy predicate that
reads `sessions`, `follows`, `repo_visibility` or `project_stars` through the viewer's own eyes sees
nothing and fails open, or, owned by a role under FORCE RLS, fails closed and silently.

PROJECT_STARS. Who starred what, readable only by who gave the star, and inserted only while it is
starrable (`project_starrable`: public, not the viewer's own, and the owner's projects are visible
to the viewer by the public profile's rule, `can_see_projects`). How MANY is `star_count`, never
who. A star on a project that later goes private is dormant: it grants nothing until the project is
public again. Excluding the repository deletes every star on it (`drop_project_stars`, the owner
cannot see those rows) and the owner's own stars under that key.

RELEASES. The owner sees every row of theirs; anyone else sees a row only through
`can_view_release`: published, and public on a public project, or the viewer follows the owner
(accepted), or the viewer starred the project while it is public. A draft is the owner's alone. One
live draft a project (a partial unique index): the Mac's next draft REPLACES it. `notified_at` is
set once, by `claim_release_audience` only (builder_app has no UPDATE on it), which is what makes
the push to stargazers and followers happen at most once a release: the function answers the
audience only to the owner, only for a published release, and only the first time.

THE CHECK LISTS are builder/releases.py's tuples, restated by hand; server/tests/test_releases.py
reads this file with `ast` and holds each to them. Account deletion cascades from `users`.
"""

from alembic import op

revision = "0037_stars_releases"
down_revision = "0036_trailer_kit_slots"
branch_labels = None
depends_on = None

VIEWER = "NULLIF(current_setting('app.viewer_id', true), '')::uuid"

# builder/releases.py, by hand; test_releases.py holds these to it.
RELEASE_STATUS = "'draft', 'published', 'dismissed'"
RELEASE_TRIGGER = "'commits', 'shipped', 'cadence', 'asked'"
RELEASE_VISIBILITY = "'followers', 'public'"
RELEASE_CADENCE = "'none', 'weekly', 'biweekly'"
TITLE_MAX = 80
NOTES_MAX = 1200
HIGHLIGHTS_MAX = 5
HIGHLIGHT_MAX = 120
EVERY_COMMITS_MIN = 3
EVERY_COMMITS_MAX = 200
# spec/trailer.v1.json `Cut.version`.
TRAILER_VERSION_MAX = 1000

KEY_CHECK = "CHECK (project_key ~ '^[0-9a-f]{64}$')"

FUNCTIONS = [
    "project_public_name(uuid, text)",
    "project_is_public(uuid, text)",
    "can_see_projects(uuid)",
    "project_starrable(uuid, text)",
    "star_count(uuid, text)",
    "public_projects(uuid)",
    "can_view_release(uuid)",
    "claim_release_audience(uuid)",
    "drop_project_stars(text)",
]


def _owner_policies(table: str, col: str) -> str:
    return "\n".join(
        [
            f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;",
            f"ALTER TABLE {table} FORCE  ROW LEVEL SECURITY;",
            f"CREATE POLICY {table}_select ON {table} FOR SELECT USING ({col} = {VIEWER});",
            f"CREATE POLICY {table}_insert ON {table} FOR INSERT WITH CHECK ({col} = {VIEWER});",
            f"CREATE POLICY {table}_update ON {table} FOR UPDATE "
            f"USING ({col} = {VIEWER}) WITH CHECK ({col} = {VIEWER});",
            f"CREATE POLICY {table}_delete ON {table} FOR DELETE USING ({col} = {VIEWER});",
        ]
    )


def upgrade() -> None:
    grants = "\n".join(
        f"ALTER FUNCTION {f} OWNER TO builder_worker;\n"
        f"REVOKE ALL ON FUNCTION {f} FROM PUBLIC;\n"
        f"GRANT EXECUTE ON FUNCTION {f} TO builder_app, builder_worker;"
        for f in FUNCTIONS
    )
    op.execute(
        f"""
        -- ------------------------------------------------------------------ tables

        -- A release's highlights: a list of at most {HIGHLIGHTS_MAX} strings, each 1 to
        -- {HIGHLIGHT_MAX} characters. A function because a CHECK cannot hold a subquery.
        CREATE OR REPLACE FUNCTION release_highlights_ok(h jsonb)
        RETURNS boolean
        LANGUAGE sql
        IMMUTABLE
        SET search_path = public, pg_temp
        AS $$
          SELECT CASE WHEN jsonb_typeof(h) <> 'array' THEN false
                      WHEN jsonb_array_length(h) > {HIGHLIGHTS_MAX} THEN false
                      ELSE NOT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(h) e
                        WHERE jsonb_typeof(e) <> 'string'
                           OR char_length(e #>> '{{}}') NOT BETWEEN 1 AND {HIGHLIGHT_MAX})
                 END
        $$;

        CREATE TABLE project_stars (
          user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key text NOT NULL {KEY_CHECK},
          created_at  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, owner_id, project_key),
          CONSTRAINT project_stars_not_own_ck CHECK (user_id <> owner_id)
        );
        -- How many, and who gets a release's push: both read by project.
        CREATE INDEX project_stars_project_idx ON project_stars (owner_id, project_key);

        CREATE TABLE releases (
          id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key     text NOT NULL {KEY_CHECK},
          status          text NOT NULL DEFAULT 'draft' CHECK (status IN ({RELEASE_STATUS})),
          title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND {TITLE_MAX}),
          notes           text NOT NULL DEFAULT '' CHECK (char_length(notes) <= {NOTES_MAX}),
          highlights      jsonb NOT NULL DEFAULT '[]'::jsonb
                          CHECK (release_highlights_ok(highlights)),
          -- Commits in this release, as the Mac counted them. Null when nobody counted.
          commits         integer CHECK (commits >= 0),
          trigger         text NOT NULL CHECK (trigger IN ({RELEASE_TRIGGER})),
          has_trailer     boolean NOT NULL DEFAULT false,
          trailer_version integer CHECK (trailer_version BETWEEN 1 AND {TRAILER_VERSION_MAX}),
          visibility      text NOT NULL DEFAULT 'followers'
                          CHECK (visibility IN ({RELEASE_VISIBILITY})),
          created_at      timestamptz NOT NULL DEFAULT now(),
          updated_at      timestamptz NOT NULL DEFAULT now(),
          published_at    timestamptz,
          -- Set once, by claim_release_audience, when the push to its audience is decided.
          notified_at     timestamptz,
          CONSTRAINT releases_published_ck
            CHECK ((status = 'published') = (published_at IS NOT NULL)),
          CONSTRAINT releases_notified_ck CHECK (notified_at IS NULL OR status = 'published'),
          CONSTRAINT releases_trailer_ck CHECK (has_trailer OR trailer_version IS NULL)
        );
        -- One live draft a project: the Mac's next draft replaces it.
        CREATE UNIQUE INDEX releases_one_draft_idx
          ON releases (owner_id, project_key) WHERE status = 'draft';
        -- The following feed, keyset on (published_at, id); and the owner's own lists.
        CREATE INDEX releases_published_idx
          ON releases (published_at DESC, id DESC) WHERE status = 'published';
        CREATE INDEX releases_owner_idx ON releases (owner_id, project_key, created_at DESC);

        CREATE TABLE release_settings (
          user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_key     text NOT NULL {KEY_CHECK},
          every_commits   integer NOT NULL DEFAULT 10
                          CHECK (every_commits BETWEEN {EVERY_COMMITS_MIN} AND {EVERY_COMMITS_MAX}),
          cadence         text NOT NULL DEFAULT 'none' CHECK (cadence IN ({RELEASE_CADENCE})),
          on_shipped      boolean NOT NULL DEFAULT true,
          drafts_to_phone boolean NOT NULL DEFAULT false,
          updated_at      timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, project_key)
        );

        GRANT SELECT, INSERT, DELETE ON project_stars TO builder_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON project_stars, releases, release_settings
          TO builder_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON releases, release_settings TO builder_app;
        -- What builder_app may change after insert. Whose a release is, which project, when it
        -- was made and whether its push went are fixed; a star is never updated at all.
        REVOKE UPDATE ON releases, release_settings FROM builder_app;
        GRANT UPDATE (status, title, notes, highlights, commits, trigger, has_trailer,
                      trailer_version, visibility, updated_at, published_at)
          ON releases TO builder_app;
        GRANT UPDATE (every_commits, cadence, on_shipped, drafts_to_phone, updated_at)
          ON release_settings TO builder_app;

        -- ------------------------------------------------------------------ helpers

        -- The owner marked the repository public, and the name rule gives it a name.
        CREATE OR REPLACE FUNCTION project_is_public(p_owner uuid, p_key text)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM repos r
            JOIN repo_visibility rv
              ON rv.repo_id = r.id AND rv.user_id = p_owner AND rv.visibility = 'public'
            WHERE r.repo_hash = p_key AND r.public_name IS NOT NULL
              AND EXISTS (SELECT 1 FROM sessions s
                          WHERE s.user_id = p_owner AND s.repo_id = r.id))
        $$;

        -- The profile's name rule (builder_profile.project_names reads names through this), to
        -- the owner; to anyone else only while the project is public.
        CREATE OR REPLACE FUNCTION project_public_name(p_owner uuid, p_key text)
        RETURNS text
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT r.public_name FROM repos r
          WHERE r.repo_hash = p_key AND r.public_name IS NOT NULL
            AND NOT session_repo_excluded(p_owner, r.id)
            AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = p_owner AND s.repo_id = r.id)
            AND (p_owner = {VIEWER} OR project_is_public(p_owner, p_key))
        $$;

        -- Whether the viewer may see this person's projects: the public profile's rule. Their
        -- own; a public profile; or a private one the viewer follows, accepted.
        CREATE OR REPLACE FUNCTION can_see_projects(p_owner uuid)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT p_owner = {VIEWER}
            OR EXISTS (SELECT 1 FROM users u
                       WHERE u.id = p_owner AND u.deleted_at IS NULL AND u.profile_public)
            OR EXISTS (SELECT 1 FROM follows f
                       WHERE f.follower_id = {VIEWER} AND f.followee_id = p_owner
                         AND f.state = 'accepted')
        $$;

        -- A star may be inserted: somebody else's project, public, and theirs to be seen.
        CREATE OR REPLACE FUNCTION project_starrable(p_owner uuid, p_key text)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT {VIEWER} IS NOT NULL AND p_owner <> {VIEWER}
            AND project_is_public(p_owner, p_key) AND can_see_projects(p_owner)
        $$;

        -- How many starred a project, never who. To the owner; to anyone else only while it is
        -- public (NULL otherwise, which is not zero).
        CREATE OR REPLACE FUNCTION star_count(p_owner uuid, p_key text)
        RETURNS integer
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT CASE WHEN p_owner = {VIEWER} OR project_is_public(p_owner, p_key)
                      THEN (SELECT count(*)::integer FROM project_stars s
                            WHERE s.owner_id = p_owner AND s.project_key = p_key)
                 END
        $$;

        -- A person's public projects, keyed and named, for a viewer who may see their projects.
        CREATE OR REPLACE FUNCTION public_projects(p_owner uuid)
        RETURNS TABLE (project_key text, name text)
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT r.repo_hash, r.public_name FROM repos r
          JOIN repo_visibility rv
            ON rv.repo_id = r.id AND rv.user_id = p_owner AND rv.visibility = 'public'
          WHERE r.public_name IS NOT NULL
            AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = p_owner AND s.repo_id = r.id)
            AND can_see_projects(p_owner)
          ORDER BY r.public_name, r.repo_hash
        $$;

        -- Who may read a release. Its owner, whatever its status; anyone else only once it is
        -- published, and then: public on a public project, or a follower of the owner (accepted),
        -- or a stargazer of the project while it is public. Never once the repository is excluded.
        CREATE OR REPLACE FUNCTION can_view_release(p_release uuid)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM releases r
            WHERE r.id = p_release
              AND NOT EXISTS (SELECT 1 FROM repos rp
                              WHERE rp.repo_hash = r.project_key
                                AND session_repo_excluded(r.owner_id, rp.id))
              AND (
                r.owner_id = {VIEWER}
                OR (r.status = 'published' AND {VIEWER} IS NOT NULL AND (
                      (r.visibility = 'public' AND project_is_public(r.owner_id, r.project_key))
                      OR EXISTS (SELECT 1 FROM follows f
                                 WHERE f.follower_id = {VIEWER} AND f.followee_id = r.owner_id
                                   AND f.state = 'accepted')
                      OR (EXISTS (SELECT 1 FROM project_stars s
                                  WHERE s.user_id = {VIEWER} AND s.owner_id = r.owner_id
                                    AND s.project_key = r.project_key)
                          AND project_is_public(r.owner_id, r.project_key))))
              )
          )
        $$;

        -- The push's audience, ONCE: marks the release notified and answers who to tell, to its
        -- owner, for a published release, the first time only. Followers (accepted) and, while the
        -- project is public, its stargazers. Every one of them can read it (can_view_release).
        CREATE OR REPLACE FUNCTION claim_release_audience(p_release uuid)
        RETURNS SETOF uuid
        LANGUAGE plpgsql
        VOLATILE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          v_owner  uuid;
          v_key    text;
          v_public boolean;
        BEGIN
          UPDATE releases SET notified_at = now()
          WHERE id = p_release AND owner_id = {VIEWER} AND status = 'published'
            AND notified_at IS NULL
          RETURNING owner_id, project_key INTO v_owner, v_key;
          IF v_owner IS NULL THEN
            RETURN;
          END IF;
          v_public := project_is_public(v_owner, v_key);
          RETURN QUERY
            SELECT a.id FROM (
              SELECT f.follower_id AS id FROM follows f
              WHERE f.followee_id = v_owner AND f.state = 'accepted'
              UNION
              SELECT s.user_id FROM project_stars s
              WHERE v_public AND s.owner_id = v_owner AND s.project_key = v_key
            ) a
            JOIN users u ON u.id = a.id AND u.deleted_at IS NULL
            WHERE a.id <> v_owner;
        END
        $$;

        -- The exclusion sweep: every star on the viewer's own project, which the viewer cannot
        -- see (a star is its giver's row). Returns how many went.
        CREATE OR REPLACE FUNCTION drop_project_stars(p_key text)
        RETURNS integer
        LANGUAGE sql
        VOLATILE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH gone AS (
            DELETE FROM project_stars
            WHERE owner_id = {VIEWER} AND project_key = p_key
            RETURNING 1)
          SELECT count(*)::integer FROM gone
        $$;

        {grants}

        -- ------------------------------------------------------------------ policies

        ALTER TABLE project_stars ENABLE ROW LEVEL SECURITY;
        ALTER TABLE project_stars FORCE  ROW LEVEL SECURITY;
        -- Whose star it is decides everything, and a new one only on a starrable project, so a
        -- star on a private project is refused by the database as well as by the route.
        CREATE POLICY project_stars_select ON project_stars FOR SELECT
          USING (user_id = {VIEWER});
        CREATE POLICY project_stars_insert ON project_stars FOR INSERT
          WITH CHECK (user_id = {VIEWER} AND project_starrable(owner_id, project_key));
        CREATE POLICY project_stars_delete ON project_stars FOR DELETE
          USING (user_id = {VIEWER});

        ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
        ALTER TABLE releases FORCE  ROW LEVEL SECURITY;
        -- Split per command: permissive policies OR together, so a FOR ALL visibility policy would
        -- let a reader write.
        CREATE POLICY releases_select ON releases FOR SELECT
          USING (owner_id = {VIEWER} OR can_view_release(id));
        CREATE POLICY releases_insert ON releases FOR INSERT
          WITH CHECK (owner_id = {VIEWER});
        CREATE POLICY releases_update ON releases FOR UPDATE
          USING (owner_id = {VIEWER}) WITH CHECK (owner_id = {VIEWER});
        CREATE POLICY releases_delete ON releases FOR DELETE
          USING (owner_id = {VIEWER});

        {_owner_policies("release_settings", "user_id")}

        COMMENT ON TABLE project_stars IS
          'Who starred which public project. The giver''s row; counts through star_count().';
        COMMENT ON TABLE releases IS
          'A project''s release: drafted by the owner''s Mac or phone, published by the phone, '
          'read through can_view_release().';
        COMMENT ON TABLE release_settings IS
          'When the owner''s Mac drafts a release for a project, and whether it may. Owner only.';
        """
    )


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION IF EXISTS {f};" for f in reversed(FUNCTIONS))
    op.execute(
        f"""
        DROP TABLE IF EXISTS release_settings, releases, project_stars CASCADE;
        {drops}
        DROP FUNCTION IF EXISTS release_highlights_ok(jsonb);
        """
    )

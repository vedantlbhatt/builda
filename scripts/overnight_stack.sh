#!/usr/bin/env bash
# A local, reproducible end-to-end Builder stack: Postgres databases, the API under
# uvicorn, a paired phone device, capture credentials, and a real-corpus upload.
#
#   scripts/overnight_stack.sh up        create DBs if missing, migrate, start the API, wait for /health
#   scripts/overnight_stack.sh pair      mint the phone device (device.json) and capture's credentials
#   scripts/overnight_stack.sh sync      capture sync + capture report over the corpus, other harnesses off
#   scripts/overnight_stack.sh live [T]  tail transcript T (default: every one written in the last hour) into the hook route
#   scripts/overnight_stack.sh status    API, migration head, row counts
#   scripts/overnight_stack.sh phone     GET the phone's endpoints with device.json's token
#   scripts/overnight_stack.sh token     print a valid access token for device.json (refreshing it)
#   scripts/overnight_stack.sh test      the server pytest suite against the separate test DB
#   scripts/overnight_stack.sh lan [stop]  a second API on this Mac's Wi-Fi address, for a real iPhone
#   scripts/overnight_stack.sh iphone ID [--onboarded]  sign the app on iPhone ID in with a freshly minted device
#   scripts/overnight_stack.sh down      stop the API (and the Wi-Fi one)
#   scripts/overnight_stack.sh restart   down + up
#   scripts/overnight_stack.sh logs      tail the API log
#   scripts/overnight_stack.sh reset     drop the two overnight DBs and the minted state (asks first)
#
# Nothing secret is written inside the repository. Keys, tokens, the log and the pid file
# live in $OVERNIGHT_HOME (default ~/.builder-overnight, mode 0700, secrets 0600), and so do
# published project demos ($OVERNIGHT_HOME/media, 0700: OBJECT_STORE_ENDPOINT=file://..., the
# object store's development backend, for both APIs). Every
# child process runs under `env -i` with only the variables set here, so a DATABASE_URL,
# APNS key or BUILDER_CAPTURE_KEY exported in your shell for other work cannot leak into
# this stack, and ~/.builder/credentials.json is never read or written
# (BUILDER_CREDENTIALS points capture somewhere else).
#
# Databases: migrations run as the OWNER ($OVERNIGHT_OWNER, default the current OS user,
# which is the local superuser); the API connects as builder_app, which is NOSUPERUSER
# NOBYPASSRLS, so boot.py's RLS checks run for real. The script refuses any database name
# that does not start with "builder_overnight", so `builder` and `builder_test` are never
# touched.
#
# Overrides (all optional): OVERNIGHT_HOME, OVERNIGHT_PGHOST (/tmp), OVERNIGHT_PGPORT
# (5432), OVERNIGHT_OWNER, OVERNIGHT_DB (builder_overnight), OVERNIGHT_TEST_DB
# (builder_overnight_test), OVERNIGHT_PORT (8787), OVERNIGHT_CORPUS ($OVERNIGHT_HOME/corpus),
# OVERNIGHT_HANDLE (vedant), OVERNIGHT_DISPLAY_NAME (Vedant), BUILDER_TZ (America/New_York),
# BUILDER_CAPTURE_EXCLUDE (passed through to capture when set).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO/server"
VENV="$SERVER_DIR/.venv"
PY="$VENV/bin/python"

STATE_DIR="${OVERNIGHT_HOME:-$HOME/.builder-overnight}"
PG_HOST="${OVERNIGHT_PGHOST:-/tmp}"
PG_PORT="${OVERNIGHT_PGPORT:-5432}"
OWNER="${OVERNIGHT_OWNER:-$(id -un)}"
APP_ROLE="builder_app"
DB="${OVERNIGHT_DB:-builder_overnight}"
TEST_DB="${OVERNIGHT_TEST_DB:-builder_overnight_test}"
PORT="${OVERNIGHT_PORT:-8787}"
API="http://127.0.0.1:$PORT"
CORPUS="${OVERNIGHT_CORPUS:-$STATE_DIR/corpus}"
HANDLE="${OVERNIGHT_HANDLE:-vedant}"
DISPLAY_NAME="${OVERNIGHT_DISPLAY_NAME:-Vedant}"
TZ_NAME="${BUILDER_TZ:-America/New_York}"

KEY_FILE="$STATE_DIR/jwt_ed25519.pem"
PID_FILE="$STATE_DIR/api.pid"
LOG_FILE="$STATE_DIR/api.log"
DEVICE_JSON="$STATE_DIR/device.json"
CAPTURE_DIR="$STATE_DIR/capture"
CAPTURE_CREDS="$CAPTURE_DIR/credentials.json"
# Project demos (docs/demos.md): the object store's development backend, a directory both
# APIs share. Uploads PUT to the API and reads stream from disk behind the bearer, so a phone
# on the tunnel walks the flow production runs against S3. 0700: it holds a person's images.
MEDIA_DIR="$STATE_DIR/media"

die() { echo "overnight_stack: $*" >&2; exit 1; }
say() { echo "==> $*"; }

# SQLAlchemy URLs over the Unix socket. make_url() in the test suite keeps the query
# string when it swaps the username, so the same shape works for BUILDER_TEST_DB.
db_url() { echo "postgresql+psycopg://$1@/$2?host=$PG_HOST&port=$PG_PORT"; }

guard_db_name() {
  case "$1" in
    builder_overnight*) ;;
    *) die "refusing to touch database '$1': only builder_overnight* databases are managed here" ;;
  esac
}

# The only environment a child process sees. PATH and HOME so git, curl and psql work.
clean_env() {
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" "$@"
}

psql_owner() { # psql_owner DB [psql args...]
  local d="$1"; shift
  psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$OWNER" -d "$d" "$@"
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR" "$CAPTURE_DIR" "$MEDIA_DIR"
  chmod 700 "$STATE_DIR" "$CAPTURE_DIR" "$MEDIA_DIR"
}

ensure_venv() {
  if [ -x "$PY" ] && "$PY" -c 'import fastapi, sqlalchemy, psycopg, alembic, jwt, uvicorn, pytest' 2>/dev/null; then
    return
  fi
  command -v uv >/dev/null || die "uv not found; install it or create $VENV by hand"
  say "creating $VENV from server/requirements.txt (the pins CI and the Dockerfile install)"
  (cd "$SERVER_DIR" && uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt "pytest==9.1.1")
}

ensure_key() {
  if [ -s "$KEY_FILE" ]; then chmod 600 "$KEY_FILE"; return; fi
  say "generating an Ed25519 JWT signing key at $KEY_FILE"
  (umask 077 && "$PY" - "$KEY_FILE" <<'PY'
import sys
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

pem = ed25519.Ed25519PrivateKey.generate().private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
)
with open(sys.argv[1], "wb") as f:
    f.write(pem)
PY
  )
  chmod 600 "$KEY_FILE"
}

ensure_db() { # ensure_db NAME
  guard_db_name "$1"
  if [ "$(psql_owner postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$1'")" != "1" ]; then
    say "creating database $1 (owner $OWNER)"
    createdb -h "$PG_HOST" -p "$PG_PORT" -U "$OWNER" -O "$OWNER" "$1"
  fi
  # builder_app is cluster-wide and created by migration 0003 if missing; it needs CONNECT
  # here (PUBLIC has it by default, granted explicitly in case that was ever revoked).
  psql_owner "$1" -qc "DO \$\$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE') THEN
        EXECUTE 'GRANT CONNECT ON DATABASE $1 TO $APP_ROLE';
      END IF; END \$\$;"
}

migrate() { # migrate NAME
  guard_db_name "$1"
  say "alembic upgrade head on $1 (as $OWNER)"
  (cd "$SERVER_DIR" && clean_env DATABASE_URL="$(db_url "$OWNER" "$1")" "$VENV/bin/alembic" upgrade head)
}

api_pid() { # prints the pid if OUR uvicorn is running, else nothing
  [ -f "$PID_FILE" ] || return 0
  local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -q "builder.main:app"; then
    echo "$pid"
  fi
}

health() { curl -fsS --max-time 3 "$API/health" 2>/dev/null; }

start_api() {
  local pid; pid="$(api_pid)"
  if [ -n "$pid" ]; then say "API already running (pid $pid)"; return; fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $PORT is already taken by something that is not this stack's API"
  fi
  say "starting the API on $API (log $LOG_FILE)"
  touch "$LOG_FILE" && chmod 600 "$LOG_FILE"
  echo "---- $(date '+%Y-%m-%dT%H:%M:%S%z') start" >>"$LOG_FILE"
  # setsid so the server survives the shell that started it; exec keeps one pid all the
  # way down, so $! is uvicorn's pid.
  (
    cd "$SERVER_DIR"
    exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
      ENVIRONMENT=development \
      APP_DATABASE_URL="$(db_url "$APP_ROLE" "$DB")" \
      JWT_PRIVATE_KEY="$(cat "$KEY_FILE")" \
      OBJECT_STORE_ENDPOINT="file://$MEDIA_DIR" \
      BASE_URL="$API" \
      nohup "$PY" -c 'import os, sys; os.setsid(); os.execv(sys.argv[1], sys.argv[1:])' \
      "$VENV/bin/uvicorn" builder.main:app --host 127.0.0.1 --port "$PORT" \
      >>"$LOG_FILE" 2>&1 </dev/null
  ) &
  echo $! >"$PID_FILE"
  chmod 600 "$PID_FILE"
  local i
  for i in $(seq 1 60); do
    if health >/dev/null; then say "API healthy: $(health)"; return; fi
    if [ -z "$(api_pid)" ]; then
      tail -n 40 "$LOG_FILE" >&2
      die "the API exited during startup (log above)"
    fi
    sleep 0.5
  done
  tail -n 40 "$LOG_FILE" >&2
  die "the API did not answer /health within 30 s"
}

require_api() { health >/dev/null || die "the API is not answering at $API; run '$0 up' first"; }

# ------------------------------------------------------------------------ subcommands

cmd_up() {
  command -v psql >/dev/null || die "psql not found"
  ensure_state_dir
  ensure_venv
  ensure_key
  ensure_db "$DB"
  ensure_db "$TEST_DB"
  migrate "$DB"
  migrate "$TEST_DB"
  start_api
}

# A real iPhone cannot reach 127.0.0.1, and rebinding the main API would drop every simulator
# mid request. So the phone gets a SECOND uvicorn on the Wi-Fi address, same database, same
# key: two processes, one stack. Build the app with BUILDER_API_URL set to the address this
# prints; the address is baked in at build time (CLAUDE.md).
LAN_PID_FILE="$STATE_DIR/api-lan.pid"
LAN_LOG_FILE="$STATE_DIR/api-lan.log"
lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true; }
lan_pid() {
  [ -f "$LAN_PID_FILE" ] || return 0
  local pid; pid="$(cat "$LAN_PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -q "builder.main:app"; then
    echo "$pid"
  fi
}
cmd_lan() {
  if [ "${1:-}" = "stop" ]; then
    local pid; pid="$(lan_pid)"
    [ -n "$pid" ] && kill "$pid" && say "stopped the Wi-Fi API (pid $pid)"
    rm -f "$LAN_PID_FILE"
    return
  fi
  require_api
  local ip; ip="$(lan_ip)"
  [ -n "$ip" ] || die "no Wi-Fi address on en0 or en1; is this Mac on a network?"
  local url="http://$ip:$PORT"
  if [ -n "$(lan_pid)" ]; then say "Wi-Fi API already running at $url"; return; fi
  ensure_state_dir
  say "starting a second API on $url (log $LAN_LOG_FILE)"
  touch "$LAN_LOG_FILE" && chmod 600 "$LAN_LOG_FILE"
  (
    cd "$SERVER_DIR"
    exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
      ENVIRONMENT=development \
      APP_DATABASE_URL="$(db_url "$APP_ROLE" "$DB")" \
      JWT_PRIVATE_KEY="$(cat "$KEY_FILE")" \
      OBJECT_STORE_ENDPOINT="file://$MEDIA_DIR" \
      BASE_URL="$url" \
      nohup "$PY" -c 'import os, sys; os.setsid(); os.execv(sys.argv[1], sys.argv[1:])' \
      "$VENV/bin/uvicorn" builder.main:app --host "$ip" --port "$PORT" \
      >>"$LAN_LOG_FILE" 2>&1 </dev/null
  ) &
  echo $! >"$LAN_PID_FILE"
  chmod 600 "$LAN_PID_FILE"
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 3 "$url/health" >/dev/null 2>&1; then
      say "Wi-Fi API healthy. Build the phone with BUILDER_API_URL=$url"
      return
    fi
    sleep 0.5
  done
  tail -n 40 "$LAN_LOG_FILE" >&2
  die "the Wi-Fi API did not answer /health within 30 s"
}

# Signs the app on a real iPhone in through the dev-auth link (a Debug build only). The phone
# gets a device of its OWN, minted here and never written to disk: refresh tokens rotate, and
# a spent one presented again revokes the whole device, so a pair shared with device.json or a
# simulator dies the second time either side refreshes. ID is the CoreDevice identifier from
# `xcrun devicectl list devices`. Run it only AFTER the app has loaded its JavaScript once and
# Local Network is allowed: a first launch cannot reach Metro, the relaunch drops the link, and
# the phone then onboards signed out and makes a new user with Sign in with Apple.
cmd_iphone() {
  require_api
  local id="${1:-}"; [ -n "$id" ] || die "usage: $0 iphone <devicectl device id> [--onboarded]"
  local onboarded=""; [ "${2:-}" = "--onboarded" ] && onboarded="&onboarded=1"
  local name; name="$(xcrun devicectl device info details --device "$id" 2>/dev/null \
    | awk -F': ' '/^ *• name:/ {print $2; exit}')"
  say "minting a device for ${name:-the iPhone} and opening the app signed in"
  local url
  url="$(mint "${name:-iPhone} (overnight)" ios "iphone-$id" | "$PY" -c '
import json, sys, urllib.parse
d = json.load(sys.stdin)
print("builder://dev-auth?" + urllib.parse.urlencode({"access": d["access_token"], "refresh": d["refresh_token"]}) + sys.argv[1])
' "$onboarded")" || die "minting the iPhone device failed"
  xcrun devicectl device process launch --device "$id" --terminate-existing \
    --payload-url "$url" com.vedantlbhatt.Builder >/dev/null || die "launch failed; is the app installed?"
  say "launched"
}

cmd_down() {
  cmd_lan stop
  local pid; pid="$(api_pid)"
  if [ -z "$pid" ]; then say "API not running"; rm -f "$PID_FILE"; return; fi
  say "stopping the API (pid $pid)"
  kill "$pid"
  local i
  for i in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || { rm -f "$PID_FILE"; say "stopped"; return; }
    sleep 0.5
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  say "killed"
}

mint() { # mint LABEL PLATFORM MACHINE [extra args...] -> JSON on stdout
  local label="$1" platform="$2" machine="$3"; shift 3
  (cd "$REPO" && clean_env DATABASE_URL="$(db_url "$OWNER" "$DB")" \
    "$PY" scripts/e2e_mint_device.py --server "$API" --handle "$HANDLE" \
      --display-name "$DISPLAY_NAME" --tz "$TZ_NAME" \
      --label "$label" --platform "$platform" --machine "$machine" "$@")
}

cmd_pair() {
  require_api
  ensure_state_dir
  # TWO devices under one user, on purpose. Refresh tokens rotate and a spent one
  # presented again revokes the whole device (auth.redeem_refresh_token). One token pair
  # copied into both device.json and capture's credentials file dies the second time
  # either holder refreshes: capture rotates it after 15 minutes, and the next refresh
  # from device.json is "reuse detected". A phone and an uploader are two devices in the
  # product too, and the phone routes read by user, so the phone sees every upload.
  say "minting the phone device (platform ios, handle $HANDLE) -> $DEVICE_JSON"
  local tmp; tmp="$(mktemp "$STATE_DIR/.device.XXXXXX")"
  chmod 600 "$tmp"
  if ! mint "iPhone (overnight)" ios "overnight-iphone" >"$tmp"; then
    rm -f "$tmp"; die "minting the phone device failed"
  fi
  mv "$tmp" "$DEVICE_JSON"
  chmod 600 "$DEVICE_JSON"

  say "minting the capture device (platform macos) -> $CAPTURE_CREDS"
  mint "Claude Code (overnight capture)" macos "overnight-capture" \
    --credentials "$CAPTURE_CREDS" >/dev/null
  chmod 600 "$CAPTURE_CREDS"
  "$PY" - "$DEVICE_JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"    user {d['user_id']}  handle {d['handle']}  phone machine {d['machine_id'][:12]}…")
PY
}

capture_env() { # the environment every capture invocation runs under
  clean_env BUILDER_CREDENTIALS="$CAPTURE_CREDS" BUILDER_TZ="$TZ_NAME" \
    ${BUILDER_CAPTURE_EXCLUDE:+BUILDER_CAPTURE_EXCLUDE="$BUILDER_CAPTURE_EXCLUDE"} "$@"
}

cmd_sync() {
  require_api
  [ -s "$CAPTURE_CREDS" ] || die "no capture credentials at $CAPTURE_CREDS; run '$0 pair' first"
  [ -d "$CORPUS" ] || die "corpus root $CORPUS does not exist"
  local rc=0
  say "capture sync --live over $CORPUS (Claude Code only)"
  (cd "$REPO" && capture_env "$PY" -m capture sync --root "$CORPUS" --server "$API" \
    --no-other-harnesses --live "$@") || rc=$?
  [ "$rc" -eq 0 ] || echo "    capture sync exited $rc" >&2
  say "capture report over $CORPUS (Claude Code only)"
  local rrc=0
  (cd "$REPO" && capture_env "$PY" -m capture report --root "$CORPUS" --server "$API" \
    --no-other-harnesses) || rrc=$?
  [ "$rrc" -eq 0 ] || echo "    capture report exited $rrc" >&2
  [ "$rc" -eq 0 ] && [ "$rrc" -eq 0 ]
}

cmd_live() { # tail a running Claude Code transcript into the hook's route, as the hook would
  # `python -m capture live` (docs/overnight-integration.md section 4): nothing goes into
  # ~/.claude/settings.json. Every 5 s it posts the transcript's new COMPLETE lines to
  # /v1/ingest/transcript with the hook's headers, and after 30 s with nothing new an empty
  # heartbeat, so the server re-cuts on its own clock and the live state keeps moving. The
  # offsets live beside capture's credentials, never in hook.sh's ~/.builder/offsets.
  require_api
  [ -s "$CAPTURE_CREDS" ] || die "no capture credentials at $CAPTURE_CREDS; run '$0 pair' first"
  local args=(--server "$API" --every 5 --heartbeat 30)
  if [ -n "${1:-}" ] && [ "${1#-}" = "$1" ]; then
    [ -f "$1" ] || die "no transcript at $1"
    args+=(--transcript "$1")
    shift
  fi
  say "capture live ${args[*]} $* (Ctrl+C to stop)"
  (cd "$REPO" && capture_env "$PY" -m capture live "${args[@]}" "$@")
}

cmd_status() {
  local pid h
  pid="$(api_pid)"
  h="$(health || true)"
  if [ -n "$h" ]; then
    echo "api       up    pid ${pid:-?}  $API  $h"
  else
    echo "api       DOWN  ${pid:+pid $pid (not answering)}  $API"
  fi
  local head
  head="$(cd "$SERVER_DIR" && clean_env "$VENV/bin/alembic" heads 2>/dev/null | awk '{print $1}' | paste -sd, -)"
  local d cur
  for d in "$DB" "$TEST_DB"; do
    if [ "$(psql_owner postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$d'")" != "1" ]; then
      echo "db        $d  MISSING"
      continue
    fi
    cur="$(psql_owner "$d" -Atc "SELECT string_agg(version_num, ',') FROM alembic_version" 2>/dev/null || echo none)"
    if [ "$cur" = "$head" ]; then
      echo "db        $d  alembic $cur (at head)"
    else
      echo "db        $d  alembic ${cur:-none}  (head is $head)"
    fi
  done
  psql_owner "$DB" -At -F ' ' -c "
    SELECT 'rows      users '         || (SELECT count(*) FROM users)
        || '  devices '               || (SELECT count(*) FROM devices WHERE revoked_at IS NULL)
        || '  sessions final '        || (SELECT count(*) FROM sessions WHERE state = 'final')
        || ' / live '                 || (SELECT count(*) FROM sessions WHERE state = 'live')
        || ' (visible '               || (SELECT count(*) FROM sessions WHERE visible)
        || ', notable '               || (SELECT count(*) FROM sessions WHERE notable)
        || ')  builder_report '       || (SELECT count(*) FROM builder_report);" 2>/dev/null \
    || echo "rows      (tables not there yet; run '$0 up')"
  if [ -s "$DEVICE_JSON" ]; then echo "phone     $DEVICE_JSON"; else echo "phone     not paired"; fi
  if [ -s "$CAPTURE_CREDS" ]; then echo "capture   $CAPTURE_CREDS"; else echo "capture   not paired"; fi
}

cmd_token() { # a valid access token for device.json, refreshed (and rotated on disk) if needed
  require_api
  [ -s "$DEVICE_JSON" ] || die "no $DEVICE_JSON; run '$0 pair' first"
  "$PY" - "$DEVICE_JSON" "$API" <<'PY'
import base64, json, os, sys, tempfile, time, urllib.error, urllib.request

path, api = sys.argv[1], sys.argv[2].rstrip("/")
d = json.load(open(path))

def exp(tok: str) -> float:
    body = tok.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))["exp"]

if exp(d["access_token"]) - time.time() > 60:
    print(d["access_token"])
    sys.exit(0)

req = urllib.request.Request(
    api + "/v1/auth/refresh",
    data=json.dumps({"refresh_token": d["refresh_token"]}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        new = json.loads(r.read())
except urllib.error.HTTPError as e:
    sys.exit(f"refresh failed ({e.code}): {e.read().decode()[:200]}; run pair again")
d["access_token"], d["refresh_token"] = new["access_token"], new["refresh_token"]
d["refreshed_at"] = time.time()
# The rotated pair is on disk before anything uses it: the old refresh token is spent.
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".device.")
with os.fdopen(fd, "w") as f:
    json.dump(d, f, indent=1)
    f.write("\n")
os.chmod(tmp, 0o600)
os.replace(tmp, path)
print(d["access_token"])
PY
}

cmd_phone() { # what the phone would get, with device.json's token
  local tok; tok="$(cmd_token)"
  local path
  for path in "/v1/sessions?limit=5" "/v1/sessions/live" "/v1/profile" "/v1/profile/builder"; do
    echo "---- GET $path"
    curl -sS --max-time 30 -w '\n[http %{http_code}]\n' -H "Authorization: Bearer $tok" "$API$path" \
      | "$PY" -c '
import json, sys
raw = sys.stdin.read()
body, _, code = raw.rpartition("\n[http ")
try:
    txt = json.dumps(json.loads(body), indent=1, ensure_ascii=False)
except ValueError:
    txt = body
lim = int(sys.argv[1])
print(txt if len(txt) <= lim else txt[:lim] + f"\n... ({len(txt) - lim} more chars)")
print("[http " + code.strip())
' "${OVERNIGHT_PHONE_CHARS:-1500}"
  done
}

cmd_test() {
  command -v psql >/dev/null || die "psql not found"
  ensure_venv
  ensure_db "$TEST_DB"
  migrate "$TEST_DB"
  say "pytest against $TEST_DB (owner $OWNER, RLS tests as $APP_ROLE)"
  (cd "$SERVER_DIR" && clean_env BUILDER_TEST_DB="$(db_url "$OWNER" "$TEST_DB")" \
    DATABASE_URL="$(db_url "$OWNER" "$TEST_DB")" "$VENV/bin/pytest" -q "$@")
}

cmd_logs() { tail -n "${1:-100}" -f "$LOG_FILE"; }

cmd_reset() {
  guard_db_name "$DB"; guard_db_name "$TEST_DB"
  if [ "${1:-}" != "--yes" ]; then
    printf 'Drop %s and %s, and delete %s and %s? [y/N] ' "$DB" "$TEST_DB" "$DEVICE_JSON" "$CAPTURE_DIR"
    local ans; read -r ans
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] || die "aborted"
  fi
  cmd_down
  dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$OWNER" --if-exists "$DB"
  dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$OWNER" --if-exists "$TEST_DB"
  rm -f "$DEVICE_JSON"
  rm -rf "$CAPTURE_DIR"
  say "reset done (the signing key and the log are kept)"
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) shift; cmd_down "$@" ;;
  # A restart brings the Wi-Fi API back if it was up: a phone on it lost its server for good
  # the first time an agent restarted the stack to re-sync (2026-09-13, 00:15).
  restart) shift; had_lan="$(lan_pid)"; cmd_down; cmd_up "$@"; if [ -n "$had_lan" ]; then cmd_lan; fi ;;
  pair) shift; cmd_pair "$@" ;;
  sync) shift; cmd_sync "$@" ;;
  live) shift; cmd_live "$@" ;;
  status) shift; cmd_status "$@" ;;
  token) shift; cmd_token "$@" ;;
  phone) shift; cmd_phone "$@" ;;
  test) shift; cmd_test "$@" ;;
  logs) shift; cmd_logs "$@" ;;
  reset) shift; cmd_reset "$@" ;;
  lan) shift; cmd_lan "$@" ;;
  iphone) shift; cmd_iphone "$@" ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

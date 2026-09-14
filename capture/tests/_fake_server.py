"""A stand-in for the Builder server, in a thread, for the client tests.

It implements exactly the behaviour the client depends on and nothing else: bearer
checking, refresh-token ROTATION with reuse detection (a spent token presented again
revokes the device), capture keys (`bck_…`, accepted on the write only routes as
`auth.current_uploader` accepts them; revoked == unknown == 401), the device-grant
start/poll pair, `/v1/sync/known`, the batch upload, the hook's transcript route
(`routes/ingest.py`: offsets, the 409 gap, gzip), the report and quotes PUTs, and a project
demo's presign, upload URL, commit and delete (`routes/media.py`, which refuses a capture key
as every route off `_KEY_ROUTES` does). Every request is recorded so a test can assert what
was, and was not, sent.
"""

from __future__ import annotations

import gzip
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

#: The routes a capture key may write to (`auth.current_uploader`); every other route
#: refuses one.
_KEY_ROUTES = re.compile(r"^/v1/(sync/|ingest/|profile/(narrative|report|quotes)$)")


class FakeBuilder:
    def __init__(self):
        self.valid_access: set[str] = set()
        self.live_refresh: dict[str, str] = {}  # refresh token -> chain id
        self.spent_refresh: set[str] = set()
        self.revoked_chains: set[str] = set()
        self.reuse_detected = 0
        self.requests: list[tuple[str, str, dict | None, str | None]] = []
        self.known: dict[str, str] = {}
        self.uploads: list[list[dict]] = []
        self.pending_polls = 0  # authorization_pending answers before "ok"
        self.valid_keys: set[str] = set()  # capture keys the server accepts on sync routes
        self.counter = 0
        #: The hook route: bytes held per native session id, every post's headers and
        #: inflated body, and what `live` answers with (the route's list of lines).
        self.chunks: dict[str, bytes] = {}
        self.ingest_posts: list[tuple[dict, bytes]] = []
        self.ingest_live: list[dict] = []
        self.reports: list[dict] = []
        self.quotes: list[dict] = []
        self.quotes_on = True
        self.quotes_deleted = 0
        #: Project demos (routes/media.py): rows by media id, what each upload URL received
        #: (path, headers, bytes, the bearer it carried: there must be none), and statuses to
        #: answer the next uploads with, for a publish that fails part way.
        self.media: dict[str, dict] = {}
        self.media_uploads: list[tuple[str, dict, bytes, str | None]] = []
        self.media_upload_status: list[int] = []
        #: Commits: which one (counting from 1) answers 500, and whether the server still
        #: acts on it first (its answer lost on the way back, after the demo was replaced).
        self.media_commits = 0
        self.media_commit_fails_at: int | None = None
        self.media_commit_acts_anyway = False
        self.lock = threading.Lock()
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def _send(self, status: int, body: dict):
                if status == 204:
                    self.send_response(204)
                    self.end_headers()
                    return
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _raw(self) -> bytes:
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def _body(self):
                raw = self._raw()
                return json.loads(raw) if raw else None

            def _bearer(self):
                h = self.headers.get("Authorization", "")
                return h[7:] if h.lower().startswith("bearer ") else None

            def do_GET(self):
                self._route("GET")

            def do_POST(self):
                self._route("POST")

            def do_PUT(self):
                self._route("PUT")

            def do_DELETE(self):
                self._route("DELETE")

            def _route(self, method):
                token = self._bearer()
                if self.path == "/v1/ingest/transcript" and method == "POST":
                    raw = self._raw()
                    if self.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    headers = {k.lower(): v for k, v in self.headers.items()}
                    with server.lock:
                        server.requests.append((method, self.path, None, token))
                        status, out = server.ingest(headers, raw, token)
                    self._send(status, out)
                    return
                if method == "PUT" and self.path.startswith("/v1/media-upload/"):
                    raw = self._raw()
                    headers = {k.lower(): v for k, v in self.headers.items()}
                    with server.lock:
                        server.requests.append((method, self.path, None, token))
                        status, out = server.media_upload(self.path, headers, raw, token)
                    self._send(status, out)
                    return
                body = self._body() if method in ("POST", "PUT") else None
                with server.lock:
                    server.requests.append((method, self.path, body, token))
                    status, out = server.handle(method, self.path, body, token)
                self._send(status, out)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    # -- lifecycle ----------------------------------------------------------------------

    def start(self) -> str:
        self.thread.start()
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    # -- helpers ------------------------------------------------------------------------

    def _mint(self, chain: str) -> tuple[str, str]:
        self.counter += 1
        access, refresh = f"A{self.counter}", f"R{self.counter}"
        self.valid_access.add(access)
        self.live_refresh[refresh] = chain
        return access, refresh

    def seed(self) -> tuple[str, str]:
        """A paired device: returns (access, refresh) for chain 'dev'."""
        return self._mint("dev")

    def expire_access(self):
        self.valid_access.clear()

    # -- routes -------------------------------------------------------------------------

    def handle(self, method, path, body, token):
        if path == "/v1/auth/refresh" and method == "POST":
            raw = (body or {}).get("refresh_token")
            if raw in self.spent_refresh:
                self.reuse_detected += 1
                chain = self.live_refresh.get(raw, "dev")
                self.revoked_chains.add(chain)
                for r, c in list(self.live_refresh.items()):
                    if c == chain:
                        self.spent_refresh.add(r)
                return 401, {"detail": "refresh token reuse detected; all tokens revoked"}
            if raw not in self.live_refresh:
                return 401, {"detail": "unknown refresh token"}
            chain = self.live_refresh[raw]
            if chain in self.revoked_chains:
                return 401, {"detail": "device revoked"}
            self.spent_refresh.add(raw)
            access, refresh = self._mint(chain)
            return 200, {"access_token": access, "refresh_token": refresh, "expires_in": 900}

        if path == "/v1/auth/device/start" and method == "POST":
            return 200, {
                "device_code": "DEVCODE",
                "user_code": "BCDF-GHJK",
                "verification_uri": "http://fake/pair",
                "expires_in": 900,
                "interval": 5,
            }
        if path == "/v1/auth/device/poll" and method == "POST":
            if (body or {}).get("device_code") != "DEVCODE":
                return 400, {"detail": "unknown device_code"}
            if self.pending_polls > 0:
                self.pending_polls -= 1
                return 200, {"status": "authorization_pending"}
            access, refresh = self._mint("paired")
            return 200, {
                "status": "ok",
                "access_token": access,
                "refresh_token": refresh,
                "expires_in": 900,
            }

        # everything below needs a bearer: a device token, or on a write only route a key
        denied = self._auth(path, token)
        if denied is not None:
            return denied
        m = re.match(r"^/v1/ingest/transcript/([^/]+)/offset$", path)
        if m and method == "GET":
            return 200, {"next_offset": len(self.chunks.get(m.group(1), b""))}
        if path == "/v1/profile/report" and method == "PUT":
            self.reports.append(body or {})
            return 200, {"ok": True}
        if path == "/v1/profile/quotes" and method == "PUT":
            if not self.quotes_on:
                return 409, {"reason": "quotes are off for this account; turn on Settings, Quote my prompts"}
            self.quotes.append(body or {})
            return 200, {"ok": True}
        if path == "/v1/profile/quotes" and method == "DELETE":
            self.quotes_deleted += 1
            self.quotes.clear()
            return 204, {}
        if path == "/v1/sync/known" and method == "GET":
            return 200, {"known": dict(self.known)}
        if path == "/v1/sync/sessions:batch" and method == "POST":
            sessions = (body or {}).get("sessions") or []
            if len(sessions) > 250:
                return 413, {"detail": "at most 250 sessions per batch"}
            self.uploads.append(sessions)
            accepted = unchanged = 0
            for s in sessions:
                if self.known.get(s["client_session_id"]) == s["content_hash"]:
                    unchanged += 1
                else:
                    self.known[s["client_session_id"]] = s["content_hash"]
                    accepted += 1
            return 200, {"accepted": accepted, "unchanged": unchanged, "rejected": []}
        media = self.media_route(method, path, body)
        if media is not None:
            return media
        return 404, {"detail": "no route"}

    def media_route(self, method, path, body):
        """routes/media.py: presign, commit and delete, a set replacing the one before it."""
        m = re.match(r"^/v1/projects/([0-9a-f]{64})/media:presign$", path)
        if m and method == "POST":
            mid = f"m{len(self.media) + 1:04d}"
            b = body or {}
            self.media[mid] = {"key": m.group(1), "body": b, "committed": False, "objects": {}}
            slot = lambda name, ct, n: {  # noqa: E731
                "upload_url": f"/v1/media-upload/{name}",
                "method": "PUT",
                "headers": {"Content-Type": ct, "Content-Length": str(n)},
                "expires_in": 900,
            }
            poster = b.get("poster")
            return 200, {
                "media_id": mid,
                **slot(mid, b.get("content_type"), b.get("bytes")),
                "poster": slot(f"{mid}-poster", poster["content_type"], poster["bytes"]) if poster else None,
            }
        m = re.match(r"^/v1/projects/([0-9a-f]{64})/media/([^/]+):commit$", path)
        if m and method == "POST":
            self.media_commits += 1
            if self.media_commits == self.media_commit_fails_at:
                if self.media_commit_acts_anyway:
                    self._commit(m.group(1), m.group(2))
                return 500, {"detail": "the answer to this commit was lost"}
            return self._commit(m.group(1), m.group(2))
        m = re.match(r"^/v1/projects/([0-9a-f]{64})/media$", path)
        if m and method == "GET":
            shown = [
                {"id": mid, "position": r["body"]["position"], **{k: r["body"][k] for k in (
                    "kind", "width", "height", "duration_ms", "label")}}
                for mid, r in self.media.items()
                if r["key"] == m.group(1) and r["committed"]
            ]
            return 200, {"items": shown}
        if m and method == "DELETE":
            gone = [mid for mid, r in self.media.items() if r["key"] == m.group(1)]
            for mid in gone:
                del self.media[mid]
            return 200, {"deleted": len(gone)}
        return None

    def _commit(self, key: str, media_id: str):
        """routes/media.py's commit: the object at its size, then the set replaces."""
        row = self.media.get(media_id)
        if row is None or row["key"] != key:
            return 404, {"detail": "not found"}
        want = {media_id: row["body"]["bytes"]}
        if row["body"].get("poster"):
            want[f"{media_id}-poster"] = row["body"]["poster"]["bytes"]
        for name, n in want.items():
            if len(row["objects"].get(name, b"")) != n:
                return 409, {"detail": f"nothing of {n} bytes was uploaded for {name}"}
        newly = not row["committed"]
        row["committed"] = True
        pub = row["body"]["publish_id"]
        same = [r for r in self.media.values() if r["key"] == key]
        pending = sum(1 for r in same if r["body"]["publish_id"] == pub and not r["committed"])
        replaced = 0
        if pending == 0 and newly:  # only the commit that completes a set replaces
            for mid, r in list(self.media.items()):
                if r["key"] == key and r["body"]["publish_id"] != pub:
                    del self.media[mid]
                    replaced += 1
        return 200, {"item": {"id": media_id}, "pending": pending, "replaced": replaced}

    def media_upload(self, path: str, headers: dict, body: bytes, token):
        """The file backend's upload URL: the URL is the grant, and a bearer is never sent."""
        self.media_uploads.append((path, headers, body, token))
        if self.media_upload_status:
            status = self.media_upload_status.pop(0)
            if status != 204:
                return status, {"detail": "the store refused this upload"}
        name = path.rsplit("/", 1)[1]
        row = self.media.get(name.removesuffix("-poster"))
        if row is None:
            return 404, {"detail": "nothing is waiting for this upload"}
        if int(headers.get("content-length", "-1")) != len(body):
            return 400, {"detail": "the size is the presign's"}
        row["objects"][name] = body
        return 204, {}

    def _auth(self, path, token):
        if token is not None and token.startswith("bck_"):
            if not _KEY_ROUTES.match(path):
                return 401, {"detail": "capture keys are accepted by the write only routes only"}
            if token not in self.valid_keys:
                return 401, {"detail": "invalid capture key"}
            return None
        if token not in self.valid_access:
            return 401, {"detail": "invalid token"}
        return None

    def ingest(self, headers: dict, body: bytes, token):
        """`routes/ingest.py`: an offset equal to what is held appends, a lower one
        replaces from there, a higher one is a 409 naming the byte to resend from."""
        denied = self._auth("/v1/ingest/transcript", token)
        if denied is not None:
            return denied
        self.ingest_posts.append((headers, body))
        sid = headers.get("x-builder-session-id", "")
        offset = int(headers.get("x-builder-offset", "0"))
        held = self.chunks.get(sid, b"")
        if offset > len(held):
            return 409, {"next_offset": len(held), "reason": "gap: resend from next_offset"}
        held = held[:offset] + body
        self.chunks[sid] = held
        return 200, {
            "next_offset": len(held),
            "recut_stale": 0,
            "accepted": 1 if body else 0,
            "unchanged": 0 if body else 1,
            "rejected": [],
            "live": list(self.ingest_live),
            "final": 0,
        }

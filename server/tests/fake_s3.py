"""A stand-in S3 bucket server, in a thread, for the demos store's tests.

It does what the demos store depends on and nothing else: a presigned PUT and GET, and the
server's own calls signed with an Authorization header (HEAD, a ranged GET, DELETE,
ListObjectsV2 with pages). Every request must carry a signature the SigV4 chain in
objectstore.py reproduces for the fake's own secret, with exactly the headers it signed
(so a PUT of another size or type is refused, as the signed content-length and content-type
make a real bucket refuse it); anything unsigned is a 403, because the bucket is PRIVATE,
which is what makes a presigned GET cut down to its path worth nothing. A presigned URL is
honoured until X-Amz-Date plus X-Amz-Expires and not a second longer, and nothing here knows
about rows: that is how a URL outlives its row at a real bucket, and what the sweep is for.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, unquote, urlsplit
from xml.sax.saxutils import escape

from builder import objectstore

ACCESS = "AKIAFAKEDEMOSSTORE01"
SECRET = "fake/demos/store/secret/not/a/real/one/xx"


def _amz_date(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)


class FakeS3:
    def __init__(self, *, page: int = 2):
        #: (bucket, key) -> (bytes, content type)
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}
        #: (method, path without query, "presigned" | "header")
        self.requests: list[tuple[str, str, str]] = []
        #: (method, path, why): every request refused, so a test can say none was
        self.refused: list[tuple[str, str, str]] = []
        self.page = page
        self.clock = lambda: datetime.now(UTC)
        self.lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, status: int, body: bytes = b"", headers: dict | None = None):
                self.send_response(status)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                if "Content-Length" not in (headers or {}):
                    self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

            def _handle(self):
                with fake.lock:
                    status, body, headers = fake.handle(self)
                self._send(status, body, headers)

            do_GET = do_PUT = do_HEAD = do_DELETE = _handle

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def start(self) -> str:
        self.thread.start()
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def keys(self, bucket: str) -> set[str]:
        return {k for b, k in self.objects if b == bucket}

    # -- auth ----------------------------------------------------------------------------

    def _auth(self, h, parts, query: dict) -> str | None:
        """None when the request is signed right and in time, else why not."""
        headers = {k.lower(): v for k, v in h.headers.items()}
        path = unquote(parts.path)
        host = headers.get("host", "")
        if "X-Amz-Signature" in query:
            cred = query["X-Amz-Credential"].split("/")
            date = _amz_date(query["X-Amz-Date"])
            if self.clock() > date + timedelta(seconds=int(query["X-Amz-Expires"])):
                return "Request has expired"
            signed = query["X-Amz-SignedHeaders"].split(";")
            if "content-length" in signed and h.command == "PUT":
                headers.setdefault("content-length", "0")
            others = {k: v for k, v in query.items() if not k.startswith("X-Amz-")}
            want = objectstore.presign(
                h.command,
                f"http://{host}",
                path,
                {name: headers.get(name, "") for name in signed if name != "host"},
                region=cred[2],
                access_key=cred[0],
                secret_key=SECRET,
                expires=int(query["X-Amz-Expires"]),
                now=date,
                query_params=others or None,
            )
            got = dict(parse_qsl(urlsplit(want).query))["X-Amz-Signature"]
            if cred[0] != ACCESS or got != query["X-Amz-Signature"]:
                return "SignatureDoesNotMatch"
            return None
        auth = headers.get("authorization", "")
        if not auth.startswith(objectstore.ALGORITHM):
            return "AccessDenied: this bucket is private"
        fields = dict(
            p.strip().split("=", 1) for p in auth[len(objectstore.ALGORITHM) :].split(",")
        )
        cred = fields["Credential"].split("/")
        signed = fields["SignedHeaders"].split(";")
        own = ("host", "x-amz-date", "x-amz-content-sha256")
        want = objectstore.sign_headers(
            h.command,
            f"http://{host}{parts.path}" + (f"?{parts.query}" if parts.query else ""),
            {name: headers.get(name, "") for name in signed if name not in own},
            region=cred[2],
            access_key=cred[0],
            secret_key=SECRET,
            now=_amz_date(headers.get("x-amz-date", "19700101T000000Z")),
            payload_hash=headers.get("x-amz-content-sha256", ""),
        )["Authorization"]
        if cred[0] != ACCESS or want != auth:
            return "SignatureDoesNotMatch"
        if self.clock() - _amz_date(headers["x-amz-date"]) > timedelta(minutes=15):
            return "RequestTimeTooSkewed"
        return None

    # -- routes ----------------------------------------------------------------------------

    def handle(self, h):
        parts = urlsplit(h.path)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        path = unquote(parts.path)
        bucket, _, key = path.lstrip("/").partition("/")
        body = b""
        if h.command == "PUT":
            body = h.rfile.read(int(h.headers.get("Content-Length") or 0))
        why = self._auth(h, parts, query)
        kind = "presigned" if "X-Amz-Signature" in query else "header"
        if why is not None:
            self.refused.append((h.command, path, why))
            return 403, why.encode(), {}
        self.requests.append((h.command, path, kind))
        if not key and h.command == "GET" and query.get("list-type") == "2":
            return self._list(bucket, query)
        if h.command == "PUT":
            self.objects[(bucket, key)] = (body, h.headers.get("Content-Type", ""))
            return 200, b"", {"ETag": '"fake"'}
        found = self.objects.get((bucket, key))
        if h.command == "DELETE":
            self.objects.pop((bucket, key), None)
            return 204, b"", {}
        if found is None:
            return 404, b"NoSuchKey", {}
        data, ctype = found
        if h.command == "HEAD":
            return 200, b"", {"Content-Length": str(len(data)), "Content-Type": ctype}
        rng = h.headers.get("Range")
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            part = data[int(a) : int(b) + 1 if b else None]
            return 206, part, {"Content-Type": ctype, "Content-Range": f"bytes {a}-{b}/{len(data)}"}
        return 200, data, {"Content-Type": ctype}

    def _list(self, bucket: str, query: dict):
        prefix = query.get("prefix", "")
        keys = sorted(k for b, k in self.objects if b == bucket and k.startswith(prefix))
        start = int(query.get("continuation-token") or 0)
        page = keys[start : start + self.page]
        more = start + self.page < len(keys)
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<Name>{escape(bucket)}</Name><Prefix>{escape(prefix)}</Prefix>"
            + "".join(
                f"<Contents><Key>{escape(k)}</Key><Size>{len(self.objects[(bucket, k)][0])}</Size>"
                "</Contents>"
                for k in page
            )
            + f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>"
            + (
                f"<NextContinuationToken>{start + self.page}</NextContinuationToken>"
                if more
                else ""
            )
            + "</ListBucketResult>"
        )
        return 200, xml.encode(), {"Content-Type": "application/xml"}

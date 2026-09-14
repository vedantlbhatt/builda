"""S3 SigV4 presigned URLs, with the standard library only, and a directory for the local stack.

Photos never pass through the API: the phone uploads straight to the bucket with a URL
this module signs (docs/social.md, "Storage"). boto is a large dependency for one HMAC
chain, and the chain is short enough to read in full below — which matters, because a
signing bug does not crash. It produces a URL that looks right and is rejected by the
bucket with a 403 the phone cannot explain.

The form implemented is the query-string ("presigned URL") variant of Signature Version 4
with an unsigned payload. `test_objectstore.py` reproduces the worked example from the AWS
documentation byte for byte; that is the only evidence the chain is right, so do not
change the canonicalisation without re-checking against it. The PUT, the GET the phone
reads a demo through, and the HEAD, ranged GET and DELETE the server sends itself are all
that one chain with a different method.

TWO BACKENDS, chosen by `OBJECT_STORE_ENDPOINT` (docs/demos.md, "Storage"):

  https://...      S3 (R2, MinIO, AWS). Uploads and reads go to the bucket with URLs signed
                   here; the API never proxies a byte.
  file:///abs/dir  The local stack's directory. Project demo uploads PUT to the API itself
                   and reads stream from disk behind the bearer (routes/media.py), so a phone
                   on the tunnel walks the flow production runs. DEVELOPMENT ONLY: refused
                   when ENVIRONMENT is production, here and at boot (boot.py), because a
                   production API writing a person's images to its own container disk would
                   lose them on the next deploy and serve them from a box nobody backs up.

Social media (post photos, voice notes) stays S3 only: `from_settings()` is None for a file
endpoint, so a post's presign answers 503 on the local stack exactly as it does unconfigured.
"""

import hashlib
import hmac
import os
import pathlib
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote, unquote, urlsplit

from .settings import settings

ALGORITHM = "AWS4-HMAC-SHA256"
UNSIGNED = "UNSIGNED-PAYLOAD"

FILE_SCHEME = "file://"

#: How long the server waits on the bucket for a HEAD, a ranged GET or a DELETE. A commit
#: and a deletion wait on it, so a stuck bucket is a slow answer, not a hung request.
S3_TIMEOUT_SECONDS = 10

#: The object keys the file backend will map to a path: relative, `/` separated segments of
#: letters, digits, dot, underscore and hyphen, none of them `.` or `..`. Every key this
#: codebase writes is built by `project_media.object_key` and fits; anything else is refused
#: before it can name a path outside the root.
_SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$")


class FileStoreRefused(RuntimeError):
    """The file backend in production: a configuration error, never a fallback."""


@dataclass(frozen=True)
class ObjectStore:
    endpoint: str
    bucket: str
    region: str
    access_key: str
    secret_key: str


def is_file_endpoint(endpoint: str | None = None) -> bool:
    ep = settings().object_store_endpoint if endpoint is None else endpoint
    return ep.strip().lower().startswith(FILE_SCHEME)


def from_settings() -> ObjectStore | None:
    """The configured S3 store, or None when any required piece is missing.

    All-or-nothing on purpose: an endpoint with no secret would sign every URL with an
    empty key, and every upload would fail at the bucket rather than here. A `file://`
    endpoint is not an S3 store, whatever else is set: signing a URL against it would hand
    a client a link to nothing.
    """
    s = settings()
    if not (
        s.object_store_endpoint
        and s.object_store_bucket
        and s.object_store_key
        and s.object_store_secret
    ):
        return None
    if is_file_endpoint(s.object_store_endpoint):
        return None
    return ObjectStore(
        endpoint=s.object_store_endpoint.rstrip("/"),
        bucket=s.object_store_bucket,
        region=s.object_store_region or "auto",
        access_key=s.object_store_key,
        secret_key=s.object_store_secret,
    )


def configured() -> bool:
    return from_settings() is not None


def public_url(object_key: str) -> str | None:
    """Where a stored object can be read from, when a public base is configured."""
    base = settings().object_store_public_base.rstrip("/")
    if not base:
        return None
    return f"{base}/{_uri_encode(object_key, encode_slash=False)}"


# ------------------------------------------------------------------------- signing


def _uri_encode(value: str, *, encode_slash: bool = True) -> str:
    # SigV4's URI encoding: unreserved characters pass, everything else is %XX, and
    # the path keeps its slashes while query values do not. `quote` gets this right
    # once told that `~` is safe (RFC 3986 unreserved; Python only added it by default
    # in 3.7, so it is spelled out).
    return quote(value, safe="-_.~/" if encode_slash is False else "-_.~")


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def presign(
    method: str,
    endpoint: str,
    path: str,
    headers: dict[str, str],
    *,
    region: str,
    access_key: str,
    secret_key: str,
    expires: int,
    now: datetime,
) -> str:
    """A presigned URL for `method path` against `endpoint`, valid for `expires` seconds.

    `headers` are the request headers the client must send verbatim (host is added here).
    Signing `content-type` on a PUT is what stops a presigned image slot being filled with
    an HTML document that a browser would then render from the public base.
    """
    parts = urlsplit(endpoint)
    host = parts.netloc
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    scope = f"{datestamp}/{region}/s3/aws4_request"

    canonical = {"host": host}
    canonical.update({k.lower(): " ".join(v.split()) for k, v in headers.items()})
    signed_headers = ";".join(sorted(canonical))
    canonical_headers = "".join(f"{k}:{canonical[k]}\n" for k in sorted(canonical))

    query = {
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": f"{access_key}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": signed_headers,
    }
    canonical_query = "&".join(
        f"{_uri_encode(k)}={_uri_encode(v)}" for k, v in sorted(query.items())
    )
    canonical_uri = _uri_encode(path, encode_slash=False)

    canonical_request = "\n".join(
        [method, canonical_uri, canonical_query, canonical_headers, signed_headers, UNSIGNED]
    )
    string_to_sign = "\n".join(
        [ALGORITHM, amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )

    key = _hmac(("AWS4" + secret_key).encode(), datestamp)
    key = _hmac(key, region)
    key = _hmac(key, "s3")
    key = _hmac(key, "aws4_request")
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()

    return f"{parts.scheme}://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"


def _store(store: ObjectStore | None) -> ObjectStore:
    store = store or from_settings()
    if store is None:
        raise RuntimeError("object store is not configured")
    return store


def presign_put(
    key: str,
    content_type: str,
    expires: int = 900,
    *,
    content_length: int | None = None,
    now: datetime | None = None,
    store: ObjectStore | None = None,
) -> str:
    """A presigned PUT for `key` in the configured bucket.

    Path-style addressing (`endpoint/bucket/key`): it is what R2 and MinIO accept without
    per-bucket DNS, and AWS accepts it too. Fifteen minutes by default — long enough for a
    photo over a bad connection, short enough that a leaked URL is not a standing grant.

    `content_length`, when given, is signed too, so the bucket refuses an upload of any
    other size: the size a project demo's presign declared is the size that lands, which is
    the only way a cap on bytes means anything when the bytes never pass through the API.
    """
    store = _store(store)
    headers = {"content-type": content_type}
    if content_length is not None:
        headers["content-length"] = str(int(content_length))
    return presign(
        "PUT",
        store.endpoint,
        f"/{store.bucket}/{key}",
        headers,
        region=store.region,
        access_key=store.access_key,
        secret_key=store.secret_key,
        expires=expires,
        now=now or datetime.now(UTC),
    )


def presign_get(
    key: str,
    expires: int = 900,
    *,
    method: str = "GET",
    now: datetime | None = None,
    store: ObjectStore | None = None,
) -> str:
    """A presigned GET (or HEAD, or DELETE) for `key`: short lived, and the only way a
    project demo is read in production. Never a public bucket URL, which would be a
    capability link that works for anyone holding it for as long as the object exists
    (docs/demos.md). Only `host` is signed, so a ranged GET may add its own Range header."""
    store = _store(store)
    return presign(
        method,
        store.endpoint,
        f"/{store.bucket}/{key}",
        {},
        region=store.region,
        access_key=store.access_key,
        secret_key=store.secret_key,
        expires=expires,
        now=now or datetime.now(UTC),
    )


# ------------------------------------------------------------------ the server's own calls


def _s3(method: str, key: str, headers: dict[str, str] | None = None, *, store=None):
    """One request from the server to the bucket, signed for 60 seconds. Returns (status,
    headers, body); a 404 is an answer, not an error. Transport failures raise OSError."""
    url = presign_get(key, 60, method=method, store=store)
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=S3_TIMEOUT_SECONDS) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


def s3_stat(key: str, *, store: ObjectStore | None = None) -> tuple[int, str | None] | None:
    """(bytes, content type) of an object in the bucket, or None when it is not there."""
    status, headers, _ = _s3("HEAD", key, store=store)
    if status == 404:
        return None
    if status != 200:
        raise OSError(f"object store answered {status} to HEAD {key}")
    lower = {k.lower(): v for k, v in headers.items()}
    return int(lower.get("content-length", "-1")), lower.get("content-type")


def s3_head_bytes(key: str, n: int, *, store: ObjectStore | None = None) -> bytes | None:
    """The first `n` bytes of an object, by a ranged GET; None when it is not there."""
    status, _, body = _s3("GET", key, {"Range": f"bytes=0-{n - 1}"}, store=store)
    if status == 404:
        return None
    if status not in (200, 206):
        raise OSError(f"object store answered {status} to GET {key}")
    return body[:n]


def s3_delete(key: str, *, store: ObjectStore | None = None) -> None:
    status, _, _ = _s3("DELETE", key, store=store)
    if status not in (200, 204, 404):
        raise OSError(f"object store answered {status} to DELETE {key}")


# ------------------------------------------------------------------------ the file backend


def file_root() -> pathlib.Path | None:
    """The directory a `file://` endpoint names, or None when the endpoint is not one.

    Raises `FileStoreRefused` in production (see the module docstring) and ValueError for a
    relative path or a host part: `file://media` would otherwise be read as a host named
    "media" and write to the root of the disk, which is not what anyone typed.
    """
    s = settings()
    if not is_file_endpoint(s.object_store_endpoint):
        return None
    if s.is_production:
        raise FileStoreRefused(
            "OBJECT_STORE_ENDPOINT is a file:// directory, which is for the local stack only; "
            "production stores demos in S3 (set an https endpoint, OBJECT_STORE_BUCKET, "
            "OBJECT_STORE_KEY and OBJECT_STORE_SECRET)"
        )
    parts = urlsplit(s.object_store_endpoint.strip())
    if parts.netloc not in ("", "localhost"):
        raise ValueError(
            f"file endpoint must be file:///absolute/dir, not {s.object_store_endpoint!r}"
        )
    path = pathlib.Path(unquote(parts.path))
    if not path.is_absolute():
        raise ValueError(f"file endpoint must name an absolute directory, not {path}")
    return path


def backend() -> str | None:
    """ "file", "s3", or None when neither is configured. The file backend's production
    refusal surfaces here as `FileStoreRefused`, before anything is written."""
    if file_root() is not None:
        return "file"
    return "s3" if from_settings() is not None else None


def file_path(key: str, *, root: pathlib.Path | None = None) -> pathlib.Path:
    """Where `key` lives under the file root. Refuses any key that is not a plain relative
    path of safe segments (`_SEGMENT`), so no key can reach outside the directory."""
    root = root or file_root()
    if root is None:
        raise RuntimeError("the file object store is not configured")
    segments = key.split("/")
    if not segments or not all(_SEGMENT.match(s) and s not in (".", "..") for s in segments):
        raise ValueError(f"not an object key the file store accepts: {key!r}")
    return root.joinpath(*segments)


def file_stat(key: str) -> int | None:
    try:
        return file_path(key).stat().st_size
    except FileNotFoundError:
        return None


def file_head_bytes(key: str, n: int) -> bytes | None:
    try:
        with file_path(key).open("rb") as f:
            return f.read(n)
    except FileNotFoundError:
        return None


def file_delete(key: str) -> None:
    file_path(key).unlink(missing_ok=True)


# ------------------------------------------------------------------------ either backend


def stat(key: str) -> int | None:
    """The stored object's size in bytes, or None when nothing is there."""
    kind = backend()
    if kind == "file":
        return file_stat(key)
    if kind == "s3":
        found = s3_stat(key)
        return None if found is None else found[0]
    raise RuntimeError("object store is not configured")


def head_bytes(key: str, n: int = 16) -> bytes | None:
    kind = backend()
    if kind == "file":
        return file_head_bytes(key, n)
    if kind == "s3":
        return s3_head_bytes(key, n)
    raise RuntimeError("object store is not configured")


def delete(key: str) -> None:
    kind = backend()
    if kind == "file":
        file_delete(key)
    elif kind == "s3":
        s3_delete(key)
    else:
        raise RuntimeError("object store is not configured")


def ensure_private_dir(path: pathlib.Path) -> None:
    """mkdir -p with every directory it makes at 0700: the root holds a person's images."""
    missing = []
    p = path
    while not p.exists():
        missing.append(p)
        p = p.parent
    for d in reversed(missing):
        d.mkdir(mode=0o700, exist_ok=True)
        os.chmod(d, 0o700)

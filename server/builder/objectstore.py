"""S3 SigV4 with the standard library only: presigned URLs for clients, signed requests for the
server's own calls, and a directory for the local stack.

Photos never pass through the API: the phone uploads straight to the bucket with a URL
this module signs (docs/social.md, "Storage"). boto is a large dependency for one HMAC
chain, and the chain is short enough to read in full below — which matters, because a
signing bug does not crash. It produces a URL that looks right and is rejected by the
bucket with a 403 the phone cannot explain.

Two forms of Signature Version 4, one key derivation. `presign` is the query-string form
(a URL a client holds: the PUT the Mac uploads with, the GET the phone reads a demo
through). `sign_headers` is the Authorization-header form, for the requests the SERVER
sends (HEAD, a ranged GET, DELETE, a bucket listing): R2 accepts presigned URLs for object
reads and writes only, not for DELETE or a listing, so a sweep built on presigned URLs
would fail at the bucket with a 403 on exactly the call that deletes. `test_objectstore.py`
reproduces the AWS documentation's worked examples for both forms byte for byte; that is
the only evidence either chain is right, so do not change the canonicalisation without
re-checking against them.

TWO STORES, NEVER ONE (FOUND IN THE SECURITY REVIEW, 2026-09-14). Post photos are served
publicly (`OBJECT_STORE_PUBLIC_BASE`, routes/social.py); project demos must never be. With
both in one bucket, a demo's presigned GET with its query cut off was a permanent public
link. So:

  OBJECT_STORE_*  the POSTS store: post photos and voice notes, public base allowed.
  MEDIA_STORE_*   the DEMOS store (docs/demos.md): a PRIVATE bucket of its own, no public
                  base, read only through presigned GETs. `store_config_problem` (run at
                  boot) refuses one bucket for both, a public base that reaches the demos
                  bucket, a MEDIA_STORE_PUBLIC_BASE at all, and half a demos configuration.

Each store's endpoint is `https://...` (S3: R2, MinIO, AWS) or, for the demos store on the
local stack only, `file:///abs/dir`: uploads PUT to the API itself and reads stream from disk
behind the bearer (routes/media.py), so a phone on the tunnel walks the flow production
runs. DEVELOPMENT ONLY: refused when ENVIRONMENT is production, here and at boot, because a
production API writing a person's images to its own container disk would lose them on the
next deploy and serve them from a box nobody backs up.
"""

import hashlib
import hmac
import os
import pathlib
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qsl, quote, unquote, urlsplit

from .settings import settings

ALGORITHM = "AWS4-HMAC-SHA256"
UNSIGNED = "UNSIGNED-PAYLOAD"
#: The payload hash of a request with no body, which every call the server makes is.
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()

FILE_SCHEME = "file://"

#: How long the server waits on the bucket for one call. A commit, a deletion and a sweep
#: wait on it, so a stuck bucket is a slow answer, not a hung request.
S3_TIMEOUT_SECONDS = 10

#: Keys per page of a bucket listing: S3's own ceiling. A sweep lists one person's prefix,
#: which holds at most a few sets of nine files a project.
LIST_PAGE = 1000

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


def _s3_store(endpoint: str, bucket: str, region: str, key: str, secret: str):
    """An S3 store from four settings, or None when any is missing or the endpoint is a
    directory. All or nothing: an endpoint with no secret would sign every URL with an empty
    key, and every upload would fail at the bucket rather than here."""
    if not (endpoint and bucket and key and secret) or is_file_endpoint(endpoint):
        return None
    return ObjectStore(
        endpoint=endpoint.rstrip("/"),
        bucket=bucket,
        region=region or "auto",
        access_key=key,
        secret_key=secret,
    )


def from_settings() -> ObjectStore | None:
    """The POSTS store (social): post photos and voice notes, publicly readable when
    `OBJECT_STORE_PUBLIC_BASE` is set. Never the demos' store (`media_store`)."""
    s = settings()
    return _s3_store(
        s.object_store_endpoint,
        s.object_store_bucket,
        s.object_store_region,
        s.object_store_key,
        s.object_store_secret,
    )


def configured() -> bool:
    return from_settings() is not None


def public_url(object_key: str) -> str | None:
    """Where a POST's object can be read from, when a public base is configured. Nothing
    of a project demo is ever passed here."""
    base = settings().object_store_public_base.rstrip("/")
    if not base:
        return None
    return f"{base}/{_uri_encode(object_key, encode_slash=False)}"


def media_store() -> ObjectStore | None:
    """The DEMOS store: its own private bucket (`MEDIA_STORE_*`), or None when unset or a
    directory. There is no fallback to the posts store, on purpose: a demo in the posts
    bucket is a demo behind that bucket's public base."""
    s = settings()
    return _s3_store(
        s.media_store_endpoint,
        s.media_store_bucket,
        s.media_store_region,
        s.media_store_key,
        s.media_store_secret,
    )


# ------------------------------------------------------------------------ the config gate


def _host(url: str) -> str:
    return (urlsplit(url.strip()).hostname or "").lower()


def store_config_problem() -> str | None:
    """Why this store configuration must not boot, or None. boot.py raises on it.

    The demos store is private or it is nothing: one bucket shared with the posts (whose
    public base would then serve demos to anyone who cut a presigned GET down to its path),
    a posts public base that reaches the demos bucket by host or by path, any
    MEDIA_STORE_PUBLIC_BASE, half an S3 configuration, or a file:// store in production."""
    s = settings()
    if s.is_production:
        for name, ep in (
            ("OBJECT_STORE_ENDPOINT", s.object_store_endpoint),
            ("MEDIA_STORE_ENDPOINT", s.media_store_endpoint),
        ):
            if is_file_endpoint(ep):
                return f"{name} is a file:// directory, the local stack's backend, in production."
    if s.media_store_public_base.strip():
        return (
            "MEDIA_STORE_PUBLIC_BASE is set, and a project demo has no public read path: "
            "unset it; demos are read only through presigned GETs."
        )
    ep = s.media_store_endpoint.strip()
    if not ep or is_file_endpoint(ep):
        return None
    missing = [
        name
        for name, value in (
            ("MEDIA_STORE_BUCKET", s.media_store_bucket),
            ("MEDIA_STORE_KEY", s.media_store_key),
            ("MEDIA_STORE_SECRET", s.media_store_secret),
        )
        if not value.strip()
    ]
    if missing:
        return f"MEDIA_STORE_ENDPOINT is set without {', '.join(missing)}: set all four or none."
    bucket = s.media_store_bucket.strip().lower()
    if s.object_store_bucket.strip().lower() == bucket:
        return (
            f"MEDIA_STORE_BUCKET is {s.media_store_bucket!r}, the posts bucket too; post photos "
            "are served publicly, so demos need a private bucket of their own."
        )
    base = s.object_store_public_base.strip()
    if base:
        parts = urlsplit(base)
        base_host = (parts.hostname or "").lower()
        first_label = base_host.split(".", 1)[0]
        first_segment = parts.path.strip("/").split("/", 1)[0].lower()
        if base_host == _host(ep) or bucket in (first_label, first_segment):
            return (
                f"OBJECT_STORE_PUBLIC_BASE ({base}) reaches the demos bucket {bucket!r}: "
                "a public base must never cover project demos."
            )
    return None


# ------------------------------------------------------------------------- signing


def _uri_encode(value: str, *, encode_slash: bool = True) -> str:
    # SigV4's URI encoding: unreserved characters pass, everything else is %XX, and
    # the path keeps its slashes while query values do not. `quote` gets this right
    # once told that `~` is safe (RFC 3986 unreserved; Python only added it by default
    # in 3.7, so it is spelled out).
    return quote(value, safe="-_.~/" if encode_slash is False else "-_.~")


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _signature(secret_key: str, datestamp: str, region: str, string_to_sign: str) -> str:
    key = _hmac(("AWS4" + secret_key).encode(), datestamp)
    key = _hmac(key, region)
    key = _hmac(key, "s3")
    key = _hmac(key, "aws4_request")
    return hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()


def _canonical_query(pairs) -> str:
    return "&".join(f"{_uri_encode(k)}={_uri_encode(v)}" for k, v in sorted(pairs))


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
    query_params: dict[str, str] | None = None,
) -> str:
    """A presigned URL for `method path` against `endpoint`, valid for `expires` seconds.

    `headers` are the request headers the client must send verbatim (host is added here).
    Signing `content-type` on a PUT is what stops a presigned image slot being filled with
    an HTML document that a browser would then render from the public base. `query_params`
    are signed with the X-Amz-* ones and travel in the URL.
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
        **(query_params or {}),
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": f"{access_key}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": signed_headers,
    }
    canonical_query = _canonical_query(query.items())
    canonical_uri = _uri_encode(path, encode_slash=False)

    canonical_request = "\n".join(
        [method, canonical_uri, canonical_query, canonical_headers, signed_headers, UNSIGNED]
    )
    string_to_sign = "\n".join(
        [ALGORITHM, amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    signature = _signature(secret_key, datestamp, region, string_to_sign)
    return f"{parts.scheme}://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"


def sign_headers(
    method: str,
    url: str,
    headers: dict[str, str],
    *,
    region: str,
    access_key: str,
    secret_key: str,
    now: datetime,
    payload_hash: str = EMPTY_SHA256,
) -> dict[str, str]:
    """The headers that authenticate `method url` with an Authorization header: `headers`
    plus `x-amz-date`, `x-amz-content-sha256` and `Authorization`. Every header given here is
    signed (a Range included), host is added, and the URL's query is canonicalised from the
    URL itself, so what is signed is what is sent."""
    parts = urlsplit(url)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    scope = f"{datestamp}/{region}/s3/aws4_request"

    canonical = {"host": parts.netloc, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    canonical.update({k.lower(): " ".join(v.split()) for k, v in headers.items()})
    signed_headers = ";".join(sorted(canonical))
    canonical_headers = "".join(f"{k}:{canonical[k]}\n" for k in sorted(canonical))
    canonical_query = _canonical_query(parse_qsl(parts.query, keep_blank_values=True))
    canonical_uri = _uri_encode(unquote(parts.path) or "/", encode_slash=False)

    canonical_request = "\n".join(
        [method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash]
    )
    string_to_sign = "\n".join(
        [ALGORITHM, amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    signature = _signature(secret_key, datestamp, region, string_to_sign)
    return {
        **headers,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": (
            f"{ALGORITHM} Credential={access_key}/{scope},"
            f"SignedHeaders={signed_headers},Signature={signature}"
        ),
    }


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
    """A presigned PUT for `key`: in the posts store unless `store` names another (project
    demos always pass `media_store()`).

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


def presign_get(key: str, expires: int, *, store: ObjectStore, now: datetime | None = None) -> str:
    """A presigned GET for `key` in `store`, which the caller must name: short lived, and the
    only way a project demo is read in production. Never a public bucket URL, which would be
    a capability link that works for anyone holding it for as long as the object exists
    (docs/demos.md). Only `host` is signed, so a player may add its own Range header."""
    return presign(
        "GET",
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


def _s3(
    method: str,
    store: ObjectStore,
    path: str,
    *,
    query: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
):
    """One request from the server to `store`, signed with an Authorization header. Returns
    (status, headers, body); a 404 is an answer, not an error. Transport failures raise
    OSError (urllib's URLError is one)."""
    url = f"{store.endpoint}{_uri_encode(path, encode_slash=False)}"
    if query:
        url += "?" + _canonical_query(query.items())
    signed = sign_headers(
        method,
        url,
        headers or {},
        region=store.region,
        access_key=store.access_key,
        secret_key=store.secret_key,
        now=datetime.now(UTC),
    )
    req = urllib.request.Request(url, method=method, headers=signed)
    try:
        with urllib.request.urlopen(req, timeout=S3_TIMEOUT_SECONDS) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


def s3_stat(key: str, *, store: ObjectStore) -> tuple[int, str | None] | None:
    """(bytes, content type) of an object in the bucket, or None when it is not there."""
    status, headers, _ = _s3("HEAD", store, f"/{store.bucket}/{key}")
    if status == 404:
        return None
    if status != 200:
        raise OSError(f"object store answered {status} to HEAD {key}")
    lower = {k.lower(): v for k, v in headers.items()}
    return int(lower.get("content-length", "-1")), lower.get("content-type")


def s3_head_bytes(key: str, n: int, *, store: ObjectStore) -> bytes | None:
    """The first `n` bytes of an object, by a ranged GET; None when it is not there."""
    status, _, body = _s3(
        "GET", store, f"/{store.bucket}/{key}", headers={"Range": f"bytes=0-{n - 1}"}
    )
    if status == 404:
        return None
    if status not in (200, 206):
        raise OSError(f"object store answered {status} to GET {key}")
    return body[:n]


def s3_delete(key: str, *, store: ObjectStore) -> None:
    status, _, _ = _s3("DELETE", store, f"/{store.bucket}/{key}")
    if status not in (200, 204, 404):
        raise OSError(f"object store answered {status} to DELETE {key}")


def _xml_items(body: bytes) -> tuple[list[str], str | None]:
    """(keys, next continuation token) from a ListObjectsV2 answer, namespaced or not."""
    root = ET.fromstring(body)

    def local(el) -> str:
        return el.tag.rsplit("}", 1)[-1]

    keys: list[str] = []
    token = None
    truncated = False
    for el in root:
        name = local(el)
        if name == "Contents":
            for child in el:
                if local(child) == "Key" and child.text:
                    keys.append(child.text)
        elif name == "IsTruncated":
            truncated = (el.text or "").strip().lower() == "true"
        elif name == "NextContinuationToken":
            token = el.text
    return keys, (token if truncated else None)


def s3_list(prefix: str, *, store: ObjectStore) -> list[str]:
    """Every key under `prefix` (ListObjectsV2, every page)."""
    keys: list[str] = []
    token = None
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": str(LIST_PAGE)}
        if token:
            query["continuation-token"] = token
        status, _, body = _s3("GET", store, f"/{store.bucket}", query=query)
        if status != 200:
            raise OSError(f"object store answered {status} to a listing of {prefix}")
        page, token = _xml_items(body)
        keys += page
        if not token:
            return keys


# ------------------------------------------------------------------------ the file backend


def media_file_root() -> pathlib.Path | None:
    """The directory a `file://` MEDIA_STORE_ENDPOINT names, or None when it is not one.

    Raises `FileStoreRefused` in production (see the module docstring) and ValueError for a
    relative path or a host part: `file://media` would otherwise be read as a host named
    "media" and write to the root of the disk, which is not what anyone typed.
    """
    s = settings()
    if not is_file_endpoint(s.media_store_endpoint):
        return None
    if s.is_production:
        raise FileStoreRefused(
            "MEDIA_STORE_ENDPOINT is a file:// directory, which is for the local stack only; "
            "production stores demos in a private S3 bucket (MEDIA_STORE_ENDPOINT, "
            "MEDIA_STORE_BUCKET, MEDIA_STORE_KEY and MEDIA_STORE_SECRET)"
        )
    parts = urlsplit(s.media_store_endpoint.strip())
    if parts.netloc not in ("", "localhost"):
        raise ValueError(
            f"file endpoint must be file:///absolute/dir, not {s.media_store_endpoint!r}"
        )
    path = pathlib.Path(unquote(parts.path))
    if not path.is_absolute():
        raise ValueError(f"file endpoint must name an absolute directory, not {path}")
    return path


def media_backend() -> str | None:
    """ "file", "s3", or None when the demos store is not configured. The file backend's
    production refusal surfaces here as `FileStoreRefused`, before anything is written."""
    if media_file_root() is not None:
        return "file"
    return "s3" if media_store() is not None else None


def file_path(key: str, *, root: pathlib.Path | None = None) -> pathlib.Path:
    """Where `key` lives under the demos directory. Refuses any key that is not a plain
    relative path of safe segments (`_SEGMENT`), so no key can reach outside it."""
    root = root or media_file_root()
    if root is None:
        raise RuntimeError("the file object store is not configured")
    segments = key.split("/")
    if not segments or not all(_SEGMENT.match(s) and s not in (".", "..") for s in segments):
        raise ValueError(f"not an object key the file store accepts: {key!r}")
    return root.joinpath(*segments)


def file_list(prefix: str) -> list[str]:
    """Every key under `prefix` in the demos directory. An upload's `.part` file (a name
    starting with a dot, which no key can) is the upload route's to remove, not a key."""
    root = media_file_root()
    if root is None:
        raise RuntimeError("the file object store is not configured")
    top = prefix.rstrip("/")
    base = file_path(top, root=root) if top else root
    if not base.is_dir():
        return []
    return sorted(
        p.relative_to(root).as_posix()
        for p in base.rglob("*")
        if p.is_file() and not p.name.startswith(".")
    )


# ------------------------------------------------------------- the demos store, either way


def media_stat(key: str) -> int | None:
    """The stored object's size in bytes, or None when nothing is there."""
    kind = media_backend()
    if kind == "file":
        try:
            return file_path(key).stat().st_size
        except FileNotFoundError:
            return None
    if kind == "s3":
        found = s3_stat(key, store=media_store())
        return None if found is None else found[0]
    raise RuntimeError("the demos store is not configured")


def media_head_bytes(key: str, n: int = 16) -> bytes | None:
    kind = media_backend()
    if kind == "file":
        try:
            with file_path(key).open("rb") as f:
                return f.read(n)
        except FileNotFoundError:
            return None
    if kind == "s3":
        return s3_head_bytes(key, n, store=media_store())
    raise RuntimeError("the demos store is not configured")


def media_delete(key: str) -> None:
    kind = media_backend()
    if kind == "file":
        file_path(key).unlink(missing_ok=True)
    elif kind == "s3":
        s3_delete(key, store=media_store())
    else:
        raise RuntimeError("the demos store is not configured")


def media_list(prefix: str) -> list[str]:
    """Every object key under `prefix` in the demos store."""
    kind = media_backend()
    if kind == "file":
        return file_list(prefix)
    if kind == "s3":
        return s3_list(prefix, store=media_store())
    raise RuntimeError("the demos store is not configured")


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

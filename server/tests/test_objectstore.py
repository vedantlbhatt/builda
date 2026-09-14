"""SigV4 presigning, checked against the one vector that is not this code's own opinion.

A signing bug does not crash: it produces a URL that looks right and is refused by the
bucket with a 403 the phone cannot explain. The first test therefore reproduces the worked
presigned-URL example from the AWS Signature Version 4 documentation ("Authenticating
Requests: Using Query Parameters", the `examplebucket/test.txt` GET) byte for byte. The
credentials in it are Amazon's published example pair, not real ones.
"""

from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import pytest

from builder import objectstore
from builder.objectstore import ObjectStore, presign, presign_put

AWS_EXAMPLE_ACCESS = "AKIAIOSFODNN7EXAMPLE"
AWS_EXAMPLE_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
AWS_EXAMPLE_SIGNATURE = "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"

STORE = ObjectStore(
    endpoint="https://account.r2.cloudflarestorage.com",
    bucket="builder-media",
    region="auto",
    access_key=AWS_EXAMPLE_ACCESS,
    secret_key=AWS_EXAMPLE_SECRET,
)
NOW = datetime(2026, 8, 15, 10, 0, tzinfo=UTC)


def test_reproduces_the_aws_documented_presigned_get():
    url = presign(
        "GET",
        "https://examplebucket.s3.amazonaws.com",
        "/test.txt",
        {},
        region="us-east-1",
        access_key=AWS_EXAMPLE_ACCESS,
        secret_key=AWS_EXAMPLE_SECRET,
        expires=86400,
        now=datetime(2013, 5, 24, 0, 0, tzinfo=UTC),
    )
    assert url == (
        "https://examplebucket.s3.amazonaws.com/test.txt"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"
        "&X-Amz-Date=20130524T000000Z"
        "&X-Amz-Expires=86400"
        "&X-Amz-SignedHeaders=host"
        f"&X-Amz-Signature={AWS_EXAMPLE_SIGNATURE}"
    )


def test_presigned_put_has_the_sigv4_shape_and_binds_key_and_type():
    url = presign_put("posts/abc/photo one.jpg", "image/jpeg", 900, now=NOW, store=STORE)
    parts = urlsplit(url)
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}

    assert parts.scheme == "https" and parts.netloc == "account.r2.cloudflarestorage.com"
    # Path-style, with the key URI-encoded once and its slashes kept.
    assert parts.path == "/builder-media/posts/abc/photo%20one.jpg"
    assert q["X-Amz-Algorithm"] == "AWS4-HMAC-SHA256"
    assert q["X-Amz-Credential"] == f"{AWS_EXAMPLE_ACCESS}/20260815/auto/s3/aws4_request"
    assert q["X-Amz-Date"] == "20260815T100000Z"
    assert q["X-Amz-Expires"] == "900"
    # content-type is signed, so the slot cannot be filled with a different kind of file.
    assert q["X-Amz-SignedHeaders"] == "content-type;host"
    sig = q["X-Amz-Signature"]
    assert len(sig) == 64 and int(sig, 16) >= 0

    # Deterministic for the same inputs; different for a different key, type or secret.
    assert presign_put("posts/abc/photo one.jpg", "image/jpeg", 900, now=NOW, store=STORE) == url
    other_key = presign_put("posts/abc/photo two.jpg", "image/jpeg", 900, now=NOW, store=STORE)
    other_type = presign_put("posts/abc/photo one.jpg", "image/png", 900, now=NOW, store=STORE)
    assert parse_qs(urlsplit(other_key).query)["X-Amz-Signature"][0] != sig
    assert parse_qs(urlsplit(other_type).query)["X-Amz-Signature"][0] != sig


def test_unconfigured_store_is_none_not_a_bad_signature(monkeypatch):
    from builder.settings import settings

    for var in (
        "OBJECT_STORE_ENDPOINT",
        "OBJECT_STORE_BUCKET",
        "OBJECT_STORE_KEY",
        "OBJECT_STORE_SECRET",
        "OBJECT_STORE_PUBLIC_BASE",
    ):
        monkeypatch.delenv(var, raising=False)
    settings.cache_clear()
    try:
        assert objectstore.from_settings() is None
        assert objectstore.configured() is False
        assert objectstore.public_url("posts/x/y.jpg") is None
        with pytest.raises(RuntimeError):
            presign_put("posts/x/y.jpg", "image/jpeg")

        # Half a configuration is no configuration: an endpoint with no secret would
        # sign every URL with an empty key.
        monkeypatch.setenv("OBJECT_STORE_ENDPOINT", "https://example.invalid")
        monkeypatch.setenv("OBJECT_STORE_BUCKET", "b")
        settings.cache_clear()
        assert objectstore.configured() is False

        monkeypatch.setenv("OBJECT_STORE_KEY", "k")
        monkeypatch.setenv("OBJECT_STORE_SECRET", "s")
        monkeypatch.setenv("OBJECT_STORE_PUBLIC_BASE", "https://media.example/")
        settings.cache_clear()
        assert objectstore.configured() is True
        assert (
            objectstore.public_url("posts/x/y z.jpg") == "https://media.example/posts/x/y%20z.jpg"
        )
    finally:
        settings.cache_clear()


# ------------------------------------------------------------------ project demos (0026)


def test_a_presigned_put_can_bind_the_size_too():
    """A project demo's upload signs `content-length` beside the type, so the bucket refuses
    any other size (routes/media.py); the post photos' form is unchanged above."""
    url = presign_put(
        "project-media/u/k/m.png", "image/png", 900, content_length=1234, now=NOW, store=STORE
    )
    q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    assert q["X-Amz-SignedHeaders"] == "content-length;content-type;host"
    other = presign_put(
        "project-media/u/k/m.png", "image/png", 900, content_length=1235, now=NOW, store=STORE
    )
    assert parse_qs(urlsplit(other).query)["X-Amz-Signature"][0] != q["X-Amz-Signature"]


def test_a_presigned_get_is_short_lived_signs_only_the_host_and_names_its_store():
    import inspect

    from builder.objectstore import presign_get

    url = presign_get("project-media/u/k/m.mp4", 900, now=NOW, store=STORE)
    parts = urlsplit(url)
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert parts.path == "/builder-media/project-media/u/k/m.mp4"
    assert (q["X-Amz-Expires"], q["X-Amz-SignedHeaders"]) == ("900", "host")
    # No default store: a demo's read is never signed against the posts bucket by omission.
    assert inspect.signature(presign_get).parameters["store"].default is inspect.Parameter.empty


# The Authorization header form, for the server's own calls (HEAD, ranged GET, DELETE, a
# listing), which R2 does not accept as presigned URLs. Both vectors are the AWS SigV4
# documentation's ("Signature Calculations for the Authorization Header: Transferring
# Payload in a Single Chunk", the examplebucket GET Object and ListObjects examples).
AWS_HEADER_GET_OBJECT = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
AWS_HEADER_LIST_OBJECTS = "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"


def _aws(url: str, headers: dict) -> dict:
    return objectstore.sign_headers(
        "GET",
        url,
        headers,
        region="us-east-1",
        access_key=AWS_EXAMPLE_ACCESS,
        secret_key=AWS_EXAMPLE_SECRET,
        now=datetime(2013, 5, 24, 0, 0, tzinfo=UTC),
    )


def test_reproduces_the_aws_documented_header_signed_get_object():
    h = _aws("https://examplebucket.s3.amazonaws.com/test.txt", {"Range": "bytes=0-9"})
    assert h["Authorization"] == (
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,"
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,"
        f"Signature={AWS_HEADER_GET_OBJECT}"
    )
    assert h["x-amz-date"] == "20130524T000000Z"
    assert (
        h["x-amz-content-sha256"]
        == objectstore.EMPTY_SHA256
        == ("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    )


def test_reproduces_the_aws_documented_header_signed_list_objects():
    h = _aws("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", {})
    assert h["Authorization"].endswith(f"Signature={AWS_HEADER_LIST_OBJECTS}")
    # The query is canonicalised from the URL in any order it was written.
    again = _aws("https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2", {})
    assert again["Authorization"] == h["Authorization"]


def test_a_listing_answer_is_read_across_pages_namespaced_or_not():
    ns = "http://s3.amazonaws.com/doc/2006-03-01/"
    body = (
        f'<ListBucketResult xmlns="{ns}"><Contents><Key>project-media/a/1.png</Key></Contents>'
        "<Contents><Key>project-media/a/2.png</Key></Contents>"
        "<IsTruncated>true</IsTruncated><NextContinuationToken>t2</NextContinuationToken>"
        "</ListBucketResult>"
    ).encode()
    assert objectstore._xml_items(body) == (
        ["project-media/a/1.png", "project-media/a/2.png"],
        "t2",
    )
    last = b"<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"
    assert objectstore._xml_items(last) == ([], None)


# ------------------------------------------------------------------------ the config gate


@pytest.fixture
def stores(monkeypatch, tmp_path):
    """Set the posts and the demos stores from keyword arguments, every other one unset."""
    from builder.settings import settings

    names = [
        f"{side}_STORE_{part}"
        for side in ("OBJECT", "MEDIA")
        for part in ("ENDPOINT", "BUCKET", "KEY", "SECRET", "PUBLIC_BASE")
    ]

    def use(environment: str = "development", **values):
        for name in names:
            monkeypatch.delenv(name, raising=False)
        for name, value in values.items():
            monkeypatch.setenv(name.upper(), value)
        monkeypatch.setenv("ENVIRONMENT", environment)
        settings.cache_clear()

    yield use, tmp_path
    settings.cache_clear()


POSTS = {
    "object_store_endpoint": "https://acct.r2.cloudflarestorage.com",
    "object_store_bucket": "builder-posts",
    "object_store_key": "k1",
    "object_store_secret": "s1",
    "object_store_public_base": "https://media.builda.app",
}
DEMOS = {
    "media_store_endpoint": "https://acct.r2.cloudflarestorage.com",
    "media_store_bucket": "builder-demos",
    "media_store_key": "k2",
    "media_store_secret": "s2",
}


def test_the_demos_store_is_its_own_private_bucket_or_boot_refuses(stores):
    """FOUND IN THE SECURITY REVIEW (2026-09-14): demos in the posts bucket were a presigned
    GET's query away from a permanent public link through the posts' public base."""
    from builder import boot

    use, _ = stores
    use("production", **POSTS, **DEMOS)
    assert objectstore.store_config_problem() is None
    boot.assert_object_store_safe()
    assert objectstore.media_store().bucket == "builder-demos"
    assert objectstore.from_settings().bucket == "builder-posts"

    refused = {
        "one bucket for both": {**DEMOS, "media_store_bucket": "Builder-Posts"},
        "a public base on the demos endpoint's host": {
            **POSTS,
            "object_store_public_base": "https://acct.r2.cloudflarestorage.com/builder-posts",
        },
        "a public base named for the demos bucket": {
            **POSTS,
            "object_store_public_base": "https://builder-demos.example.com",
        },
        "a public base whose path is the demos bucket": {
            **POSTS,
            "object_store_public_base": "https://cdn.example.com/builder-demos/",
        },
        "a public base of the demos' own": {"media_store_public_base": "https://x.example"},
        "half a demos configuration": {"media_store_secret": ""},
    }
    for why, change in refused.items():
        use("production", **{**POSTS, **DEMOS, **change})
        problem = objectstore.store_config_problem()
        assert problem, why
        with pytest.raises(SystemExit) as exc:
            boot.assert_object_store_safe()
        assert "Refusing to start" in str(exc.value), why


def test_no_demos_store_is_no_demos_never_the_posts_bucket(stores):
    use, _ = stores
    use(**POSTS)
    assert objectstore.from_settings() is not None
    assert objectstore.media_store() is None and objectstore.media_backend() is None


def test_the_file_backend_maps_keys_inside_its_root_and_nowhere_else(stores):
    use, tmp = stores
    use(media_store_endpoint=f"file://{tmp}/media")
    assert objectstore.media_backend() == "file" and objectstore.media_store() is None
    root = objectstore.media_file_root()
    assert root == tmp / "media"
    assert objectstore.file_path("project-media/u-1/k/m.png") == root / "project-media/u-1/k/m.png"
    for bad in ("../etc/passwd", "/etc/passwd", "a/../../b", "a//b", "a/./b", "", "a/b c", ".x"):
        with pytest.raises(ValueError):
            objectstore.file_path(bad)
    for bad in ("file://media", "file://host/abs/dir"):
        use(media_store_endpoint=bad)
        with pytest.raises(ValueError):
            objectstore.media_file_root()


def test_the_file_backend_is_refused_in_production_here_and_at_boot(stores):
    from builder import boot

    use, tmp = stores
    for name in ("media_store_endpoint", "object_store_endpoint"):
        use("production", **{name: f"file://{tmp}/media"})
        with pytest.raises(SystemExit) as exc:
            boot.assert_object_store_safe()
        assert "file://" in str(exc.value)
    use("production", media_store_endpoint=f"file://{tmp}/media")
    with pytest.raises(objectstore.FileStoreRefused):
        objectstore.media_backend()
    use(media_store_endpoint=f"file://{tmp}/media")
    boot.assert_object_store_safe()


def test_the_file_backend_stats_reads_lists_and_deletes(stores):
    use, tmp = stores
    use(media_store_endpoint=f"file://{tmp}/media")
    key = "project-media/u/k/m.png"
    assert objectstore.media_stat(key) is None and objectstore.media_head_bytes(key) is None
    assert objectstore.media_list("project-media/u/") == []
    path = objectstore.file_path(key)
    objectstore.ensure_private_dir(path.parent)
    assert all((p.stat().st_mode & 0o777) == 0o700 for p in (tmp / "media", path.parent))
    path.write_bytes(b"\x89PNG\r\n\x1a\nrest")
    (path.parent / ".m.png.abc.part").write_bytes(b"in flight")  # an upload's, never a key
    assert objectstore.media_stat(key) == 12
    assert objectstore.media_head_bytes(key, 8) == b"\x89PNG\r\n\x1a\n"
    assert objectstore.media_list("project-media/u/") == [key]
    assert objectstore.media_list("project-media/other/") == []
    objectstore.media_delete(key)
    objectstore.media_delete(key)  # gone twice is still gone
    assert objectstore.media_stat(key) is None

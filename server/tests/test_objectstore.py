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


def test_a_presigned_get_is_short_lived_and_signs_only_the_host():
    from builder.objectstore import presign_get

    url = presign_get("project-media/u/k/m.mp4", 900, now=NOW, store=STORE)
    parts = urlsplit(url)
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert parts.path == "/builder-media/project-media/u/k/m.mp4"
    assert (q["X-Amz-Expires"], q["X-Amz-SignedHeaders"]) == ("900", "host")
    # The same chain as the documented GET: a HEAD or a DELETE differs only in the method.
    head = presign_get("project-media/u/k/m.mp4", 900, method="HEAD", now=NOW, store=STORE)
    assert parse_qs(urlsplit(head).query)["X-Amz-Signature"][0] != q["X-Amz-Signature"]


@pytest.fixture
def file_env(monkeypatch, tmp_path):
    from builder.settings import settings

    def use(endpoint: str, environment: str = "development"):
        monkeypatch.setenv("OBJECT_STORE_ENDPOINT", endpoint)
        monkeypatch.setenv("ENVIRONMENT", environment)
        for var in ("OBJECT_STORE_BUCKET", "OBJECT_STORE_KEY", "OBJECT_STORE_SECRET"):
            monkeypatch.delenv(var, raising=False)
        settings.cache_clear()

    yield use, tmp_path
    settings.cache_clear()


def test_the_file_backend_maps_keys_inside_its_root_and_nowhere_else(file_env):
    use, tmp = file_env
    use(f"file://{tmp}/media")
    assert objectstore.backend() == "file" and objectstore.from_settings() is None
    root = objectstore.file_root()
    assert root == tmp / "media"
    assert objectstore.file_path("project-media/u-1/k/m.png") == root / "project-media/u-1/k/m.png"
    for bad in (
        "../etc/passwd",
        "/etc/passwd",
        "a/../../b",
        "a//b",
        "a/./b",
        "",
        "a/b c",
        ".hidden",
    ):
        with pytest.raises(ValueError):
            objectstore.file_path(bad)
    for bad in ("file://media", "file://host/abs/dir"):
        use(bad)
        with pytest.raises(ValueError):
            objectstore.file_root()


def test_the_file_backend_is_refused_in_production_here_and_at_boot(file_env):
    from builder import boot

    use, tmp = file_env
    use(f"file://{tmp}/media", "production")
    with pytest.raises(objectstore.FileStoreRefused):
        objectstore.backend()
    with pytest.raises(SystemExit) as exc:
        boot.assert_object_store_safe()
    assert "file://" in str(exc.value)
    use(f"file://{tmp}/media", "development")
    boot.assert_object_store_safe()
    use("https://acct.r2.cloudflarestorage.com", "production")
    boot.assert_object_store_safe()


def test_the_file_backend_stats_reads_and_deletes(file_env):
    use, tmp = file_env
    use(f"file://{tmp}/media")
    key = "project-media/u/k/m.png"
    assert objectstore.stat(key) is None and objectstore.head_bytes(key) is None
    path = objectstore.file_path(key)
    objectstore.ensure_private_dir(path.parent)
    assert all((p.stat().st_mode & 0o777) == 0o700 for p in (tmp / "media", path.parent))
    path.write_bytes(b"\x89PNG\r\n\x1a\nrest")
    assert objectstore.stat(key) == 12 and objectstore.head_bytes(key, 8) == b"\x89PNG\r\n\x1a\n"
    objectstore.delete(key)
    objectstore.delete(key)  # gone twice is still gone
    assert objectstore.stat(key) is None

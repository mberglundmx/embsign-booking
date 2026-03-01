import app.github_content as github_content
from app.github_content import fetch_text, github_url_to_api


def test_github_url_to_api_converts_supported_formats():
    assert (
        github_url_to_api("https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main")
        == "https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main"
    )
    assert (
        github_url_to_api("https://raw.githubusercontent.com/acme/repo/main/path/file.txt")
        == "https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main"
    )
    assert (
        github_url_to_api("https://github.com/acme/repo/raw/main/path/file.txt")
        == "https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main"
    )
    assert (
        github_url_to_api("https://github.com/acme/repo/raw/refs/heads/main/path/file.txt")
        == "https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main"
    )
    assert (
        github_url_to_api("https://github.com/acme/repo/blob/main/path/file.txt")
        == "https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main"
    )


def test_github_url_to_api_returns_input_for_unsupported_urls():
    raw_without_filepath = "https://raw.githubusercontent.com/acme/repo/main"
    assert github_url_to_api(raw_without_filepath) == raw_without_filepath
    assert (
        github_url_to_api("https://example.com/something.txt")
        == "https://example.com/something.txt"
    )


def test_fetch_text_uses_token_header_and_utf8_decode(monkeypatch):
    captured = {}

    class _FakeResponse:
        def __init__(self, payload: bytes):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self.payload

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["headers"] = {k.lower(): v for k, v in dict(request.header_items()).items()}
        captured["timeout"] = timeout
        return _FakeResponse("hej".encode("utf-8"))

    monkeypatch.setattr(github_content, "urlopen", fake_urlopen)
    text = fetch_text(
        "https://github.com/acme/repo/blob/main/path/file.txt",
        github_token="token-123",
        timeout_seconds=7,
    )

    assert text == "hej"
    assert (
        captured["url"] == "https://api.github.com/repos/acme/repo/contents/path/file.txt?ref=main"
    )
    assert captured["headers"]["authorization"] == "token token-123"
    assert captured["timeout"] == 7


def test_fetch_text_falls_back_to_latin1(monkeypatch):
    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b"\xff"

    monkeypatch.setattr(github_content, "urlopen", lambda request, timeout: _FakeResponse())
    text = fetch_text("https://example.com/file.txt", github_token=None)
    assert text == "ÿ"

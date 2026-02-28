from urllib.parse import urlparse
from urllib.request import Request, urlopen


def github_url_to_api(url: str) -> str:
    """Convert a GitHub web/raw URL to API raw-content URL."""
    parsed = urlparse(url)
    if parsed.hostname == "api.github.com":
        return url
    if parsed.hostname == "raw.githubusercontent.com":
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 3:
            owner, repo = parts[0], parts[1]
            branch_and_path = "/".join(parts[2:])
            if "/" in branch_and_path:
                branch, _, filepath = branch_and_path.partition("/")
            else:
                return url
            return (
                f"https://api.github.com/repos/{owner}/{repo}/contents/{filepath}"
                f"?ref={branch}"
            )
        return url
    if parsed.hostname == "github.com":
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 5 and parts[2] == "raw":
            owner, repo = parts[0], parts[1]
            ref_parts = parts[3:]
            if ref_parts[0] == "refs" and len(ref_parts) >= 3 and ref_parts[1] == "heads":
                branch = ref_parts[2]
                filepath = "/".join(ref_parts[3:])
            else:
                branch = ref_parts[0]
                filepath = "/".join(ref_parts[1:])
            return (
                f"https://api.github.com/repos/{owner}/{repo}/contents/{filepath}"
                f"?ref={branch}"
            )
        if len(parts) >= 5 and parts[2] == "blob":
            owner, repo = parts[0], parts[1]
            branch = parts[3]
            filepath = "/".join(parts[4:])
            return (
                f"https://api.github.com/repos/{owner}/{repo}/contents/{filepath}"
                f"?ref={branch}"
            )
    return url


def fetch_text(url: str, github_token: str | None, timeout_seconds: int = 15) -> str:
    api_url = github_url_to_api(url)
    headers = {"Accept": "application/vnd.github.v3.raw"}
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    request = Request(api_url, headers=headers)
    with urlopen(request, timeout=timeout_seconds) as response:
        raw_bytes = response.read()

    try:
        return raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return raw_bytes.decode("latin-1")

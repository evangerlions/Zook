#!/usr/bin/env python3
"""Anonymous, read-only checks. Never follow custom-scheme or external redirects."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def origin(value):
    parsed = urlsplit(value)
    allowed = {"https://app-dev.youwoai.net", "https://app.youwoai.net"}
    loopback = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if (parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/") or parsed.scheme not in ("http", "https")
            or (not loopback and value.rstrip("/") not in allowed)):
        raise ValueError("Use a known Zook HTTPS origin or loopback, without credentials or a path.")
    return value.rstrip("/")


def run(base_url, expected_version=None):
    base_url = origin(base_url)
    opener = build_opener(NoRedirect())
    checks = []

    def fetch(path):
        try:
            request = Request(base_url + path, headers={"User-Agent": "Zook-domain-acceptance/1"})
            try:
                response = opener.open(request, timeout=15)
            except HTTPError as error:
                response = error
            with response:
                return response.status, response.headers, response.read(65536).decode("utf-8", "replace")
        except (URLError, OSError):
            return 0, {}, ""

    status, headers, text = fetch("/api/health")
    try:
        health = json.loads(text).get("data", {})
    except (ValueError, AttributeError):
        health = {}
    if not isinstance(health, dict):
        health = {}
    checks.append({"path": "/api/health", "status": status,
                   "passed": status == 200 and health.get("status") == "ok"
                   and (not expected_version or health.get("version") == expected_version)})
    for host in ("buddy-invitation", "sleep-buddy-invite", "focus-invite"):
        path = "/frogsleep/" + host
        status, headers, text = fetch(path)
        location = urlsplit(headers.get("Location", ""))
        is_redirect = (status in (301, 302, 303, 307, 308) and location.scheme == "frogsleep"
                       and location.netloc == host and "mode=preview" in location.query.split("&"))
        is_page = (host == "buddy-invitation" and status == 200
                   and headers.get("Content-Type", "").lower().startswith("text/html")
                   and 'href="frogsleep://buddy-invitation?mode=preview&token=' in text)
        checks.append({"path": path, "status": status, "admin_spa": "__ADMIN_RUNTIME_CONFIG__" in text,
                       "passed": (is_redirect or is_page) and "__ADMIN_RUNTIME_CONFIG__" not in text
                       and headers.get("Cache-Control", "").lower() == "no-store"
                       and headers.get("Referrer-Policy", "").lower() == "no-referrer"})
    return {"base_url": base_url, "version": health.get("version"),
            "passed": all(check["passed"] for check in checks), "checks": checks,
            "scope": "anonymous health and custom-scheme handoff; no account, device receipt or universal-link claim"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://app-dev.youwoai.net")
    parser.add_argument("--expected-version")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = run(args.base_url, args.expected_version)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
        args.output.chmod(0o600)
    print(text, end="")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

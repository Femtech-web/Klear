"""HTTPS JSON with a verified CA bundle (certifi when available; this Python may ship without one)."""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request

try:
    import certifi

    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    _CTX = ssl.create_default_context()


def post_json(url: str, body: dict, timeout: float = 30, attempts: int = 5):
    """Retries rate limits (429) and server errors with backoff; anything else is raised at once."""
    # Some public RPCs (Base) refuse urllib's default User-Agent.
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json", "user-agent": "keel/0.1"})
    for i in range(attempts):
        try:
            return json.load(urllib.request.urlopen(req, timeout=timeout, context=_CTX))
        except urllib.error.HTTPError as e:
            if (e.code != 429 and e.code < 500) or i == attempts - 1:
                raise
        except urllib.error.URLError:
            if i == attempts - 1:
                raise
        time.sleep(2 * (i + 1))

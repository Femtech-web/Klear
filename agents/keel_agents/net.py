"""HTTPS JSON with a verified CA bundle (certifi when available; this Python may ship without one)."""
from __future__ import annotations

import json
import ssl
import urllib.request

try:
    import certifi

    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    _CTX = ssl.create_default_context()


def post_json(url: str, body: dict, timeout: float = 30):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout, context=_CTX))

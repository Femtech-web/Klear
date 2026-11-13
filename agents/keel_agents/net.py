"""HTTPS JSON with a verified CA bundle (certifi when available; this Python may ship without one)."""
from __future__ import annotations

import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.request

try:
    import certifi

    _CTX = ssl.create_default_context(cafile=certifi.where())
    # Libraries that build their own default context (aiohttp, in NEAR AI's SDK) read the same bundle.
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:  # pragma: no cover
    _CTX = ssl.create_default_context()

_system_getaddrinfo = socket.getaddrinfo


def _getaddrinfo(host, *args, **kwargs):
    """The system resolver, then DNS over HTTPS at 1.1.1.1 when it fails (a flaky local resolver drops some names).
    Only the address changes; TLS still checks the certificate against the original host name."""
    try:
        return _system_getaddrinfo(host, *args, **kwargs)
    except socket.gaierror:
        if isinstance(host, bytes):  # httpx passes the name as bytes
            host = host.decode("ascii", "ignore")
        if not isinstance(host, str) or not host or host[0].isdigit():
            raise
        req = urllib.request.Request(f"https://1.1.1.1/dns-query?name={host}&type=A", headers={"accept": "application/dns-json"})
        try:
            answers = json.load(urllib.request.urlopen(req, timeout=10, context=_CTX)).get("Answer", [])
        except (OSError, ValueError):
            raise socket.gaierror(socket.EAI_NONAME, f"{host}: no address from the system resolver or 1.1.1.1") from None
        ips = [a["data"] for a in answers if a.get("type") == 1]
        if not ips:
            raise
        return _system_getaddrinfo(ips[0], *args, **kwargs)


socket.getaddrinfo = _getaddrinfo


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

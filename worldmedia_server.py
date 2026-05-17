#!/usr/bin/env python3
"""World Media Windows local HTTP server.

The Windows-native build keeps the browser UI and the CORS-bypass proxy from
the Linux version, but drops the bundled WSL distro, setup scripts, bridge, and
rootfs. This server is imported by worldmedia_native.py for the desktop build
and can also run directly for development.
"""
from __future__ import annotations

import http.server
import ipaddress
import json
import os
import socket
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from http import HTTPStatus
from pathlib import Path


APP_NAME = "World Media"
BASE_DIR = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("WORLDMEDIA_FRONTEND", BASE_DIR / "frontend")).resolve()
PORT = int(os.environ.get("WORLDMEDIA_PORT") or os.environ.get("WORLDMEDIA_WINDOWS_PORT") or "9124")
USER_AGENT = "WorldMediaWindows/0.1.0 (https://github.com/aivrar/worldmediawindows)"
MAX_SIZE = 50 * 1024 * 1024
TIMEOUT_SEC = 20

ALLOWED_HOSTS = frozenset(
    {
        "all.api.radio-browser.info",
        "iptv-org.github.io",
        "archive.org",
        "www.archive.org",
        "images-api.nasa.gov",
        "images-assets.nasa.gov",
        "commons.wikimedia.org",
        "upload.wikimedia.org",
        "librivox.org",
        "www.librivox.org",
    }
)

ALLOWED_SUFFIXES: tuple[str, ...] = (
    ".api.radio-browser.info",
    ".archive.org",
)

_rate_lock = threading.Lock()
_rate_log: dict[str, deque[float]] = {}
RATE_WINDOW_SEC = 1.0
RATE_MAX_PER_WINDOW = 60


def is_allowed_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    if host in ALLOWED_HOSTS:
        return True
    return any(host.endswith(suffix) for suffix in ALLOWED_SUFFIXES)


def resolves_to_private_ip(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return True
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            return True
    return False


def rate_limit(client_ip: str) -> bool:
    now = time.monotonic()
    with _rate_lock:
        q = _rate_log.setdefault(client_ip, deque())
        while q and q[0] < now - RATE_WINDOW_SEC:
            q.popleft()
        if len(q) >= RATE_MAX_PER_WINDOW:
            return False
        q.append(now)
    return True


def schedule_process_exit(delay: float = 0.25) -> None:
    def exit_later() -> None:
        time.sleep(delay)
        os._exit(0)

    threading.Thread(target=exit_later, daemon=True).start()


class WorldMediaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.client_address[0]} {fmt % args}\n")

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            return self._dispatch_api("GET")
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path.startswith("/api/"):
            return self._dispatch_api("POST")
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def send_response(self, code, message=None):
        super().send_response(code, message)
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")

    def _dispatch_api(self, method: str) -> None:
        if not rate_limit(self.client_address[0]):
            return self.send_error(HTTPStatus.TOO_MANY_REQUESTS, "rate limit")

        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/api/proxy":
            return self._handle_proxy(method, parsed.query)
        if parsed.path in ("/api/health", "/api/ping"):
            return self._send_json({"ok": True, "app": APP_NAME, "port": PORT})
        if parsed.path == "/api/shutdown":
            if method != "POST":
                return self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
            if not self._same_origin_or_no_origin():
                return self.send_error(HTTPStatus.FORBIDDEN, "origin not allowed")
            self._send_json({"ok": True, "shutdown": "in_progress"}, status=HTTPStatus.ACCEPTED)
            schedule_process_exit()
            return None
        return self.send_error(HTTPStatus.NOT_FOUND)

    def _same_origin_or_no_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        try:
            parsed = urllib.parse.urlsplit(origin)
        except ValueError:
            return False
        host = (parsed.hostname or "").lower()
        return host in {"127.0.0.1", "localhost"} and parsed.port == self.server.server_port

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _handle_proxy(self, method: str, query: str) -> None:
        if method not in {"GET", "POST"}:
            return self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

        qs = urllib.parse.parse_qs(query, keep_blank_values=True)
        url = (qs.get("url") or [""])[0]
        if not url:
            return self.send_error(HTTPStatus.BAD_REQUEST, "missing url")

        target = urllib.parse.urlsplit(url)
        if target.scheme != "https":
            return self.send_error(HTTPStatus.FORBIDDEN, "scheme not allowed: " + target.scheme)

        host = (target.hostname or "").lower()
        if not is_allowed_host(host):
            return self.send_error(HTTPStatus.FORBIDDEN, "host not allowlisted: " + host)
        if resolves_to_private_ip(host):
            return self.send_error(HTTPStatus.FORBIDDEN, "private/loopback target rejected")

        body = None
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length > 0 else b""

        req = urllib.request.Request(url, method=method, data=body)
        req.add_header("User-Agent", USER_AGENT)
        req.add_header("Accept", "application/json, text/plain, */*")

        try:
            opener = urllib.request.build_opener(_AllowlistRedirectHandler())
            upstream = opener.open(req, timeout=TIMEOUT_SEC)
        except urllib.error.HTTPError as exc:
            return self._stream_upstream(exc, exc.status or 502)
        except urllib.error.URLError as exc:
            return self.send_error(HTTPStatus.BAD_GATEWAY, f"upstream error: {exc}")
        except (TimeoutError, socket.timeout):
            return self.send_error(HTTPStatus.GATEWAY_TIMEOUT, "upstream timeout")
        except ValueError as exc:
            return self.send_error(HTTPStatus.FORBIDDEN, str(exc))

        self._stream_upstream(upstream, upstream.status or 200)

    def _stream_upstream(self, upstream, status: int) -> None:
        try:
            self.send_response(status)
            content_type = upstream.headers.get("Content-Type", "application/octet-stream")
            self.send_header("Content-Type", content_type)
            content_length = upstream.headers.get("Content-Length")
            if content_length and content_length.isdigit():
                self.send_header("Content-Length", content_length)
            else:
                self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            total = 0
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SIZE:
                    sys.stderr.write(f"[proxy] response > {MAX_SIZE} bytes; truncating\n")
                    break
                try:
                    self.wfile.write(chunk)
                except (ConnectionResetError, BrokenPipeError):
                    return
        finally:
            try:
                upstream.close()
            except Exception:
                pass


class _AllowlistRedirectHandler(urllib.request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):  # noqa: N802
        new_url = headers.get("Location") or ""
        new = urllib.parse.urlsplit(urllib.parse.urljoin(req.full_url, new_url))
        host = (new.hostname or "").lower()
        if new.scheme != "https" or not is_allowed_host(host) or resolves_to_private_ip(host):
            raise ValueError(f"redirect to disallowed target rejected: {new.scheme}://{host}")
        return super().http_error_302(req, fp, code, msg, headers)

    http_error_301 = http_error_302
    http_error_303 = http_error_302
    http_error_307 = http_error_302
    http_error_308 = http_error_302


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


WorldMediaHandler.protocol_version = "HTTP/1.1"


def main() -> int:
    if not ROOT.is_dir():
        sys.stderr.write(f"[server] frontend dir not found: {ROOT}\n")
        return 2
    if not (ROOT / "index.html").is_file():
        sys.stderr.write(f"[server] {ROOT / 'index.html'} missing\n")
        return 2

    bind_host = os.environ.get("WORLDMEDIA_BIND", "127.0.0.1")
    server = ThreadingServer((bind_host, PORT), WorldMediaHandler)
    sys.stderr.write(f"[server] World Media listening on http://{bind_host}:{PORT}/ (frontend={ROOT})\n")
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[server] shutting down\n")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

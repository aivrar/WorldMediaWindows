#!/usr/bin/env python3
"""Windows-native World Media launcher.

This is the single-file Windows entry point. It starts the local HTTP server on
127.0.0.1, opens the UI in a WebView2 desktop window, and stores logs under
LocalAppData. End users do not need Python, Node, WSL, or a Linux distro.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


APP_TITLE = "World Media"
APP_ID = "WorldMediaWindows"
DEFAULT_PORT = 9124
_LOG_HANDLE = None


def bundled_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent


def state_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if base:
        return Path(base) / APP_ID
    return Path.home() / f".{APP_ID.lower()}"


def find_port(preferred: int = DEFAULT_PORT) -> int:
    forced = os.environ.get("WORLDMEDIA_WINDOWS_PORT") or os.environ.get("WORLDMEDIA_PORT")
    if forced:
        port = int(forced)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
        return port

    for port in [preferred, *range(19124, 19180)]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("No free localhost port found for World Media")


def configure_environment(port: int) -> tuple[Path, Path]:
    root = bundled_root()
    runtime = state_root()
    for name in ("cache", "state", "logs"):
        (runtime / name).mkdir(parents=True, exist_ok=True)

    os.environ["WORLDMEDIA_APP_DIR"] = str(root)
    os.environ["WORLDMEDIA_FRONTEND"] = str(root / "frontend")
    os.environ["WORLDMEDIA_CACHE_DIR"] = str(runtime / "cache")
    os.environ["WORLDMEDIA_STATE_DIR"] = str(runtime / "state")
    os.environ["WORLDMEDIA_LOG_DIR"] = str(runtime / "logs")
    os.environ["WORLDMEDIA_BIND"] = "127.0.0.1"
    os.environ["WORLDMEDIA_PORT"] = str(port)
    os.environ["WORLDMEDIA_NATIVE"] = "1"
    return root, runtime


def main() -> int:
    global _LOG_HANDLE

    port = find_port()
    _root, runtime = configure_environment(port)
    log_path = runtime / "logs" / "native.log"
    try:
        _LOG_HANDLE = log_path.open("a", encoding="utf-8", buffering=1)
        sys.stdout = _LOG_HANDLE
        sys.stderr = _LOG_HANDLE
    except OSError:
        pass

    import worldmedia_server

    # worldmedia_server reads environment at import time, so import after
    # configure_environment().
    httpd = worldmedia_server.ThreadingServer(("127.0.0.1", port), worldmedia_server.WorldMediaHandler)
    url = f"http://127.0.0.1:{port}/"

    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] listening {url}", flush=True)

    if os.environ.get("WORLDMEDIA_NO_BROWSER") == "1":
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            return 0
        finally:
            httpd.server_close()
        return 0

    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    try:
        try:
            import webview

            webview.create_window(
                APP_TITLE,
                url,
                width=1280,
                height=860,
                min_size=(980, 660),
                text_select=False,
            )
            webview.start(gui="edgechromium", debug=False)
            return 0
        except Exception as exc:
            print(f"[native] WebView startup failed: {exc}", flush=True)
            webbrowser.open(url)
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        return 0
    finally:
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    raise SystemExit(main())

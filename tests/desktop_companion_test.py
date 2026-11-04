import importlib.util
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch


sys.dont_write_bytecode = True
COMPANION_PATH = Path(__file__).resolve().parents[1] / "desktop-companion" / "companion.py"


def load_companion(origin="https://eri.hs.vc"):
    with patch.dict(os.environ, {
        "APP_ORIGIN": origin,
        "DESKTOP_COMPANION_SECRET": "a" * 64,
    }), patch("shutil.which", return_value="/usr/bin/available"):
        spec = importlib.util.spec_from_file_location("nightjar_companion_under_test", COMPANION_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class RedirectHandler(BaseHTTPRequestHandler):
    redirect_target = ""
    requests = []

    def do_GET(self):
        self.__class__.requests.append(dict(self.headers))
        self.send_response(302)
        self.send_header("Location", self.redirect_target)
        self.end_headers()

    def log_message(self, _format, *_args):
        return


class CaptureHandler(BaseHTTPRequestHandler):
    requests = []

    def do_GET(self):
        self.__class__.requests.append(dict(self.headers))
        self.send_response(200)
        self.end_headers()

    def log_message(self, _format, *_args):
        return


class DesktopCompanionTests(unittest.TestCase):
    def test_remote_origin_is_exact_https_origin(self):
        companion = load_companion()
        self.assertEqual(companion.REMOTE_ORIGIN, "https://eri.hs.vc")
        with self.assertRaisesRegex(SystemExit, "requires APP_ORIGIN to be an HTTPS origin"):
            load_companion("http://eri.hs.vc")
        with self.assertRaisesRegex(SystemExit, "requires APP_ORIGIN to be an HTTPS origin"):
            load_companion("https://eri.hs.vc/desktop")

    def test_signed_relay_request_does_not_follow_redirect(self):
        companion = load_companion()
        CaptureHandler.requests.clear()
        RedirectHandler.requests.clear()
        target = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        relay = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
        RedirectHandler.redirect_target = f"http://127.0.0.1:{target.server_port}/capture"
        servers = []
        for server in (target, relay):
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            servers.append((server, thread))
        try:
            companion.REMOTE_ORIGIN = f"http://127.0.0.1:{relay.server_port}"
            status, _ = companion.relay_request("GET", "/api/desktop/companion/poll")
            self.assertEqual(status, 302)
            self.assertEqual(len(RedirectHandler.requests), 1)
            self.assertIn("X-Nj-Desktop-Signature", RedirectHandler.requests[0])
            self.assertEqual(CaptureHandler.requests, [])
        finally:
            for server, thread in servers:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()

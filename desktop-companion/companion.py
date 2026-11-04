#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import select
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent.parent
PORT = 4175
IDLE_LIMIT = 60
MAX_BODY = 32 * 1024
KEYS = {
    "escape": 1,
    "backspace": 14,
    "tab": 15,
    "enter": 28,
    "space": 57,
    "home": 102,
    "up": 103,
    "page-up": 104,
    "left": 105,
    "right": 106,
    "end": 107,
    "down": 108,
    "page-down": 109,
}
MAX_SCREEN_BYTES = 8 * 1024 * 1024


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, _request, _response, _code, _message, _headers, _new_url):
        return None


relay_opener = build_opener(RejectRedirects)


def load_project_env():
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if not separator or not key.strip() or key.lstrip().startswith("#"):
            continue
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


load_project_env()
SECRET = os.environ.get("DESKTOP_COMPANION_SECRET", "")
if not len(SECRET) == 64 or any(character not in "0123456789abcdefABCDEF" for character in SECRET):
    raise SystemExit("Set DESKTOP_COMPANION_SECRET to 64 random hexadecimal characters in the project .env.")

APP_PORT = os.environ.get("PORT", "4173")
APP_ORIGINS = {
    f"http://127.0.0.1:{APP_PORT}",
    f"http://localhost:{APP_PORT}",
}
configured_origin = os.environ.get("APP_ORIGIN", "")
if configured_origin in APP_ORIGINS:
    APP_ORIGINS.add(configured_origin)
REMOTE_ORIGIN = ""
if configured_origin:
    parsed_origin = urlparse(configured_origin)
    if (
        parsed_origin.scheme == "https"
        and parsed_origin.netloc
        and parsed_origin.username is None
        and parsed_origin.password is None
        and not parsed_origin.path
        and not parsed_origin.query
        and not parsed_origin.fragment
    ):
        REMOTE_ORIGIN = configured_origin
    elif configured_origin not in APP_ORIGINS:
        raise SystemExit("Remote desktop relay requires APP_ORIGIN to be an HTTPS origin without a path.")

for executable in ("grim", "ydotool"):
    if not shutil.which(executable):
        raise SystemExit(f"Required local executable not found: {executable}. The companion does not install system packages.")

used_nonces = {}
session = None
state_lock = threading.RLock()
console_lock = threading.Lock()
pair_attempts = []
pairing_pending = False


def decode_ticket(ticket):
    if not isinstance(ticket, str):
        return None
    try:
        payload, signature = ticket.split(".", 1)
        expected = hmac.new(bytes.fromhex(SECRET), payload.encode(), hashlib.sha256).digest()
        actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(expected, actual):
            return None
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not isinstance(claims, dict):
            return None
        if claims.get("audience") != "nightjar-linux-companion":
            return None
        if type(claims.get("expiresAt")) is not int or claims["expiresAt"] <= int(time.time() * 1000):
            return None
        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not 32 <= len(nonce) <= 256:
            return None
        now = int(time.time() * 1000)
        for old_nonce, expiry in list(used_nonces.items()):
            if expiry <= now:
                del used_nonces[old_nonce]
        if nonce in used_nonces:
            return None
        used_nonces[nonce] = claims["expiresAt"]
        return claims
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def approve_locally(prompt):
    if not sys.stdin.isatty():
        return False
    with console_lock:
        try:
            if not select.select([sys.stdin], [], [], 45)[0]:
                print("\nLocal approval timed out.", flush=True)
                return False
            answer = input(f"\n{prompt} Type YES in this terminal to approve: ")
        except EOFError:
            return False
    return hmac.compare_digest(answer.strip(), "YES")


def stop_session():
    global session
    with state_lock:
        if session:
            session["sharing"] = False
            session["input"] = False
            session = None


def run_tool(arguments, timeout=3):
    try:
        result = subprocess.run(
            arguments,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            shell=False,
        )
        return result.stdout
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"Local desktop operation failed: {error.__class__.__name__}.") from error


def perform_input(body):
    action = body.get("action")
    if not isinstance(action, str):
        raise ValueError("Choose a supported pointer, key, or text action.")
    if action in {"move", "click"}:
        x = body.get("x")
        y = body.get("y")
        if type(x) is not int or type(y) is not int or not (0 <= x <= 16384 and 0 <= y <= 16384):
            raise ValueError("Pointer coordinates are outside the allowed range.")
        buttons = {"left": ("0xC0",), "right": ("0x41", "0x81"), "middle": ("0x42", "0x82")}
        button = body.get("button", "left")
        if action == "click" and (not isinstance(button, str) or button not in buttons):
            raise ValueError("Choose left, right, or middle click.")
        run_tool(["ydotool", "mousemove", "--absolute", str(x), str(y)])
        if action == "click":
            run_tool(["ydotool", "click", *buttons[button]])
        return
    if action == "key":
        key = body.get("key")
        if not isinstance(key, str) or key not in KEYS:
            raise ValueError("That key is not available for remote input.")
        code = str(KEYS[key])
        run_tool(["ydotool", "key", f"{code}:1", f"{code}:0"])
        return
    if action == "type":
        text = body.get("text")
        if not isinstance(text, str) or not 1 <= len(text) <= 120 or any(not character.isprintable() for character in text):
            raise ValueError("Text must contain 1–120 printable characters.")
        run_tool(["ydotool", "type", "--", text])
        return
    raise ValueError("Choose a supported pointer, key, or text action.")


def relay_request(method, path, body=b""):
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_urlsafe(24)
    digest = hashlib.sha256(body).hexdigest()
    message = f"{method}\n{path}\n{timestamp}\n{nonce}\n{digest}".encode()
    signature = hmac.new(bytes.fromhex(SECRET), message, hashlib.sha256).hexdigest()
    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-store",
        "X-NJ-Desktop-Timestamp": timestamp,
        "X-NJ-Desktop-Nonce": nonce,
        "X-NJ-Desktop-Signature": signature,
    }
    if body:
        headers["Content-Type"] = "image/png" if path.endswith("/frame") else "application/json"
    request = Request(f"{REMOTE_ORIGIN}{path}", data=body or None, headers=headers, method=method)
    try:
        with relay_opener.open(request, timeout=8) as response:
            return response.status, response.read()
    except HTTPError as error:
        try:
            return error.code, error.read(2048)
        finally:
            error.close()


def remote_agent():
    global session
    print(f"Nightjar Linux companion (outbound HTTPS relay to {REMOTE_ORIGIN})", flush=True)
    print("The companion makes no public listener. Screen sharing and remote input still require separate local terminal approval.", flush=True)
    last_frame = 0.0
    last_poll_success = time.monotonic()
    while True:
        try:
            status, response = relay_request("GET", "/api/desktop/companion/poll")
            if status != 200:
                raise RuntimeError(f"Nightjar relay returned HTTP {status}.")
            payload = json.loads(response)
            last_poll_success = time.monotonic()
            if not payload.get("paired") or not payload.get("sharing"):
                stop_session()
            command = payload.get("command")
            if command:
                action = command.get("action")
                accepted = True
                detail = ""
                try:
                    if action == "start":
                        accepted = approve_locally("Nightjar owner console requested live screen sharing.")
                        with state_lock:
                            session = {
                                "sharing": accepted,
                                "input": False,
                                "lastSeen": time.time(),
                                "expiresAt": time.time() + 4 * 60 * 60,
                            } if accepted else None
                    elif action == "enable-input":
                        accepted = approve_locally("Nightjar owner console requested remote mouse and keyboard input.")
                        with state_lock:
                            if session and session["sharing"]:
                                session["input"] = accepted
                            else:
                                accepted = False
                    elif action == "stop":
                        stop_session()
                    elif action == "input":
                        with state_lock:
                            if not session or not session["sharing"] or not session["input"]:
                                raise RuntimeError("Local approval for remote input is not active.")
                            perform_input(command.get("input", {}))
                    else:
                        accepted = False
                        detail = "Unsupported relay action."
                except (ValueError, RuntimeError) as error:
                    accepted = False
                    detail = str(error)
                if action != "stop":
                    result = json.dumps({
                        "action": action,
                        "commandId": command.get("id"),
                        "sessionId": command.get("sessionId"),
                        "ok": accepted,
                        "error": detail,
                    }, separators=(",", ":")).encode()
                    result_status, _ = relay_request("POST", "/api/desktop/companion/result", result)
                    if result_status != 200:
                        raise RuntimeError(f"Nightjar relay rejected companion result (HTTP {result_status}).")
            with state_lock:
                sharing = bool(session and session["sharing"])
            now = time.monotonic()
            if sharing and now - last_frame >= 1.0:
                image = capture_screen()
                frame_status, _ = relay_request("POST", "/api/desktop/companion/frame", image)
                if frame_status != 204:
                    raise RuntimeError(f"Nightjar relay rejected screen frame (HTTP {frame_status}).")
                last_frame = now
            time.sleep(0.25)
        except (OSError, RuntimeError, URLError, ValueError, json.JSONDecodeError) as error:
            if time.monotonic() - last_poll_success > 10:
                stop_session()
            print(f"Nightjar desktop relay connection failed: {error}", file=sys.stderr, flush=True)
            time.sleep(2)


def capture_screen(timeout=4):
    try:
        process = subprocess.Popen(
            ["grim", "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            shell=False,
        )
    except OSError as error:
        raise RuntimeError(f"Local desktop operation failed: {error.__class__.__name__}.") from error

    chunks = []
    size = 0
    deadline = time.monotonic() + timeout
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([process.stdout], [], [], remaining)[0]:
                raise RuntimeError("Screen capture timed out.")
            chunk = os.read(process.stdout.fileno(), 64 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_SCREEN_BYTES:
                raise RuntimeError("Screen capture exceeded the 8 MB relay limit.")
            chunks.append(chunk)
        if process.wait(timeout=max(0, deadline - time.monotonic())) != 0:
            raise RuntimeError("Screen capture failed.")
        if not chunks:
            raise RuntimeError("Screen capture returned an empty image.")
        return b"".join(chunks)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"Local desktop operation failed: {error.__class__.__name__}.") from error
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()


class CompanionHandler(BaseHTTPRequestHandler):
    server_version = "NightjarCompanion"
    sys_version = ""

    def log_message(self, _format, *_args):
        return

    def send_json(self, status, value):
        data = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_cors()
        self.end_headers()
        self.wfile.write(data)

    def send_cors(self):
        origin = self.headers.get("Origin", "")
        if origin in APP_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def check_origin(self):
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "")
        return origin in APP_ORIGINS and host in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def do_OPTIONS(self):
        if not self.check_origin():
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "60")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length < 1 or length > MAX_BODY:
            return None
        try:
            value = json.loads(self.rfile.read(length))
            return value if isinstance(value, dict) else None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def authorize(self):
        global session
        authorization = self.headers.get("Authorization", "")
        candidate = authorization.removeprefix("Bearer ")
        with state_lock:
            if not session or not candidate or not hmac.compare_digest(candidate, session["token"]):
                self.send_json(401, {"error": "Pair the companion again from the owner console."})
                return False
            now = time.time()
            if now - session["lastSeen"] > IDLE_LIMIT or now >= session["expiresAt"]:
                stop_session()
                self.send_json(401, {"error": "The companion session expired. Pair again to continue."})
                return False
            session["lastSeen"] = now
            return True

    def do_GET(self):
        if not self.check_origin():
            self.send_error(403)
            return
        if self.path == "/status":
            with state_lock:
                self.send_json(200, {
                    "available": True,
                    "paired": bool(session),
                    "sharing": bool(session and session["sharing"]),
                    "inputEnabled": bool(session and session["input"]),
                })
            return
        if self.path == "/frame":
            if not self.authorize():
                return
            with state_lock:
                active_session = session
                if not active_session or not active_session["sharing"]:
                    self.send_json(409, {"error": "Screen sharing is not active."})
                    return
            try:
                image = capture_screen()
            except RuntimeError as error:
                self.send_json(503, {"error": str(error)})
                return
            with state_lock:
                if session is not active_session or not active_session["sharing"]:
                    self.send_json(410, {"error": "Screen sharing has stopped."})
                    return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(image)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_cors()
            self.end_headers()
            self.wfile.write(image)
            return
        self.send_error(404)

    def do_POST(self):
        global session
        if not self.check_origin():
            self.send_error(403)
            return
        body = self.read_json()
        if body is None:
            self.send_json(400, {"error": "Send a small JSON object."})
            return

        if self.path == "/pair":
            global pair_attempts, pairing_pending
            now = time.time()
            pair_attempts = [timestamp for timestamp in pair_attempts if now - timestamp < 60]
            if len(pair_attempts) >= 5:
                self.send_json(429, {"error": "Too many pairing attempts. Wait one minute and try again."})
                return
            pair_attempts.append(now)
            claims = decode_ticket(body.get("ticket", ""))
            if not claims:
                self.send_json(401, {"error": "The owner-session pairing ticket was rejected or expired."})
                return
            with state_lock:
                if (session and now - session["lastSeen"] <= IDLE_LIMIT and now < session["expiresAt"]) or pairing_pending:
                    self.send_json(409, {"error": "A companion session is already paired or awaiting approval."})
                    return
                if session:
                    stop_session()
                pairing_pending = True
            try:
                with state_lock:
                    now = time.time()
                    if session and now - session["lastSeen"] <= IDLE_LIMIT and now < session["expiresAt"]:
                        self.send_json(409, {"error": "A companion session is already paired."})
                        return
                    if session:
                        stop_session()
                    session = {
                        "token": secrets.token_urlsafe(32),
                        "lastSeen": time.time(),
                        "expiresAt": min(claims["expiresAt"] / 1000 + 3600, time.time() + 4 * 60 * 60),
                        "sharing": False,
                        "input": False,
                        "lastInput": 0.0,
                    }
                    self.send_json(200, {"paired": True, "sessionToken": session["token"]})
            finally:
                with state_lock:
                    pairing_pending = False
            return

        if not self.authorize():
            return
        if self.path == "/heartbeat":
            with state_lock:
                self.send_json(200, {
                    "paired": True,
                    "sharing": session["sharing"],
                    "inputEnabled": session["input"],
                })
            return
        if self.path == "/start":
            with state_lock:
                active_session = session
                already_sharing = bool(active_session and active_session["sharing"])
            if not active_session:
                self.send_json(401, {"error": "Pair the companion again from the owner console."})
                return
            if not already_sharing:
                if not approve_locally("Nightjar owner console requested live screen sharing."):
                    self.send_json(403, {"error": "Local screen-sharing approval was denied."})
                    return
                with state_lock:
                    if session is not active_session:
                        self.send_json(401, {"error": "The companion session ended before sharing was approved."})
                        return
                    active_session["sharing"] = True
            self.send_json(200, {"sharing": True})
            return
        if self.path == "/enable-input":
            with state_lock:
                active_session = session
                sharing = bool(active_session and active_session["sharing"])
                input_enabled = bool(active_session and active_session["input"])
            if not active_session:
                self.send_json(401, {"error": "Pair the companion again from the owner console."})
                return
            if not sharing:
                self.send_json(409, {"error": "Start locally approved screen sharing first."})
                return
            if not input_enabled:
                if not approve_locally("Nightjar owner console requested remote mouse and keyboard input."):
                    self.send_json(403, {"error": "Local remote-input approval was denied."})
                    return
                with state_lock:
                    if session is not active_session or not active_session["sharing"]:
                        self.send_json(401, {"error": "The companion session ended before input was approved."})
                        return
                    active_session["input"] = True
            self.send_json(200, {"inputEnabled": True})
            return
        if self.path == "/stop":
            stop_session()
            self.send_json(200, {"stopped": True})
            return
        if self.path == "/input":
            with state_lock:
                if not session or not session["sharing"] or not session["input"]:
                    self.send_json(403, {"error": "Local approval for remote input is not active."})
                    return
                now = time.time()
                if now - session["lastInput"] < 0.02:
                    self.send_json(429, {"error": "Remote input is being sent too quickly."})
                    return
                session["lastInput"] = now
                try:
                    self.perform_input(body)
                except (ValueError, RuntimeError) as error:
                    self.send_json(400, {"error": str(error)})
                    return
            self.send_json(200, {"ok": True})
            return
        self.send_error(404)

    def perform_input(self, body):
        perform_input(body)


class LoopbackServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def expire_idle_sessions(server):
    while True:
        time.sleep(1)
        with state_lock:
            expired = bool(session and time.time() - session["lastSeen"] > IDLE_LIMIT)
        if expired:
            stop_session()
            print("\nCompanion session stopped after its owner-console heartbeat expired.", flush=True)


def main():
    if REMOTE_ORIGIN and REMOTE_ORIGIN not in APP_ORIGINS:
        remote_agent()
        return
    print("Nightjar Linux companion (manual start; loopback only)")
    print(f"Open the owner console at {', '.join(sorted(APP_ORIGINS))}")
    print("Pairing is authorized by the signed ticket from your authenticated Nightjar owner session; no pairing code is used.")
    print("The local terminal will ask before screen sharing and remote input.")
    print("Stop sharing in the owner console or press Ctrl+C here. No RDP or firewall settings are changed.")
    server = LoopbackServer(("127.0.0.1", PORT), CompanionHandler)
    threading.Thread(target=expire_idle_sessions, args=(server,), daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nStopping Nightjar companion.", flush=True)
    finally:
        stop_session()
        server.server_close()


if __name__ == "__main__":
    main()

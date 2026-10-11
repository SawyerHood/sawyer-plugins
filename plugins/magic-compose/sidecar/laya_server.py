#!/usr/bin/env python3
"""Laya sidecar: serve the NandhaKishorM/laya decision model over plain HTTP.

Speaks the same wire format as the OpenRouter decisions endpoint
(state + typed questions -> choices, probabilities, confidence), so a
Magic Compose-style client can point at it instead of a cloud gateway.

Runs on the Python standard library only; the laya package does the ML.
Default: http://127.0.0.1:8899/decisions, bound to loopback only.

Usage:
    python laya_server.py [--model REPO_OR_PATH] [--subfolder NAME]
                          [--host 127.0.0.1] [--port 8899]
"""
import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Find the laya package: sibling checkout of the repo containing this script,
# or a pip-installed laya as the fallback.
_here = Path(__file__).resolve()
for _candidate in (_here.parents[4] / "laya", _here.parents[3] / "laya"):
    if (_candidate / "laya" / "__init__.py").exists():
        sys.path.insert(0, str(_candidate))
        break

import laya  # noqa: E402


class LayaService:
    """One warm model, guarded by a lock because a forward pass is not reentrant."""

    def __init__(self, model: str, subfolder: str | None):
        self.agent = laya.load(model, subfolder=subfolder)
        self.lock = threading.Lock()

    def decide(self, state, questions):
        # system_one answers every question about the state in one batched pass.
        with self.lock:
            return self.agent.system_one(state, questions)


class Handler(BaseHTTPRequestHandler):
    service: LayaService
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

    def _send(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "model": "laya-rl-agent"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/decisions":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            request = json.loads(raw)
        except (ValueError, json.JSONDecodeError) as error:
            self._send(400, {"error": "bad JSON: %s" % error})
            return

        questions = request.get("questions")
        if not isinstance(questions, dict) or not questions:
            self._send(400, {"error": "questions must be a non-empty object"})
            return

        started = time.time()
        try:
            result = self.service.decide(request.get("state", ""), questions)
        except Exception as error:  # noqa: BLE001 - surface model faults to the client
            self._send(500, {"error": "laya inference failed: %s" % error})
            return

        self._send(
            200,
            {
                "model": result.get("model", "laya-rl-agent"),
                "answers": result["answers"],
                "usage": result.get("usage", {"input_tokens": 0, "output_tokens": 0}),
                "latency_ms": round((time.time() - started) * 1000),
            },
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="convaiinnovations/laya",
                        help="HF repo or local path of a laya checkpoint")
    parser.add_argument("--subfolder", default=None,
                        help="checkpoint subfolder inside the repo (e.g. multilingual)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8899)
    args = parser.parse_args()

    print("loading laya checkpoint %s%s..." % (args.model,
          (" subfolder=%s" % args.subfolder) if args.subfolder else ""), flush=True)
    started = time.time()
    service = LayaService(args.model, args.subfolder)
    print("loaded in %.1fs on %s, serving http://%s:%d/decisions"
          % (time.time() - started, service.agent.device, args.host, args.port), flush=True)

    Handler.service = service
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

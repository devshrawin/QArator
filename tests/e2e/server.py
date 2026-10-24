"""Static mock pages + OpenAI-compatible mock endpoint. Records chat requests to requests.jsonl."""
import json, os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock")
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requests.jsonl")
ANSWER = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "answer.json"), encoding="utf-8"))


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "*")
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self._json(204, {})

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._json(404, {"error": "nope"})
        if self.path == "/v1/models":
            return self._json(200, {"data": [{"id": "local-vision"}, {"id": "local-text"}]})
        return super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.path.startswith("/api/"):
            return self._json(500, {"error": "boom"})
        if self.path == "/v1/chat/completions":
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps({"auth": self.headers.get("authorization"), "body": json.loads(body)}) + "\n")
            return self._json(200, {"choices": [{"message": {"role": "assistant", "content": "```json\n" + json.dumps(ANSWER) + "\n```"}}]})
        self._json(404, {})


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()

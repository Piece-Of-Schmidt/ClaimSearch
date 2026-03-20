"""
NarrativLabel – lokaler Annotation-Server (Python 3, keine Abhängigkeiten)
Starten: python server.py
"""
import json
import os
import re
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

BASE     = Path(__file__).resolve().parent   # immer absoluter Pfad
PUBLIC   = BASE / "public"
ANN_FILE        = BASE / "data" / "annotations.json"
TXT_FILE        = BASE / "data" / "texts.json"
TXT_SAMPLE_FILE = BASE / "data" / "texts_sample.json"

def read_ann():
    try:
        return json.loads(ANN_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}

def write_ann(data):
    ANN_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    # ── routing ──────────────────────────────────────────────
    def do_GET(self):
        if self.path == "/api/texts":
            src = TXT_FILE if TXT_FILE.exists() else TXT_SAMPLE_FILE
            self._json(json.loads(src.read_text(encoding="utf-8")))
        elif self.path == "/api/annotations":
            self._json(read_ann())
        elif self.path == "/favicon.ico":
            self.send_response(204)   # No Content – kein Crash, kein Log-Spam
            self.end_headers()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/annotations":
            body = self._read_body()
            text_id    = str(body.get("textId"))
            text       = body.get("text", "")
            span       = body.get("span", "")
            start      = body.get("start", 0)
            end        = body.get("end", 0)
            narratives = body.get("narratives", [])
            comment    = body.get("comment", "")

            data = read_ann()
            if text_id not in data:
                data[text_id] = {"text": text, "spans": []}
            entry = {
                "span":       span,
                "start":      start,
                "end":        end,
                "narratives": narratives,
            }
            if comment:
                entry["comment"] = comment
            data[text_id]["spans"].append(entry)
            write_ann(data)
            self._json({"success": True, "spanIndex": len(data[text_id]["spans"]) - 1})
        elif self.path == "/api/rename-narrative":
            body     = self._read_body()
            old_name = body.get("oldName", "")
            new_name = body.get("newName", "")
            if not old_name or not new_name:
                return self.send_error(400, "Missing oldName or newName")
            data = read_ann()
            for entry in data.values():
                for sp in entry.get("spans", []):
                    sp["narratives"] = [
                        new_name if n == old_name else n
                        for n in sp.get("narratives", [])
                    ]
            write_ann(data)
            self._json({"success": True})
        else:
            self.send_error(404)

    def do_DELETE(self):
        # Pattern: /api/annotations/<textId>/spans/<spanIndex>
        m = re.match(r"^/api/annotations/(.+)/spans/(\d+)$", self.path)
        if m:
            text_id   = unquote(m.group(1))
            span_idx  = int(m.group(2))
            data = read_ann()
            entry = data.get(text_id)
            if not entry or span_idx >= len(entry["spans"]):
                self.send_error(404, "Span nicht gefunden.")
                return
            entry["spans"].pop(span_idx)
            write_ann(data)
            self._json({"success": True})
        else:
            self.send_error(404)

    # ── helpers ──────────────────────────────────────────────
    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Ruhigere Logs: nur API-Calls zeigen
        # args[0] kann ein HTTPStatus-Objekt sein → immer als str behandeln
        first = str(args[0]) if args else ""
        if "/api/" in first:
            print(f"  {first}")


if __name__ == "__main__":
    port = 3000
    server = HTTPServer(("", port), Handler)  # alle Interfaces
    txt_label = "texts.json" if TXT_FILE.exists() else "texts_sample.json  (kein texts.json gefunden)"
    print(f"\n  NarrativLabel laeuft auf  http://localhost:{port}")
    print(f"  Texte:                    {txt_label}\n")
    print("  Beenden mit Ctrl+C\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server gestoppt.")

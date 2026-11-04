"""Serve the zotsite export and accept PDF reading-position write-backs.

Chrome's built-in PDF viewer never tells JS which page is open, so the site
uses its own pdf.js viewer (viewer.html), which POSTs the current page here and
this server patches storage/<key>/.zotero-reader-state the way Zotero does.
"""
import argparse
import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

KEY_RE = re.compile(r'^[A-Za-z0-9]{8}$')
STATE_NAME = '.zotero-reader-state'


class Handler(SimpleHTTPRequestHandler):
    storage: Path = Path()

    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map,
                          **{'.mjs': 'text/javascript'})

    def end_headers(self):
        # reader state must never be cached; static assets may be revalidated
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/api/')
                         else 'no-cache')
        super().end_headers()

    def _state_path(self, key):
        if not KEY_RE.match(key or ''):
            return None
        return self.storage / key / STATE_NAME

    def _json(self, obj, code):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_state(self, path):
        try:
            state = json.loads(path.read_text(encoding='utf-8'))
        except (FileNotFoundError, ValueError, OSError):
            return {}
        return state if isinstance(state, dict) else {}

    def do_GET(self):
        if urlparse(self.path).path == '/api/state':
            query = parse_qs(urlparse(self.path).query)
            key = (query.get('key') or [''])[0]
            path = self._state_path(key)
            if path is None:
                return self._json({'error': 'bad key'}, 400)
            return self._json(self._read_state(path), 200)
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != '/api/state':
            return self._json({'error': 'not found'}, 404)
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(length) or b'{}')
        except (ValueError, OSError):
            return self._json({'error': 'bad json'}, 400)
        key = body.get('key') or ''
        page = body.get('pageIndex')
        path = self._state_path(key)
        if path is None or not isinstance(page, int) or page < 0:
            return self._json({'error': 'bad request'}, 400)
        state = self._read_state(path)
        state['pageIndex'] = page
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(STATE_NAME + '.tmp')
        tmp.write_text(json.dumps(state), encoding='utf-8')
        os.replace(tmp, path)
        return self._json({'ok': True, 'pageIndex': page}, 200)


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument('-d', '--dir', type=Path, default=here / 'site')
    ap.add_argument('-s', '--storage', type=Path,
                    default=Path('D:/Zotero/DB/storage'))
    ap.add_argument('-p', '--port', type=int, default=8099)
    args = ap.parse_args()
    Handler.storage = args.storage
    handler = lambda *a, **kw: Handler(*a, directory=str(args.dir), **kw)
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as httpd:
        print(f'serving {args.dir} on http://127.0.0.1:{args.port} '
              f'(reader state -> {args.storage})', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())

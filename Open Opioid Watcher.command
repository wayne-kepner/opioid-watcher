#!/bin/zsh
cd "${0:A:h}" || exit 1
/usr/bin/python3 - <<'PY'
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from webbrowser import open as open_browser

class FreshHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

server = ThreadingHTTPServer(("127.0.0.1", 0), FreshHandler)
url = f"http://127.0.0.1:{server.server_port}/"
print(f"Opioid Watcher is open at {url}")
print("Keep this window open while you use the site. Press Control-C to stop it.")
open_browser(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY

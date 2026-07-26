import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class CorsHlsHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".m3u8": "application/vnd.apple.mpegurl",
        ".ts": "video/mp2t",
    }

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()

    handler = functools.partial(CorsHlsHandler, directory=args.root)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Serving HLS with CORS at http://127.0.0.1:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()

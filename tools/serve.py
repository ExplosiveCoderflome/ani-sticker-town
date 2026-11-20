"""Serve the built Web game locally, including its precompressed Godot files."""
import argparse
from functools import partial
import hashlib
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit, urlunsplit
import webbrowser
import sticker_service


SITE = Path(__file__).resolve().parents[1] / "play"
SITE_ID = hashlib.sha256(os.path.normcase(str(SITE)).encode()).hexdigest()[:16]
HOST = "127.0.0.1"


def accepts_gzip(header):
    for item in header.lower().split(","):
        name, _, parameter = item.strip().partition(";")
        if name == "gzip":
            if not parameter:
                return True
            try:
                return float(parameter.strip().removeprefix("q=").strip()) > 0
            except ValueError:
                return False
    return False


class GameHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".pck": "application/octet-stream",
        ".js": "application/javascript",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
    }

    def send_head(self):
        self.use_gzip = False
        original = self.path
        location = urlsplit(original)
        if location.path == "/weekend-letter.html":
            try:
                gift = (SITE.parent / "releases" / "黑猫寄来的周末.html").open("rb")
            except FileNotFoundError:
                self.send_error(404, "The letter has not been installed.")
                return None
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(os.fstat(gift.fileno()).st_size))
            self.end_headers()
            return gift
        if location.path.startswith("/api/"):
            return self.api_response(location.path, write=False)
        filepath = Path(self.translate_path(original))
        if (filepath.suffix in (".wasm", ".pck", ".js")
                and accepts_gzip(self.headers.get("Accept-Encoding", ""))
                and Path(str(filepath) + ".gz").is_file()):
            self.path = urlunsplit(location._replace(path=location.path + ".gz"))
            self.use_gzip = True
        try:
            return super().send_head()
        finally:
            self.path = original

    def do_POST(self):
        self.use_gzip = False
        body = self.api_response(urlsplit(self.path).path, write=True)
        with body:
            try:
                self.copyfile(body, self.wfile)
            except (ConnectionResetError, BrokenPipeError):
                pass

    def api_response(self, path, write):
        status = 200
        try:
            host = self.headers.get("Host", "").lower()
            port = self.server.server_address[1]
            if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                raise sticker_service.StickerError(403, "请通过本机的小镇入口使用素材库。")
            if write:
                origin = self.headers.get("Origin")
                if ((origin is not None and origin != "http://" + host)
                        or self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site"):
                    raise sticker_service.StickerError(403, "只接受小镇页面提交的贴纸。")
                if self.headers.get_content_type() != "application/json":
                    raise sticker_service.StickerError(415, "贴纸资料需要使用 JSON 格式。")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= sticker_service.MAX_POST:
                    raise sticker_service.StickerError(413, "贴纸资料为空或文件过大。")
                result = sticker_service.post(path, json.loads(self.rfile.read(length)))
                status = 201
            else:
                result = sticker_service.get(path)
        except sticker_service.StickerError as exc:
            status, result = exc.status, {"error": str(exc)}
        except (ValueError, UnicodeError):
            status, result = 400, {"error": "请求资料格式不正确。"}
        except (OSError, sqlite3.Error):
            status, result = 500, {"error": "本机素材库暂时无法读写。"}
        image = isinstance(result, bytes)
        content = result if image else json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "image/png" if image else "application/json; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        return BytesIO(content)

    def guess_type(self, path):
        if self.use_gzip:
            path = path[:-3]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("X-Sticker-Town", SITE_ID)
        if getattr(self, "use_gzip", False):
            self.send_header("Content-Encoding", "gzip")
        super().end_headers()

    def log_message(self, format, *args):
        # The double-click launcher uses pythonw without a console.
        pass


def is_our_server(port):
    conn = HTTPConnection(HOST, port, timeout=0.8)
    try:
        conn.request("HEAD", "/")
        return conn.getresponse().getheader("X-Sticker-Town") == SITE_ID
    except (OSError, HTTPException):
        return False
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open or reuse the game in a browser")
    args = parser.parse_args()
    handler = partial(GameHandler, directory=str(SITE))
    for port in range(args.port, args.port + 10):
        url = f"http://{HOST}:{port}/"
        if is_our_server(port):
            if args.open:
                webbrowser.open(url)
            return
        try:
            server = ThreadingHTTPServer((HOST, port), handler)
        except OSError:
            if is_our_server(port):
                if args.open:
                    webbrowser.open(url)
                return
            continue
        with server:
            if args.open:
                webbrowser.open(url)
            server.serve_forever()
        return
    raise SystemExit("All local game ports are occupied. Run again with --port.")


if __name__ == "__main__":
    main()

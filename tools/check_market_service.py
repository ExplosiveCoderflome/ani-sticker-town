"""Exercise the offline market, legacy database migration and paid-request boundaries."""
import base64
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
from unittest.mock import patch
import zlib

import sticker_service as service


def png(color):
    def chunk(name, content):
        return struct.pack(">I", len(content)) + name + content + struct.pack(">I", zlib.crc32(name + content))
    rows = []
    for y in range(12):
        pixels = [bytes((color, 110, 84, 255 if 1 < x < 9 and 1 < y < 10 else 0)) for x in range(12)]
        rows.append(b"\0" + b"".join(pixels))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", 12, 12, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


def run():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        kit = root / "market"
        kit.mkdir()
        old_id = "gen-" + "a" * 32
        with closing(sqlite3.connect(root / "stickers.sqlite3")) as db, db:
            db.execute("CREATE TABLE stickers (id TEXT PRIMARY KEY, name TEXT, width INTEGER, height INTEGER, "
                       "draw_width REAL, draw_height REAL, png BLOB)")
            db.execute("INSERT INTO stickers VALUES (?,?,?,?,?,?,?)", (old_id,"我的摊位",12,12,30,30,png(1)))

        bundled = []
        for n, role in enumerate(service.MARKET_ROLES, 1):
            (kit / (role + ".png")).write_bytes(png(n))
            bundled.append({"id":"gen-" + format(n, "032x"), "name":role, "role":role, "size":[40,44],
                            "width":12, "height":12, "file":role + ".png"})
        manifest = {"theme":"一个热闹的夜市", "stickers":bundled[::-1]}
        manifest_file = kit / "kit.json"
        manifest_file.write_text(json.dumps(manifest), encoding="utf-8")

        with patch.object(service, "MARKET_DIR", kit), patch.dict(os.environ, {"TOWN_STICKER_DATA":temporary,"RECRAFT_API_TOKEN":""}):
            sample = service.get("/api/stickers/night-market")
            assert [s["role"] for s in sample["stickers"]] == list(service.MARKET_ROLES)
            assert {s["id"] for s in service.get("/api/stickers")["stickers"]} == {old_id}
            assert service.get("/api/stickers/" + old_id)["role"] is None
            for item, row in zip(bundled, sample["stickers"]):
                assert service.get("/api/stickers/" + item["id"]) == row
                assert service.get(row["image"]) == (kit / item["file"]).read_bytes()
            manifest["stickers"][0]["file"] = "../escape.png"
            manifest_file.write_text(json.dumps(manifest), encoding="utf-8")
            try:
                service.get("/api/stickers/night-market")
            except service.StickerError as error:
                assert error.status == 503
            else:
                raise AssertionError("Untrusted filename accepted")

            if service.Image is None:
                print("Offline kit and migration passed. Install Pillow for mock provider checks.")
                return
            calls = []
            def provider(endpoint, payload, token):
                calls.append(endpoint)
                if endpoint == "generations":
                    choices = [r for r in service.MARKET_ROLES if service.ROLES[r][2] in payload["prompt"]]
                    assert len(choices) == 1 and token == "mock"
                    image = png(120 + service.MARKET_ROLES.index(choices[0]))
                    return {"data":[{"b64_json":base64.b64encode(image).decode()}]}
                assert endpoint == "removeBackground"
                return {"image":{"b64_json":payload["image_url"].partition(",")[2]}}
            def order(role, **extra):
                return service.post("/api/stickers/generate", {"theme":"湖边市集","role":role, **extra})
            with patch.dict(os.environ, {"RECRAFT_API_TOKEN":"mock"}), patch.object(service, "recraft", provider):
                rows = [order(r) for r in service.MARKET_ROLES]
                assert [s["role"] for s in rows] == list(service.MARKET_ROLES)
                assert len({service.get(s["image"]) for s in rows}) == 4
                assert [order(r) for r in service.MARKET_ROLES] == rows and len(calls) == 8
                order("stall", edition="c"*32)
                order("stall", edition="c"*32)
                assert calls == ["generations","removeBackground"] * 5
            assert all(order(row["role"]) == row for row in rows)
            assert all(service.get("/api/stickers/" + row["id"])["role"] == row["role"] for row in rows)
    print("Market kit, migrated roles, four mock images, cached replay and explicit redraw passed.")


if __name__ == "__main__":
    run()

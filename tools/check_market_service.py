"""Exercise offline kits, player imports, themed prompts and paid-request boundaries."""
import base64
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
from unittest.mock import patch
import zlib

import sticker_service as service


def png(color, alpha=None):
    def chunk(name, content):
        return struct.pack(">I", len(content)) + name + content + struct.pack(">I", zlib.crc32(name + content))
    rows = []
    for y in range(12):
        pixels = [bytes((color, 110, 84, alpha if alpha is not None else 255 if 1 < x < 9 and 1 < y < 10 else 0)) for x in range(12)]
        rows.append(b"\0" + b"".join(pixels))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", 12, 12, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


def check_filtered_alpha():
    for value, accepted in [(0, False), (255, False), (90, True)]:
        for channels in (2, 4):
            for method in range(5):
                rows = bytearray()
                for y in range(2):
                    rows.append(method)
                    for x in range(3):
                        left, above = (value if x else 0), (value if y else 0)
                        diagonal = value if x and y else 0
                        estimate = left + above - diagonal
                        paeth = min((left, above, diagonal), key=lambda n: abs(estimate - n))
                        predictor = [0, left, above, (left + above) // 2, paeth][method]
                        rows.extend(bytes(channels - 1) + bytes([(value - predictor) % 256]))
                assert service.has_cutout(rows, 3, 2, channels) == accepted


def run():
    check_filtered_alpha()
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
        for start, dirname, theme in [(11, "bookshop", "海边书市"), (21, "seaside-market", "海风夜市")]:
            folder = root / dirname
            folder.mkdir()
            items = []
            for n, item in enumerate(bundled, start):
                (folder / item["file"]).write_bytes(png(n))
                items.append({**item, "id":"gen-" + format(n, "032x")})
            (folder / "kit.json").write_text(json.dumps({"theme":theme, "stickers":items}), encoding="utf-8")

        with patch.object(service, "MARKET_DIR", kit), patch.object(service, "BOOKSHOP_DIR", root / "bookshop"), \
                patch.object(service, "SEASIDE_DIR", root / "seaside-market"), \
                patch.dict(os.environ, {"TOWN_STICKER_DATA":temporary,"RECRAFT_API_TOKEN":""}):
            sample = service.get("/api/stickers/night-market")
            assert sample["profile"] == "market"
            assert [s["role"] for s in sample["stickers"]] == list(service.MARKET_ROLES)
            assert {s["id"] for s in service.get("/api/stickers")["stickers"]} == {old_id}
            assert service.get("/api/stickers/" + old_id)["role"] is None
            old_theme = "周日旧书店"
            with closing(service.database()) as db, db:
                db.execute("UPDATE stickers SET name=?, role='stall' WHERE id=?", (old_theme + "·摊位", old_id))
                key = hashlib.sha256(("theme-v1\0stall\0" + old_theme).encode()).hexdigest()
                db.execute("INSERT INTO theme_jobs(request_key,sticker_id) VALUES (?,?)", (key, old_id))
            old = service.post(service.PREFIX + "/generate", {"theme":old_theme, "role":"stall"})
            assert old["id"] == old_id and old["profile"] == "books"
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

            for dirname, expected in [("bookshop", "books"), ("seaside-market", "market")]:
                sample = service.get("/api/stickers/" + dirname)
                assert sample["profile"] == expected and len(sample["stickers"]) == 4
                for row in sample["stickers"]:
                    asset = root / dirname / (row["role"] + ".png")
                    assert row["profile"] == expected and service.get(row["image"]) == asset.read_bytes()
                    assert service.get("/api/stickers/" + row["id"]) == row
            profiles = service.get("/api/stickers/profiles")
            samples = {"海边书市":"books", "灯笼夜市":"market", "陶艺市集":"studio", "春日花店":"garden",
                       "ＦＬＯＷＥＲ market":"garden", "雨后的纸飞机机场":"general"}
            assert {s: service.theme_profile(s) for s in samples} == samples
            assert all(set(p["labels"]) == set(service.MARKET_ROLES) for p in profiles["profiles"])

            def upload(image, **fields):
                data = "data:image/png;base64," + base64.b64encode(image).decode()
                return service.post(service.PREFIX, {"kind":"interactive", "theme":"自己的花店", "role":"stall", "data":data, **fields})

            with patch.object(service, "Image", None), patch.object(service, "recraft", side_effect=AssertionError("unexpected paid request")):
                assert service.get(service.PREFIX)["interactiveImport"]
                imported = [upload(png(30+i), role=r) for i,r in enumerate(service.MARKET_ROLES)]
                assert len({row["id"] for row in imported}) == 4
                for index, row in enumerate(imported):
                    assert row["profile"] == "garden" and service.get(row["image"]) == png(30+index)
                    assert row == service.get(service.PREFIX + "/" + row["id"]) == upload(png(30+index), role=row["role"])
                assert upload(png(30), name=imported[0]["name"], profile="studio")["id"] != imported[0]["id"]
                for content, fields in [(png(1,0), {}), (png(1,255), {}), (png(1), {"role":"typo"}), (png(1), {"profile":"typo"})]:
                    try:
                        upload(content, **fields)
                    except service.StickerError as error:
                        assert error.status == 400
                    else:
                        raise AssertionError("Invalid imported component accepted")

            if service.Image is None:
                print("Three offline kits, uploads without Pillow, and old cached jobs passed.")
                return
            calls, prompts = [], []
            def provider(endpoint, payload, token):
                calls.append(endpoint)
                if endpoint == "generations":
                    prompts.append(payload["prompt"])
                    choices = [r for profile in service.PROFILE_TERMS for r in service.MARKET_ROLES
                               if service.role_spec(r, profile)[2] in payload["prompt"]]
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
                before = len(prompts)
                for theme, expected in [("月下书市", "books"), ("街角花园", "garden"), ("陶艺工作坊", "studio")]:
                    for role in service.MARKET_ROLES:
                        row = order(role, theme=theme)
                        label, _, composition = service.role_spec(role, expected)
                        assert row["profile"] == expected and row["name"].endswith("·" + label)
                        assert composition in prompts[-1] and theme in prompts[-1]
                        assert order(role, theme=theme) == row
                assert len(prompts) - before == 12 and len(calls) == 34
            assert all(order(row["role"]) == row for row in rows)
            assert all(service.get("/api/stickers/" + row["id"])["role"] == row["role"] for row in rows)
    print("Three offline kits, migrated library, role imports, themed generation, cached replay and explicit redraw passed.")


if __name__ == "__main__":
    run()

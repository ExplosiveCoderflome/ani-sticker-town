"""Offline checks for the production motion endpoints; no provider traffic."""
import base64
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
from unittest.mock import patch

from PIL import Image
import sticker_motion as motion
import sticker_service as service

BASE = service.PREFIX
SAMPLE = Path(__file__).resolve().parents[1] / "play/media/watercolor-studio"


def data(blob):
    return motion.DATA + base64.b64encode(blob).decode("ascii")


def fail(status, fn, *arguments):
    try:
        fn(*arguments)
    except service.StickerError as exc:
        assert exc.status == status, (exc.status, str(exc))
        return str(exc)
    raise AssertionError("Unexpectedly accepted request")


def square_row(sheet, row):
    square = Image.new("RGBA",(448,448))
    for i in range(4):
        square.paste(sheet.crop((i*224,row*224,(i+1)*224,(row+1)*224)), ((i%2)*224,(i//2)*224))
    return motion.png(square)


def run(root):
    # A pre-role database must continue to open before the first motion request.
    with closing(sqlite3.connect(root / "stickers.sqlite3")) as old, old:
        old.execute("CREATE TABLE stickers (id TEXT PRIMARY KEY, name TEXT, width INTEGER, height INTEGER, draw_width REAL, draw_height REAL, png BLOB)")
    assert service.get(BASE)["motionImport"] and not service.get(BASE)["motionAI"]
    prepared = service.get(BASE+"/watercolor-studio")["stickers"]
    stall, table, chair, artist = [s["id"] for s in prepared]
    built = service.get(f"{BASE}/{artist}/motions")
    assert len(built["motions"]) == 1
    record = built["motions"][0]
    assert record["ready"] and record["source"] == "sample" and record["targets"] == [stall,table,chair]
    original = service.get(record["image"])
    assert original == (SAMPLE/"motion.png").read_bytes()
    with Image.open(BytesIO(original)) as sheet:
        assert sheet.size == (896,896)
        square = {action:square_row(sheet, i) for i,action in enumerate(motion.ACTIONS)}
        sheet = sheet.convert("RGBA")
    customer = service.post(BASE, {"kind":"interactive","role":"customer","theme":"我的水彩画室",
                        "name":"工坊实测来客","data":data((SAMPLE/"customer.png").read_bytes())})["id"]
    work = {"actor":customer, "target":stall, "theme":"我的水彩画室", "furniture":[table,chair]}
    endpoint = f"{BASE}/{customer}/motions/{stall}"
    imp, gen = BASE+"/motions/import", BASE+"/motions/generate"
    assert service.get(f"{BASE}/{customer}/motions") == {"motions":[]}
    fail(404, service.get, endpoint)
    fail(503, service.post, gen, {**work,"action":"walk"})
    fail(400, service.post, imp, {**work,"target":table})
    fail(400, service.post, imp, {**work,"actor":chair})
    fail(400, service.post, imp, {**work,"furniture":[table,table]})
    fail(400, service.post, imp, {**work,"furniture":[service.get(BASE+"/bookshop")["stickers"][1]["id"]]})
    fail(400, service.post, gen, {**work,"action":"anything"})
    fail(400, service.post, imp, {**work,"data":"data:image/png;base64,broken"})
    missing = sheet.copy()
    missing.paste((0,0,0,0),(224,224,448,448))
    opaque = Image.new("RGB", sheet.size,"white")
    opaque.paste(sheet,mask=sheet.getchannel("A"))
    shifted = sheet.copy()
    pose = sheet.crop((0,0,224,224))
    for x in range(4):
        shifted.paste((0,0,0,0),(x*224,0,(x+1)*224,224))
        shifted.paste(pose,(x*224 + x,0))
    touching = sheet.copy()
    touching.paste((255,255,255,255), (0,26,3,40))
    recolored = sheet.copy()
    for i in range(4):
        silhouette = Image.new("RGBA",pose.size,(100+i*30,80,140,255))
        silhouette.putalpha(pose.getchannel("A"))
        recolored.paste(silhouette,(i*224,0))
    for invalid in (missing, opaque, shifted, recolored, touching, sheet.resize((165,180))):
        fail(400, service.post, imp, {**work,"data":data(motion.png(invalid))})
    fail(404, service.get, endpoint)

    class FakeTransport:
        def __init__(self):
            self.calls, self.action, self.fail_cut = [], "", True

        def __call__(self, path, body, token):
            assert token == "offline-test" and body["response_format"] == "b64_json" and body["image_format"] == "png"
            self.calls.append(path)
            if path == "imageToImage":
                assert body["image_url"].startswith(motion.DATA) and body["strength"] > 0
                reference = base64.b64decode(body["image_url"].split(",")[1])
                with Image.open(BytesIO(reference)) as img:
                    assert img.size == (1024,1024) and img.convert("RGB").getpixel((0,0)) != img.convert("RGB").getpixel((256,256))
                names = ("Walk up without","At the serving counter","Use a small craft piece","Walk away holding")
                self.action = next(key for key,needle in zip(motion.ACTIONS,names) if needle in body["prompt"])
                assert work["theme"] in body["prompt"]
                return {"data":[{"b64_json":base64.b64encode(square[self.action]).decode()}]}
            assert path == "removeBackground"
            if self.action == "receive" and self.fail_cut:
                self.fail_cut = False
                raise service.StickerError(502,"mock removal temporarily unavailable")
            return {"image":{"b64_json":body["image_url"].split(",")[1]}}

    transport = FakeTransport()
    with patch.object(service,"recraft",side_effect=transport):
        with patch.dict(os.environ,{"RECRAFT_API_TOKEN":"offline-test"}):
            called, resume = threading.Event(), threading.Event()
            def delayed(path, body, token):
                called.set()
                assert resume.wait(10)
                return transport(path,body,token)
            with patch.object(service,"recraft",side_effect=delayed), ThreadPoolExecutor(max_workers=1) as pool:
                request = pool.submit(service.post,gen,{**work,"action":"walk"})
                try:
                    assert called.wait(10)
                    fail(409,service.post,gen,{**work,"action":"walk"})
                finally:
                    resume.set()
                first = request.result()
            assert first["actions"] == ["walk"] and not first["ready"] and first["image"] is None
            fail(502, service.post, gen, {**work,"action":"receive"})
        # Successful rows are reusable even after the key is removed.
        assert service.post(gen,{**work,"action":"walk"}) == first
        assert service.get(endpoint) == first
        fail(404, service.get, endpoint+"/atlas.png")
        assert len(transport.calls) == 4
        with patch.dict(os.environ,{"RECRAFT_API_TOKEN":"offline-test"}):
            for action in ("receive","use","carry"):
                result = service.post(gen, {**work,"action":action})
        assert result["source"] == "recraft" and result["ready"] and result["actions"] == list(motion.ACTIONS)
        assert result["targets"] == [stall,table,chair] and result["profile"] == "studio"
        assert transport.calls.count("imageToImage") == 4 and transport.calls.count("removeBackground") == 5
        assert service.post(gen,{**work,"action":"carry"}) == result
        assert service.get(endpoint) == result
        with Image.open(BytesIO(service.get(result["image"]))) as produced:
            assert produced.mode == "RGBA" and produced.size == (896,896)
            assert all(produced.getchannel("A").crop((0,224*j,896,224*(j+1))).getextrema() == (0,255) for j in range(4))

    # Second destination for the same actor is a second persisted relationship.
    alt = service.post(BASE,{"kind":"interactive","role":"stall","theme":"我的水彩画室",
                        "name":"另一个画棚","data":data((SAMPLE/"stall.png").read_bytes())})["id"]
    other = {**work,"target":alt,"data":data(original)}
    saved = service.post(imp, other)
    assert saved["source"] == "import" and saved["image"] != result["image"]
    assert service.post(imp, other) == saved
    # A rejected replacement cannot damage the previous playable atlas.
    fail(400, service.post, imp, {**other,"data":data(motion.png(shifted))})
    assert service.get(f"{BASE}/{customer}/motions/{alt}") == saved
    assert {m["target"] for m in service.get(f"{BASE}/{customer}/motions")["motions"]} == {stall,alt}
    assert len(service.get(saved["image"])) > 1000
    with patch.object(service,"Image",None):
        assert not service.get(BASE)["motionImport"]
        assert service.post(gen,{**work,"action":"walk"}) == result
        fail(503, service.post, imp, other)
        assert service.get(record["image"]) == original
    print("PASS: sample and 3 partners, 16 real frames, import/rejection, 4 reference edits, resuming an interrupted cut, cache, multiple targets, old database and keyless replay.")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{"TOWN_STICKER_DATA":tmp,"RECRAFT_API_TOKEN":""}):
        run(Path(tmp))

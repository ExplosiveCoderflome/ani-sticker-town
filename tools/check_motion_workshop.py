"""Real workshop browser regression. Requires Pillow, numpy, opencv-python and Node playwright-core/Chromium."""
import base64
from collections import Counter
from contextlib import closing
from functools import partial
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

import serve
import sticker_service as api

HERE = Path(__file__).resolve().parent
SITE = HERE.parent / "play"
FIXTURE = SITE / "media/watercolor-studio"
THEME = "坡顶的水彩工作室"
CLIPS = ("walk", "receive", "use", "carry")
ROLE_NAMES = ("stall", "table", "chair", "customer")
TOKEN = "isolated-test-no-network"


class FixtureTransport:
    """Only the paid HTTP boundary is replaced. All image validation and caching remain real."""

    def __init__(self):
        self.calls = Counter()
        self.images = {role: (FIXTURE / (role + ".png")).read_bytes() for role in ROLE_NAMES}
        with Image.open(FIXTURE / "motion.png") as atlas:
            cell = atlas.width // 4
            for row, action in enumerate(CLIPS):
                grid = Image.new("RGBA", (cell * 2, cell * 2))
                for i in range(4):
                    tile = atlas.crop((i*cell, row*cell, (i+1)*cell, (row+1)*cell))
                    grid.paste(tile, (cell*(i % 2), cell*(i // 2)))
                file = BytesIO()
                grid.save(file, format="PNG")
                self.images[action] = file.getvalue()
        self.encoded = {name:base64.b64encode(blob).decode() for name, blob in self.images.items()}

    def __call__(self, endpoint, params, token):
        assert token == TOKEN and params["response_format"] == "b64_json"
        if endpoint == "removeBackground":
            data = params["image_url"].split(",", 1)[1]
            name = next(key for key, value in self.encoded.items() if value == data)
            self.calls[name, endpoint] += 1
            if name == "use" and self.calls[name, endpoint] == 1:
                raise api.StickerError(502, "回归测试：这次去背服务暂时中断。")
            return {"image":{"b64_json":data}}
        assert THEME in params["prompt"] and params["n"] == 1
        if endpoint == "generations":
            name, = (role for role in ROLE_NAMES if api.role_spec(role,"studio")[2] in params["prompt"])
        else:
            assert endpoint == "imageToImage"
            markers = ("Walk up without", "At the serving counter", "Use ", "Walk away holding")
            name, = (action for action, phrase in zip(CLIPS, markers) if phrase in params["prompt"])
            reference = base64.b64decode(params["image_url"].split(",",1)[1], validate=True)
            with Image.open(BytesIO(reference)) as image:
                assert image.size == (1024, 1024)
        self.calls[name, endpoint] += 1
        return {"data":[{"b64_json":self.encoded[name]}]}


def verify_screen(atlas_bytes, captures):
    # Compare pixels actually displayed in Chromium with the normalized database frames.
    # The four different clips must win independently against the other three and both facings.
    geometry = json.loads((captures / "geometry.json").read_text())
    size = round(224 * geometry["height"] / 192 * geometry["scale"])
    templates = []
    with Image.open(BytesIO(atlas_bytes)) as atlas:
        assert atlas.size == (896,896)
        for row, action in enumerate(CLIPS):
            for col in range(4):
                frame = atlas.crop((col*224,row*224,(col+1)*224,(row+1)*224))
                rgba = np.array(frame.resize((size,size), Image.Resampling.BILINEAR))
                for directed in (rgba, np.fliplr(rgba)):
                    mask = np.uint8(directed[:,:,3] > 235)
                    x,y,w,h = cv2.boundingRect(mask)
                    region = np.ascontiguousarray(directed[y:y+h,x:x+w,:3])
                    mask = mask[y:y+h,x:x+w].copy()
                    gray = cv2.cvtColor(region,cv2.COLOR_RGB2GRAY)
                    templates.append((action,gray,mask,region))
    hits = Counter()
    for shot in sorted(captures.glob("*.png")):
        with Image.open(shot) as image:
            rgb = np.asarray(image.convert("RGB"))
        gray = cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
        scores = dict.fromkeys(CLIPS,float("inf"))
        for action, pattern, mask, region in templates:
            result = cv2.matchTemplate(gray,pattern,cv2.TM_SQDIFF,mask=mask)
            _,_,(x,y),_ = cv2.minMaxLoc(result)
            crop = rgb[y:y+pattern.shape[0],x:x+pattern.shape[1]]
            score = np.abs(crop.astype("int16")-region)[mask!=0].mean()
            scores[action] = min(scores[action],score)
        first,second = sorted(CLIPS,key=scores.get)[:2]
        if scores[first] < 26 and scores[second] - scores[first] > 1.8:
            hits[first] += 1
    print("Chromium canvas frames independently matched by clip:", dict(hits), flush=True)
    assert set(hits) == set(CLIPS), "one or more atlas clips were never visible on the game canvas"


def main():
    transport = FixtureTransport()
    with tempfile.TemporaryDirectory(prefix="sticker-workshop-motion-") as work:
        captures = Path(work) / "capture"
        captures.mkdir()
        environment = {"TOWN_STICKER_DATA":str(Path(work)/"library"),"RECRAFT_API_TOKEN":TOKEN}
        with patch.dict(os.environ,environment), patch.object(api,"recraft",transport):
            class QuietHandler(serve.GameHandler):
                def log_message(self, *args):
                    pass

            with ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=str(SITE))) as server:
                thread = threading.Thread(target=server.serve_forever,daemon=True)
                thread.start()
                try:
                    url = f"http://127.0.0.1:{server.server_port}"
                    subprocess.run(["node",str(HERE/"check_motion_workshop.cjs"),url,str(captures),THEME],
                                   check=True,timeout=200)
                finally:
                    server.shutdown()
                    thread.join(10)
            with closing(api.database()) as db:
                rows = db.execute("SELECT role,png,id FROM stickers").fetchall()
                assert {r["role"] for r in rows} == set(ROLE_NAMES) and len({r["png"] for r in rows}) == len(rows) == 4
                ids = {r["role"]:r["id"] for r in rows}
                job, = db.execute("SELECT * FROM motion_sets")
                assert (job["actor"],job["target"],job["theme"],job["profile"],job["source"],job["owner"]) == (
                    ids["customer"],ids["stall"],THEME,"studio","recraft",None)
                assert json.loads(job["furniture"]) == [ids["table"],ids["chair"]]
                strips = db.execute("SELECT action,strip,reference_result FROM motion_strips").fetchall()
                assert {r["action"] for r in strips} == set(CLIPS) and len({r["strip"] for r in strips}) == 4
                assert all(r["strip"] and r["reference_result"] is None for r in strips)
            expected = Counter({(r,"generations"):1 for r in ROLE_NAMES})
            expected.update({(action,"imageToImage"):1 for action in CLIPS})
            expected.update({(name,"removeBackground"):1 for name in (*ROLE_NAMES,*CLIPS)})
            expected["use","removeBackground"] += 1
            assert transport.calls == expected, (transport.calls,expected)
            print("PASS SQLite + paid boundary: 4 static drawings, 4 motion drawings, 8 successful cutouts, 1 interrupted cutout; no redraw on resume.", flush=True)
            verify_screen(job["atlas"],captures)


if __name__ == "__main__":
    main()

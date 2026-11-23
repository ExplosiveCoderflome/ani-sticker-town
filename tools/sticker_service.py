"""Persistent local sticker library and optional Recraft generation."""
import base64
import binascii
from contextlib import closing
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import struct
import threading
import time
import unicodedata
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zlib

if __package__:
    from . import sticker_motion
else:
    import sticker_motion

try:
    from PIL import Image
except ImportError:
    Image = None


PREFIX = "/api/stickers"
ASSET_ROUTE = re.compile(r"/api/stickers/(gen-[0-9a-f]{32})(/image\.png)?")
MAX_PNG = 4 * 1024 * 1024
MAX_POST = MAX_PNG * 4 // 3 + 8192
GENERATION_LOCK = threading.Lock()
MARKET_DIR = Path(__file__).resolve().parents[1] / "play" / "media" / "night-market"
BOOKSHOP_DIR = MARKET_DIR.parent / "bookshop"
SEASIDE_DIR = MARKET_DIR.parent / "seaside-market"
POSTBOX_ID = "gen-25bfc1d44e685cb1a2bede850ac754bb"
MARKET_ROLES = ("stall", "table", "chair", "customer")
INVALID_TEXT = re.compile(r"[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ud800-\udfff]")
JS_TRIM = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
ROLES = {
    "place": ("小屋", (310, 300), "Draw one empty open-front shop or room shell, with its floor and rear walls together as a single architectural piece. Show a clear empty interior for the player to furnish. Keep furnishings, props and inhabitants outside the picture."),
    "furniture": ("家具", (120, 102), "Invent ONE useful freestanding piece of furniture belonging to this themed room. Draw the entire piece, including its legs and surface, isolated on its own. Keep the view tightly focused on this single furniture item."),
    "resident": ("居民", (48, 84), "Invent ONE human resident who would use this place. Draw a single standing full-body character from head to shoes with expressive clothes that evoke the theme. Give the figure a distinct silhouette and relaxed pose."),
    "stall": ("摊位", (210, 200), "Draw one whole OPEN food-market booth as a playable stall: a canopy, food counter and serving opening form a single coherent object. Leave the customer-facing side clear. Draw the booth alone, with no people, outdoor tables, chairs or pavement."),
    "table": ("摊桌", (90, 75), "Draw ONE small standalone dining TABLE for street-market guests. Give its tabletop a motif from the requested theme. Show an empty top and all legs clearly, isolated without chairs, food stall, customers or floor."),
    "chair": ("餐椅", (48, 58), "Draw ONE standalone empty market dining CHAIR with an unmistakable open seat and backrest. Show the whole silhouette from top to legs in three-quarter view. Keep tables, booths and people outside this object."),
    "customer": ("食客", (48, 85), "Draw ONE full-body human CUSTOMER on foot, in casual clothing that suits the requested market. Give them an eager, hungry expression and an easy-to-read gaze toward a stall. Include only the shopper from head to feet, with no scenery or furniture."),
}

# Ordered so that a book market, flower market or craft market keeps its specialty.
PROFILE_TERMS = {
    "books": ("书店", "书市", "书摊", "书屋", "书房", "书馆", "书籍", "读书", "阅读", "书展", "書店", "書市", "書屋", "閱讀", "book", "library", "reading"),
    "garden": ("花园", "花店", "花市", "花摊", "花圃", "花卉", "园艺", "苗圃", "植物", "温室", "花藝", "花園", "園藝", "garden", "flower", "plant", "botanical", "greenhouse"),
    "studio": ("画室", "画廊", "工坊", "工作室", "手作", "手工艺", "陶艺", "陶瓷", "画坊", "畫室", "工作坊", "陶藝", "studio", "workshop", "pottery", "craft", "atelier"),
    "market": ("夜市", "馄饨", "小吃", "美食", "早市", "餐厅", "食堂", "咖啡", "甜品", "饭馆", "夜攤", "餐廳", "night market", "street food", "diner", "food", "café", "cafe", "coffee", "restaurant"),
    "general": (),
}
PROFILE_COMPONENTS = {
    "books": {
        "stall": ("书摊", "One open-front book kiosk displaying books with varied spines and a low browsing ledge."),
        "table": ("阅览桌", "One freestanding reading desk with an open book, a clear tabletop and visible legs."),
        "chair": ("阅读椅", "One empty reading chair with a supportive back and a worn seat cushion."),
        "customer": ("读者", "One standing full-body reader, carrying a book under one arm and looking toward new titles."),
    },
    "garden": {
        "stall": ("花摊", "One open-front plant stand displaying pots, seedlings and foliage; the front counter is accessible."),
        "table": ("园艺桌", "One standalone potting table, with a trowel and a little soil tray on its wooden work surface."),
        "chair": ("园艺凳", "One empty sturdy garden stool with a broad seat and short wooden legs."),
        "customer": ("园丁", "One standing full-body gardener in a work apron, ready to select a plant for potting."),
    },
    "studio": {
        "stall": ("工艺展摊", "One open-front artisan booth displaying finished crafts made in the requested medium."),
        "table": ("工作台", "One freestanding artisan worktable with one small tool suited to the requested craft."),
        "chair": ("工作凳", "One empty workshop stool, with a solid seat and clearly visible legs."),
        "customer": ("学徒", "One standing full-body craft apprentice, wearing an apron suitable for this particular workshop."),
    },
    "general": {
        "stall": ("陈列摊", "One open-front kiosk displaying objects specific to this theme. Invent the objects from the description."),
        "table": ("活动桌", "One freestanding activity table. Its work surface and materials should suggest what visitors do here."),
        "chair": ("座椅", "One empty freestanding seat appropriate for visitors to the requested place."),
        "customer": ("访客", "One standing full-body visitor with an outfit and a handheld object specific to the requested theme."),
    },
}


def theme_profile(theme):
    text = unicodedata.normalize("NFKC", theme).lower()
    return next((profile for profile, terms in PROFILE_TERMS.items() if any(term in text for term in terms)), "general")


def role_spec(role, profile):
    label, frame, composition = ROLES[role]
    if role in MARKET_ROLES and profile in PROFILE_COMPONENTS:
        label, subject = PROFILE_COMPONENTS[profile][role]
        composition = subject + " Depict this single isolated component, with no extra characters, furniture or scenery."
    return label, frame, composition


class StickerError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def available():
    return bool(os.environ.get("RECRAFT_API_TOKEN", "").strip()) and Image is not None


def database():
    default = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "StickerTown"
    location = Path(os.environ.get("TOWN_STICKER_DATA") or default)
    location.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(location / "stickers.sqlite3", timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("""CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        draw_width REAL NOT NULL, draw_height REAL NOT NULL, png BLOB NOT NULL, role TEXT, profile TEXT
    )""")
    columns = {row["name"] for row in db.execute("PRAGMA table_info(stickers)")}
    if not {"role", "profile"}.issubset(columns):
        with db:
            db.execute("BEGIN IMMEDIATE")
            columns = {row["name"] for row in db.execute("PRAGMA table_info(stickers)")}
            for column in ("role", "profile"):
                if column not in columns:
                    db.execute(f"ALTER TABLE stickers ADD COLUMN {column} TEXT")
    db.execute("""CREATE TABLE IF NOT EXISTS theme_jobs (
        request_key TEXT PRIMARY KEY, sticker_id TEXT, started REAL NOT NULL DEFAULT 0
    )""")
    sticker_motion.schema(db)
    return db


def metadata(row):
    profile = row["profile"]
    if not profile and row["role"] in MARKET_ROLES:
        profile = theme_profile(row["name"].partition("·")[0])
    return {
        "id": row["id"], "name": row["name"], "width": row["width"], "height": row["height"],
        "size": [row["draw_width"], row["draw_height"]], "image": f'{PREFIX}/{row["id"]}/image.png',
        "role": row["role"], "profile": profile,
    }


FIELDS = "id, name, width, height, draw_width, draw_height, role, profile"


def read_kit(root, profile):
    root = root.resolve()
    try:
        contents = json.loads((root / "kit.json").read_text(encoding="utf-8-sig"))
        theme = display_name(contents["theme"], 80)
        rows = contents["stickers"]
        by_role, ids, filenames = {}, set(), set()
        if not isinstance(rows, list) or len(rows) != len(MARKET_ROLES):
            raise ValueError("wrong number of market assets")
        for item in rows:
            role, asset_id, filename = item["role"], item["id"], item["file"]
            if (role not in MARKET_ROLES or role in by_role or asset_id in ids or filename in filenames
                    or not re.fullmatch(r"gen-[0-9a-f]{32}", asset_id)
                    or not re.fullmatch(r"[a-zA-Z0-9_-]{1,96}\.png", filename)):
                raise ValueError("invalid market asset")
            path = (root / filename).resolve()
            size = item["size"]
            if (path.parent != root or not path.is_file() or path.stat().st_size > MAX_PNG
                    or not isinstance(size, list) or len(size) != 2
                    or not all(type(n) in (int,float) and math.isfinite(n) and 1 <= n <= maximum
                               for n, maximum in zip(size, (864,900)))):
                raise ValueError("invalid market image")
            with path.open("rb") as image:
                header = image.read(24)
            if header[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
                raise ValueError("invalid market PNG")
            width, height = struct.unpack(">II", header[16:])
            if ((width, height) != (item["width"], item["height"])
                    or not (1 <= width <= 2048 and 1 <= height <= 2048)):
                raise ValueError("invalid market dimensions")
            meta = {"id":asset_id, "role":role, "profile":profile, "name":display_name(item["name"],40), "size":size,
                    "width":width, "height":height, "image":f"{PREFIX}/{asset_id}/image.png"}
            by_role[role] = (meta, path)
            ids.add(asset_id)
            filenames.add(filename)
        return theme, [by_role[role] for role in MARKET_ROLES]
    except (OSError, ValueError, TypeError, KeyError, struct.error, StickerError) as exc:
        raise StickerError(503, "样盒的素材不齐，请使用完整的试玩包。") from exc


def get(path):
    postbox_path = f"{PREFIX}/{POSTBOX_ID}"
    if path in (PREFIX + "/story-keepsake", postbox_path, postbox_path + "/image.png"):
        art = MARKET_DIR.parent / "story" / "postbox.png"
        if not art.is_file():
            raise StickerError(503, "礼物贴纸暂未装好，请使用完整的试玩包。")
        if path.endswith("/image.png"):
            return art.read_bytes()
        with art.open("rb") as picture:
            width, height = struct.unpack(">II", picture.read(24)[16:])
        scale = min(76 / width, 104 / height)
        return {"id":POSTBOX_ID, "name":"街角蓝邮筒", "width":width, "height":height,
                "size":[round(width*scale,2),round(height*scale,2)], "role":None, "profile":None,
                "image":postbox_path + "/image.png"}
    motion = sticker_motion.ROUTE.fullmatch(path)
    if motion:
        return sticker_motion.get(*motion.groups())
    kits = {"night-market": (MARKET_DIR, "market"), "bookshop": (BOOKSHOP_DIR, "books"),
            "seaside-market": (SEASIDE_DIR, "market"), "watercolor-studio": (MARKET_DIR.parent / "watercolor-studio", "studio")}
    if path == PREFIX + "/profiles":
        return {"fallback":"general", "profiles":[
            {"id":profile, "terms":list(terms), "labels":{role:role_spec(role, profile)[0] for role in MARKET_ROLES}}
            for profile, terms in PROFILE_TERMS.items()]}
    name = path.removeprefix(PREFIX + "/")
    if name in kits:
        directory, profile = kits[name]
        theme, assets = read_kit(directory, profile)
        return {"theme":theme, "profile":profile, "stickers":[meta for meta, _ in assets]}
    if path == PREFIX:
        with closing(database()) as db:
            rows = db.execute(f"SELECT {FIELDS} FROM stickers ORDER BY rowid DESC")
            return {"ai": available(), "interactiveImport": True, "motionAI":available(), "motionImport":Image is not None,
                    "stickers": [metadata(row) for row in rows]}
    match = ASSET_ROUTE.fullmatch(path)
    if match:
        field = "png" if match[2] else FIELDS
        with closing(database()) as db:
            row = db.execute(f"SELECT {field} FROM stickers WHERE id = ?", (match[1],)).fetchone()
        if row:
            return bytes(row["png"]) if match[2] else metadata(row)
        for directory, profile in kits.values():
            if not (directory / "kit.json").is_file():
                continue
            try:
                _, assets = read_kit(directory, profile)
            except StickerError:
                continue  # A damaged sample must not block assets from another sample.
            for meta, file in assets:
                if meta["id"] == match[1]:
                    return file.read_bytes() if match[2] else meta
    raise StickerError(404, "这张贴纸未保存在当前小镇。")


def display_name(value, limit):
    if isinstance(value, str):
        value = unicodedata.normalize("NFC", value).strip(JS_TRIM)
    if not isinstance(value, str) or not value or len(value) > limit:
        raise StickerError(400, f"请填写 1 至 {limit} 个字。")
    if INVALID_TEXT.search(value):
        raise StickerError(400, "文字中含有无效字符。")
    return value


def decode_base64(text, limit):
    if not isinstance(text, str) or not text or len(text) > math.ceil(limit / 3) * 4:
        raise ValueError("invalid image length")
    blob = base64.b64decode(text, validate=True)
    if len(blob) > limit:
        raise ValueError("oversized image")
    return blob


def has_cutout(decoded, width, height, channels):
    # All-zero and all-255 alpha images have known bytes under every PNG filter.
    # Test those two cases directly, without a second full-size RGBA image or Pillow.
    stride = width * channels + 1
    if max(decoded[::stride]) > 4:
        return False
    visible = transparent = False
    for y in range(height):
        start = y * stride
        method = decoded[start]
        alpha = decoded[start + channels:start + stride:channels]
        visible |= bool(alpha.strip(b"\x00"))
        if method == 0 or (method == 2 and y == 0):
            transparent |= bool(alpha.strip(b"\xff"))
        elif method == 3:
            first, rest = (255, 128) if y == 0 else (128, 0)
            transparent |= alpha[0] != first or bool(alpha[1:].strip(bytes([rest])))
        elif method in (1, 2, 4):
            first = 255 if method == 1 or y == 0 else 0
            transparent |= alpha[0] != first or bool(alpha[1:].strip(b"\x00"))
        if visible and transparent:
            return True
    return False


def png_size(blob, cutout=False):
    # Canvas signs are noninterlaced PNGs. Bound decompression and check chunk CRCs before storing.
    if not blob.startswith(b"\x89PNG\r\n\x1a\n") or len(blob) > MAX_PNG:
        raise ValueError("invalid PNG")
    position = 8
    image_data = bytearray()
    expected_size = 0
    while position + 12 <= len(blob):
        n, tag = struct.unpack_from(">I4s", blob, position)
        end = position + 12 + n
        if end > len(blob):
            break
        chunk = blob[position + 8:end - 4]
        checksum = struct.unpack_from(">I", blob, end - 4)[0]
        if zlib.crc32(tag + chunk) != checksum:
            break
        if tag == b"IHDR" and position == 8 and n == 13:
            width, height, depth, color, compression, filters, interlace = struct.unpack(">2I5B", chunk)
            channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
            if not (channels and 0 < width <= 2048 and 0 < height <= 2048 and depth in (1, 2, 4, 8)
                    and (depth == 8 or color in (0, 3)) and (compression, filters, interlace) == (0, 0, 0)):
                break
            expected_size = ((width * channels * depth + 7) // 8 + 1) * height
        elif not expected_size or tag == b"IHDR":
            break
        elif tag == b"IDAT":
            image_data.extend(chunk)
        elif tag == b"IEND":
            if end != len(blob) or n:
                break
            stream = zlib.decompressobj()
            decoded = stream.decompress(image_data, expected_size + 1)
            if stream.eof and not stream.unused_data and len(decoded) == expected_size:
                if cutout and not (color in (4, 6) and depth == 8 and has_cutout(decoded, width, height, channels)):
                    raise ValueError("no visible transparent cutout")
                return width, height
            break
        position = end
    raise ValueError("invalid PNG")


def save(name, png, frame, request_key=None, role=None, profile=None, cutout=False):
    width, height = png_size(png, cutout)
    scale = min(frame[0] / width, frame[1] / height)
    size = [max(1, round(d * scale, 2)) for d in (width, height)]
    # A repeated save of an identical named sticker should keep its shared identifier.
    stamp = bytes(frame) if max(frame) < 256 else struct.pack(">HH", *frame)
    if role:
        stamp += b"\0" + role.encode("ascii")
    if profile:
        stamp += b"\0" + profile.encode("ascii")
    digest = hashlib.sha256(name.encode() + b"\0" + png + stamp).hexdigest()[:32]
    sticker_id = "gen-" + digest
    with closing(database()) as db, db:
        db.execute("INSERT OR IGNORE INTO stickers (id,name,width,height,draw_width,draw_height,png,role,profile)"
                   " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (sticker_id, name, width, height, *size, png, role, profile))
        if request_key:
            db.execute("UPDATE theme_jobs SET sticker_id=?, started=0 WHERE request_key=?",
                       (sticker_id, request_key))
        row = db.execute(f"SELECT {FIELDS} FROM stickers WHERE id = ?", (sticker_id,)).fetchone()
    return metadata(row)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def recraft(endpoint, payload, token):
    request = Request("https://external.api.recraft.ai/v1/images/" + endpoint,
                      data=json.dumps(payload).encode(), method="POST",
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with build_opener(NoRedirect).open(request, timeout=90) as response:
            body = response.read(16 * 1024 * 1024 + 1)
        if len(body) > 16 * 1024 * 1024:
            raise ValueError("response too large")
        return json.loads(body)
    except (URLError, OSError, ValueError) as exc:
        raise StickerError(502, "绘图服务暂未返回可用图片，请稍后重试。") from exc


def cached_theme(db, key):
    row = db.execute(f"SELECT {FIELDS} FROM stickers JOIN theme_jobs ON stickers.id=theme_jobs.sticker_id "
                     "WHERE theme_jobs.request_key=?", (key,)).fetchone()
    return metadata(row) if row else None


def claim_theme(key):
    # One local database may be shared by multiple service processes. A crashed worker's lease expires.
    with closing(database()) as db, db:
        db.execute("INSERT OR IGNORE INTO theme_jobs (request_key) VALUES (?)", (key,))
        previous = cached_theme(db, key)
        if previous:
            return previous
        now = time.time()
        changed = db.execute("UPDATE theme_jobs SET started=? WHERE request_key=? AND sticker_id IS NULL AND started<?",
                             (now, key, now - 300)).rowcount
        if not changed:
            raise StickerError(409, "这件主题贴纸正在绘制，请稍候再试。")
    return None


def generate(prompt, role=None, edition=None, profile=None):
    request_key = None
    name, frame = prompt[:40], (145, 145)
    subject = "Single isolated subject: " + prompt
    if role:
        inferred = theme_profile(prompt) if role in MARKET_ROLES else None
        profile = profile or inferred
        label, frame, composition = role_spec(role, profile)
        name = prompt[:10] + "·" + label
        subject = composition + " Use this theme as inspiration: " + prompt
        cache_label = "theme-v1\0" + role + "\0" + prompt
        if profile != inferred:
            cache_label += "\0profile:" + profile
        if edition:
            cache_label += "\0edition:" + edition
        request_key = hashlib.sha256(cache_label.encode()).hexdigest()
        with closing(database()) as db:
            previous = cached_theme(db, request_key)
        if previous:
            return previous
    if not available():
        raise StickerError(503, "这座小镇尚未配置 AI 绘图服务。")
    if not GENERATION_LOCK.acquire(blocking=False):
        raise StickerError(409, "正在制作上一张贴纸，请稍候。")
    claimed = False
    try:
        if request_key:
            previous = claim_theme(request_key)
            if previous:
                return previous
            claimed = True
        token = os.environ["RECRAFT_API_TOKEN"].strip()
        options = {"response_format": "b64_json", "image_format": "png"}
        description = ("A single whole small-town sticker object, hand-painted cozy stationery, "
                       "three-quarter isometric view, warm muted natural colors and fine ink outlines. "
                       "Center the isolated subject on an even plain backdrop with clear margins. " + subject)
        generated = recraft("generations", {**options, "model": "recraftv4_1", "prompt": description,
                                           "n": 1, "size": "1024x1024"}, token)
        encoded = generated["data"][0]["b64_json"]
        decode_base64(encoded, 9 * 1024 * 1024)
        cut = recraft("removeBackground", {**options, "image_url": "data:image/png;base64," + encoded}, token)
        binary = decode_base64(cut["image"]["b64_json"], 9 * 1024 * 1024)
        with Image.open(BytesIO(binary), formats=["PNG"]) as source:
            if max(source.size) > 2048:
                raise ValueError("unexpected resolution")
            image = source.convert("RGBA")
        alpha = image.getchannel("A")
        bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
        if not bbox or alpha.getextrema()[0] == 255:
            raise ValueError("background was not removed")
        image = image.crop(bbox)
        image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="PNG")
        return save(name, output.getvalue(), frame, request_key, role, profile)
    except (KeyError, TypeError, IndexError, ValueError, OSError) as exc:
        raise StickerError(502, "生成图的透明边缘或格式不合适，请换个描述再试。") from exc
    finally:
        try:
            if claimed:
                with closing(database()) as db, db:
                    db.execute("UPDATE theme_jobs SET started=0 WHERE request_key=? AND sticker_id IS NULL",
                               (request_key,))
        finally:
            GENERATION_LOCK.release()


def requested_profile(body, role):
    profile = body.get("profile")
    if profile is not None and (role not in MARKET_ROLES or not isinstance(profile, str) or profile not in PROFILE_TERMS):
        raise StickerError(400, "请选择已有的互动主题类型。")
    return profile


def post(path, body):
    if not isinstance(body, dict):
        raise StickerError(400, "请求需要包含贴纸资料。")
    if path in (PREFIX + "/motions/generate", PREFIX + "/motions/import"):
        return sticker_motion.post(body, generate=path.endswith("/generate"))
    if path == PREFIX + "/generate":
        if "theme" in body or "role" in body:
            role = body.get("role")
            if "prompt" in body or not isinstance(role, str) or role not in ROLES:
                raise StickerError(400, "请选择主题套组中的一种物件。")
            edition = body.get("edition")
            if edition is not None and (role not in MARKET_ROLES or not isinstance(edition, str)
                                        or not re.fullmatch(r"[0-9a-f]{32}", edition)):
                raise StickerError(400, "这次重新绘制的编号无效。")
            return generate(display_name(body.get("theme"), 240), role, edition, requested_profile(body, role))
        return generate(display_name(body.get("prompt"), 240))
    if path != PREFIX:
        raise StickerError(404, "找不到这个贴纸入口。")
    role = profile = None
    if body.get("kind") == "interactive":
        role = body.get("role")
        if role not in MARKET_ROLES:
            raise StickerError(400, "请选择摊位、桌、椅或来访角色。")
        theme = display_name(body.get("theme"), 240)
        profile = requested_profile(body, role) or theme_profile(theme)
        label, frame, _ = role_spec(role, profile)
        name = display_name(body.get("name", theme[:10] + "·" + label), 40)
    elif body.get("kind") == "sign":
        name = display_name(body.get("name"), 40)
        frame = (146, 45)
    else:
        raise StickerError(400, "请选择可保存的贴纸类型。")
    data = body.get("data")
    if not isinstance(data, str) or not data.startswith("data:image/png;base64,"):
        raise StickerError(400, "请提交一张 PNG 贴纸。")
    try:
        return save(name, decode_base64(data.partition(",")[2], MAX_PNG), frame, role=role, profile=profile,
                    cutout=role is not None)
    except (ValueError, binascii.Error, zlib.error, struct.error) as exc:
        if role:
            raise StickerError(400, "请导入有可见物件和透明区域的 PNG（每边最多 2048 像素，文件不超过 4 MiB）。") from exc
        raise StickerError(400, "这张 PNG 无法读取，或超过 2048 像素。") from exc

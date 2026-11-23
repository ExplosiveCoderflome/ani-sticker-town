"""Four-pose strips bound to the owner's character and interaction partners."""
import base64
from contextlib import closing
from io import BytesIO
import json
import os
import re
import struct
import time
import uuid

if __package__:
    from . import sticker_service as api
else:
    import sticker_service as api

ID = r"gen-[0-9a-f]{32}"
ROUTE = re.compile(rf"/api/stickers/({ID})/motions(?:/({ID})(/atlas\.png)?)?")
ACTIONS = ("walk", "receive", "use", "carry")
LABELS = dict(zip(ACTIONS, ("走近", "接取", "坐下使用", "带物离开")))
OBJECTS = {
    "market": ("a small portion of the stall's food", "sit with bent knees, raise the food, taste it, then lower it"),
    "books": ("a closed book", "sit with bent knees, open the book, lift one page, turn it, then smooth it down"),
    "garden": ("a tiny potted plant", "sit with bent knees, cup the pot, loosen the soil, tuck in a seedling, then pat it down"),
    "studio": ("a small craft piece and suitable handheld tool", "sit with bent knees and actively make the work in the theme: prepare, start a stroke, finish it, then inspect the result"),
    "general": ("one small object from this theme", "sit with bent knees, examine, handle and use the object across four distinct hand poses"),
}
CELL = 224
DATA = "data:image/png;base64,"
RESULT_OPTIONS = {"image_format":"png","response_format":"b64_json"}


def schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS motion_sets (
        actor TEXT NOT NULL, target TEXT NOT NULL, theme TEXT NOT NULL, profile TEXT NOT NULL,
        furniture TEXT NOT NULL, source TEXT NOT NULL, atlas BLOB, owner TEXT, started REAL,
        PRIMARY KEY(actor,target))""")
    db.execute("""CREATE TABLE IF NOT EXISTS motion_strips (
        actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, strip BLOB, reference_result BLOB,
        PRIMARY KEY(actor,target,action))""")


def metadata(actor, target, theme, profile, furniture, source, actions):
    done = [action for action in ACTIONS if action in actions]
    ready = len(done) == len(ACTIONS)
    return {"id":actor, "actor":actor, "target":target, "targets":[target, *furniture], "theme":theme,
            "profile":profile, "source":source, "actions":done, "ready":ready, "grid":[4, 4],
            "image":f"{api.PREFIX}/{actor}/motions/{target}/atlas.png" if ready else None}


def sample(actor, target):
    directory = api.MARKET_DIR.parent / "watercolor-studio"
    file = directory / "motion.png"
    if not file.is_file() or not (directory / "kit.json").is_file():
        return None
    try:
        # A damaged preinstalled sample must never block a player's own library.
        theme, kit = api.read_kit(directory, "studio")
    except api.StickerError:
        return None
    stall, table, chair, customer = (item["id"] for item, _ in kit)
    if actor != customer or target not in (None, stall):
        return None
    with file.open("rb") as picture:
        header = picture.read(24)
    if (len(header) != 24 or header[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
            or struct.unpack(">II",header[16:24]) != (CELL*4,CELL*4) or file.stat().st_size > api.MAX_PNG):
        raise api.StickerError(503,"画室动作图集不完整，请使用完整的试玩包。")
    return metadata(actor, stall, theme, "studio", [table, chair], "sample", ACTIONS), file


def db_metadata(db, row):
    pair = (row["actor"], row["target"])
    actions = ACTIONS if row["ready"] else [
        r[0] for r in db.execute("SELECT action FROM motion_strips WHERE actor=? AND target=? AND strip IS NOT NULL", pair)]
    return metadata(*pair, row["theme"], row["profile"], json.loads(row["furniture"]), row["source"], actions)


def get(actor, target, image):
    with closing(api.database()) as db:
        query = "SELECT actor,target,theme,profile,furniture,source,atlas IS NOT NULL AS ready FROM motion_sets WHERE actor=?"
        if target:
            row = db.execute(query + " AND target=?", (actor, target)).fetchone()
            if row:
                if not image:
                    return db_metadata(db, row)
                if row["ready"]:
                    return db.execute("SELECT atlas FROM motion_sets WHERE actor=? AND target=?", (actor,target)).fetchone()[0]
                raise api.StickerError(404, "四组动作收齐后就可以取回图集。")
        else:
            items = [db_metadata(db, row) for row in db.execute(query + " ORDER BY target", (actor,))]
    built_in = sample(actor, target)
    if not target:
        if built_in and not any(item["target"] == built_in[0]["target"] for item in items):
            items.append(built_in[0])
        return {"motions":items}
    if built_in:
        return built_in[1].read_bytes() if image else built_in[0]
    raise api.StickerError(404, "还没有为这位角色和这个摊位制作动作。")


def png(image):
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def strip_images(blob, cols, actions):
    """Validate isolated figures + meaningful in-place changes, then align their ground points."""
    from PIL import Image, ImageChops, ImageStat
    rows = len(actions) * 4 // cols
    try:
        image = Image.open(BytesIO(blob), formats=["PNG"])
        width, height = image.size
        if not (32*cols <= width <= 2048 and 32*rows <= height <= 2048 and width % cols == height % rows == 0):
            raise ValueError("PNG 需要等大的帧格，每格最少 32×32，整图每边最多 2048 像素")
        if "A" not in image.getbands() and "transparency" not in image.info:
            raise ValueError("PNG 需要透明背景")
        image = image.convert("RGBA")
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("无法读取动作 PNG") from exc
    w, h = width // cols, height // rows
    strips = {}
    for i, action in enumerate(actions):
        frames, signatures = [], []
        for f in range(4):
            x = ((i*4 + f) % cols)*w
            y = ((i*4 + f) // cols)*h
            cell = image.crop((x, y, x+w, y+h))
            alpha = cell.getchannel("A")
            bounds = alpha.point(lambda a: 255 if a >= 32 else 0).getbbox()
            hist = alpha.histogram()
            if not bounds or sum(hist[:12]) < .06*w*h or sum(hist[128:]) < max(60,.01*w*h):
                raise ValueError(f"「{LABELS[action]}」第 {f+1} 格需要同时包含清楚的人物和真实透明留白")
            left, top, right, bottom = bounds
            if min(left, top, w-right, h-bottom) < 1:
                raise ValueError(f"「{LABELS[action]}」第 {f+1} 格碰到边缘，请给整个人物留出透明边距")
            if right-left < 5 or bottom-top < 12:
                raise ValueError(f"「{LABELS[action]}」第 {f+1} 格的人物太小")
            frame = cell.crop(bounds)
            frames.append(frame)
            # Ignore blank margins, whole-frame translation and hidden RGB. Page turns can
            # change an interior detail while preserving the same outer silhouette.
            sig = frame.resize((48,64), Image.Resampling.BILINEAR)
            mask = sig.getchannel("A")
            visible = mask.point(lambda a: 255 if a>64 else 0)
            if not visible.getbbox():
                raise ValueError(f"「{LABELS[action]}」第 {f+1} 格需要清楚可辨的人物")
            # A color-cycling sticker is still the same pose. Normalize the average
            # color of its visible pixels; details such as a turning page survive.
            bands = []
            for channel in sig.convert("RGB").split():
                mean = round(ImageStat.Stat(channel, mask=visible).mean[0])
                bands.append(channel.point(lambda c: min(255,max(0,c-mean+128))))
            matte = Image.new("RGB", sig.size, "#808080")
            matte.paste(Image.merge("RGB",bands), mask=mask)
            if all(ImageStat.Stat(ImageChops.difference(mask, old_mask)).mean[0] > 3 or
                   sum(ImageStat.Stat(ImageChops.difference(matte, old_color)).mean)/3 > 2.6
                   for old_mask, old_color in signatures):
                signatures.append((mask,matte))
        if len(signatures) < 3:
            raise ValueError(f"「{LABELS[action]}」需要至少三个可区分的姿势，平移同一张立绘无法形成动作")
        strip = Image.new("RGBA", (CELL*4, CELL))
        max_height = 158 if action == "use" else 192
        scale = min(max_height / max(frame.height for frame in frames), 208 / max(frame.width for frame in frames))
        for f, frame in enumerate(frames):
            frame = frame.resize((max(1,round(frame.width*scale)), max(1,round(frame.height*scale))), Image.Resampling.LANCZOS)
            strip.paste(frame, (CELL*f+(CELL-frame.width)//2, 218-frame.height))
        strips[action] = png(strip)
    if len(set(strips.values())) != len(strips):
        raise ValueError("多个动作行完全相同，请按行分别绘制走近、接取、坐下使用和带物离开")
    return strips


def assemble(strips):
    atlas = api.Image.new("RGBA", (CELL*4, CELL*4))
    for i, action in enumerate(ACTIONS):
        with api.Image.open(BytesIO(strips[action])) as image:
            atlas.paste(image, (0, i*CELL))
    return png(atlas)


def reference(actor):
    src = api.get(f"{api.PREFIX}/{actor}/image.png")
    with api.Image.open(BytesIO(src)) as image:
        pic = image.convert("RGBA")
    pic = pic.crop(pic.getchannel("A").getbbox() or (0,0,*pic.size))
    scale = min(365/pic.width,440/pic.height)
    pic = pic.resize((max(1,round(pic.width*scale)),max(1,round(pic.height*scale))),api.Image.Resampling.LANCZOS)
    grid = api.Image.new("RGB", (1024,1024), "#e3e0db")
    for x,y in ((0,0),(512,0),(0,512),(512,512)):
        grid.paste(pic, (x+(512-pic.width)//2, y+482-pic.height), mask=pic.getchannel("A"))
    return DATA + base64.b64encode(png(grid)).decode("ascii")


def provider_prompt(theme, profile, target_name, action):
    prop, use = OBJECTS[profile]
    directions = {
        "walk":"Walk up without the new item: left foot contact, passing raised knee, right contact, opposite raised knee. Alternate arms.",
        "receive":f"At the serving counter wait, extend empty palms, receive {prop}, draw it to chest. The prop appears in pose three.",
        "use":f"Use {prop}: {use}. Draw the seated anatomy floating without the chair, table or stall.",
        "carry":f"Walk away holding {prop} securely: left contact, passing raised knee, right contact, opposite raised knee.",
    }
    return ("Edit the same reference character in each of the FOUR equal cells of this 2x2 sprite sheet. "
            "Keep identity, head, hair, clothes, palette and drawing style consistent. Four distinct sequential "
            "full-body poses, facing LEFT, in reading order. Same proportions and ground line, ample empty margin "
            "on all sides of every pose. Plain solid background. No panel lines, labels, shadows, scenery or other people. "
            + directions[action] + f" The character's destination is {target_name}. Theme from player: {theme}.")


def partners(body):
    actor, target = body.get("actor"), body.get("target")
    friends = body.get("furniture", [])
    if (not isinstance(friends,list) or len(friends) > 2 or
            any(not isinstance(s,str) or not re.fullmatch(ID,s) for s in [actor,target,*friends])):
        raise api.StickerError(400, "请选择一名来客、一个互动摊位，以及同套的桌椅。")
    character, stall, *furniture = (api.get(f"{api.PREFIX}/{key}") for key in [actor,target,*friends])
    roles = [s["role"] for s in furniture]
    if (character["role"] != "customer" or stall["role"] != "stall" or character["profile"] not in OBJECTS
            or len(set(roles)) != len(roles) or any(role not in ("table","chair") for role in roles)
            or any(s["profile"] != character["profile"] for s in [stall,*furniture])):
        raise api.StickerError(400, "来客、摊位和桌椅需要来自相同类型的互动主题。")
    return (actor,target), stall, sorted(furniture, key=lambda item: item["role"] != "table")


def claim(db, pair, theme, profile, friends, source, action):
    db.execute("BEGIN IMMEDIATE")
    old = db.execute("SELECT * FROM motion_sets WHERE actor=? AND target=?", pair).fetchone()
    if old:
        prior = json.loads(old["furniture"])
        if friends and prior and friends != prior:
            raise api.StickerError(409, "这组角色和摊位已有配套桌椅，请使用原来的一组。")
        if not prior and friends:
            db.execute("UPDATE motion_sets SET furniture=? WHERE actor=? AND target=?", (json.dumps(friends),*pair))
        if action and (old["atlas"] or db.execute(
                "SELECT 1 FROM motion_strips WHERE actor=? AND target=? AND action=? AND strip IS NOT NULL", (*pair,action)).fetchone()):
            return None
        if old["owner"] and old["started"] >= time.time()-300:
            raise api.StickerError(409, "这套动作正在制作，请稍后查看已完成的组。")
    if action and not api.available():
        raise api.StickerError(503, "在线绘制需要在本机配置 Recraft 和 Pillow，也可以直接导入透明动作图。")
    owner = uuid.uuid4().hex
    db.execute("""INSERT INTO motion_sets (actor,target,theme,profile,furniture,source,owner,started)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(actor,target) DO UPDATE SET owner=excluded.owner,started=excluded.started""",
        (*pair, theme, profile, json.dumps(friends), source, owner, time.time()))
    return owner


def generated_strip(db, pair, owner, theme, stall, action):
    token = os.environ.get("RECRAFT_API_TOKEN","").strip()
    cached = db.execute("SELECT reference_result FROM motion_strips WHERE actor=? AND target=? AND action=?", (*pair,action)).fetchone()
    edited = cached[0] if cached else None
    if edited is None:
        result = api.recraft("imageToImage", {**RESULT_OPTIONS, "model":"recraftv4_1", "n":1, "strength":0.53,
            "image_url":reference(pair[0]), "prompt":provider_prompt(theme, stall["profile"], stall["name"], action)}, token)
        edited = api.decode_base64(result["data"][0]["b64_json"], 9*1024*1024)
        with db:
            assert_owned(db, pair, owner)
            db.execute("""INSERT INTO motion_strips (actor,target,action,reference_result) VALUES (?,?,?,?)
                ON CONFLICT(actor,target,action) DO UPDATE SET reference_result=excluded.reference_result""", (*pair,action,edited))
    # Retain the paid edit across removal-service failures. An unusable completed
    # cutout, however, needs a new reference generation on an explicit retry.
    result = api.recraft("removeBackground", {**RESULT_OPTIONS, "image_url":DATA+base64.b64encode(edited).decode("ascii")}, token)
    try:
        cut = api.decode_base64(result["image"]["b64_json"], 9*1024*1024)
        return strip_images(cut, 2, [action])[action]
    except (ValueError, OSError, KeyError, IndexError, TypeError):
        with db:
            assert_owned(db, pair, owner)
            db.execute("UPDATE motion_strips SET reference_result=NULL WHERE actor=? AND target=? AND action=?", (*pair,action))
        raise


def assert_owned(db, pair, owner):
    db.execute("BEGIN IMMEDIATE")
    if not db.execute("SELECT 1 FROM motion_sets WHERE actor=? AND target=? AND owner=?", (*pair,owner)).fetchone():
        raise api.StickerError(409, "另一个请求已在更新这套动作，请刷新进度。")


def post(body, generate):
    pair, stall, furniture = partners(body)
    friends = [item["id"] for item in furniture]
    theme = api.display_name(body.get("theme"), 240)
    action = body.get("action") if generate else None
    if generate and action not in ACTIONS:
        raise api.StickerError(400, "请选择走近、接取、坐下使用或带物离开。")
    builtin = sample(*pair)
    if builtin and generate:
        return get(*pair,None)
    if not generate and api.Image is None:
        raise api.StickerError(503, "请在本机服务安装 Pillow 后导入动作图集。")
    if generate and api.Image is None:
        try:
            current = get(*pair,None)
        except api.StickerError as exc:
            if exc.status != 404:
                raise
        else:
            if action in current["actions"]:
                return current
        raise api.StickerError(503, "在线绘制需要在本机安装 Pillow。")
    strips = None
    if not generate:
        data = body.get("data")
        if not isinstance(data,str) or not data.startswith(DATA):
            raise api.StickerError(400, "请提交一张透明的四行四列 PNG。")
        try:
            strips = strip_images(api.decode_base64(data[len(DATA):], api.MAX_PNG), 4, ACTIONS)
        except (ValueError,OSError) as exc:
            raise api.StickerError(400, "无法导入动作图集：" + str(exc)) from exc
    source = "recraft" if generate else "import"
    with closing(api.database()) as db:
        with db:
            owner = claim(db,pair,theme,stall["profile"],friends,source,action)
        if owner:
            try:
                if generate:
                    strips = {action:generated_strip(db,pair,owner,theme,stall,action)}
                with db:
                    assert_owned(db,pair,owner)
                    for key, value in strips.items():
                        db.execute("""INSERT INTO motion_strips (actor,target,action,strip) VALUES (?,?,?,?)
                            ON CONFLICT(actor,target,action) DO UPDATE SET strip=excluded.strip,reference_result=NULL""", (*pair,key,value))
                    rows = dict(db.execute("SELECT action,strip FROM motion_strips WHERE actor=? AND target=? AND strip IS NOT NULL",pair))
                    if len(set(rows.values())) != len(rows):
                        raise ValueError("多个动作行完全相同，请为每行画出各自的姿态")
                    atlas = assemble(rows) if len(rows) == len(ACTIONS) else None
                    db.execute("UPDATE motion_sets SET source=?,theme=?,atlas=?,owner=NULL,started=NULL WHERE actor=? AND target=?",
                               (source,theme,atlas,*pair))
            except (KeyError,IndexError,TypeError,ValueError,OSError) as exc:
                # An invalid finished strip must be redrawn, not endlessly re-cut.
                if generate:
                    with db:
                        assert_owned(db,pair,owner)
                        db.execute("UPDATE motion_strips SET reference_result=NULL WHERE actor=? AND target=? AND action=?", (*pair,action))
                raise api.StickerError(502 if generate else 400, "动作图尚未通过检查：" + str(exc)) from exc
            finally:
                with db:
                    db.execute("UPDATE motion_sets SET owner=NULL,started=NULL WHERE actor=? AND target=? AND owner=?", (*pair,owner))
    return get(*pair,None)

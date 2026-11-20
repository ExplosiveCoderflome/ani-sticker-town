"""Build the v0.5 local-play ZIP from the published game and its runtime files."""
import argparse
import gzip
import json
import os
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "releases" / "sticker-town-v0.5.zip"
UI_FILES = (
    "game.css", "custom.css", "game.js", "gift.js", "parcel.js", "custom.js",
    "encounters.js", "garden.js", "night-rules.js", "night-market.js",
)
GODOT_FILES = (
    "town.html", "town.js", "town.js.gz", "town.pck", "town.pck.gz",
    "town.wasm", "town.wasm.gz", "town.audio.worklet.js",
    "town.audio.position.worklet.js", "town.png", "town.icon.png",
    "town.apple-touch-icon.png",
)
KIT_FILES = ("kit.json", "stall.png", "table.png", "chair.png", "customer.png")
QUICKSTART = """小镇贴纸簿 v0.5 · 主题工坊

解压整个 ZIP 后再开始。

Windows 安装 Python 3.9 或以上版本及 Python Launcher，然后双击「开始试玩.cmd」。
macOS 或 Linux 在解压目录运行 python3 tools/serve.py --open。
工坊中的「海风夜市」可以直接试玩。开盒后点烤鱿鱼摊旁的空地放下游客。
把凳子挪远，游客会改为外带。换到「雨天的街角书屋」还能请读者来借书。
输入自己的主题，连接 Recraft 后可以逐件绘制。在其他 AI 绘图工具生成透明四格图也可以导入工坊，拆开后每件都能单独用。

「定制贴纸 → 写路牌」可以在本机制作文字路牌。「存明信片」保存 PNG；
「封装成礼物 → 下载可玩的礼物」生成可发送给朋友的独立 HTML。
单独打开 releases/黑猫寄来的周末.html 可以直接拆开一份示例礼物，不需要运行服务。

贴纸库保存在本机，浏览器保留草稿和游戏进度。了解可选的在线绘图设置，请看 README.md。
"""


def release_files():
    paths = {
        "README.md", "开始试玩.cmd", "tools/serve.py", "tools/sticker_service.py",
        "releases/黑猫寄来的周末.html", "releases/黑猫寄来的周末-预览.webp",
        "play/index.html", "play/media/levels.json", "play/media/ground.webp", "play/media/ground-night.webp",
        "play/media/signboard.webp", "play/media/preview-1.webp", "play/media/preview-2.webp",
    }
    paths.update("play/" + name for name in GODOT_FILES)
    paths.update("play/ui/" + name for name in UI_FILES)
    for kit in ("night-market", "bookshop", "seaside-market"):
        paths.update(f"play/media/{kit}/{name}" for name in KIT_FILES)

    # Only the shipped layouts and the built-in cat belong in the release.
    levels = json.loads((ROOT / "play/media/levels.json").read_text(encoding="utf-8"))
    assets = {slot["asset"] for level in levels["levels"] for slot in level["slots"]}
    for asset in assets | {"black-cat"}:
        if not asset.isascii() or not asset.replace("-", "").isalnum() or asset.startswith("gen-"):
            raise ValueError(f"Invalid built-in sticker ID: {asset!r}")
        paths.update(f"play/media/{kind}/{asset}.webp" for kind in ("stickers", "thumbs"))
    for member in sorted(paths):
        source = ROOT / member
        if not source.is_file() or not source.stat().st_size:
            raise FileNotFoundError(f"Missing release file: {member}")
    for name in ("town.js", "town.pck", "town.wasm"):
        source = ROOT / "play" / name
        with gzip.open(str(source) + ".gz", "rb") as compressed, source.open("rb") as raw:
            while True:
                chunk = raw.read(1024 * 1024)
                if compressed.read(len(chunk) or 1) != chunk:
                    raise ValueError(f"{name}.gz does not match {name}; rebuild the Web export")
                if not chunk:
                    break
    return sorted(paths)


def add_entry(archive, name, data):
    info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = ZIP_STORED if name.endswith((".gz", ".png", ".webp")) else ZIP_DEFLATED
    archive.writestr(info, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check inputs without writing an archive")
    args = parser.parse_args()
    members = release_files()
    if args.check:
        print(f"Validated {len(members)} release files and the precompressed Web export.")
        return
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=DESTINATION.parent, prefix=".package-") as staging:
        pending = Path(staging) / DESTINATION.name
        with ZipFile(pending, "w") as archive:
            for member in members:
                add_entry(archive, member, (ROOT / member).read_bytes())
            add_entry(archive, "试玩说明.txt", QUICKSTART.replace("\n", "\r\n").encode("utf-8-sig"))
        with ZipFile(pending) as archive:
            damaged = archive.testzip()
            if damaged:
                raise ValueError(f"Archive verification failed for {damaged}")
        os.replace(pending, DESTINATION)
    print(f"{DESTINATION} ({len(members) + 1} files, {DESTINATION.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

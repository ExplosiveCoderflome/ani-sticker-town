"""Build the local-play ZIP, including a portable Windows x64 runtime."""
import argparse
import gzip
import hashlib
from io import BytesIO
import json
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "releases" / "sticker-town-v0.9.zip"
# Pinned to the published checksums on python.org and PyPI. Each archive includes its licenses.
WINDOWS_ARCHIVES = (
    ("https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip",
     "9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38"),
    ("https://files.pythonhosted.org/packages/d7/ed/1b16fb66a37e1b9e41370b93b2c614c7da761a5b2a41dc333f7af4639962/pillow-13.0.0-cp313-cp313-win_amd64.whl",
     "9dda0788a9932776a75d8bcc020076edc308ce2508b51f6739a45e3158b3fc42"),
)
UI_FILES = (
    "game.css", "custom.css", "game.js", "gift.js", "parcel.js", "custom.js",
    "encounters.js", "garden.js", "night-rules.js", "night-market.js", "story.js", "story.css",
)
GODOT_FILES = (
    "town.html", "town.js", "town.js.gz", "town.pck", "town.pck.gz",
    "town.wasm", "town.wasm.gz", "town.audio.worklet.js",
    "town.audio.position.worklet.js", "town.png", "town.icon.png",
    "town.apple-touch-icon.png",
)
KIT_FILES = ("kit.json", "stall.png", "table.png", "chair.png", "customer.png")
QUICKSTART = """小镇贴纸簿 v0.9 · AI 动作贴纸工坊

解压整个 ZIP 后再开始。

Windows x64 双击「开始试玩.cmd」，下载包已附运行环境。
macOS 或 Linux 使用 Python 3.9 或以上，在解压目录运行 python3 tools/serve.py --open。
从封面点「做一盒动作贴纸」。先试「海边的水彩画室」，把黄帽画师贴在画摊旁。把画摊拖远，将画师放在同盒的桌子或凳子旁，还能单独用家具。
要画自己的主题，在工坊输入主题，勾选角色动作，点「生成整盒与 4 组动作」。在线绘制使用本机服务的 RECRAFT_API_TOKEN。也可复制绘图单，用自己的 AI 工具画一张四格组件图和一张十六格动作图，再导入工坊。
想先玩红贝雷帽读者，可以在封面点「去书屋借书」。从贴纸盘选中读者，点书亭前的空地放下她。让阅读椅靠着阅览桌，她就会坐下翻书。把椅子拖远，她会抱书离开。
在封面拆开「游客的来信」，点烤鱿鱼摊前的空地放下条纹衫游客。看她走过去接烤串，再坐到小凳上吃。把珊瑚色折叠凳拖远，再看她拿着烤串离开。
完成心愿后可以收下回信，集齐三封就能下载小镇的纪念明信片。
同一浏览器、同一本机地址会保存委托与布景进度。从封面也可以直接自由游玩。
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
        "README.md", "开始试玩.cmd", "tools/serve.py", "tools/sticker_service.py", "tools/sticker_motion.py",
        "releases/黑猫寄来的周末.html", "releases/黑猫寄来的周末-预览.webp",
        "play/index.html", "play/media/levels.json", "play/media/ground.webp", "play/media/ground-night.webp",
        "play/media/signboard.webp", "play/media/preview-1.webp", "play/media/preview-2.webp",
    }
    paths.update("play/" + name for name in GODOT_FILES)
    paths.update("play/ui/" + name for name in UI_FILES)
    paths.add("play/media/story/cover.webp")
    paths.add("play/media/story/postbox.png")
    paths.add("docs/releases/release-notes.md")
    paths.add("design/phase-1.md")
    paths.add("play/media/watercolor-studio/motion.png")
    for kit in ("night-market", "bookshop", "seaside-market", "watercolor-studio"):
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


def add_windows_runtime(archive):
    for url, expected in WINDOWS_ARCHIVES:
        cache = Path(tempfile.gettempdir()) / ("sticker-town-" + expected + ".zip")
        blob = cache.read_bytes() if cache.exists() else b""
        if hashlib.sha256(blob).hexdigest() != expected:
            with urlopen(url, timeout=90) as response:
                blob = response.read()
            if hashlib.sha256(blob).hexdigest() != expected:
                raise ValueError("Runtime checksum mismatch: " + url)
            cache.write_bytes(blob)
        with ZipFile(BytesIO(blob)) as upstream:
            for item in upstream.infolist():
                if item.is_dir():
                    continue
                data = upstream.read(item)
                if item.filename == "python313._pth":
                    # The embeddable interpreter uses an explicit import path even for adjacent scripts.
                    data += b"\r\n../tools\r\n"
                add_entry(archive, "runtime/" + item.filename, data)


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
            add_windows_runtime(archive)
            add_entry(archive, "试玩说明.txt", QUICKSTART.replace("\n", "\r\n").encode("utf-8-sig"))
        with ZipFile(pending) as archive:
            count = len(archive.infolist())
            damaged = archive.testzip()
            if damaged:
                raise ValueError(f"Archive verification failed for {damaged}")
        os.replace(pending, DESTINATION)
    print(f"{DESTINATION} ({count} files, {DESTINATION.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

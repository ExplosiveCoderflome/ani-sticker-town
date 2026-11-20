"""Build the sticker game using Godot 4.7.2 Standard and matching Web templates."""
import argparse
import gzip
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.7.2.stable"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", default=os.environ.get("GODOT_BIN") or "godot")
    parser.add_argument("--template", type=Path, help="Optional web_nothreads_release.zip")
    args = parser.parse_args()
    godot = shutil.which(args.godot)
    if not godot:
        parser.error("Pass --godot with the path of the Godot 4.7.2 Standard executable.")
    version = subprocess.check_output([godot, "--headless", "--version"], text=True).strip()
    if not (version == VERSION or version.startswith(VERSION + ".")):
        parser.error(f"Expected {VERSION}, got {version}")

    destination = ROOT / "play"
    destination.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sticker-town-build-") as temporary:
        staging = Path(temporary)
        source = staging / "game"
        shutil.copytree(ROOT / "game", source, ignore=shutil.ignore_patterns(".godot"))
        if args.template:
            template_path = args.template.resolve(strict=True)
            preset = source / "export_presets.cfg"
            preset.write_text(preset.read_text(encoding="utf-8").replace(
                'custom_template/release=""',
                f'custom_template/release="{template_path.as_posix()}"',
            ), encoding="utf-8")
        output = staging / "release"
        output.mkdir()
        command = [godot, "--headless", "--path", str(source)]
        subprocess.run(command + ["--import"], check=True)
        subprocess.run(command + ["--export-release", "Web", str(output / "town.html")], check=True)
        for name in ("town.wasm", "town.pck", "town.js"):
            binary = output / name
            if not binary.is_file() or not binary.stat().st_size:
                raise RuntimeError(f"Godot produced no {name}")
            (output / (name + ".gz")).write_bytes(
                gzip.compress(binary.read_bytes(), compresslevel=6, mtime=0)
            )
        for artifact in output.iterdir():
            pending = destination / (artifact.name + ".building")
            shutil.copyfile(artifact, pending)
            os.replace(pending, destination / artifact.name)
        assets = source / "assets"
        for asset in [*assets.rglob("*.webp"), assets / "levels.json"]:
            media_path = destination / "media" / asset.relative_to(assets)
            media_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset, media_path)
    print(f"Web release ready: {destination}")


if __name__ == "__main__":
    main()

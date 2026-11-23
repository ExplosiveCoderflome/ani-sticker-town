"""Rebuild the hand-painted visitor or reader animations using pinned Agent Sprite Forge."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


PIN = "25203d03900b46b444bdd72a75768c33d1895ad6"
ART = Path(__file__).resolve().parents[1] / "art"
TIMING = {"walk": 167, "receive": 200, "eat": 250, "read": 250, "carry": 167}


def register_sheet(path, columns, sides):
    """Assign complete silhouettes across grid lines and anchor hats over the floor."""
    pixels = np.asarray(Image.open(path).convert("RGBA"))
    alpha = pixels[:, :, 3]
    labels, _ = ndimage.label(alpha > 32, structure=np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    ids = np.flatnonzero(areas > 10000)
    ids = ids[ids != 0]
    if len(ids) != 2 * columns:
        raise ValueError(f"{path.name}: expected {2 * columns} connected figures, found {len(ids)}")
    centers = ndimage.center_of_mass(alpha, labels, ids)
    order = sorted(zip(ids, centers), key=lambda item: (int(item[1][0] // (alpha.shape[0] // 2)), item[1][1]))
    cores = np.zeros(alpha.shape, dtype=np.uint8)
    for index, (label, _) in enumerate(order, 1):
        cores[labels == label] = index
    distance, nearest = ndimage.distance_transform_edt(cores == 0, return_indices=True)
    owners = cores[tuple(nearest)]
    attached = (alpha >= 5) & (distance <= 3)
    frames = []
    for index in range(1, len(ids) + 1):
        side = sides[(index - 1) // columns]
        core = cores == index
        body_y, _ = np.where(core)
        floor = int(body_y.max() + 1)
        _, hat_x = np.where(core[body_y.min():body_y.min() + 66])
        center_x = int(round(np.median(hat_x)))
        mask = attached & (owners == index)
        ys, xs = np.where(mask)
        x, y, right, bottom = int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)
        crop = pixels[y:bottom, x:right].copy()
        crop[~mask[y:bottom, x:right]] = 0
        frame = Image.new("RGBA", (side, side))
        frame.alpha_composite(Image.fromarray(crop), (x + side // 2 - center_x, y + side - 13 - floor))
        frames.append(frame)
    return frames


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor", choices=("visitor", "reader"), default="visitor")
    parser.add_argument("--forge", type=Path, required=True, help="Pinned agent-sprite-forge checkout")
    parser.add_argument("--out", type=Path, required=True, help="New directory for QC and export")
    args = parser.parse_args()
    forge = args.forge.resolve()
    revision = subprocess.check_output(["git", "-C", str(forge), "rev-parse", "HEAD"], text=True).strip()
    if revision != PIN:
        parser.error(f"Expected Forge commit {PIN}, found {revision}")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    scripts = forge / "skills/generate2dsprite/scripts"
    sys.path.insert(0, str(scripts))
    import forge_core

    def run(tool, *options):
        subprocess.run([sys.executable, "-X", "utf8", str(scripts / tool), *map(str, options)], cwd=out, check=True)

    if args.actor == "visitor":
        folder = ART / "seaside-visitor"
        motion = register_sheet(folder / "motion.png", 4, (600, 600))
        extra = [frame.resize((600, 600), Image.Resampling.LANCZOS)
                 for frame in register_sheet(folder / "motion-alternate.png", 2, (641, 641))]
        service = register_sheet(folder / "service.png", 4, (622, 622))
        poses = {"walk": motion[:2] + extra[:2], "receive": service[:4], "eat": service[4:], "carry": motion[4:6] + extra[2:]}
    else:
        folder = ART / "bookshop-reader"
        motion = register_sheet(folder / "motion.png", 4, (622, 622))
        # The seated figures were drawn slightly closer. Match their beret size to the standing row.
        service = register_sheet(folder / "service.png", 4, (651, 678))
        poses = {"walk": motion[:4], "receive": service[:4], "read": service[4:], "carry": motion[4:]}
    manifest = {"schema": "generate2dsprite.animation_clips.v2", "art_source": "host_image", "pixel_art": False,
                "sampling": "linear", "frames": [], "anchor_px": [112, 218], "body_height_px": 193, "clips": {}}
    for name, tiles in poses.items():
        side = tiles[0].width
        strip = Image.new("RGBA", (4 * side, side))
        for index, frame in enumerate(tiles):
            strip.paste(frame, (index * side, 0))
        source = out / (name + "-owned.png")
        clean, _ = forge_core.alpha_hygiene(np.asarray(strip), mode="both")
        clean.save(source)
        run("sheet_qc.py", "spill", "--input", source, "--rows", 1, "--cols", 4, "--expect", 4,
            "--key", "none", "--safe-margin", "0.01", "--output-dir", out / (name + "-spill"))
        target = out / (name + "-registered")
        run("generate2dsprite.py", "process", "--input", source, "--target", "asset", "--mode", "sheet",
            "--rows", 1, "--cols", 4, "--label-prefix", name, "--background-mode", "native_alpha",
            "--alpha-hygiene", "both", "--resampler", "lanczos", "--scale-strategy", "registered",
            "--align", "feet", "--anchor-px", f"{side // 2},{side - 13}", "--trim-border", 0,
            "--fit-scale", "0.94", "--cell-size", 224, "--duration", TIMING[name],
            "--reject-edge-touch", "--strict-qc", "--output-dir", target)
        metadata = json.loads((target / "pipeline-meta.json").read_text(encoding="utf8"))
        frames = [target / (label + ".png") for label in metadata["frame_labels"]]
        run("sheet_qc.py", "frames", "--frames", *frames, "--cycle", "walk" if name in ("walk", "carry") else "none",
            "--facing", "left", "--torso-band", "0.23,0.37", "--game-pixel", "2.18", "--output-dir", out / (name + "-motion-qc"))
        start = len(manifest["frames"])
        manifest["frames"].extend(f.relative_to(out).as_posix() for f in frames)
        manifest["clips"][name] = {"frames": list(range(start, start + 4)), "duration_ms": TIMING[name],
                                   "loop_policy": "oneshot" if name == "receive" else "cycle"}
    spec = out / "clips.json"
    spec.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8")
    run("build_animation_clips.py", "--manifest", spec, "--preview-scale", 1, "--output-dir", out / "clips")
    run("export_engine.py", "--clips", out / "clips/animation-clips.json", "--target", "godot-spriteframes",
        "--name", args.actor, "--sampling", "linear", "--padding", 2, "--extrude", 1, "--output-dir", out / "engine")


if __name__ == "__main__":
    main()

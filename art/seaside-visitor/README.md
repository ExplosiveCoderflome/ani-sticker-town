# 海风夜市游客动作

三张透明母图以原游客贴纸 `play/media/seaside-market/customer.png` 为人物参考，由 Codex 图像生成工具绘制。角色都朝左，坐姿图只含人物。游戏使用 `game/assets/visitor-motion/visitor.tres` 与同目录的 `visitor-atlas-00.png`。

| 动作 | 母图格序（各行从左数） | 帧时长 | 播放 |
| --- | --- | --- | --- |
| `walk` | `motion.png` 第一行前两格，接 `motion-alternate.png` 第一行两格 | 167 ms | 循环 |
| `receive` | `service.png` 第一行四格 | 200 ms | 播放一次，第三格拿到串 |
| `eat` | `service.png` 第二行四格 | 250 ms | 循环 |
| `carry` | `motion.png` 第二行前两格，接 `motion-alternate.png` 第二行两格 | 167 ms | 循环 |

## 重建

脚本从每张母图提取独立的透明轮廓。个别鞋、手和包跨过等分线，按连通主体归属可以保留完整原画。它用帽子上部和脚底统一各帧的位置，保留坐姿的实际高度，然后调用固定版本 Agent Sprite Forge 的 `sheet_qc.py`、`generate2dsprite.py`、`build_animation_clips.py` 和 `export_engine.py`。运行环境用到了 Python 3.12、Pillow 11.1、NumPy 1.26 和 SciPy 1.15。[上游固定版本](https://github.com/0x0funky/agent-sprite-forge/tree/25203d03900b46b444bdd72a75768c33d1895ad6)

```sh
git clone https://github.com/0x0funky/agent-sprite-forge.git ../agent-sprite-forge
git -C ../agent-sprite-forge checkout 25203d03900b46b444bdd72a75768c33d1895ad6
python art/seaside-visitor/build.py --forge ../agent-sprite-forge --out ../visitor-build
```

`--out` 接受新目录。成品位于 `engine/godot/`，逐项报告在各动作目录和 `engine/engine-export.json`。每格 224 × 224，共用脚底坐标 (112, 218)。站姿约高 192 像素，坐姿约高 166 像素。坐骨约为 (124, 167)，接串时握点约为 (74, 90)。

## 验证记录

- 四组透明轮廓均通过跨格检查，四次严格注册均通过。Forge 逐像素回读导出图集，并核对各段时长、循环与帧序。Godot 4.7.2 headless 实际导入 PNG、加载 SpriteFrames，并读到了 16 张互相独立的可见纹理。
- `walk-motion-qc/sheet-qc.json` 与 `carry-motion-qc/sheet-qc.json` 中的 `leg_alternation` 均为 `needs-visual-review`。估计的近远腿依次是 `unclear, unclear, far, unclear`，判据是两次相隔半周期的迈步应由不同腿领先。已查看四张并排的原画和注册预览，第三格的长跨步和第四格的抬膝使用补画的姿势。
- `receive-motion-qc/sheet-qc.json` 和 `eat-motion-qc/sheet-qc.json` 的 `torso_drift` 分别为 3.16、2.07 个游戏像素，阈值均为 2。伸手接串、举串时衣服轮廓会偏移。四张接串图与四张坐姿图的脚底都落在同一像素行。
- 独立 GIF 预览会把 167 ms 向下量化为 160 ms；游戏图集的步行与携带帧均以 167 ms 播放。

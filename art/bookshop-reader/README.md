# 雨天书屋读者动作

两张 1254 × 1254 透明母图以 `play/media/bookshop/customer.png` 中的读者为参考，由 Codex 图像生成工具绘制。红贝雷帽、黄色雨衣、棕色皮包和墨绿植物纹书贯穿四段动作。母图均为四列两行、从左到右播放，所有人物朝左。

| 动作 | 母图位置 | 画面与时长 |
| --- | --- | --- |
| `walk` | motion.png 上排 | 书夹在身侧，四个步态，各 167 ms |
| `receive` | service.png 上排 | 持书、伸空掌、接回倾斜的书、抱在胸前，各 200 ms，播放一次 |
| `read` | service.png 下排 | 坐好开书、捏住书页、翻起书页、按平，各 250 ms，循环 |
| `carry` | motion.png 下排 | 双手把书抱在胸前走开，各 167 ms |

## 重建和放置

仓库的 `tools/build_actor_motion.py` 同时支持游客与读者。运行环境为 Python 3.12、Pillow 11.1、NumPy 1.26、SciPy 1.15，以及固定版本的 Agent Sprite Forge。脚本按连通轮廓保留跨格的手掌和书，按贝雷帽和接地线统一尺度，再调用 Forge 的透明注册、逐帧检查、剪辑与 Godot 导出脚本。[上游固定版本](https://github.com/0x0funky/agent-sprite-forge/tree/25203d03900b46b444bdd72a75768c33d1895ad6)

```sh
git clone https://github.com/0x0funky/agent-sprite-forge.git ../agent-sprite-forge
git -C ../agent-sprite-forge checkout 25203d03900b46b444bdd72a75768c33d1895ad6
python tools/build_actor_motion.py --actor reader --forge ../agent-sprite-forge --out ../reader-build
```

输出为 `engine/godot/reader.tres` 和 `reader-atlas-00.png`，游戏使用 `game/assets/reader-motion/` 下的同名文件。每帧 224 × 224，脚底原点 (112, 218)，站姿约高 192 像素，坐姿约高 168 像素。坐姿只绘人物，椅面应对准坐骨约 (122, 165)。第二格空掌约在 (55, 87)，第三格握住书本的手约在 (75, 88)。

## 验证

四组跨格测试与四次严格透明注册通过。Forge 回读图集后逐像素核对了 16 个帧区与播放时长。Godot 4.7.2 headless 导入图集，实际读取了四段动作、16 个独立帧的纹理及透明角。

- `walk-motion-qc/sheet-qc.json` 的 `identity_residual` 在第 4 格为 1.61，阈值 1.5；各格数值为 `[null,0.73,1.0,1.61]`。并排查看四个步态时，帽子、雨衣、皮包及书均保持可辨。
- `receive-motion-qc/sheet-qc.json` 的 `torso_drift` 为 3.55 个游戏像素，阈值 2。该段包含伸手向柜台和抱回胸前的上身位移。`seam` 为 1.75，阈值 1.5，对应从第 3 格接书到第 4 格抱书的过渡。
- `read` 与 `carry` 的逐帧检查均通过。GIF 预览将 167 ms 取整到 160 ms，游戏保存 167 ms。

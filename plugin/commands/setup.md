---
description: 配置 wukong-drama 本地后期依赖与图片/视频模型，检查 ffmpeg / git / 字体工具
---

先读取 `skills/setup/SKILL.md`，模型与批次授权按该技能执行；`check` 不验证 API 权限。

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wkd.mjs" setup`。
   它会把 npm 依赖和 Chromium 装到 `~/.wukong-drama/deps/<引擎版本>/<环境与锁身份>/`（插件升级不会丢）。
2. 再运行 `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wkd.mjs" check`，把结果整理给用户。
3. 对仍然缺少的项，按用户的操作系统给出一行安装命令：
   - ffmpeg（必需）：macOS `brew install ffmpeg`；Ubuntu `sudo apt install ffmpeg`；Windows `winget install ffmpeg`
   - git（推荐）：用于为每个审片节点做定版存档
   - fonttools（推荐）：`pip install fonttools brotli`，中文字体子集化
   - TTS（可选）：`pip install edge-tts` 或 kokoro，用于 AI 配音（人声）
不要替用户执行需要管理员权限的安装命令，给出命令让用户确认后再运行。

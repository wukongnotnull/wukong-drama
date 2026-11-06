# 工程文件规范（film.json）

> `film.json` 给引擎用，`storyboard.md` 给人看（写法见 `STORYBOARD.md`），两者逐镜对应：分镜表的「镜」栏对应 `shots[].id`，「景别」栏对应 `shots[].size`，「时长」栏对应 `shots[].duration`。

- **工序**：第 3 道 `wkd init` 生成，第 6 道起各道工序往里填字段
- **模板**：`engine/templates/film/film.json`
- **完整字段**：`engine/schemas/film.schema.json`，引擎按它校验
- **示例**：`ink-wash/examples/demo/film.json` 是未生成的模型工程，镜头使用 JSON。

## 一、结构一览

```json
{
  "title": "晨雾",
  "style": "ink-wash",
  "size": [1920, 1080],
  "fps": 30,
  "seed": 7,
  "generation": {"image": {"provider": "openai"}, "video": {"provider": "seedance"}},
  "shots": [
    { "id": "s01", "file": "shots/s01.json", "duration": 4, "size": "远景", "note": "晨雾山谷" }
  ],
  "cues": { "亭现": [6.2, 6.6] },
  "audio": {
    "build": "audio/build.mjs",
    "voice_source": "user",
    "voices": [{ "text": "雾散时，山就醒了。", "at": 4.5, "cue": "第一句", "file": "audio/voice/01.wav" }],
    "tracks": []
  },
  "export": { "formats": ["mp4"], "name": "chenwu" },
  "subtitles": { "mode": "srt" }
}
```

## 二、常用字段

| 字段 | 说明 |
|---|---|
| `seed` | 生成参数之一；相同种子不保证模型结果可重复 |
| `shots[].duration` | 秒。第 8 道工序按人声实测时长回填 |
| `shots[].size` | 景别：`大远景` / `远景` / `全景` / `中景` / `近景` / `特写` / `大特写`，与分镜表景别栏一致。第 6 道签批时 `wkd signoff --step 6` 检查：每镜都写、4 镜及以上至少 3 种、相邻两镜不同，不合规就拒绝签批 |
| `cues` | 声音同步点 `名: [入点, 出点]`（全片时间，秒）。人声同步点由 `wkd soundtrack` 自动写入，音效同步点手写 |
| `audio.build` | 配乐脚本，导出 `default async ({synth, duration, outDir, shots, cues}) => [{file, start, gain}]`。配乐、环境声、音效各返回一个文件（`bgm.wav` / `ambience.wav` / `sfx.wav`），剪映草稿里按文件分轨 |
| `audio.voice_source` | 独立人声素材来源（第 7 道工序，审片节点⑥）：`user` 用户自供录音 / `ai` AI 配音 / `none` 无独立人声 |
| `audio.voices` | 人声文案，画外音、对白、同期声都写在这里；`user` 时每条用 `file` 挂接录音；`ai` 且没装 TTS 时按每秒 3.6 字预估同步点 |
| `voices[].kind` | 人声类型，对应分镜「人声」栏的标记：`vo` 画外音（默认，含旁白、内心独白）/ `dialogue` 对白 / `os` 画外但在场景里 / `live` 同期声。`live` 是现场原声，AI 配不出来，必须挂接 `file`；`voice_source` 为 `ai` 时，其余条目照常 AI 配音 |
| `voices[].chars` | `true` 时 `wkd soundtrack` 给这一句的每个字写同步点 `名#1`、`名#2`……（按停顿分句、句内均分的近似时间），用于声音/字幕及后期对位参考；不能据此宣称生成视频的文字或口型逐字同步 |
| `voices[].speaker` | 说话的人或声音来源，对应标记括号里的内容，如 `对白（老者）` 写 `"speaker": "老者"` |
| `export.formats` | 已注册的导出器：`mp4` / `gif` / `png-seq` / `jianying`（剪映草稿，直接写进剪映草稿目录；不写进这里，等 ⑪ 终审定版后在第 16 道用 `wkd final <片> --formats jianying` 单独导出） |
| `variants` | 副版画幅（第 15 道改版用）：键是画幅，如 `"variants": { "9:16": {} }`；主版画幅就是 `size`。值里可覆盖 `export.name`（缺省为主版名加 `-<后缀>`，如 `chenwu-9x16`）和 `subtitles.style`（叠在主版的字幕样式之上）。主版和副版的画幅都必须在风格 `style.json` 的 `aspects` 里。副版尺寸按主版短边等比推出（主版 1920×1080 时 9:16 副版为 1080×1920）；镜头表、时长、`cues`、声音两版共用。没有这个字段即只出主版 |
| `subtitles` | 字幕（第 11 道工序，审片节点⑨）：`mode` 为 `none` 不出 / `srt` 外挂 / `burn` 烧录 / `both` 两者；`file` 字幕文件（缺省 `subtitles.srt`，`wkd subtitles` 生成，可手改）；`max_chars` 每条最多几个字（缺省横屏 18、竖屏 12、方形 14）；`style` 这支片的字幕样式（字段同 `style.json` 的 `subtitles` 块：`font`、`size`、`color`、`stroke`、`bottom`，逐项覆盖风格的设置）。没有这个字段即不出字幕 |

人声字段统一使用 `voices` / `voice_source`；旧名 `voiceover` / `vo_source` 直接校验失败，不自动改名或改写工程。`scripts` 字段（包括空数组）不再支持。

## 三、模型与系列配置

`generation.image.provider` 为 `openai`，`generation.video.provider` 为 `seedance`；各自可写 `model`，否则使用 `OPENAI_IMAGE_MODEL` / `SEEDANCE_MODEL`。密钥只读环境。`image.estimated_cost_usd` / `video.estimated_cost_cny` 是人工查验的每请求估算上界，缺少可靠估算不调用付费服务。`generation.budget` 中的 `image_usd`、`video_cny`、`max_video_tasks` 控制批次提交，不能保证最终账单硬封顶。

图片按 [图片来源规范](IMAGES.md) 每批 image-plan → 用户选择 → image-approve → image-dispatch；宿主结果再 image-import。API 配置留在 generation.image，宿主路线独立存储，不把 provider 写成 host。视频继续 generation-plan 与 generation-approve。模型、参考素材或提示词改变后，旧批准不可用于新请求。样片的 max_video_tasks: 1 是整部影片累计提交上限，不能通过改修订号绕过。

可选 `series` 引用项目路径、`episode_id` 与 `character_ids`。角色、道具、场景版本在项目设定库中维护；第 5 道按 `SETTINGS.md` 确认，本片 `settings.json` 选择版本，镜头 `settings` 自动带入文字与参考快照，额外构图图像才列入 `references`。正式连续性独立于草稿，只有明确确认的当前稿才入 canon。

默认 `generation.video.generate_audio: true`，省略时也开启；保留并提取模型原生音轨进入后期。用户选择无声画面或独立后期时显式设为 `false`，旧工程已有的 `false` 不变。原生声音是一条混合音轨，不能承诺自动拆分。`audio.voice_source` 仅管理额外独立人声；全片无人声还要在 `video_prompt` 明确禁止对白和旁白。真实视频未产出前只确认方向，实际生成后再审听，不填写虚假的提前通过记录。

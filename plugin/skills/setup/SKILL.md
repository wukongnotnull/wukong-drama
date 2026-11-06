---
name: setup
description: 用户首次安装 wukong-drama、要求安装或检查本地制作环境，或遇到 Node.js、ffmpeg、Chromium 与渲染依赖缺失，以及配置 GPT Image / Seedance、询问插件版本、安装来源、升级失败时使用。
---

# 配置本地制作环境

本文件位于 `<插件根目录>/skills/setup/SKILL.md`。先取得**当前加载的本文件所在目录的真实路径**，再上移两级目录得到插件根目录，使用其中的 `engine/bin/wkd.mjs`，不要依赖宿主的插件路径变量或固定的源码仓库路径。

1. 确认能访问本地终端与文件，并检查 `node --version`。需要 Node.js 20 或更高版本；没有 Node 或版本过低时，给出 [Node.js 下载页](https://nodejs.org/)，请用户安装后再继续。没有本地执行能力时说明需要桌面本地执行环境。
2. 用户选择「设置」或明确请求配置环境时，运行下列命令。它按插件自带的锁文件安装 npm 依赖，放在 `~/.wukong-drama/deps/<引擎版本>/<环境与锁身份>/`；设置了 `WUKONG_DRAMA_HOME` 时使用该目录。Chromium 由锁定的 Playwright 安装到其浏览器缓存。旧版依赖目录保留，升级到新的锁身份后第一次需要运行 setup；同身份已完成的安装会复用。如果用户只要求检查，不运行 `setup`，直接执行下一步。

   ```bash
   node "<插件根目录>/engine/bin/wkd.mjs" setup
   ```

3. 运行检查，把日志中的必需项与可选项整理给用户；下载或安装失败时保留错误，不声称环境已就绪。

   ```bash
   node "<插件根目录>/engine/bin/wkd.mjs" check
   ```

4. 缺少外部工具时，按用户操作系统给出安装方式：

   | 工具 | 用途 | 安装方式 |
   |---|---|---|
   | ffmpeg（必需） | 编码与混音 | macOS：`brew install ffmpeg`；Ubuntu：`sudo apt install ffmpeg`；Windows：`winget install ffmpeg` |
   | git（推荐） | 审片定版存档 | [git-scm.com](https://git-scm.com/) |
   | fonttools（推荐） | 中文字体子集化 | `pip install fonttools brotli` |
   | edge-tts / kokoro（可选） | AI 配音 | `pip install edge-tts` |

   不替用户执行需要管理员权限的安装命令；让用户执行给出的命令后重新检查。

把 `<插件根目录>` 替换为实际绝对路径并保留引号。不要在插件缓存中运行 `npm install`、生成影片或修改插件源码。只有 `check` 成功才报告本地环境就绪。它不请求生成服务，不证明账号、模型权限、余额或真实 API 可用。模型配置按下节执行，不能把环境通过当成已生成过作品。


## 模型配置与批次授权

图片可以选择当前 Agent 的可用 skill／内置工具，或已配置的自定义 API；首批优先推荐可用 Agent。宿主路线不需要项目 API 密钥，按 [图片来源规范](../director/specs/IMAGES.md) 逐批选择、交接并回收。API 默认官方 OpenAI Images API 与火山方舟 Seedance，不自动切换。由实际执行进程读取 `OPENAI_API_KEY` / `ARK_API_KEY`，模型使用 `OPENAI_IMAGE_MODEL` / `SEEDANCE_MODEL`，也可在 `film.generation.image.model` / `video.model` 指定。只核对是否已设置，不打印密钥；密钥不能写入工程、日志或 Git。没有密钥时也可以导入本地 `image` / `video` 素材完成后期。

先查验所选模型的实际图片规格、视频时长、分辨率、原生声音能力与定价；没有可靠依据不填估价，也不宣称可生成 30 秒。`generation.image.estimated_cost_usd` 和 `video.estimated_cost_cny` 记录人工核实的每请求上界，来源写进制作简报或计划备注；`generation.budget` 设置 `image_usd`、`video_cny` 和 `max_video_tasks`。预算是提交前控制，不是账单硬封顶。

图片全部阶段先 `image-plan`，在同一选择窗口说明本批任务、数量、API 费用或宿主费用不可估算，再 `image-approve --method host|api --signature ... --source ...`；同批继续执行不逐张问，新批必须确认。具体参数与回收见图片来源规范。视频先 `generation-plan --kind video`，按 [视频批次规范](../director/specs/VIDEO.md) 展示源片／成片时长、模型、数量、费用和预算；每批弹窗等待明确开始，再 `generation-approve --kind video --signature <计划签名> --source "实际开始授权原文"`。不能把工具返回、预选项、项目记忆或超时当批准；参考图实际审阅通过后才准备视频批次。

重跑查询、下载与转码不创建新生成请求。提交结果不明或任务失败不得自动重试；修订也不能绕过累计任务上限。原始素材和任务记录保留在影片 `assets/generated/`。

## 版本与升级诊断

用户询问插件版本、安装来源或升级失败时，先从当前加载的本文件真实路径定位插件根目录，运行只读诊断：

```bash
node "<插件根目录>/engine/bin/wkd.mjs" check --upgrade --json
```

按结果说明插件版本、引擎版本、包格式、依赖状态及对应升级指引。远端最新版本和宿主是否已重载无法由离线诊断确认；不要声称已是最新版。发现其他 marketplace 路径失效时指出具体条目，请用户核对，不自动删除或改写其他插件配置。仅请求诊断时不运行 setup 或更新命令；更新操作仍按用户明确授权执行。诊断不是媒体环境检查，需要确认制作环境时继续运行上面的普通 check。

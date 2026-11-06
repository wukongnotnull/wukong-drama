# 安装操作参考（给助手和维护者）

普通用户先看[安装和开始使用](agent-installation.md)。这里保留具体命令、安装位置和检查规则，供执行安装时查阅。

当前本地构建包版本为 0.1.0，portable 文件为 `wukong-drama-agent-skills-v0.1.0.zip` 与同一次构建的 SHA256SUMS；原生插件包为 `wukong-drama-plugin-v0.1.0.zip` 与相邻的 .sha256 文件。下载见 [GitHub Release](https://github.com/wukongnotnull/wukong-drama/releases/tag/v0.1.0)。两个包的用途不同：Codex 本地原生安装直接使用仓库中的 marketplace，其他支持 Agent Skills 的工具可使用 portable 包。

## Codex 本地原生安装

在已支持 `codex plugin` 的 Codex CLI 中，注册对应版本的仓库来源并安装：

```text
codex plugin marketplace add wukongnotnull/wukong-drama --ref v0.1.0 --json
codex plugin add wukong-drama@wukong-drama --json
codex plugin list --marketplace wukong-drama --json
```

本地源码安装时，将第一条命令的来源改为仓库绝对路径，并去掉 --ref。

使用安装结果返回的插件目录运行 `node <安装目录>/engine/bin/wkd.mjs check`，并用 `list styles` 检查风格发现。`check` 只验证本地工具，不调用图片/视频服务，不证明账号权限、密钥或额度可用。已安装的 wukong-animation 保持独立，不删除或覆盖其插件、marketplace 或用户目录。

CLI 的 installed/enabled 状态与磁盘技能存在，不能单独证明当前聊天已加载入口。安装后按宿主要求刷新或在后续新聊天确认技能；不要通过重复安装制造多个来源。若全局列表被另一个失效的本地 marketplace 阻断，可先按上面的目标名称查询，保留无关配置。

本地来源更新后再次运行 `codex plugin add wukong-drama@wukong-drama`，并核对安装返回的版本及内容。`marketplace upgrade` 用于刷新 Git 来源，不是本地源码更新命令。不要直接编辑 Codex 缓存目录。

## 从源码构建分发包

`npm run build:plugin` 生成原生 ZIP，`npm run build:portable` 生成 portable ZIP。构建不上传账户、不发布市场，也不自动安装依赖。两种正式包共用资源筛选规则：仅收Git跟踪资源，相关运行文件、构建工具、distribution、许可及来源说明必须与干净提交一致；无关开发文稿不阻塞。包内记录构建模式、sourceCommit与文件摘要，排除凭证、依赖、缓存、活动任务和普通用户媒体；已授权示范素材继续收录。

本地验证可用 `npm run build:plugin -- --development` 或 `npm run build:portable -- --development`，文件名带-development并写入开发标记，可收未忽略的新源码。portable安装／升级开发包必须显式添加 `--allow-development`，仍不允许同版本不同模式、来源或内容覆盖。安装包必须明确声明buildMode；缺少模式的旧包请从当前源码重建，不再推断为正式包。原生开发产物只用于验证，不进入默认安装指引；本工具不管理宿主的手工导入，不能声称阻止官方CLI绕过。

## 升级诊断

安装诊断显示当前包身份；发布版本和安装包见 [GitHub Release](https://github.com/wukongnotnull/wukong-drama/releases)。

可从当前安装的引擎入口执行 `node <安装目录>/engine/bin/wkd.mjs check --upgrade`，机器读取追加 `--json`。诊断只读且离线，显示插件/引擎版本、包格式、依赖身份及对应升级指引；远端最新版本和宿主是否已加载新版显示未知。发现失效的其他 marketplace 时提示手动核对，不自动改写配置。

## 安装与开始制作

需要 Node.js 20+。使用本地构建或作者交付的 `wukong-drama-agent-skills-v<版本>.zip` 与 SHA256SUMS，核对校验和后用系统解压工具解压；进入包含 install-agent.mjs 的目录。以下命令不自动安装 Agent 客户端或后期依赖：

```text
node install-agent.mjs list
node install-agent.mjs install --agent cursor --scope project --project "<已存在的项目绝对路径>" --dry-run
node install-agent.mjs install --agent cursor --scope project --project "<已存在的项目绝对路径>"
node install-agent.mjs status --agent cursor --scope project --project "<已存在的项目绝对路径>"
```

将 cursor 替换为下表 ID；用户级安装改为 `--scope global` 并去掉 --project。不确定写哪里时先 --dry-run；自动化加 --json 输出单个 JSON 结果，不混入日志。源码命令使用 `node tools/install-agent.mjs` 并追加 `--bundle "<仓库绝对路径>/dist/wukong-drama"`。

安装后按客户端的刷新/启用技能方法加载。发消息“使用 wukong-drama 检查环境”，检查通过后再说“使用 wukong-drama 列风格”或“使用 wukong-drama 开始制作一支短剧”。工程写入用户选定目录。没有终端/文件权限时可准备简报，但不能执行制作。审片批准继续保留；已有草稿等选择不重复问。

## 工具与作用域

表中的 portable 路径均追加 /wukong-drama；不同客户端/版本可能需要启用技能。minimumVersion 尚未确认数字下限，需使用支持 Agent Skills 的版本。下表是目录安装契约，继承的宿主目录适配需在目标宿主实际验证，不能把该表当作全功能实测。

| ID | 工具族 | 项目目录 | 用户目录 | 状态 |
| --- | --- | --- | --- | --- |
| claude-code | Claude Code | .claude/skills | ~/.claude/skills | 目录契约适配 |
| codex | Codex | .agents/skills | ~/.agents/skills | 目录契约适配 |
| chatgpt-local | ChatGPT 桌面本地执行 | 原生插件 | 原生插件 | 保留原生渠道 |
| cursor | Cursor | .agents/skills | ~/.cursor/skills | 目录契约适配 |
| github-copilot | GitHub Copilot | .agents/skills | ~/.copilot/skills | 目录契约适配 |
| gemini-cli | Gemini CLI | .agents/skills | ~/.gemini/skills | 目录契约适配 |
| opencode | OpenCode | .agents/skills | ~/.config/opencode/skills | 目录契约适配 |
| cascade | Devin Desktop / Windsurf | .devin/skills | ~/.config/devin/skills | 目录契约适配 |
| antigravity | Antigravity | .agents/skills | ~/.gemini/antigravity/skills | 目录契约适配 |
| cline | Cline | .agents/skills | ~/.agents/skills | 候选，禁止写入 |
| roo | Roo Code | .roo/skills | ~/.roo/skills | 目录契约适配 |
| kiro | Kiro | .kiro/skills | ~/.kiro/skills | 目录契约适配 |
| droid | Factory Droid | .agents/skills | ~/.factory/skills | 目录契约适配 |
| amp | Amp | .agents/skills | ~/.config/agents/skills | 目录契约适配 |
| continue | Continue | .continue/skills | ~/.continue/skills | 目录契约适配 |
| goose | Goose | .goose/skills | ~/.config/goose/skills | 目录契约适配 |
| qwen-code | Qwen Code | .qwen/skills | ~/.qwen/skills | 目录契约适配 |
| kimi-code | Kimi Code CLI | .agents/skills | ~/.agents/skills | 目录契约适配 |
| trae | Trae | .trae/skills | ~/.trae/skills | 目录契约适配 |
| codebuddy | CodeBuddy | .codebuddy/skills | ~/.codebuddy/skills | 目录契约适配 |
| qoder | Qoder | .qoder/skills | ~/.qoder/skills | 目录契约适配 |
| augment | Augment | .augment/skills | ~/.augment/skills | 目录契约适配 |
| openclaw | OpenClaw | skills | ~/.openclaw/skills | 目录契约适配 |
| openhands | OpenHands | .openhands/skills | ~/.openhands/skills | 目录契约适配 |
| pi | Pi | .agents/skills | ~/.agents/skills | 目录契约适配 |
| warp | Warp | .agents/skills | ~/.agents/skills | 目录契约适配 |
| zed | Zed | .agents/skills | ~/.agents/skills | 目录契约适配 |

具备 variants 的工具必须显式选择：cascade 使用 `--variant devin` 或 `--variant windsurf`；antigravity 使用 `--variant ide` 或 `--variant cli`；trae/qoder 使用 `--variant international` 或 `--variant cn`。目录如下，其他字段与主配置一致：

| ID / variant | 项目目录 | 用户目录 |
| --- | --- | --- |
| cascade / devin | .devin/skills | ~/.config/devin/skills |
| cascade / windsurf | .windsurf/skills | ~/.codeium/windsurf/skills |
| antigravity / ide | .agents/skills | ~/.gemini/antigravity/skills |
| antigravity / cli | .agents/skills | ~/.gemini/antigravity-cli/skills |
| trae / international | .trae/skills | ~/.trae/skills |
| trae / cn | .trae/skills | ~/.trae-cn/skills |
| qoder / international | .qoder/skills | ~/.qoder/skills |
| qoder / cn | .qoder/skills | ~/.qoder-cn/skills |

Kiro CLI 默认 Agent 自动加载目录；自定义 Agent 需手动在资源声明中添加 `skill://.kiro/skills/**/SKILL.md`，安装器不会改已有配置。Kiro IDE 可导入包内 wukong-drama 子目录，单独核验。Cline 尚缺具体加载路径佐证，暂不启用。ChatGPT 普通网页聊天不等于桌面本地执行环境。

## 更新与卸载

先获取新版本本地构建包并解压，从新包目录执行同一命令的 upgrade；使用相同 agent/scope/project/variant。不会自动抓浮动 latest，不自动降级；同版本不同内容会拒绝覆盖，因此正式交付后的内容修订应先增加版本号。

```text
node install-agent.mjs upgrade --agent cursor --scope project --project "<项目绝对路径>" --dry-run
node install-agent.mjs upgrade --agent cursor --scope project --project "<项目绝对路径>"
node install-agent.mjs uninstall --agent cursor --scope project --project "<项目绝对路径>" --dry-run
node install-agent.mjs uninstall --agent cursor --scope project --project "<项目绝对路径>"
```

用户新增/修改/删除包内文件或同名外部技能时，升级卸载会停止，先自行备份与迁移后重试；没有强制覆盖开关。多个宿主共享一个物理目录时，卸载一个 owner 保留其余 owner，最后一个才删除。作品、其他技能及共享依赖缓存保留。自定义风格默认保存在用户资源目录，适合跨版本使用。

安装后同时有原生插件与 portable 入口时，核对两个版本并在宿主设置中手动停用重复项；安装器不修改宿主配置。找不到入口时先 status 核对作用域与目录，再按客户端文档刷新/启用，不要将同一包盲目复制到多个目录。中断事务可在重试时恢复；遇到用户改动或未知备份会保留文件并报错。

## 依据与限制

目录依据固定到 [skills 适配器源码 92a9a34](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/agents.md)，Cascade 的当前目录补充[官方文档](https://docs.devin.ai/desktop/cascade/skills)。本项目尚未对所有第三方宿主进行运行验证。

只有合同测试通过的具名 family 才计安装适配数；地区版和 IDE/CLI 不重复计数。远程/云端不继承本地资源或预览能力，应在其实际工作区安装检查。第三方安装器只有通过完整目录复制测试后才可作为渠道，本指南不承诺 npx skills add 本仓库已可用。

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfiles } from './install-agent.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const agents=loadProfiles().agents;
const version=JSON.parse(fs.readFileSync(path.join(root,'plugin/plugin.json'),'utf8')).version;
const reference=`# 安装操作参考（给助手和维护者）

普通用户先看[安装和开始使用](agent-installation.md)。这里保留具体命令、安装位置和检查规则，供执行安装时查阅。

当前本地构建包版本为 ${version}，portable 文件为 \`wukong-drama-agent-skills-v${version}.zip\` 与同一次构建的 SHA256SUMS；原生私有插件包为 \`wukong-drama-plugin-v${version}.zip\` 与相邻的 .sha256 文件。本项目尚未发布 GitHub Release。两个包的用途不同：Codex 本地原生安装直接使用仓库中的 marketplace，其他支持 Agent Skills 的工具可使用 portable 包。

## Codex 本地原生安装

在已支持 \`codex plugin\` 的 Codex CLI 中，先核对源码和依赖，再注册这个独立来源并安装：

\`\`\`text
codex plugin marketplace add "<仓库绝对路径>" --json
codex plugin add wukong-drama@wukong-drama --json
codex plugin list --marketplace wukong-drama --json
\`\`\`

使用安装结果返回的插件目录运行 \`node <安装目录>/engine/bin/wkd.mjs check\`，并用 \`list styles\` 检查风格发现。\`check\` 只验证本地工具，不调用图片/视频服务，不证明账号权限、密钥或额度可用。已安装的 wukong-animation 保持独立，不删除或覆盖其插件、marketplace 或用户目录。

CLI 的 installed/enabled 状态与磁盘技能存在，不能单独证明当前聊天已加载入口。安装后按宿主要求刷新或在后续新聊天确认技能；不要通过重复安装制造多个来源。若全局列表被另一个失效的本地 marketplace 阻断，可先按上面的目标名称查询，保留无关配置。

本地来源更新后再次运行 \`codex plugin add wukong-drama@wukong-drama\`，并核对安装返回的版本及内容。\`marketplace upgrade\` 用于刷新 Git 来源，不是本地源码更新命令。不要直接编辑 Codex 缓存目录。

## 从源码构建分发包

\`npm run build:plugin\` 生成原生 ZIP，\`npm run build:portable\` 生成 portable ZIP。构建不上传账户、不发布市场，也不自动安装依赖。两种正式包共用资源筛选规则：仅收Git跟踪资源，相关运行文件、构建工具、distribution、许可及来源说明必须与干净提交一致；无关开发文稿不阻塞。包内记录构建模式、sourceCommit与文件摘要，排除凭证、依赖、缓存、活动任务和普通用户媒体；已授权示范素材继续收录。

本地验证可用 \`npm run build:plugin -- --development\` 或 \`npm run build:portable -- --development\`，文件名带-development并写入开发标记，可收未忽略的新源码。portable安装／升级开发包必须显式添加 \`--allow-development\`，仍不允许同版本不同模式、来源或内容覆盖。安装包必须明确声明buildMode；缺少模式的旧包请从当前源码重建，不再推断为正式包。原生开发产物只用于验证，不进入默认安装指引；本工具不管理宿主的手工导入，不能声称阻止官方CLI绕过。

## 升级诊断

安装诊断可显示当前包身份；本项目尚未发布 GitHub Release。

可从当前安装的引擎入口执行 \`node <安装目录>/engine/bin/wkd.mjs check --upgrade\`，机器读取追加 \`--json\`。诊断只读且离线，显示插件/引擎版本、包格式、依赖身份及对应升级指引；远端最新版本和宿主是否已加载新版显示未知。发现失效的其他 marketplace 时提示手动核对，不自动改写配置。

## 安装与开始制作

需要 Node.js 20+。使用本地构建或作者交付的 \`wukong-drama-agent-skills-v<版本>.zip\` 与 SHA256SUMS，核对校验和后用系统解压工具解压；进入包含 install-agent.mjs 的目录。以下命令不自动安装 Agent 客户端或后期依赖：

\`\`\`text
node install-agent.mjs list
node install-agent.mjs install --agent cursor --scope project --project "<已存在的项目绝对路径>" --dry-run
node install-agent.mjs install --agent cursor --scope project --project "<已存在的项目绝对路径>"
node install-agent.mjs status --agent cursor --scope project --project "<已存在的项目绝对路径>"
\`\`\`

将 cursor 替换为下表 ID；用户级安装改为 \`--scope global\` 并去掉 --project。不确定写哪里时先 --dry-run；自动化加 --json 输出单个 JSON 结果，不混入日志。源码命令使用 \`node tools/install-agent.mjs\` 并追加 \`--bundle "<仓库绝对路径>/dist/wukong-drama"\`。

安装后按客户端的刷新/启用技能方法加载。发消息“使用 wukong-drama 检查环境”，检查通过后再说“使用 wukong-drama 列风格”或“使用 wukong-drama 开始制作一支短剧”。工程写入用户选定目录。没有终端/文件权限时可准备简报，但不能执行制作。审片批准继续保留；已有草稿等选择不重复问。

## 工具与作用域

表中的 portable 路径均追加 /wukong-drama；不同客户端/版本可能需要启用技能。minimumVersion 尚未确认数字下限，需使用支持 Agent Skills 的版本。下表是目录安装契约，继承的宿主目录适配需在目标宿主实际验证，不能把该表当作全功能实测。

| ID | 工具族 | 项目目录 | 用户目录 | 状态 |
| --- | --- | --- | --- | --- |
${agents.map(a=>`| ${a.familyId} | ${a.label} | ${a.projectPath||'原生插件'} | ${a.globalPath||'原生插件'} | ${a.qualification==='candidate'?'候选，禁止写入':a.channel==='native'?'保留原生渠道':'目录契约适配'} |`).join('\n')}

具备 variants 的工具必须显式选择：cascade 使用 \`--variant devin\` 或 \`--variant windsurf\`；antigravity 使用 \`--variant ide\` 或 \`--variant cli\`；trae/qoder 使用 \`--variant international\` 或 \`--variant cn\`。目录如下，其他字段与主配置一致：

| ID / variant | 项目目录 | 用户目录 |
| --- | --- | --- |
${agents.flatMap(a=>Object.entries(a.variants).map(([id,v])=>`| ${a.familyId} / ${id} | ${v.projectPath||a.projectPath} | ${v.globalPath||a.globalPath} |`)).join('\n')}

Kiro CLI 默认 Agent 自动加载目录；自定义 Agent 需手动在资源声明中添加 \`skill://.kiro/skills/**/SKILL.md\`，安装器不会改已有配置。Kiro IDE 可导入包内 wukong-drama 子目录，单独核验。Cline 尚缺具体加载路径佐证，暂不启用。ChatGPT 普通网页聊天不等于桌面本地执行环境。

## 更新与卸载

先获取新版本本地构建包并解压，从新包目录执行同一命令的 upgrade；使用相同 agent/scope/project/variant。不会自动抓浮动 latest，不自动降级；同版本不同内容会拒绝覆盖，因此正式交付后的内容修订应先增加版本号。

\`\`\`text
node install-agent.mjs upgrade --agent cursor --scope project --project "<项目绝对路径>" --dry-run
node install-agent.mjs upgrade --agent cursor --scope project --project "<项目绝对路径>"
node install-agent.mjs uninstall --agent cursor --scope project --project "<项目绝对路径>" --dry-run
node install-agent.mjs uninstall --agent cursor --scope project --project "<项目绝对路径>"
\`\`\`

用户新增/修改/删除包内文件或同名外部技能时，升级卸载会停止，先自行备份与迁移后重试；没有强制覆盖开关。多个宿主共享一个物理目录时，卸载一个 owner 保留其余 owner，最后一个才删除。作品、其他技能及共享依赖缓存保留。自定义风格默认保存在用户资源目录，适合跨版本使用。

安装后同时有原生插件与 portable 入口时，核对两个版本并在宿主设置中手动停用重复项；安装器不修改宿主配置。找不到入口时先 status 核对作用域与目录，再按客户端文档刷新/启用，不要将同一包盲目复制到多个目录。中断事务可在重试时恢复；遇到用户改动或未知备份会保留文件并报错。

## 依据与限制

目录依据固定到 [skills 适配器源码 92a9a34](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/agents.md)，Cascade 的当前目录补充[官方文档](https://docs.devin.ai/desktop/cascade/skills)。本项目尚未对所有第三方宿主进行运行验证。

只有合同测试通过的具名 family 才计安装适配数；地区版和 IDE/CLI 不重复计数。远程/云端不继承本地资源或预览能力，应在其实际工作区安装检查。第三方安装器只有通过完整目录复制测试后才可作为渠道，本指南不承诺 npx skills add 本仓库已可用。
`;
const guide=`# 第一步：安装插件

需要一个能读写文件、运行制作工具的 AI 助手。目前没有公开下载页，请向作者获取正式安装包或本地源码。当前版本：**${version}**。

## 把这段话发给助手

替换【】里的内容，并把本页一起交给助手：

> 请帮我安装 wukong-drama。我用【软件名称，如 Codex】，安装文件在【位置】。请按安装操作参考选择合适的方式，说明装到哪里，完成安装并检查制作工具。先不要生成图片或视频。

助手请读[安装操作参考](agent-installation-reference.md)。不同软件和安装包的用法不同，不能只解压就当作装好了。

## 确认装好了

按软件提示启用、刷新或新开聊天，再说：

> 用 wukong-drama 检查环境，列出可用画风。只检查，不生成。

助手能找到插件、所需工具已就绪，并能列出真人影视、二维卡通和水墨画风，就完成了这一步。**接着看[第二步：准备账号和模型](providers.md)。** 安装成功不代表生成服务已经可用。

## 有问题怎么办

- **找不到插件或缺少工具**：把提示交给助手，先查安装和启用状态，再补工具。
- **提示开发包、文件不完整或“同版本内容不同”**：保留现有文件，向作者索取版本清楚的正式包。
- **升级或卸载被拦住**：可能改过插件文件，先备份改动，再让助手核对。

换电脑或改用云端时，要在实际使用的环境重新安装、检查，作品素材也要带过去。

## 升级或卸载

告诉助手“升级／卸载 wukong-drama，保留作品、原始素材和剪映草稿”；升级时再提供新版文件位置。让它沿用原安装方式，先核对范围，再操作。

旧安装版本高于新包时，先备份作品、按原方式卸载，再安装。

具体命令和软件支持情况见[安装操作参考](agent-installation-reference.md)；维护者见[维护与打包](README.md#维护与打包)。
`;
const check=process.argv.includes('--check');
for(const [name,text] of [['agent-installation.md',guide],['agent-installation-reference.md',reference]]){
 const target=path.join(root,'docs',name);
 if(check){
  if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text){console.error(`安装说明不是最新：${name}；请运行 node tools/build-agent-docs.mjs`);process.exitCode=1;}
 }else fs.writeFileSync(target,text);
}

# 图片来源选择与结果回收

定调样图、角色／道具／场景设定、镜头画面、改图与副版均遵守本流程。**每批真正生成前使用问答窗口选择一次；窗口同时授权本批，不逐张问，也不再重复问同一批的生成许可。** 已有完整素材只复用，不制造新批次。新增项目、提示词／参考图／规格／来源变化、重生成或失败后切换时重新展示当前批次。

同一已授权批次的每项完成后立即回收并登记实际文件，然后主动处理下一项，不要求用户逐张回复“继续”。宿主调用中断先找回本次工具已返回的结果，已有文件不重生；只有确实无法回收的剩余项才重新展示来源选择和授权。长工具调用按 [宿主规范](../HOSTS.md) 保持60秒内实际进度更新；工具显示成功但无法读取文件时仍是待导入，不能标为完成。

## 1. 核实能力，准备批次

先按 HOSTS.md 检查当前会话真实可调用的生图工具，读取对应 skill。技能文件存在不代表工具可调用；同一工具的 skill 与内置入口只列一次。首版以 Codex 的 imagegen 为已研究的接入方式；其他宿主按实际能力声明，不凭品牌名推断。

将当次工具契约写到项目内的能力 JSON，交给 `--host`，例如下面的值**必须与当次发现一致，不能把示例当核实结果**：

```json
{
  "id": "codex-imagegen",
  "label": "Codex imagegen",
  "tool": "当前会话实际工具名称",
  "evidence": "本次工具发现与技能中相关能力的具体来源",
  "available": true,
  "references": true,
  "edit": true,
  "maxReferences": null
}
```

`maxReferences: null` 仅表示当前本地路径接口未声明固定数量，不是无限能力保证；实际还有文件类型、大小等约束时由 Agent 在展示选项前检查。若不能满足本批所需能力，将 available 设为 false 或不传 --host，说明原因。不支持参考图时不能删掉参考图硬做。宿主模型身份或精确尺寸控制未知时如实说明，不填入 API 模型 ID。

镜头从当前 JSON 自动读取提示词、参考图及批准的 settings，不另抄一份，避免脱节。改镜头时更新其 references/revision。局部批次在所有命令中保持相同 `--only` 和 `--aspect`。

非镜头资产使用 `--batch`：

```json
{
  "stage": "settings",
  "items": [
    {"id": "hero-v1-front", "prompt": "本次已明确的角色文字、造型和画风要求", "revision": "v1"}
  ]
}
```

stage 为 art（定调）、settings（设计设定图）、edit（一般改图）；items 每项对应一张图。id 稳定且不重复。references 为片目录内的相对路径，使用已确认设定时加 settings 引用。第一次定调/设定图还没有设定批准时省略 settings；不能把镜头伪装成定调来绕过门禁。edit 必须包含实际原图 references；编辑已有设定可继续使用 settings 阶段并带原图。

定调先 `wkd brief` 建目录；尚无 film.json 时，art 批次增加简报已确认的 `aspect: "16:9"`。API 配置与预算可放在该批次的 generation 对象，结构同 film.json；host 不需要。不会提前创建 film.json 或假定美术风格已经选定。已有 film.json 时以工程的 generation 与所选画幅为准。

## 2. 一张选择卡片完成本批确认

```bash
wkd image-plan <片目录> --host <本次能力.json> [--batch <资产批次.json>] [--only s01,s03] [--aspect 9:16]
```

只展示 routes 中 allowed 为 true 的来源。不可用项在说明中写原因；两项都不可用就解释阻塞，不自选。推荐采用 returned recommended：首次优先可用 Agent，之后按项目跨会话记住上次选择。推荐不能视为批准。

卡片示例（由真实计划填写，技术签名不用放进产品文案）：

> 本批将生成「角色正面、侧面」共 2 张，使用已列出的设定和参考图。请选择本批的生成方式并开始生成。
>
> - 当前 Agent 生图（推荐）：费用／额度由宿主管理，当前不可估算。
> - 自定义 API：实际服务和模型名称、本批费用估算上界与累计预算余量。

没有可用问答工具时用同一问题的文字选项，并等明确答复；纯 CLI 必须显式 method、signature、source。默认选中、空答、超时或工具返回均不等于批准。用户取消或暂不生成时不写批准。

得到真实选择后，一次记录选择与授权：

```bash
wkd image-approve <片目录> --host <本次能力.json> --method host --signature <该路线计划signature> --source "用户本次选择与生成授权原文或引用" [--batch ...] [--only ...] [--aspect ...]
```

选择 API 时改为 `--method api`，保留同样批次参数。API 需要配置密钥、每请求估价上界、累计费用及任务上限；host 不读 API 密钥，也不能被称为免费。图片统一从 image-plan 开始，经 image-approve 明确来源并授权；generation-plan / generation-approve 仅处理视频。

## 3. 调用与导入

```bash
wkd image-dispatch <片目录> --host <本次能力.json> --method host [--batch ...] [--only ...] [--aspect ...]
```

API 模式会执行已授权批次。host 模式每次交接一个未完成项目，返回 item、signature、tool、prompt、references、aspect 和 requestedSize；**这只是交接，尚未生成**。Agent 使用当次真实工具调用，严格使用交接 prompt 与全部参考快照，将画幅要求放入工具支持的参数或提示词，不能偷偷添加无关内容。读完对应 skill 并遵守工具限制，改图需要时先查看原图；跨项目全局文件不能当作本批结果。

Codex 内置 imagegen 由 Agent 调用；skill 中 Python CLI 是另一个 API 通道，需要密钥，不能当成内置模型的 shell 包装或偷偷 fallback。内置工具不保证允许指定输出路径，也不保证返回 local_path。对真实返回的本地文件或宿主支持保存的本次结果进行回收；不扫描“最新图片”猜结果，不下载远程媒体绕过宿主展示限制。拿不到可读文件就保留 submitting，说明如何手动保存／导入，**不要重新调用模型**。

```bash
wkd image-import <片目录> --host <本次能力.json> --method host --item <交接item> --signature <交接signature> --file <本次结果绝对路径> --source "对应工具结果或用户手动保存的依据" [--batch ...] [--only ...] [--aspect ...]
```

引擎核对当前请求、参考快照、实际图片类型与解码，保留原结果及标准 PNG，记录用途、来源与内容哈希。实际文件就绪才算完成；这不等于审图通过。镜头会自动复用已完成 source，无须再把 image 路径写进镜头 JSON。设定图使用返回 output，转换为相对项目根的路径后 `settings-save`，并按设定规范集中审查。定调图先展示再选择美术方向。

同批继续执行 dispatch → 调用宿主 → import，直到 remaining 为 0，不重复询问本批已获授权的项目。发生失败或额度不足时暂停，说明原因，禁止自动换渠道或自动重试。已交接但结果未知先核对工具记录；只有用户决定重新生成才改 revision 并重新计划。改用另一来源也要重新计划并获得本批选择；成功项自动保留，只生成剩余项。实际输出仍按原有节点展示、审查和签批。

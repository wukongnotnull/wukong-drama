# 角色／道具／场景设定

第 5 道 · 审片节点④。剧本先确定本片对象，设定集中确认后进入分镜。

## 三类设定库

标准工程 `项目/films/<片名>/` 共用项目根的 `characters.json`、`props.json`、`scenes.json`；单独片目录使用本片的库。角色沿用既有角色档案，旧剧情批准不等于参考图已审。创建版本：

```json
{
  "kind": "character",
  "id": "hero",
  "version": "v1-coat",
  "name": "主角",
  "state": "冬装",
  "importance": "key",
  "description": "短发、深蓝外套、左袖有白色补丁；脸型与瞳色保持一致",
  "references": ["assets/settings/hero-v1-coat.png"],
  "notes": "本片开场到室外段落使用"
}
```

`wkd settings-save <项目目录> --file 设定.json` 不覆盖既有版本。类别为 `character`、`prop`、`scene`；`importance` 为 `key` 或 `minor`，默认 key。重点对象必须有非空文字和真实可读参考图；简化对象可仅文字。参考路径相对项目根，不得越出工程。角色也可沿用 `appearance` 字段，声线在 `voice` 中保存。

角色描述脸型、发型、服装、配饰与禁止变化项；道具描述形状、尺度、材质及剧情状态；场景描述环境、重要空间关系和昼夜。剧情需要的换装、破损、昼夜等使用新版本和明确 state，多视图按需补充。

## 本片清单

`wkd init` 自带 `settings.json`；旧片运行 `wkd settings-init <片>`，不会覆盖已有清单。把三类 pending 分别改为 used 或带原因的 not-applicable：

```json
{
  "version": 1,
  "categories": {
    "characters": {"status":"used"},
    "props": {"status":"not-applicable","reason":"本片没有道具"},
    "scenes": {"status":"not-applicable","reason":"纯色背景"}
  },
  "selections": [{"kind":"character","id":"hero","version":"v1-coat"}]
}
```

每镜 JSON 的 `settings` 精确列出所用版本；无对象的镜头写 `[]`。引擎自动补入文字和参考图，不能只登记项目档案却忘记镜头关联。图片模型读取这些参考图，视频模型通过分镜首帧及稳定描述保持一致；结果仍需实际审看。

## 审查、沿用与返修

`wkd settings-review <片>` 生成 `review/设定审查.md/.json`，列出文字、参考图、复用／待审状态、缺项及主副版受影响镜头。导演实际打开图片后集中呈现，不能以摘要检查代替视觉审阅。用户确认新增／变化部分后，以报告 signature 执行 `wkd signoff <片> "实际确认结论" --step 5 --settings-signature <摘要>`。

全部对象都已获同风格批准且未变化时，用 `wkd settings-reuse <片> --signature <摘要>` 绑定本集复用，不重复索要已作出的批准。全无对象的首次清单须明确确认不适用。跨作品不会自动查找其他项目的库；引入素材或更换风格须重新确认适用性。

批准同时绑定文字、参考图字节、版本和风格；图片快照在项目 `.wkd-settings/approved/`，本片确认历史在 `.wkd/settings-approval.json`，都应备份。参考图或文字改变会使相关批准过期，不能通过 `revision` 或 `--force` 绕过。

修改优先新建版本，保留旧版；更新本片清单与受影响镜头，重新审查。报告列出待复核关联，是否重拍由实际差异决定。未关联变更项的镜头签名不变，可继续复用。所有新设定图及重拍图片按 [图片来源规范](IMAGES.md) 每批选择 Agent 或 API；图片局部批次的 image-plan、image-approve、image-dispatch、image-import 保持相同 --only sNN，图片就绪后 still --at sNN:0。视频计划与批准仍用 generation-plan/generation-approve，再 preview --only sNN；完整 render 仍需全片所有依赖有效。

旧项目的工序自动换算为 16 道，但不会生成不存在的设定签批；旧素材与任务保留，再提交模型任务前完成此节点。付费生成计划与授权继续独立执行，设定签批不是预算授权。

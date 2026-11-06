# 审阅证据规范

机器报告只证明列出的测量或文件检查。实际听感、画面含义与用户签批分别记录，不互相代替。

## review-notes.json

片目录可选文件，schema：`engine/schemas/review-notes.schema.json`。没有记录时保留待审，不补写历史审阅。

- 顶层 `version: 1`。
- `audio.sha256`：从当前 `review/声轨审听.json` 复制实际混音签名；不是文件名或任意自定义 id。
- `audio.sections`：音乐段落数组，每项 `id`、`label`、`range: [开始秒,结束秒]`。按音乐编排声明，不把每次镜头切换当成新段落。
- `audio.checks`：实际审听记录，含 `section`（报告窗口的 id）、覆盖该窗口的 `range`、`reviewer`、实际 `reviewedAt`、`verdict`、`note` 和 `evidence`。结论 accepted / needs-fix；听不到写 not-listened，只有数值检查写 measured。后两项不会被认作实际审听完成。
- `qc`：人工处置数组，每项 `finding`（当前报告的完整 id）、`disposition: accepted|needs-fix`、`range`、`reviewer`、实际 `reviewedAt`、`reason`、`evidence`。全片统计问题写实际抽查范围及全片设计理由；空理由、旧来源、越界范围不生效。

`evidence` 用具体事实，例如“在当前宿主播放本段”“打开报告对应的前后帧对照后确认是转场”。不能写没有实际发生的操作，也不能把代理的接受写成客户终审通过。修改后重跑 `wkd soundtrack` / `wkd qc`，原始测量不删除，报告列出有效处置与过期备注。

## decisions.json

`.wkd/decisions.json` 保存明确的用户决定，schema：`engine/schemas/decisions.schema.json`。delivery / aspects / subtitles / materials 各项包含 `status`、已确认的 `value` 和 `source`，只有实际可核实时才记录 confirmedAt。unknown 不填写猜测值。

delivery 的 value 为 video 或 video-and-draft；aspects 是主版在前的画幅数组；subtitles 是 `{mode,bilingual}`；materials 是 `{kind,use,path?,source?}` 数组，明确没有素材用已确认的空数组。source 写对应的已批准简报条目或用户明确结论；不从未签批的默认推荐推断授权。

## 恢复与交付

第一次交小样时说明它主要用于检查内容、动作和节奏，通常降低尺寸／帧率。终审前根据当前产物列出“小样 → 终版”的实际差异：画面是否复用同一源视频、切点／时长是否变化、声音与字幕是否调整、尺寸／帧率及编码变化。未变化写“沿用”，不泛称“高清提升”；720p源视频升到1080p编码仍是720p原生素材。无法核实的项写未核实，不能编造改善。终审用于确认最终交付文件，不因内容沿用而代签。

恢复先 `wkd resume <片> --json`，再按原命令补做；待签批节点仍等待用户。草稿内 `.wkd-owner.json/.wkd-complete.json` 和片内导出回执用于核实本次导出，不能删掉客户修改以制造“完整”。

交付先 `wkd delivery <片> --host codex --aspect all --json`；工具提供存在文件的链接及新旧状态，但没有实际打开/播放的文件仍是 not-tested。历史 unverified 项先核实，不把同名旧文件当作本次产物。无法验证的宿主明确注明边界。

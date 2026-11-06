# 配置操作参考（给助手）

普通用户先看[账号说明](providers.md)。本页只讲自定义 API 配置；助手自带生图使用当前可用工具，不需要这些 API 设置。

## 账号与型号

| 设置 | 图片 | 视频 |
| --- | --- | --- |
| provider | openai | seedance |
| 默认密钥环境变量 | OPENAI_API_KEY | ARK_API_KEY |
| 型号环境变量 | OPENAI_IMAGE_MODEL | SEEDANCE_MODEL |
| 工程配置位置 | generation.image | generation.video |

在 film.json 的对应配置中填写 model，可覆盖型号环境变量。视频没有默认型号；图片也应显式选择本次账号已开通的型号，不把程序的兜底值当作推荐。

密钥只放在实际运行环境，api_key_env 填环境变量名，不填密钥值。base_url 可配置服务地址，必须使用 HTTPS；仅本机测试地址允许 HTTP。不要展示密钥或把它写入工程。

## 声音

新片和 Seedance 请求默认 generate_audio 为 true，省略时也按开启处理。模型原生声音随视频保存并进入预览、成片和剪映；它是一条混合音轨，不会自动分离人声、配乐和音效。

需要无声画面或独立后期时，在 film.json 的 generation.video 中显式设置 `"generate_audio": false`；已有 false 保持关闭。不支持原生声音的旧型号也须显式关闭，提交前会检查，不自动降级。切换后重新核对计划和费用，等待本批开始授权。

## 费用与任务上限

- 每请求估价：图片填 estimated_cost_usd，视频填 estimated_cost_cny，均放在对应生成配置中。
- 总预算：generation.budget 中填写 image_usd、video_cny。
- 最多提交次数：同一 budget 中填写 max_image_tasks、max_video_tasks。

这些值要按本批模型、规格和服务报价核对，不能照抄示例。预算用于提交前检查，实际费用以服务账单为准。

## 调用前后

1. 用 resolveProvider 检查配置；assertProviderReady 只确认设置和密钥存在，不验证账号权限或余额。
2. 先用 validateVideoRequest 核对视频规格，再制作所需参考图；提交前用 validateImageRequest／validateVideoInput 检查实际素材。当前视频 API 适配器提交文字与首帧图，不提交整片多参考视频。
3. 图片走 image-plan → 用户选择并授权 → image-approve；视频走 generation-plan → 弹窗明确确认开始 → generation-approve。配置、测试或旧授权不代替本批确认。
4. 提交前保存状态，取得任务 ID 后立即记录；超时或结果不明先查原任务，不自动重发。下载完成并取得实际文件后再继续。

具体字段以[生成接口](../plugin/engine/providers/index.mjs)、[图片适配器](../plugin/engine/providers/openai.mjs)、[视频适配器](../plugin/engine/providers/seedance.mjs)和[工程格式](../plugin/engine/schemas/film.schema.json)为准。离线检查运行 node --test tests/unit/generation-providers.test.mjs，不调用真实服务。

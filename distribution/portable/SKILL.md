---
name: wukong-drama
description: 用图片模型与视频模型制作真人影视、动漫与水墨短剧，或继续在制作品；包括环境检查、浏览风格、简报、剧本、分镜、声音、字幕、渲染和剪映草稿交付。
---

# wukong-drama

先取得当前实际加载的本 SKILL.md 的真实绝对位置，其所在目录就是安装根；引擎为该根下 engine/bin/wkd.mjs。不得从工作目录、源码仓库或缓存版本猜测安装根。制作命令在用户选择的作品目录执行，安装目录不能当作品目录。

先读 [宿主能力规则](skills/director/HOSTS.md)。环境安装或检查读 [setup](skills/setup/INSTRUCTIONS.md)；浏览/推荐风格读 [styles](skills/styles/INSTRUCTIONS.md)；开拍/恢复作品读 [film](skills/film/INSTRUCTIONS.md)，并按 [director](skills/director/INSTRUCTIONS.md) 执行；创建风格读 [new-style](skills/new-style/INSTRUCTIONS.md)。它们是同一制作流程，不能以开拍请求代替后续审片签批。

检查环境用 `node "<安装根>/engine/bin/wkd.mjs" check`，列风格用 `node "<安装根>/engine/bin/wkd.mjs" list styles`。setup 未通过不得报告本地制作环境已就绪；check 不验证真实 API。生成须按导演流程提交当前批次计划，绑定实际用户授权；模型源素材和任务记录必须备份。新作品写入用户选定目录；现有作品先核对状态再继续。没有终端或文件权限时只完成能完成的简报/剧本，说明执行限制并等待合适环境，不虚报安装或渲染成功。

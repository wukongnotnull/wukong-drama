# 测试导航

运行 `npm test` 覆盖unit与integration；`npm run lint` 包含架构检查。测试与fixture不进入插件运行包。

| 领域 | 主要入口 |
|---|---|
| 领域与导出边界 | unit/module-boundaries.test.mjs、integration/architecture-evidence.test.mjs |
| 生成与图片批次 | unit/generation-*.test.mjs、unit/image-source.test.mjs、integration/generation-pipeline.test.mjs |
| 当前工程与风格格式 | unit/film-format.test.mjs、unit/model-style-format.test.mjs |
| 设定、系列与批准 | unit/settings.test.mjs、unit/series.test.mjs、unit/approval.test.mjs |
| 交付与恢复 | unit/final-delivery.test.mjs、integration/final-delivery.test.mjs、integration/recovery-delivery.test.mjs |
| 构建资源与开发门禁 | unit/package-resources.test.mjs、unit/development-install.test.mjs、unit/plugin-package.test.mjs |
| 便携安装完整生命周期 | integration/portable-installation.test.mjs |
| 声音、字幕与时间轴 | unit及integration中的audio／subtitle／timing相关文件 |

保留unit／integration／fixtures／helpers，不按源码目录机械搬迁。会构建当前工作区的回归显式使用development，临时安装必须显式允许且目标限于测试临时目录；正式模式由已提交隔离fixture或干净提交核验。技术fixture不证明真实模型或宿主画面已验证。

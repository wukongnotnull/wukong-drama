# 文档导航

| 想做什么 | 看这里 |
| --- | --- |
| 安装、升级或卸载 | [安装说明](agent-installation.md) |
| 准备账号和模型 | [账号说明](providers.md) |
| 让助手执行安装 | [安装操作参考](agent-installation-reference.md) |
| 让助手填写生成配置 | [配置操作参考](providers-reference.md) |
| 查看版本规则 | [版本说明](VERSIONING.md) |
| 了解来源和许可 | [来源说明](UPSTREAM.md) |

## 维护与打包

源码在 plugin，构建在 tools，宿主适配在 distribution，测试在 tests。制作规范以[导演技能](../plugin/skills/director/SKILL.md)为准，测试入口见[测试导航](../tests/README.md)。

```bash
npm ci
npm run setup
npm test
npm run lint
npm run build:plugin
npm run build:portable
```

正式包从干净提交构建，记录来源和文件摘要；开发验证加 --development，便携开发包安装须加 --allow-development。两种包保留来源和媒体许可，排除密钥、依赖、缓存及普通用户作品。

创建风格统一用 wkd new style；贡献内置风格时显式指定 --dest plugin/skills、--category 和未占用的 --order。

修改安装说明时，编辑 tools/build-agent-docs.mjs 后重新生成；改画风后运行 npm run catalog。版本同步见[版本说明](VERSIONING.md)。不要直接改已安装插件缓存。

离线测试不代表真实模型、费用或剪映界面已验收。任何真实视频生成仍须先弹窗展示模型、数量、时长、费用和预算，等用户明确确认开始。

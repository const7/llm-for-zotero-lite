# 本项目开发约定

## 依赖目录

项目位于 OneDrive，`node_modules` 必须软链接到 `~/.cache/project-deps/llm-for-zotero-lite/node_modules`，不能在项目内创建实体依赖目录。构建、测试前确认链接有效；安装或更新依赖在外部缓存目录执行，以项目的 `package.json` 和 `package-lock.json` 为准，更新后同步回项目。

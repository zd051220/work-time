# 自动生成中文更新日志

## 触发方式

当一个 PR 合并到 `main` 后，`.github/workflows/automatic-changelog.yml` 会启动。工作流读取仓库中已合并的 PR，并更新 `CHANGELOG.md` 的自动生成区块；不会修改 `version.json`，不会创建 Tag 或 GitHub Release。

## 分类与版本标签

- 必须明确设置一个 `release:major`、`release:minor` 或 `release:patch` 标签，才会进入自动更新日志。
- `release:none` 表示不写入更新日志。
- 没有版本标签的 PR 会跳过并计入日志提示，不根据标题猜测是否属于版本更新。
- 同时存在多个版本标签时，生成器会失败关闭，不提交不完整或含糊的更新日志。
- 标题按 Conventional Commits 前缀归类为新功能、问题修复、性能优化、安全改进、文档更新或工程优化；无法识别的标题归入「其他更新」。
- PR 描述仅提取首段作为简短说明，并清理 HTML、Markdown 标记和换行；PR 链接由仓库名和 PR 编号生成。

## 去重与安全

- 以 PR 编号去重，按合并时间倒序排列。
- 只处理 GitHub API 返回且具有 `merged_at` 的 PR。
- 自动生成内容仅替换 `CHANGELOG.md` 中 BEGIN/END 标记之间的区块，保留人工维护内容和历史版本章节。
- 工作流只在 PR 确认已合并后运行；顶层权限为空，写权限仅授予更新日志 job。
- PR 标题和描述只作为文本处理，不作为 shell 命令执行。
- 工作流使用 Node.js 内置 `fetch`，不引入第三方依赖。

## 本地测试

```sh
node --test .github/scripts/changelog.test.cjs
node --test .github/scripts/versioning.test.cjs
```

当前阶段仅自动维护未发布区的 PR 变更摘要，不自动决定发布日期、版本号或正式发布状态。

# 自动生成中文更新日志

## 触发与机器人 PR 流程

当一个 PR 合并到 `main` 后，`.github/workflows/automatic-changelog.yml` 会启动。工作流读取已合并 PR，生成 `CHANGELOG.md` 自动区块，并将结果推送到专用分支 `automation/changelog`，再创建或更新一个指向 `main` 的机器人 PR。

**工作流不会直接推送 `main`。** 仓库现有的 `main` 保护规则保持不变；机器人分支的强制更新仅作用于 `automation/changelog`，并使用 force-with-lease 防止覆盖并发产生的新提交。重复触发时，生成器会重新扫描全部可读取的已合并 PR，机器人 PR 始终呈现当前完整结果。

机器人 PR 不会自动合并。仍由维护者检查并按仓库规则决定是否合并。

## CI 如何可靠启动

机器人使用仓库自带的 `GITHUB_TOKEN` 创建或更新 PR。GitHub 对这类 PR 产生的 `pull_request` 检查可能要求有写权限的维护者手动批准，因此工作流**不把该事件当作唯一 CI 入口**。

为避免检查静默不运行：
- `.github/workflows/code-audit.yml` 同时支持 `workflow_dispatch`。
- 机器人 PR 创建或更新后，自动更新日志工作流通过 `gh workflow run code-audit.yml --ref automation/changelog` 显式派发完整审计。
- GitHub 允许由 `GITHUB_TOKEN` 触发的 `workflow_dispatch` 创建工作流运行；这项权限只授予自动更新日志 job。
- 派发失败会使自动更新日志工作流失败，不会把“未执行检查”伪装成成功。合并前仍须看到 PR 对应提交的必需审计检查成功。

`workflow_dispatch` 工作流必须存在于默认分支。因此，这套机器人 CI 派发机制会在本 PR 合并、审计工作流进入 `main` 后启用。当前 PR 本身仍由正常的 PR 检查验证。

## 分类与版本标签

- 必须明确设置一个 `release:major`、`release:minor` 或 `release:patch` 标签，才会进入自动更新日志。
- `release:none` 表示不写入更新日志。
- 没有版本标签的 PR 会跳过并计入日志提示，不根据标题猜测是否属于版本更新。
- 同时存在多个版本标签时，生成器会失败关闭，不提交不完整或含糊的更新日志。
- 标题按 Conventional Commits 前缀归类为新功能、问题修复、性能优化、安全改进、文档更新或工程优化；无法识别的标题归入「其他更新」。
- PR 描述仅提取首段作为简短说明，并清理 HTML、Markdown 标记和换行；PR 链接由仓库名和 PR 编号生成。

## 去重、分页与内容保护

- 以 PR 编号去重，按合并时间倒序排列。
- 只处理 GitHub API 返回且具有 `merged_at` 的 PR。
- 每页最多读取 100 条，最多完整读取 20 页（2000 条）；如果第 21 页探测到仍有记录，生成器会失败关闭，不会使用截断数据覆盖文件。
- API 请求失败、返回格式异常、标签结构异常或版本标签冲突都会中止生成；文件写入发生在完整读取和校验之后。
- 自动生成内容仅替换 `CHANGELOG.md` 中唯一且顺序正确的 BEGIN/END 标记区块。标记缺失、重复、配对不完整或 END 位于 BEGIN 之前时都会报错，保留原文件不写入。
- 区块外的人工维护内容和历史版本章节保持不变。
- PR 标题和描述只作为文本处理，不作为 shell 命令执行。

## 权限与发布边界

- 顶层工作流权限为空；job 仅授予创建机器人分支所需的 `contents: write`、创建 PR 所需的 `pull-requests: write`，以及显式派发审计所需的 `actions: write`。
- `code-audit` 本身只有 `contents: read`，checkout 不保留凭据。
- 自动流程不写入 `main`，不修改 `version.json`，不创建 Tag 或 GitHub Release，也不触发正式发布。
- 不需要预先配置个人 PAT 或 GitHub App 私钥。

## 本地测试

```sh
node --test .github/scripts/changelog.test.cjs
node --test .github/scripts/versioning.test.cjs
```

当前阶段仅自动维护未发布区的 PR 变更摘要，不自动决定发布日期、版本号或正式发布状态。

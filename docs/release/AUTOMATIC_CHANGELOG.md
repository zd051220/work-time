# 自动生成中文更新日志

## 触发与机器人 PR 流程

当一个 PR 合并到 `main` 后，`.github/workflows/automatic-changelog.yml` 会启动。工作流读取已合并 PR，生成 `CHANGELOG.md` 自动区块，并将结果推送到专用分支 `automation/changelog`，再创建或更新一个指向 `main` 的机器人 PR。

**工作流不会直接推送 `main`。** 仓库现有的 `main` 保护规则保持不变；机器人分支的强制更新仅作用于 `automation/changelog`，并使用 force-with-lease 防止覆盖并发产生的新提交。重复触发时，生成器会重新扫描全部可读取的已合并 PR，机器人 PR 始终呈现当前完整结果。

机器人 PR 不会自动合并。仍由维护者检查并按仓库规则决定是否合并。

## CI 如何可靠启动

机器人使用仓库自带的 `GITHUB_TOKEN` 创建或更新 PR。GitHub 对这类 PR 产生的 `pull_request` 检查可能要求有写权限的维护者手动批准，因此工作流**不把该事件当作唯一 CI 入口**。

为避免检查静默不运行：
- `.github/workflows/code-audit.yml` 支持 `workflow_dispatch`，也支持作为可复用工作流被其他工作流调用。
- 正式 CHANGELOG 机器人流程仍通过 `workflow_dispatch` 显式启动审计，因此该 job 保留 `actions: write`。
- 隔离 E2E 测试不再调用 Actions API 派发审计，而是在同一工作流中调用可复用的 `code-audit.yml`，并将审计目标明确设为 `automation/changelog-e2e-test`。
- 隔离测试 job 不再申请 `actions: write`；审计 job 只申请 `contents: read`，checkout 不保留凭据。
- 这样测试 job 的仓库级写权限不再包含“启动任意 workflow”的能力，避免它能借此启动 `formal-release.yml`。

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

- 顶层工作流权限为空。正式 CHANGELOG 机器人 job 仅因需要显式派发审计而授予 `actions: write`；隔离 E2E 测试 job 只授予 `contents: write` 和 `pull-requests: write`，不拥有启动其他工作流的权限。
- `code-audit` 作为独立运行或可复用工作流时均只需要 `contents: read`，checkout 不保留凭据。
- 自动流程不写入 `main`，不修改 `version.json`，不创建 Tag 或 GitHub Release，也不触发正式发布。
- 不需要预先配置个人 PAT 或 GitHub App 私钥。

## 本地测试

```sh
node --test .github/scripts/changelog.test.cjs
node --test .github/scripts/versioning.test.cjs
```

当前阶段仅自动维护未发布区的 PR 变更摘要，不自动决定发布日期、版本号或正式发布状态。

## 隔离端到端测试模式

维护者审核并合并测试模式代码后，可在 GitHub Actions 中手动运行 `automatic-changelog`，必须选择 `main` 分支并显式勾选 `test_mode=true`。测试 job 同时校验 `workflow_dispatch`、`github.ref == 'refs/heads/main'` 和布尔输入；默认值为 `false`。从其他分支触发或未勾选测试开关均不会执行测试 job。正式更新日志 job 仍只响应已合并到 `main` 的 PR。

测试模式使用固定模拟数据（一个带 `release:patch` 标签的 PR 和一个无标签 PR），调用同一更新日志生成器，并且只允许写入：

`docs/release/e2e-test/CHANGELOG.test.md`

随后在专用分支 `automation/changelog-e2e-test` 创建或更新草稿测试 PR（目标为 `main`），再调用可复用的 `code-audit.yml` 对该测试分支执行完整审计。这里不通过 `workflow_dispatch` 派发另一个工作流，因此测试 job 不需要 `actions: write`。测试 PR 不自动合并；检查完成后由维护者人工关闭并清理测试分支。

此模式不读取或写入正式 `CHANGELOG.md`，不修改 `version.json`，不创建 Tag 或 Release，也不调用正式发布工作流。测试 job 仅申请 `contents: write` 和 `pull-requests: write`；审计 job 只读。注意：GitHub 的这两项权限是仓库级权限，并非只对测试分支生效；固定的测试分支名、固定文件路径和 main 分支保护规则属于操作层防线，不能误称为 Token 已获得分支级限权。测试 job 不拥有 `actions: write`，因此不能通过 Actions API 派发 `formal-release.yml`。测试模式输入固定为布尔开关，不接受任意文件路径、分支名或 PR 数据。


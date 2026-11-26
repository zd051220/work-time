# 自动生成中文更新日志

## 触发与机器人 PR 流程

当一个 PR 合并到 `main` 后，`.github/workflows/automatic-changelog.yml` 会启动。工作流读取已合并 PR，生成 `CHANGELOG.md` 自动区块，并将结果推送到专用分支 `automation/changelog`，再创建或更新一个指向 `main` 的机器人 PR。

**工作流不会直接推送 `main`。** 仓库现有的 `main` 保护规则保持不变；机器人分支的强制更新仅作用于 `automation/changelog`，并使用 force-with-lease 防止覆盖并发产生的新提交。重复触发时，生成器会重新扫描全部可读取的已合并 PR，机器人 PR 始终呈现当前完整结果。

机器人 PR 不会自动合并。仍由维护者检查并按仓库规则决定是否合并。

## CI 如何可靠启动

机器人分支需要获得**属于机器人 PR 自身提交**的 GitHub Actions 检查。单纯在原工作流里调用 reusable workflow，只会把检查记录在调用方的事件和提交上下文中；即使 checkout 了机器人分支代码，也不能把该检查变成机器人 PR head SHA 的检查。

因此，创建或更新机器人分支及 PR 使用专用 GitHub App installation token，而不是 `GITHUB_TOKEN`：
- App token 对 `work-time` 仓库仅申请 `contents: write`、`pull_requests: write` 和 `checks: read`。
- App token 推送机器人分支、创建或更新 PR；这些由 App token 触发的 push / pull_request 事件会启动仓库原生的 `code-audit.yml`。
- 原生 `pull_request` 审计运行在机器人 PR 的事件上下文中，检查记录关联到该 PR 的提交；E2E job 会等待测试 PR 的检查完成。
- 不再使用 reusable workflow 冒充机器人 PR 的审计结果，也不使用 `workflow_dispatch` 作为 PR 必需检查。
- 工作流的 `GITHUB_TOKEN` 仍保持只读 `contents: read`；自动更新日志 job 和隔离测试 job 均不授予 `actions: write`。

**一次性仓库配置：**需要创建并安装一个专用于此仓库的 GitHub App，授予上述三项最小权限，并在仓库 Actions secrets 中配置：
- `CHANGELOG_APP_ID`：GitHub App ID。
- `CHANGELOG_APP_PRIVATE_KEY`：该 App 的私钥 PEM。

App installation 必须覆盖 `zd051220/work-time`。如果缺少密钥或 App 权限不足，工作流会在写入机器人分支之前失败关闭，不会退回到无法触发 PR 检查的 `GITHUB_TOKEN` 方案。无需个人 PAT。该 App 不需要 `Actions: write` 权限。

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

- 顶层工作流权限为空；自动化 job 的内置 `GITHUB_TOKEN` 只授予 `contents: read`。用于机器人分支和 PR 的专用 GitHub App token 仅授予 `contents: write`、`pull_requests: write`、`checks: read)，不授予 `actions: write`。
- `code-audit` 只需要 `contents: read`，checkout 不保留凭据。
- 自动流程不写入 `main`，不修改 `version.json`，不创建 Tag 或 GitHub Release，也不触发正式发布。
- 不使用个人 PAT；需要按上文配置专用 GitHub App ID 和私钥仓库密钥。

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

随后通过专用 GitHub App token 更新 `automation/changelog-e2e-test` 分支，并创建或更新目标为 `main` 的草稿测试 PR。工作流会检查 PR 的 head/base 分支，并在 PR 已被标记为 Ready 时将其恢复为 Draft；无法确认 Draft 状态就失败关闭。App token 触发的 `pull_request` 事件会启动默认分支中的 `code-audit.yml`，审计结果属于测试 PR 的提交；E2E job 会等待该 PR 检查完成。正式 CHANGELOG 机器人 PR 使用相同机制，审计也由对应 PR 的原生检查完成。

此模式不读取或写入正式 `CHANGELOG.md`，不修改 `version.json`，不创建 Tag 或 Release，也不调用正式发布工作流。自动化 job 的内置 `GITHUB_TOKEN` 仅为只读；写入机器人分支和 PR 的 GitHub App token 不具备 `actions: write`。注意：`contents: write` 和 `pull_requests: write` 是仓库级权限，并非分支级限权；固定测试分支名、固定文件路径和 main 分支保护规则属于操作层防线，不能误称为 Token 已获得分支级限权。测试模式输入固定为布尔开关，不接受任意文件路径、分支名或 PR 数据。

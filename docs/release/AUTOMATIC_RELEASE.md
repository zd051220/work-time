# 自动正式发布（受控启用）

本仓库的自动正式发布采用“两阶段”方式：普通功能 PR 合并后，只生成一个版本候选 PR；只有版本候选 PR 经检查并合并后，系统才会在对应 Pages 部署成功后创建正式 Git Tag 和 GitHub Release。

## 默认状态

自动正式发布默认关闭。工作流要求仓库变量 `AUTO_FORMAL_RELEASE_ENABLED=true`，未设置或不是字符串 `true` 时不会生成候选版本，也不会创建正式 Release。

## 启用前提

1. 仓库 Actions Secrets 已配置：
   - `CHANGELOG_APP_ID`
   - `CHANGELOG_APP_PRIVATE_KEY`
2. 对应 GitHub App 仅安装到本仓库，并具备 Contents: Read and write、Pull requests: Read and write 权限。
3. 仓库保护规则要求版本候选 PR 通过所需 CI 后才能合并。
4. 仓库 Pages 工作流应在 main 更新时部署，并以部署工作流名 `pages build and deployment` 报告对应提交 SHA。
5. 仓库变量 `AUTO_FORMAL_RELEASE_ENABLED` 设置为 `true`。

## 发布流程

1. 普通功能 PR 合并到 main 时，必须且只能带一个版本标签：`release:patch`、`release:minor` 或 `release:major`。
2. 工作流根据当前 `version.json` 计算下一个稳定 SemVer，并更新 `version.json` 与 `CHANGELOG.md`。
3. 工作流使用受限 GitHub App 凭据创建 `automation/release/vX.Y.Z` 分支及版本候选 PR。此时不会创建 Tag 或 Release。
4. 人工审查并合并版本候选 PR。
5. 合并事件触发发布验证：版本/分支一致性、CHANGELOG 章节、版本脚本测试、代码审计、游戏数据库检查、计时回归测试、远程 Tag 唯一性。
6. 工作流等待与该合并提交 SHA 完全匹配的 GitHub Pages 部署成功。
7. 只有所有验证通过后，独立的写权限 job 才创建正式 Tag 和 GitHub Release。

## 停止自动发布

将仓库变量 `AUTO_FORMAL_RELEASE_ENABLED` 删除或改为 `false`。变量同时保护候选生成和最终发布两个入口。已经生成的候选 PR 不会自动合并；关闭变量后，已存在的候选 PR 即使被合并也不会创建 Release。

## 安全边界

- 普通功能 PR 不直接创建 Tag 或 Release。
- 版本候选 PR 只允许修改 `version.json` 和 `CHANGELOG.md`。
- 自动发布不自动合并任何 PR。
- 版本验证与发布写权限分离。
- Tag 已存在、版本格式错误、CHANGELOG 缺失、任一审计失败、Pages 部署失败或无法确认部署状态时，均失败关闭。
- 本工作流只创建 GitHub Release，不自动把旧的 `v5.5.html` 文件改名为新版本文件；网页实际内容仍由 Pages 部署的 main 决定。

## 当前未完成的启用验收

在启用仓库变量前，必须完成该工作流在隔离分支上的 CI 验证，并在 GitHub Actions 中验证 GitHub App secrets、Pages 部署识别和候选 PR 创建权限。自动化测试不能替代真实仓库权限与 Pages 事件验收。

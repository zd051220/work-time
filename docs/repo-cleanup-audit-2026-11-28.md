# 仓库体检报告（2026-11-28，只报告不清理）

文件路径 | 问题类型 | 建议操作
--- | --- | ---
README.md | 版本清单仍列 v5.1–v5.4.1 历史页（main 已清理） | 更新为 v5.5 正式产物清单
docs/release/archive/release-manual.yml.md | 发布示例引用已下线旧版文件 | 标注历史示例或改为 v5.5.html
.github/scripts/versioning-browser.test.cjs | 未被任何工作流引用 | 接入 CI 或归档
.github/scripts/versioning-runtime.integration.test.cjs | 未被任何工作流引用 | 接入 CI 或归档
v5.1.html / v5.2.html / v5.3.html / v5.4.html / v5.4.1.html / ledger*.html / test-5.4.1.html / preview-*.html | 遗留旧版页面（main 已删、feat 仍在） | 合并主干后统一清理，本次不动
assets/cats/source/（本地未跟踪，约 22 MB） | 大体积源素材无 .gitignore | 加忽略规则或按需提交优化素材
assets/cats/web/、main-v55-check.html（本地未跟踪） | 临时预览/产物未归类 | 确认纳入版本或忽略
preview-ledger54-5.4.1-sync.html / preview-v5.4.1-sync.html / test-5.4.1.html（本地已删未提交） | 工作树存在未提交删除 | 确认后提交或恢复，本次不动
docs/cat-game-shop-launch.md | 上线清单仍有未完成项（删号 Edge Function、sbp_ 令牌） | 部署函数并撤销令牌后更新清单

零命中项：HTML 本地坏链 0、Markdown 本地坏链 0、明文凭据 0（8 处均为 service_role 说明性文字）、超 400 KB 跟踪文件 0、重复 HTML 0、非法 UTF-8 0。

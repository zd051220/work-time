# 小猫搬金条 · work-time

一个手机端的工作计时 / 搬金记录工具。当前 Web 版本使用 HTML + 原生 JavaScript，托管在 GitHub Pages，后端使用 Supabase 提供账号、云同步和游戏数据服务。

## 项目架构

项目正在进行渐进式架构整理。目标是分离页面展示、业务规则、数据访问和平台适配，同时保留现有线上页面地址。

- [项目架构规范与目标目录](docs/architecture/PROJECT_STRUCTURE.md)
- 当前正式网页：5.4.1
- 当前内测网页：v5.5
- 猫咪游戏：由内测父页面提供 RPC bridge
- 后端：Supabase Auth、Postgres、RPC 与 Edge Functions

## 在线地址

| 页面 | 地址 |
| --- | --- |
| 站点根地址 | https://zd051220.github.io/work-time/ |
| 当前主页 5.4.1 | https://zd051220.github.io/work-time/v5.4.1.html |
| 完整账本（5.4.1） | https://zd051220.github.io/work-time/ledger54-5.4.1.html |
| 上一版 5.4 | https://zd051220.github.io/work-time/v5.4.html |
| v5.5 内测版 | https://zd051220.github.io/work-time/beta-v5.5.html |
| 小猫游戏页 | https://zd051220.github.io/work-time/cat-workshop.html |

## 当前主要文件

| 文件 | 用途 |
| --- | --- |
| `index.html` | GitHub Pages 站点入口 |
| `v5.4.1.html` | 当前正式主页 |
| `ledger54-5.4.1.html` | 5.4.1 完整账本 |
| `beta-v5.5.html` | 独立内测版本，不自动替换正式版 |
| `cat-workshop.html` | 猫咪游戏页面，需从提供 RPC bridge 的父页面进入 |
| `v5.1.html`–`v5.4.html` | 历史版本与回滚参考 |
| `supabase/migrations/` | 数据库迁移历史 |
| `.github/scripts/` | 自动化检查脚本 |
| `.github/workflows/` | CI 与手动发布流程 |

## 计时与数据规则

- 实际工作、带薪摸鱼计薪；不带薪摸鱼暂停计薪。
- 跨午夜打卡按自然日拆分记录。
- 系统时间回退或长时间离线时进入核对流程，避免静默产生错误工时。
- 本地与云端数据必须按用户身份隔离。
- 游戏金币、购买、奖励和结算以服务端校验结果为准。

## 开发与发布约定

- 未完成兼容验证前，不移动或删除当前公开页面路径。
- 正式版与内测版分开维护；内测功能不得自动进入正式入口。
- 数据库 migration 必须先与生产 schema 和迁移历史核对，不得盲目重复执行。
- 不得将 Supabase service_role 或其他服务端秘密放入前端或仓库。
- CI 自动化测试通过不等于真实设备和生产环境端到端测试通过。
- 发布必须经过对应回归测试，并明确记录本次实际测试范围。

## 当前整理状态

项目架构整理在独立分支 `refactor/enterprise-structure` 中进行，不直接修改 `main` 生产分支。目录重排和代码拆分将分阶段实施，每阶段验证旧入口、页面导航、资源路径和数据行为后再考虑合并。

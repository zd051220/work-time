# 小猫搬金条 · work-time

一个手机端的工作计时 / 工资账本工具，猫咪养成作为辅助体验。Web 版本使用 HTML + 原生 JavaScript，托管在 GitHub Pages，后端使用 Supabase 提供账号、云同步和游戏数据服务。

## 项目架构

项目正在进行渐进式架构整理。目标是分离页面展示、业务规则、数据访问和平台适配，同时为未来原生微信小程序迁移做好准备。

- [项目架构规范与目标目录](docs/architecture/PROJECT_STRUCTURE.md)
- [版本号规范](docs/release/VERSIONING.md)
- [正式发布流程](docs/release/RELEASE_PROCESS.md)
- [发布回滚制度](docs/release/ROLLBACK.md)
- [正式发布检查清单](docs/release/RELEASE_CHECKLIST.md)
- [更新日志](CHANGELOG.md)
- 当前正式网页版本标识：**v5.5**（三段式 SemVer 规范切换中的过渡基线）
- 正式账本：**ledger-v5.5**
- 猫咪游戏：由正式主页提供受限 RPC bridge
- 后端：Supabase Auth、Postgres、RPC 与 Edge Functions

## 在线地址

| 页面 | 地址 |
| --- | --- |
| 站点根地址 | https://zd051220.github.io/work-time/ |
| 当前正式主页 5.5 | https://zd051220.github.io/work-time/v5.5.html |
| 当前正式账本 5.5 | https://zd051220.github.io/work-time/ledger-v5.5.html |
| 猫咪游戏页（需由主页进入） | https://zd051220.github.io/work-time/cat-workshop.html |

## 当前主要文件

| 文件 | 用途 |
| --- | --- |
| `index.html` | GitHub Pages 站点入口，自动进入当前正式主页 |
| `v5.5.html` | 当前正式主页：工作计时、工资账本入口、账号与游戏 |
| `ledger-v5.5.html` | 与主页共享本地数据和登录态的正式账本 |
| `beta-v5.5.html` | 旧入口兼容跳转，统一进入当前正式主页 |
| `cat-workshop.html` | 猫咪游戏页面，需从提供 RPC bridge 的正式主页进入 |
| `v5.1.html`–`v5.4.1.html` | 历史版本，后续归档整理 |
| `supabase/migrations/` | 数据库迁移历史 |
| `.github/scripts/` | 自动化检查脚本 |
| `.github/workflows/` | CI 与手动发布流程 |

## 计时与数据规则

- 实际工作、带薪摸鱼计薪；不带薪摸鱼暂停计薪。
- 跨午夜打卡按自然日拆分记录。
- 无感补时：切后台或离线期间按挂钟流逝时间自动全额计入计时，不设时长上限、不弹核对；系统时间回退时只重置计时基线、不倒扣。
- 账本每条记录提供「改」入口，可修改结束时间并按比例重算时长与金额，作为多计时或误操作后的唯一更正手段。
- 本地与云端数据必须按用户身份隔离。
- 游戏金币、购买、奖励和结算以服务端校验结果为准。

## 开发与发布约定

- 未完成兼容验证前，不移动或删除当前公开页面路径。
- 正式入口只指向当前稳定版本；历史版本归档，不作为默认入口。
- 数据库 migration 必须先与生产 schema 和迁移历史核对，不得盲目重复执行。
- 不得将 Supabase service_role 或其他服务端秘密放入前端或仓库。
- CI 自动化测试通过不等于真实设备和生产环境端到端测试通过。
- 发布必须经过对应回归测试，并明确记录本次实际测试范围。
- 正式版本使用 SemVer；预发布渠道、Git Tag、GitHub Release、公告和回滚按 `docs/release/` 执行。
- 当前 `version.json` 仍使用历史两段式版本标识；在确认运行时版本比较和缓存兼容性前，不擅自修改其格式。

## 当前整理状态

项目采用渐进式整理：每个阶段在独立分支完成，经过审查和验证后再合并到 `main`。不直接进行一次性大规模搬迁，不擅自修改生产数据库。目录重排和代码拆分前，必须先验证公开入口、资源路径、页面导航、缓存、本地数据和发布工作流。
